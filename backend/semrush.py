"""Minimal Semrush MCP HTTP client.

The official Semrush MCP server is at https://mcp.semrush.com/v1/mcp and uses
streamable HTTP transport. For our needs we only need single-shot JSON-RPC 2.0
calls (tools/list, tools/call) — no SSE, no bidirectional streaming.

Auth: Authorization: Apikey {SEMRUSH_API_KEY}
"""
from __future__ import annotations

import os
import uuid
from typing import Any, Dict, Optional

import httpx
from dotenv import load_dotenv

load_dotenv()

SEMRUSH_API_KEY = os.environ.get("SEMRUSH_API_KEY", "")
SEMRUSH_MCP_ENDPOINT = os.environ.get("SEMRUSH_MCP_ENDPOINT", "https://mcp.semrush.com/v1/mcp")


def is_configured() -> bool:
    return bool(SEMRUSH_API_KEY)


async def _rpc(method: str, params: Dict[str, Any]) -> Dict[str, Any]:
    if not is_configured():
        raise RuntimeError("Semrush MCP not configured")
    headers = {
        "Authorization": f"Apikey {SEMRUSH_API_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    payload = {
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": method,
        "params": params,
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(SEMRUSH_MCP_ENDPOINT, json=payload, headers=headers)
        resp.raise_for_status()
        ctype = resp.headers.get("content-type", "")
        if "text/event-stream" in ctype:
            # Parse last data: line from SSE
            data_line = None
            for line in resp.text.splitlines():
                if line.startswith("data:"):
                    data_line = line[5:].strip()
            if not data_line:
                raise RuntimeError("Empty SSE response from Semrush MCP")
            import json
            body = json.loads(data_line)
        else:
            body = resp.json()
    if "error" in body and body["error"]:
        raise RuntimeError(f"Semrush MCP error: {body['error']}")
    return body.get("result", {})


async def list_tools() -> Dict[str, Any]:
    return await _rpc("tools/list", {})


async def call_tool(name: str, arguments: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    return await _rpc("tools/call", {"name": name, "arguments": arguments or {}})


async def execute_report(report: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """Run any Semrush report via MCP execute_report tool. Returns parsed result."""
    res = await call_tool("execute_report", {"report": report, "params": params})
    content = res.get("content") or []
    if content and content[0].get("type") == "text":
        return {"raw": content[0].get("text", "")}
    return res


def _parse_semrush_csv(text: str, max_rows: int = 50) -> list:
    """Semrush returns CRLF-separated, semicolon-delimited rows with a header line."""
    if not text:
        return []
    rows = [r for r in text.splitlines() if r.strip()]
    if len(rows) < 2:
        return []
    header = [h.strip() for h in rows[0].split(";")]
    out = []
    for line in rows[1: 1 + max_rows]:
        parts = line.split(";")
        if len(parts) != len(header):
            continue
        out.append(dict(zip(header, parts)))
    return out


async def domain_competitors(domain: str, database: str = "us", limit: int = 15) -> list:
    """Top organic competitors with overlap stats."""
    raw = await execute_report("domain_organic_organic", {"domain": domain, "database": database})
    return _parse_semrush_csv(raw.get("raw", ""), max_rows=limit)


async def domain_organic_keywords(domain: str, database: str = "us", limit: int = 40) -> list:
    """Top organic keywords a domain ranks for."""
    raw = await execute_report("domain_organic", {"domain": domain, "database": database})
    return _parse_semrush_csv(raw.get("raw", ""), max_rows=limit)


async def phrase_batch_metrics(phrases: list, database: str = "us") -> list:
    """Batch keyword metrics (semicolon-separated phrases)."""
    phrase = ";".join(p.strip() for p in phrases if p and p.strip())
    if not phrase:
        return []
    raw = await execute_report("phrase_these", {"phrase": phrase, "database": database})
    return _parse_semrush_csv(raw.get("raw", ""), max_rows=len(phrases) + 5)


def _to_int(v):
    if v is None or v == "":
        return None
    try:
        return int(float(str(v).replace(",", "")))
    except (TypeError, ValueError):
        return None


async def backlinks_overview(target: str, target_type: str = "root_domain") -> dict | None:
    """High-level backlink metrics for a domain or URL via Semrush.
    Returns {backlinks, referring_domains, referring_domains_dofollow, referring_domains_nofollow,
    authority_score, trust_score, ips, urls, image_links}.
    """
    raw = await execute_report("backlinks_overview", {"target": target, "target_type": target_type})
    rows = _parse_semrush_csv(raw.get("raw", ""), max_rows=1)
    if not rows:
        return None
    r = rows[0]
    return {
        "backlinks": _to_int(r.get("total")),
        "referring_domains": _to_int(r.get("domains_num")),
        "referring_domains_dofollow": _to_int(r.get("follows_num")),
        "referring_domains_nofollow": _to_int(r.get("nofollows_num")),
        "authority_score": _to_int(r.get("score")),
        "trust_score": _to_int(r.get("trust_score")),
        "ips": _to_int(r.get("ips_num")),
        "urls_with_backlinks": _to_int(r.get("urls_num")),
        "image_backlinks": _to_int(r.get("images_num")),
    }


async def domain_rank(domain: str, database: str = "us") -> dict | None:
    """Domain-level snapshot: organic keyword count + traffic + cost for one region."""
    raw = await execute_report("domain_rank", {"domain": domain, "database": database})
    rows = _parse_semrush_csv(raw.get("raw", ""), max_rows=1)
    if not rows:
        return None
    r = rows[0]
    return {
        "rank": _to_int(r.get("Rank")),
        "organic_keywords": _to_int(r.get("Organic Keywords")),
        "organic_traffic": _to_int(r.get("Organic Traffic")),
        "organic_cost": _to_int(r.get("Organic Cost")),
        "adwords_keywords": _to_int(r.get("Adwords Keywords")),
        "adwords_traffic": _to_int(r.get("Adwords Traffic")),
        "database": database,
    }


async def test_connection() -> Dict[str, Any]:
    """Lightweight ping: try to list tools, return summary."""
    try:
        result = await list_tools()
        tools = result.get("tools", [])
        return {
            "ok": True,
            "tool_count": len(tools),
            "sample_tools": [t.get("name") for t in tools[:6]],
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}
