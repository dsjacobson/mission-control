"""Backend API tests for Autonomous SEO Agency Operator.

Covers:
- Health check
- Dashboard summary
- Client CRUD + competitors + integrations
- Workflow runs (background AI tasks) + active runs
- Approvals listing/decisions
- Cascade delete
"""
from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Optional

import pytest
import requests
from dotenv import load_dotenv

# Load frontend .env to get REACT_APP_BACKEND_URL
load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

# Reuse a session per module
session = requests.Session()
session.headers.update({"Content-Type": "application/json"})

# Shared state between tests within this module
STATE: dict = {}


# ---------------- Health ----------------

def test_health_root():
    r = session.get(f"{API}/", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data.get("status") == "ok"
    assert data.get("service") == "seo-operator"


# ---------------- Dashboard ----------------

def test_dashboard_summary_shape():
    r = session.get(f"{API}/dashboard/summary", timeout=15)
    assert r.status_code == 200
    data = r.json()
    for k in ("total_clients", "active_runs", "completed_runs", "pending_approvals", "recent_runs"):
        assert k in data, f"missing key: {k}"
    assert isinstance(data["total_clients"], int)
    assert isinstance(data["recent_runs"], list)


# ---------------- Clients ----------------

def test_create_client():
    payload = {
        "name": "TEST_Acme Outdoors",
        "domain": "test-acme-outdoors.example",
        "target_markets": ["US", "CA"],
        "goals": "Grow organic traffic 30% in 6 months",
        "industry": "Outdoor retail",
        "notes": "Test client",
    }
    r = session.post(f"{API}/clients", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["name"] == payload["name"]
    assert data["domain"] == payload["domain"]
    assert data["target_markets"] == ["US", "CA"]
    assert data["goals"] == payload["goals"]
    assert isinstance(data["id"], str) and data["id"]
    assert "integrations" in data
    assert "competitors" in data
    STATE["client_id"] = data["id"]


def test_get_client():
    cid = STATE["client_id"]
    r = session.get(f"{API}/clients/{cid}", timeout=15)
    assert r.status_code == 200
    assert r.json()["id"] == cid


def test_list_clients():
    r = session.get(f"{API}/clients", timeout=15)
    assert r.status_code == 200
    arr = r.json()
    assert isinstance(arr, list)
    assert any(c["id"] == STATE["client_id"] for c in arr)


def test_patch_client():
    cid = STATE["client_id"]
    r = session.patch(f"{API}/clients/{cid}", json={"notes": "Updated notes", "industry": "Outdoor gear"}, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data["notes"] == "Updated notes"
    assert data["industry"] == "Outdoor gear"
    # Verify persistence
    r2 = session.get(f"{API}/clients/{cid}")
    assert r2.json()["notes"] == "Updated notes"


def test_get_client_404():
    r = session.get(f"{API}/clients/does-not-exist", timeout=10)
    assert r.status_code == 404


# ---------------- Competitors ----------------

def test_add_competitor():
    cid = STATE["client_id"]
    r = session.post(
        f"{API}/clients/{cid}/competitors",
        json={"name": "REI", "domain": "rei.com", "notes": "Major player"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    comps = data["competitors"]
    assert len(comps) == 1
    assert comps[0]["domain"] == "rei.com"
    STATE["competitor_id"] = comps[0]["id"]


def test_delete_competitor():
    cid = STATE["client_id"]
    comp_id = STATE["competitor_id"]
    # Add a second so we can remove one
    r = session.post(
        f"{API}/clients/{cid}/competitors",
        json={"name": "Backcountry", "domain": "backcountry.com"},
        timeout=15,
    )
    assert r.status_code == 200
    # Delete the first
    r = session.delete(f"{API}/clients/{cid}/competitors/{comp_id}", timeout=15)
    assert r.status_code == 200
    domains = [c["domain"] for c in r.json()["competitors"]]
    assert "rei.com" not in domains
    assert "backcountry.com" in domains


# ---------------- Integrations ----------------

def test_update_integrations():
    cid = STATE["client_id"]
    payload = {
        "gsc_connected": True,
        "ga_connected": False,
        "semrush_api_key": "test-key",
        "wordpress_url": "https://blog.test-acme-outdoors.example",
        "wordpress_user": "admin",
        "wordpress_app_password": "pw",
    }
    r = session.put(f"{API}/clients/{cid}/integrations", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["integrations"]["gsc_connected"] is True
    assert data["integrations"]["semrush_api_key"] == "test-key"


# ---------------- Workflow Runs ----------------

def _create_run(rtype: str, objective: str = "") -> str:
    cid = STATE["client_id"]
    r = session.post(f"{API}/runs", json={"client_id": cid, "type": rtype, "objective": objective}, timeout=20)
    assert r.status_code == 200, r.text
    run = r.json()
    assert run["client_id"] == cid
    assert run["type"] == rtype
    assert run["status"] in ("queued", "running")
    return run["id"]


def _wait_for_completion(run_id: str, timeout: int = 120) -> dict:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        r = session.get(f"{API}/runs/{run_id}", timeout=20)
        assert r.status_code == 200
        last = r.json()
        if last["status"] in ("completed", "failed"):
            return last
        time.sleep(3)
    return last  # type: ignore


def test_run_404():
    r = session.get(f"{API}/runs/nonexistent-run-id", timeout=10)
    assert r.status_code == 404


def test_create_run_invalid_client():
    r = session.post(f"{API}/runs", json={"client_id": "bad-id", "type": "keyword_research"}, timeout=15)
    assert r.status_code == 404


def test_list_active_runs_endpoint_works():
    r = session.get(f"{API}/runs/active/all", timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_keyword_research_run_completes():
    rid = _create_run("keyword_research", "Discover top opportunities")
    STATE["kw_run_id"] = rid
    final = _wait_for_completion(rid, timeout=150)
    assert final is not None
    assert final["status"] == "completed", f"Run did not complete: {final.get('status')} err={final.get('error')}"
    # logs include coordinator + keyword agent
    agents_seen = {log["agent"] for log in final["logs"]}
    assert "coordinator" in agents_seen
    assert "keyword" in agents_seen
    assert final["results"], "results should be non-empty"
    assert isinstance(final["plan"], list) and len(final["plan"]) >= 1
    assert final["started_at"] and final["completed_at"]


def test_list_runs_for_client():
    cid = STATE["client_id"]
    r = session.get(f"{API}/runs", params={"client_id": cid}, timeout=15)
    assert r.status_code == 200
    arr = r.json()
    assert any(run["id"] == STATE["kw_run_id"] for run in arr)


def test_technical_audit_run_completes():
    rid = _create_run("technical_audit", "Find P0/P1 issues")
    final = _wait_for_completion(rid, timeout=150)
    assert final["status"] == "completed", f"err={final.get('error')}"
    agents_seen = {log["agent"] for log in final["logs"]}
    assert "audit" in agents_seen


def test_competitor_analysis_run_completes():
    rid = _create_run("competitor_analysis", "Find content gaps")
    final = _wait_for_completion(rid, timeout=150)
    assert final["status"] == "completed", f"err={final.get('error')}"
    agents_seen = {log["agent"] for log in final["logs"]}
    assert "competitor" in agents_seen


def test_strategy_sprint_run_completes():
    rid = _create_run("strategy_sprint", "Monthly plan")
    STATE["strategy_run_id"] = rid
    final = _wait_for_completion(rid, timeout=150)
    assert final["status"] == "completed", f"err={final.get('error')}"
    agents_seen = {log["agent"] for log in final["logs"]}
    assert "strategy" in agents_seen


# ---------------- Approvals ----------------

def test_approvals_created_for_run():
    cid = STATE["client_id"]
    r = session.get(f"{API}/approvals", params={"client_id": cid}, timeout=15)
    assert r.status_code == 200
    approvals = r.json()
    assert isinstance(approvals, list)
    # After running keyword_research/technical_audit/competitor/strategy, some approvals should exist
    assert len(approvals) >= 1, "Expected at least 1 approval after running workflows"
    STATE["approval_id"] = approvals[0]["id"]


def test_approval_decision_approved():
    aid = STATE["approval_id"]
    r = session.post(
        f"{API}/approvals/{aid}/decision",
        json={"status": "approved", "note": "Looks good"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "approved"
    assert data["decided_at"]
    # Verify persistence via list filter
    r2 = session.get(f"{API}/approvals", params={"status": "approved"})
    assert any(a["id"] == aid for a in r2.json())


def test_approval_decision_invalid_status():
    aid = STATE["approval_id"]
    r = session.post(f"{API}/approvals/{aid}/decision", json={"status": "maybe"}, timeout=15)
    # Either Pydantic 422 or our 400
    assert r.status_code in (400, 422)


def test_approval_decision_404():
    r = session.post(f"{API}/approvals/nope/decision", json={"status": "rejected"}, timeout=15)
    assert r.status_code == 404


# ---------------- Cleanup / Cascade ----------------

def test_dashboard_after_runs():
    r = session.get(f"{API}/dashboard/summary", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data["completed_runs"] >= 1


def test_delete_client_cascades():
    cid = STATE["client_id"]
    r = session.delete(f"{API}/clients/{cid}", timeout=15)
    assert r.status_code == 200
    # Verify gone
    assert session.get(f"{API}/clients/{cid}").status_code == 404
    # Runs for this client should be gone
    runs = session.get(f"{API}/runs", params={"client_id": cid}).json()
    assert runs == []
    # Approvals for this client should be gone
    apps = session.get(f"{API}/approvals", params={"client_id": cid}).json()
    assert apps == []


def test_delete_client_404():
    r = session.delete(f"{API}/clients/already-gone", timeout=15)
    assert r.status_code == 404
