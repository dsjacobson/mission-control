"""Tests for the Tasks & Workers feature (assignable tasks + Claude Cowork seed).

Covers:
- Workers seed + list
- Tasks CRUD (create/list/get/update/delete)
- Task complete (non-recurring vs recurring: daily/weekly)
- notes_append timestamp behaviour
- validation (bad client_id, bad assignee_id)
"""
import os
import time
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API_KEY = os.environ.get("REACT_APP_AGENT_API_KEY") or os.environ.get("AGENT_API_KEY")

# Fallback: read from files if env not injected
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
if not API_KEY:
    with open("/app/backend/.env") as f:
        for line in f:
            if line.startswith("AGENT_API_KEY="):
                API_KEY = line.split("=", 1)[1].strip().strip('"')


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "X-API-Key": API_KEY or "",
    })
    return s


@pytest.fixture(scope="session")
def client_id(api_client):
    r = api_client.get(f"{BASE_URL}/api/clients")
    assert r.status_code == 200, f"could not list clients: {r.status_code} {r.text}"
    clients = r.json()
    if not clients:
        # create one to make the suite self-contained
        r2 = api_client.post(f"{BASE_URL}/api/clients", json={"name": "TEST_TasksClient"})
        assert r2.status_code == 200, r2.text
        return r2.json()["id"]
    return clients[0]["id"]


