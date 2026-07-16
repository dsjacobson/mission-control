#!/usr/bin/env python3
"""End-to-end simulation of an autonomous agent (e.g. Claude Cowork) driving
the SEO Operator API via HTTP.

Runs the "monthly competitive analysis for all clients" workflow described in
CLAUDE-COWORK.md, top-to-bottom, using only public endpoints.

Usage:
    # With no auth (dev mode)
    python simulate_agent_session.py

    # With auth
    AGENT_API_KEY=your-key python simulate_agent_session.py
"""
from __future__ import annotations

import os
import sys
import time
from typing import Dict, List, Optional

import httpx
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BACKEND_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001")
API_KEY = os.environ.get("AGENT_API_KEY", "").strip()

HEADERS = {"X-API-Key": API_KEY} if API_KEY else {}


def _get(client: httpx.Client, path: str, **kwargs) -> dict | list:
    r = client.get(path, headers=HEADERS, timeout=30, **kwargs)
    r.raise_for_status()
    return r.json()


def _post(client: httpx.Client, path: str, json: Optional[dict] = None, **kwargs) -> dict | list:
    r = client.post(path, json=json or {}, headers=HEADERS, timeout=60, **kwargs)
    r.raise_for_status()
    return r.json()


def step(label: str, obj: object = None) -> None:
    print(f"\n\033[36m▶ {label}\033[0m")
    if obj is not None:
        if isinstance(obj, (dict, list)):
            import json as _json
            s = _json.dumps(obj, indent=2, default=str)
            if len(s) > 1200:
                s = s[:1200] + "\n… truncated"
            print(s)
        else:
            print(obj)


def main() -> int:
    base = f"{BACKEND_URL}/api"
    with httpx.Client(base_url=base) as c:
        # 1. Learn what we can do
        step("GET /api/agent/manifest (no auth needed)")
        manifest = _get(c, "/agent/manifest")
        print(f"  product={manifest.get('product')}")
        print(f"  workflows={list((manifest.get('workflows') or {}).keys())}")

        # 2. Auth + integration status
        step("GET /api/health")
        health = _get(c, "/health")
        print(f"  auth_required={health.get('auth_required')}  integrations={health.get('integrations')}")
        if health.get("auth_required") and not API_KEY:
            print("\n\033[31mAGENT_API_KEY is required — export it and retry.\033[0m")
            return 2

        # 3. Discover clients
        step("GET /api/clients")
        clients = _get(c, "/clients")
        print(f"  {len(clients)} clients: {[cl['name'] for cl in clients]}")
        if not clients:
            print("No clients — cannot run the workflow. Create one via POST /api/clients.")
            return 0

        # 4. Pick a target client and run the one-click flow
        target = None
        for cl in clients:
            if (cl.get("competitors") or []):
                target = cl
                break
        if not target:
            print("No client with competitors. Skipping the analysis flow.")
            return 0
        step(f"POST /api/clients/{target['id']}/competitive-analysis  ({target['name']})")
        start = time.time()
        launch = _post(c, f"/clients/{target['id']}/competitive-analysis")
        print(f"  run_id={launch.get('run_id')}")
        print(f"  metrics_refreshed={launch.get('metrics_refreshed')} / failed={launch.get('metrics_failed')}")
        print(f"  ranked_keywords_topped_up={launch.get('ranked_keywords_topped_up')}")

        run_id = launch["run_id"]

        # 5. Poll until complete
        step("Polling run status")
        while time.time() - start < 300:
            run = _get(c, f"/runs/{run_id}")
            status = run.get("status")
            print(f"  status={status}  approvals_pending={run.get('approvals_pending')}  ({int(time.time() - start)}s)")
            if status in ("completed", "failed"):
                break
            time.sleep(5)

        if run.get("status") != "completed":
            print(f"\033[31mRun did not complete cleanly: {run.get('error')}\033[0m")
            return 1

        # 6. Find the deliverable approval
        step("GET /api/approvals (find our deliverable)")
        approvals = _get(c, "/approvals", params={"client_id": target["id"], "status": "pending"})
        deliverable = next(
            (a for a in approvals if a.get("run_id") == run_id and a.get("kind") == "competitive_deliverable"),
            None,
        )
        if not deliverable:
            print("\033[31mNo matching deliverable found in the pending queue.\033[0m")
            return 1
        print(f"  approval_id={deliverable['id']}")
        print(f"  title={deliverable['title']}")

        # 7. Download the exports (proves format works)
        step(f"GET /api/approvals/{deliverable['id']}/export/docx")
        r = c.get(f"/approvals/{deliverable['id']}/export/docx", headers=HEADERS, timeout=60)
        r.raise_for_status()
        docx_size = len(r.content)
        print(f"  docx bytes={docx_size}")

        step(f"GET /api/approvals/{deliverable['id']}/export/xlsx")
        r = c.get(f"/approvals/{deliverable['id']}/export/xlsx", headers=HEADERS, timeout=60)
        r.raise_for_status()
        xlsx_size = len(r.content)
        print(f"  xlsx bytes={xlsx_size}")

        # 8. DO NOT approve automatically — this is where a human review is expected.
        step("Session complete — deliverable is PENDING for the user to review")
        print(f"  Review URL: {BACKEND_URL}/clients/{target['id']}/deliverables/competitive/{deliverable['id']}")
        print(f"  To approve: POST /api/approvals/{deliverable['id']}/decision  body: {{status: 'approved'}}")

        return 0


if __name__ == "__main__":
    sys.exit(main())
