"""Google Analytics 4 (GA4) OAuth + Data API integration.

Reuses Google OAuth client credentials (same project as GSC). Stores per-client
tokens encrypted with Fernet under client.ga.tokens.

Scopes: analytics.readonly
"""
from __future__ import annotations

import base64
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode

import httpx
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorDatabase

from gsc import decrypt, encrypt  # reuse Fernet helpers

load_dotenv()

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "")

# Distinct callback URI for GA (must be registered in Google Cloud Console)
GA_REDIRECT_URI = os.environ.get(
    "GA_REDIRECT_URI",
    (FRONTEND_BASE_URL + "/api/integrations/ga/callback") if FRONTEND_BASE_URL else "",
)

GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"

GA_ADMIN_BASE = "https://analyticsadmin.googleapis.com/v1beta"
GA_DATA_BASE = "https://analyticsdata.googleapis.com/v1beta"

GA_SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
USERINFO_SCOPE = "https://www.googleapis.com/auth/userinfo.email"


def is_configured() -> bool:
    return bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and GA_REDIRECT_URI)


# ---------- OAuth ----------

def build_state(client_id: str) -> str:
    payload = {"client_id": client_id, "nonce": secrets.token_urlsafe(16)}
    return base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8")).decode("utf-8")


def parse_state(state: str) -> Dict[str, Any]:
    return json.loads(base64.urlsafe_b64decode(state.encode("utf-8")).decode("utf-8"))


def build_authorization_url(state: str) -> str:
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GA_REDIRECT_URI,
        "response_type": "code",
        "scope": f"{GA_SCOPE} {USERINFO_SCOPE}",
        "access_type": "offline",
        "include_granted_scopes": "true",
        "state": state,
        "prompt": "consent",
    }
    return f"{GOOGLE_AUTH_BASE}?{urlencode(params)}"