# ---------------- Workers ----------------
class TestWorkers:
    def test_workers_endpoint_returns_seed_agent(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/workers", params={"active": "true"})
        assert r.status_code == 200, r.text
        workers = r.json()
        assert isinstance(workers, list) and len(workers) >= 1
        cc = next((w for w in workers if w.get("id") == "claude-cowork"), None)
        assert cc is not None, f"Claude Cowork not seeded. Got: {workers}"
        assert cc["type"] == "agent"
        assert cc["name"] == "Claude Cowork"
        assert cc["active"] is True


# ---------------- Tasks: happy paths + validation ----------------
class TestTasksCRUD:
    created_ids = []

    def test_create_task_valid(self, api_client, client_id):
        r = api_client.post(
            f"{BASE_URL}/api/tasks",
            json={
                "client_id": client_id,
                "title": "TEST_task_basic",
                "instructions": "do the thing",
                "assignee_id": "claude-cowork",
                "recurrence": "none",
            },
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["title"] == "TEST_task_basic"
        assert data["status"] == "open"
        assert data["assignee_id"] == "claude-cowork"
        assert data["client_id"] == client_id
        assert "id" in data
        TestTasksCRUD.created_ids.append(data["id"])

    def test_create_task_invalid_client(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/tasks",
            json={"client_id": "does-not-exist", "title": "TEST_bad_client"},
        )
        assert r.status_code == 404, r.text

    def test_create_task_invalid_assignee(self, api_client, client_id):
        r = api_client.post(
            f"{BASE_URL}/api/tasks",
            json={
                "client_id": client_id,
                "title": "TEST_bad_assignee",
                "assignee_id": "no-such-worker",
            },
        )
        assert r.status_code == 404, r.text

    def test_list_tasks_filter_status_open(self, api_client, client_id):
        r = api_client.get(
            f"{BASE_URL}/api/tasks",
            params={"client_id": client_id, "status": "open"},
        )
        assert r.status_code == 200, r.text
        tasks = r.json()
        assert isinstance(tasks, list)
        # every returned task must match filters
        for t in tasks:
            assert t["client_id"] == client_id
            assert t["status"] == "open"
        # our created task must be there
        assert any(t["id"] == TestTasksCRUD.created_ids[0] for t in tasks)

    def test_patch_status_and_assignee(self, api_client, client_id):
        # First reassign to a fresh worker to check assignee validation path
        # Create an ad-hoc human worker
        wr = api_client.post(
            f"{BASE_URL}/api/workers",
            json={"name": "TEST_human", "type": "human"},
        )
        assert wr.status_code == 200, wr.text
        worker_id = wr.json()["id"]

        task_id = TestTasksCRUD.created_ids[0]
        r = api_client.patch(
            f"{BASE_URL}/api/tasks/{task_id}",
            json={"status": "in_progress", "assignee_id": worker_id},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "in_progress"
        assert data["assignee_id"] == worker_id

        # Verify persistence via GET
        g = api_client.get(f"{BASE_URL}/api/tasks/{task_id}")
        assert g.status_code == 200
        assert g.json()["status"] == "in_progress"

    def test_patch_notes_append(self, api_client):
        task_id = TestTasksCRUD.created_ids[0]
        r = api_client.patch(
            f"{BASE_URL}/api/tasks/{task_id}",
            json={"notes_append": "first note"},
        )
        assert r.status_code == 200, r.text
        notes1 = r.json()["notes"]
        assert "first note" in notes1
        # Should be prefixed with a timestamp bracket like [2026-...]
        assert notes1.strip().startswith("[")

        r2 = api_client.patch(
            f"{BASE_URL}/api/tasks/{task_id}",
            json={"notes_append": "second note"},
        )
        assert r2.status_code == 200, r2.text
        notes2 = r2.json()["notes"]
        assert "first note" in notes2 and "second note" in notes2
        # 2 lines separated by newline
        assert notes2.count("\n") >= 1

    def test_complete_non_recurring(self, api_client, client_id):
        cr = api_client.post(
            f"{BASE_URL}/api/tasks",
            json={
                "client_id": client_id,
                "title": "TEST_complete_once",
                "assignee_id": "claude-cowork",
            },
        )
        assert cr.status_code == 200, cr.text
        tid = cr.json()["id"]
        TestTasksCRUD.created_ids.append(tid)

        r = api_client.post(f"{BASE_URL}/api/tasks/{tid}/complete", json={})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "done"
        assert data["last_completed_at"] is not None

    def test_complete_recurring_daily(self, api_client, client_id):
        cr = api_client.post(
            f"{BASE_URL}/api/tasks",
            json={
                "client_id": client_id,
                "title": "TEST_recurring_daily",
                "assignee_id": "claude-cowork",
                "recurrence": "daily",
            },
        )
        assert cr.status_code == 200, cr.text
        task = cr.json()
        tid = task["id"]
        TestTasksCRUD.created_ids.append(tid)
        # backend auto-sets due_at to now for recurring w/o due
        assert task["due_at"] is not None

        before = datetime.now(timezone.utc)
        r = api_client.post(f"{BASE_URL}/api/tasks/{tid}/complete", json={})
        assert r.status_code == 200, r.text
        data = r.json()
        # stays open because it recurs
        assert data["status"] == "open"
        assert data["last_completed_at"] is not None
        new_due = datetime.fromisoformat(data["due_at"])
        delta = new_due - before
        # ~1 day (allow generous window)
        assert timedelta(hours=23) <= delta <= timedelta(hours=25), f"delta={delta}"

    def test_complete_recurring_weekly(self, api_client, client_id):
        cr = api_client.post(
            f"{BASE_URL}/api/tasks",
            json={
                "client_id": client_id,
                "title": "TEST_recurring_weekly",
                "assignee_id": "claude-cowork",
                "recurrence": "weekly",
            },
        )
        assert cr.status_code == 200
        tid = cr.json()["id"]
        TestTasksCRUD.created_ids.append(tid)

        before = datetime.now(timezone.utc)
        r = api_client.post(f"{BASE_URL}/api/tasks/{tid}/complete", json={})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "open"
        new_due = datetime.fromisoformat(data["due_at"])
        delta = new_due - before
        assert timedelta(days=6, hours=23) <= delta <= timedelta(days=7, hours=1), f"delta={delta}"

    def test_delete_task(self, api_client, client_id):
        # Create a throwaway task
        cr = api_client.post(
            f"{BASE_URL}/api/tasks",
            json={"client_id": client_id, "title": "TEST_delete_me"},
        )
        assert cr.status_code == 200
        tid = cr.json()["id"]

        r = api_client.delete(f"{BASE_URL}/api/tasks/{tid}")
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True}

        g = api_client.get(f"{BASE_URL}/api/tasks/{tid}")
        assert g.status_code == 404

    @classmethod
    def teardown_class(cls):
        # cleanup any created tasks
        s = requests.Session()
        s.headers.update({"X-API-Key": API_KEY or ""})
        for tid in cls.created_ids:
            try:
                s.delete(f"{BASE_URL}/api/tasks/{tid}", timeout=10)
            except Exception:
                pass
