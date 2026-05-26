"""Google Search Console OAuth + API integration.

- OAuth 2.0 authorization code flow (web server / confidential client).
- Per-client tokens stored encrypted in MongoDB under client.gsc.tokens.
- Auto-refresh of access tokens via stored refresh_token.
- Search Console API: list sites + Search Analytics (queries/pages/clicks/impressions/CTR/position).
"""
from __future__ import annotations

import base64
import json
import os
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote, urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorDatabase

load_dotenv()

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.environ.get("GOOGLE_REDIRECT_URI", "")
FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "")
FERNET_KEY = os.environ.get("FERNET_KEY", "")

GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
GSC_API_BASE = "https://www.googleapis.com/webmasters/v3"
GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
USERINFO_SCOPE = "https://www.googleapis.com/auth/userinfo.email"

_fernet = Fernet(FERNET_KEY.encode("utf-8")) if FERNET_KEY else None


def is_configured() -> bool:
    return all([GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, FERNET_KEY])


# ---------- Crypto ----------

def encrypt(plaintext: str) -> str:
    if not _fernet:
        raise RuntimeError("FERNET_KEY not configured")
    return _fernet.encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt(ciphertext: str) -> str:
    if not _fernet:
        raise RuntimeError("FERNET_KEY not configured")
    try:
        return _fernet.decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("Invalid encrypted token") from exc


# ---------- OAuth helpers ----------

def build_state(client_id: str) -> str:
    payload = {"client_id": client_id, "nonce": secrets.token_urlsafe(16)}
    return base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8")).decode("utf-8")


def parse_state(state: str) -> Dict[str, Any]:
    raw = base64.urlsafe_b64decode(state.encode("utf-8"))
    return json.loads(raw.decode("utf-8"))


def build_authorization_url(state: str) -> str:
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": f"{GSC_SCOPE} {USERINFO_SCOPE}",
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
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "grant_type": "authorization_code",
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(GOOGLE_TOKEN_URL, data=data)
        resp.raise_for_status()
        body = resp.json()
    return body


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
            resp = await client.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if resp.status_code == 200:
                return resp.json().get("email")
    except Exception:
        return None
    return None


def _expiry_from_expires_in(expires_in: Any) -> Optional[str]:
    if not isinstance(expires_in, (int, float)):
        return None
    return (datetime.now(timezone.utc) + timedelta(seconds=int(expires_in) - 30)).isoformat()


# ---------- DB ops (per client) ----------