async def exchange_code_for_tokens(code: str) -> Dict[str, Any]:
    data = {
        "code": code,
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri": GA_REDIRECT_URI,
        "grant_type": "authorization_code",
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(GOOGLE_TOKEN_URL, data=data)
        resp.raise_for_status()
        return resp.json()


async def refresh_access_token(refresh_token: str) -> Dict[str, Any]:
    data = {
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(GOOGLE_TOKEN_URL, data=data)
        resp.raise_for_status()
        return resp.json()


async def fetch_google_email(access_token: str) -> Optional[str]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
            if r.status_code == 200:
                return r.json().get("email")
    except Exception:
        return None
    return None


def _expiry_from_expires_in(expires_in: Any) -> Optional[str]:
    if not isinstance(expires_in, (int, float)):
        return None
    return (datetime.now(timezone.utc) + timedelta(seconds=int(expires_in) - 30)).isoformat()


# ---------- DB ----------

async def save_tokens(
    db: AsyncIOMotorDatabase,
    client_id: str,
    access_token: str,
    refresh_token: str,
    expiry_iso: Optional[str],
    scope: str,
    token_type: str,
    google_email: Optional[str],
) -> None:
    await db.clients.update_one(
        {"id": client_id},
        {"$set": {
            "ga.connected": True,
            "ga.google_email": google_email,
            "ga.tokens.access_token_enc": encrypt(access_token),
            "ga.tokens.refresh_token_enc": encrypt(refresh_token),
            "ga.tokens.expiry": expiry_iso,
            "ga.tokens.scope": scope,
            "ga.tokens.token_type": token_type,
            "integrations.ga_connected": True,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )


async def get_state(db: AsyncIOMotorDatabase, client_id: str) -> Optional[Dict[str, Any]]:
    doc = await db.clients.find_one({"id": client_id}, {"_id": 0, "ga": 1})
    if not doc:
        return None
    return doc.get("ga") or {}


async def set_selected_property(db, client_id: str, property_id: str, property_name: str) -> None:
    await db.clients.update_one(
        {"id": client_id},
        {"$set": {"ga.selected_property_id": property_id, "ga.selected_property_name": property_name}},
    )


async def disconnect(db, client_id: str) -> None:
    await db.clients.update_one(
        {"id": client_id},
        {"$set": {"ga": {"connected": False}, "integrations.ga_connected": False,
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
    )


async def ensure_valid_access_token(db, client_id: str) -> Tuple[str, str]:
    state = await get_state(db, client_id)
    if not state or not state.get("tokens"):
        raise ValueError("Client has no GA tokens. Connect GA first.")
    tokens = state["tokens"]
    access_enc = tokens.get("access_token_enc")
    refresh_enc = tokens.get("refresh_token_enc")
    if not access_enc or not refresh_enc:
        raise ValueError("GA tokens incomplete")

    access_token = decrypt(access_enc)
    refresh_token = decrypt(refresh_enc)
    expiry_iso = tokens.get("expiry")

    needs_refresh = True
    if expiry_iso:
        try:
            if datetime.fromisoformat(expiry_iso) > datetime.now(timezone.utc):
                needs_refresh = False
        except Exception:
            pass

    if needs_refresh:
        refreshed = await refresh_access_token(refresh_token)
        new_access = refreshed.get("access_token")
        if not new_access:
            raise ValueError("Failed to refresh GA access token")
        new_expiry = _expiry_from_expires_in(refreshed.get("expires_in"))
        await db.clients.update_one(
            {"id": client_id},
            {"$set": {"ga.tokens.access_token_enc": encrypt(new_access), "ga.tokens.expiry": new_expiry}},
        )
        access_token = new_access

    return access_token, refresh_token


# ---------- GA API ----------

async def list_properties(access_token: str) -> List[Dict[str, Any]]:
    """List GA4 properties via accountSummaries."""
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(
            f"{GA_ADMIN_BASE}/accountSummaries",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        r.raise_for_status()
        body = r.json()
    out = []
    for acct in body.get("accountSummaries", []):
        for prop in acct.get("propertySummaries", []):
            out.append({
                "property": prop.get("property"),  # "properties/123456"
                "displayName": prop.get("displayName"),
                "account": acct.get("displayName"),
            })
    return out


async def run_report(access_token: str, property_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    url = f"{GA_DATA_BASE}/{property_id}:runReport"
    async with httpx.AsyncClient(timeout=40.0) as client:
        r = await client.post(
            url,
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            json=body,
        )
        r.raise_for_status()
        return r.json()


def _rows(report: Dict[str, Any]) -> List[Dict[str, Any]]:
    dims = [d.get("name") for d in report.get("dimensionHeaders") or []]
    mets = [m.get("name") for m in report.get("metricHeaders") or []]
    out = []
    for row in report.get("rows") or []:
        item = {}
        for i, v in enumerate(row.get("dimensionValues") or []):
            item[dims[i]] = v.get("value")
        for i, v in enumerate(row.get("metricValues") or []):
            item[mets[i]] = v.get("value")
        out.append(item)
    return out


async def pull_28d_traffic(db, client_id: str, property_id: str) -> Dict[str, Any]:
    access_token, _ = await ensure_valid_access_token(db, client_id)

    base_range = {"startDate": "28daysAgo", "endDate": "yesterday"}
    metrics = [
        {"name": "sessions"},
        {"name": "totalUsers"},
        {"name": "screenPageViews"},
        {"name": "engagementRate"},
        {"name": "averageSessionDuration"},
    ]

    overview = await run_report(access_token, property_id, {
        "dateRanges": [base_range],
        "metrics": metrics,
    })
    by_page = await run_report(access_token, property_id, {
        "dateRanges": [base_range],
        "dimensions": [{"name": "landingPagePlusQueryString"}],
        "metrics": metrics,
        "limit": 25,
        "orderBys": [{"metric": {"metricName": "sessions"}, "desc": True}],
    })
    by_source = await run_report(access_token, property_id, {
        "dateRanges": [base_range],
        "dimensions": [{"name": "sessionDefaultChannelGroup"}, {"name": "sessionSource"}],
        "metrics": metrics,
        "limit": 25,
        "orderBys": [{"metric": {"metricName": "sessions"}, "desc": True}],
    })
    by_device = await run_report(access_token, property_id, {
        "dateRanges": [base_range],
        "dimensions": [{"name": "deviceCategory"}],
        "metrics": [{"name": "sessions"}, {"name": "engagementRate"}],
    })

    cache = {
        "property_id": property_id,
        "totals": (_rows(overview) or [{}])[0],
        "top_pages": _rows(by_page),
        "by_source": _rows(by_source),
        "by_device": _rows(by_device),
        "refreshed_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.clients.update_one(
        {"id": client_id},
        {"$set": {"ga.performance_cache": cache, "ga.last_refreshed_at": cache["refreshed_at"]}},
    )
    return cache


async def get_performance_cache(db, client_id: str) -> Optional[Dict[str, Any]]:
    state = await get_state(db, client_id)
    if not state:
        return None
    return state.get("performance_cache")
