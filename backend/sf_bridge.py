"""Screaming Frog HTTP bridge client.

Architecture
------------
Screaming Frog's MCP runs locally over stdio — it can't be reached directly
from our cloud backend. To bridge that gap, the user runs a tiny HTTP wrapper
on their Windows desktop (we ship `bridge/sf_bridge.py`), which wraps the
`ScreamingFrogSEOSpiderCli.exe` and exposes a minimal REST API:

  GET  /health
  POST /crawl     {url, max_urls?, export_tabs?, bulk_exports?}
                  -> {job_id, status}
  GET  /crawl/{job_id}     -> {status, started_at, finished_at, error?}
  GET  /crawl/{job_id}/files            -> {files: [...]}
  GET  /crawl/{job_id}/file/{filename}  -> raw CSV body

They then expose the bridge with `ngrok http 8765`. We store the public URL +
shared token per-client and call it on demand.

Bridge token is sent as `X-SF-Token: <token>` header.
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

import httpx


class BridgeError(RuntimeError):
    pass


def _strip(url: str) -> str:
    return (url or "").strip().rstrip("/")


def _headers(token: Optional[str]) -> Dict[str, str]:
    h = {"Accept": "application/json"}
    if token:
        h["X-SF-Token"] = token
    return h


async def _rpc_get(base_url: str, token: Optional[str], path: str, timeout: float = 30.0) -> "httpx.Response":
    """Single GET with explicit connect/read timeouts (ngrok cold-starts can stall briefly)."""
    timeouts = httpx.Timeout(connect=15.0, read=timeout, write=15.0, pool=15.0)
    async with httpx.AsyncClient(timeout=timeouts) as c:
        return await c.get(f"{_strip(base_url)}{path}", headers=_headers(token))


async def test_connection(base_url: str, token: Optional[str] = None) -> Dict[str, Any]:
    base = _strip(base_url)
    if not base:
        return {"ok": False, "error": "no_url"}
    try:
        timeouts = httpx.Timeout(connect=10.0, read=15.0, write=10.0, pool=10.0)
        async with httpx.AsyncClient(timeout=timeouts) as c:
            r = await c.get(f"{base}/health", headers=_headers(token))
            if r.status_code == 401:
                return {"ok": False, "error": "unauthorized"}
            r.raise_for_status()
            data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        return {"ok": True, **data}
    except httpx.HTTPStatusError as e:
        return {"ok": False, "error": f"HTTP {e.response.status_code}"}
    except Exception as e:
        msg = str(e) or type(e).__name__
        return {"ok": False, "error": msg[:200]}


async def start_crawl(
    base_url: str,
    token: Optional[str],
    target_url: str,
    max_urls: int = 500,
    export_tabs: Optional[List[str]] = None,
    bulk_exports: Optional[List[str]] = None,
) -> Dict[str, Any]:
    payload = {
        "url": target_url,
        "max_urls": max_urls,
        "export_tabs": export_tabs or ["Internal:All", "Response Codes:Client Error (4xx)", "Page Titles:Missing"],
        "bulk_exports": bulk_exports or ["Issues:All"],
    }
    timeouts = httpx.Timeout(connect=15.0, read=30.0, write=15.0, pool=15.0)
    async with httpx.AsyncClient(timeout=timeouts) as c:
        r = await c.post(f"{_strip(base_url)}/crawl", json=payload, headers=_headers(token))
        if r.status_code >= 400:
            raise BridgeError(f"start_crawl HTTP {r.status_code}: {r.text[:300]}")
        return r.json()


async def get_status(base_url: str, token: Optional[str], job_id: str) -> Dict[str, Any]:
    # Two-attempt retry on transient connect failures (ngrok blips)
    last_err = None
    for attempt in range(2):
        try:
            r = await _rpc_get(base_url, token, f"/crawl/{job_id}", timeout=20.0)
            if r.status_code >= 400:
                raise BridgeError(f"get_status HTTP {r.status_code}: {r.text[:200]}")
            return r.json()
        except httpx.ConnectTimeout as e:
            last_err = e
            if attempt == 0:
                await asyncio.sleep(1.5)
                continue
            raise BridgeError("Connect timeout to bridge (ngrok blip — usually resolves on next poll)") from e
    raise BridgeError(f"get_status failed: {last_err}")


async def list_files(base_url: str, token: Optional[str], job_id: str) -> List[str]:
    r = await _rpc_get(base_url, token, f"/crawl/{job_id}/files", timeout=30.0)
    if r.status_code >= 400:
        raise BridgeError(f"list_files HTTP {r.status_code}: {r.text[:200]}")
    return (r.json() or {}).get("files", [])


async def fetch_file(base_url: str, token: Optional[str], job_id: str, filename: str) -> str:
    timeouts = httpx.Timeout(connect=15.0, read=180.0, write=30.0, pool=15.0)
    async with httpx.AsyncClient(timeout=timeouts) as c:
        r = await c.get(
            f"{_strip(base_url)}/crawl/{job_id}/file/{filename}",
            headers=_headers(token),
        )
        if r.status_code >= 400:
            raise BridgeError(f"fetch_file HTTP {r.status_code}: {r.text[:200]}")
        return r.text


async def wait_for_completion(
    base_url: str,
    token: Optional[str],
    job_id: str,
    timeout_s: int = 1800,
    poll_s: float = 4.0,
) -> Dict[str, Any]:
    deadline = asyncio.get_event_loop().time() + timeout_s
    last = {}
    while asyncio.get_event_loop().time() < deadline:
        last = await get_status(base_url, token, job_id)
        status = (last.get("status") or "").lower()
        if status in ("done", "completed", "finished", "success"):
            return last
        if status in ("failed", "error"):
            raise BridgeError(f"Crawl failed: {last.get('error', 'unknown')}")
        await asyncio.sleep(poll_s)
    raise BridgeError("Crawl timed out")


# ---------- Config storage ----------

async def save_config(db, client_id: str, base_url: str, token: str) -> None:
    await db.clients.update_one(
        {"id": client_id},
        {"$set": {"sf_bridge": {"base_url": _strip(base_url), "token": token}}},
    )


async def get_config(db, client_id: str) -> Optional[Dict[str, str]]:
    doc = await db.clients.find_one({"id": client_id}, {"_id": 0, "sf_bridge": 1})
    if not doc:
        return None
    cfg = doc.get("sf_bridge") or {}
    if not cfg.get("base_url"):
        return None
    return cfg


async def clear_config(db, client_id: str) -> None:
    await db.clients.update_one({"id": client_id}, {"$unset": {"sf_bridge": ""}})