async def save_gsc_tokens(
    db: AsyncIOMotorDatabase,
    client_id: str,
    access_token: str,
    refresh_token: str,
    expiry_iso: Optional[str],
    scope: str,
    token_type: str,
    google_email: Optional[str],
) -> None:
    update = {
        "$set": {
            "gsc.connected": True,
            "gsc.google_email": google_email,
            "gsc.tokens.access_token_enc": encrypt(access_token),
            "gsc.tokens.refresh_token_enc": encrypt(refresh_token),
            "gsc.tokens.expiry": expiry_iso,
            "gsc.tokens.scope": scope,
            "gsc.tokens.token_type": token_type,
            "integrations.gsc_connected": True,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    }
    await db.clients.update_one({"id": client_id}, update)


async def update_access_token_only(
    db: AsyncIOMotorDatabase,
    client_id: str,
    access_token: str,
    expiry_iso: Optional[str],
) -> None:
    await db.clients.update_one(
        {"id": client_id},
        {
            "$set": {
                "gsc.tokens.access_token_enc": encrypt(access_token),
                "gsc.tokens.expiry": expiry_iso,
            }
        },
    )


async def get_gsc_state(db: AsyncIOMotorDatabase, client_id: str) -> Optional[Dict[str, Any]]:
    doc = await db.clients.find_one({"id": client_id}, {"_id": 0, "gsc": 1})
    if not doc:
        return None
    return doc.get("gsc") or {}


async def ensure_valid_access_token(
    db: AsyncIOMotorDatabase, client_id: str
) -> Tuple[str, str]:
    state = await get_gsc_state(db, client_id)
    if not state or not state.get("tokens"):
        raise ValueError("Client has no GSC tokens. Connect GSC first.")
    tokens = state["tokens"]
    access_enc = tokens.get("access_token_enc")
    refresh_enc = tokens.get("refresh_token_enc")
    expiry_iso = tokens.get("expiry")
    if not access_enc or not refresh_enc:
        raise ValueError("GSC tokens incomplete")

    access_token = decrypt(access_enc)
    refresh_token = decrypt(refresh_enc)

    needs_refresh = True
    if expiry_iso:
        try:
            expiry = datetime.fromisoformat(expiry_iso)
            if expiry > datetime.now(timezone.utc):
                needs_refresh = False
        except Exception:
            needs_refresh = True

    if needs_refresh:
        refreshed = await refresh_access_token(refresh_token)
        new_access = refreshed.get("access_token")
        if not new_access:
            raise ValueError("Failed to refresh GSC access token")
        new_expiry = _expiry_from_expires_in(refreshed.get("expires_in"))
        await update_access_token_only(db, client_id, new_access, new_expiry)
        access_token = new_access

    return access_token, refresh_token


async def disconnect(db: AsyncIOMotorDatabase, client_id: str) -> None:
    await db.clients.update_one(
        {"id": client_id},
        {
            "$set": {
                "gsc": {"connected": False},
                "integrations.gsc_connected": False,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )


async def set_selected_site(db: AsyncIOMotorDatabase, client_id: str, site_url: str) -> None:
    await db.clients.update_one(
        {"id": client_id},
        {"$set": {"gsc.selected_site_url": site_url}},
    )


# ---------- Search Console API ----------

async def list_sites(access_token: str) -> List[Dict[str, Any]]:
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(
            f"{GSC_API_BASE}/sites",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        resp.raise_for_status()
        body = resp.json()
    return body.get("siteEntry", [])


async def query_search_analytics(
    access_token: str,
    site_url: str,
    start_date: date,
    end_date: date,
    dimensions: List[str],
    row_limit: int = 1000,
) -> Dict[str, Any]:
    url = f"{GSC_API_BASE}/sites/{quote(site_url, safe='')}/searchAnalytics/query"
    body = {
        "startDate": start_date.isoformat(),
        "endDate": end_date.isoformat(),
        "dimensions": dimensions,
        "rowLimit": row_limit,
    }
    async with httpx.AsyncClient(timeout=40.0) as client:
        resp = await client.post(
            url,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json=body,
        )
        resp.raise_for_status()
        return resp.json()


async def pull_28d_performance(
    db: AsyncIOMotorDatabase, client_id: str, site_url: str
) -> Dict[str, Any]:
    access_token, _ = await ensure_valid_access_token(db, client_id)
    today = date.today()
    end_date = today - timedelta(days=3)
    start_date = end_date - timedelta(days=27)

    # Pull two slices: by query, by page. Keep it light.
    by_query = await query_search_analytics(
        access_token, site_url, start_date, end_date, ["query"], row_limit=500
    )
    by_page = await query_search_analytics(
        access_token, site_url, start_date, end_date, ["page"], row_limit=200
    )

    def _norm(rows):
        out = []
        for r in rows or []:
            out.append({
                "key": (r.get("keys") or [None])[0],
                "clicks": r.get("clicks", 0),
                "impressions": r.get("impressions", 0),
                "ctr": round(float(r.get("ctr", 0)) * 100, 2),
                "position": round(float(r.get("position", 0)), 1),
            })
        return out

    cache = {
        "site_url": site_url,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "by_query": _norm(by_query.get("rows")),
        "by_page": _norm(by_page.get("rows")),
        "totals": {
            "queries": len(by_query.get("rows") or []),
            "pages": len(by_page.get("rows") or []),
            "clicks": sum(r.get("clicks", 0) for r in by_query.get("rows") or []),
            "impressions": sum(r.get("impressions", 0) for r in by_query.get("rows") or []),
        },
        "refreshed_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.clients.update_one(
        {"id": client_id},
        {"$set": {"gsc.performance_cache": cache, "gsc.last_refreshed_at": cache["refreshed_at"]}},
    )
    return cache


async def get_performance_cache(db: AsyncIOMotorDatabase, client_id: str) -> Optional[Dict[str, Any]]:
    state = await get_gsc_state(db, client_id)
    if not state:
        return None
    return state.get("performance_cache")
