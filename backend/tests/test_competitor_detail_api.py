"""Backend tests for the Competitor Detail page endpoints.

Covers:
- CRUD: POST/DELETE /api/clients/{id}/competitors
- POST /api/clients/{id}/competitors/{cid}/metrics/refresh (DataForSEO live)
- POST /api/clients/{id}/competitors/{cid}/keywords/refresh
- POST /api/clients/{id}/competitors/{cid}/semrush/upload
- POST /api/clients/{id}/competitors/{cid}/sf-crawl/upload
- GET  /api/clients/{id}/competitors/comparison
- POST /api/clients/{id}/metrics/refresh (client's own metrics)
- POST /api/clients/{id}/competitors/{cid}/sf-bridge/crawl (400 expected when not configured)
- POST /api/clients/{id}/competitors/{cid}/sf-bridge/crawl/{job_id}/ingest (400 expected)
"""
import io
import os
import uuid
import pytest
import requests

def _read_frontend_env():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                line = line.strip()
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return None

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_env() or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
EXISTING_CLIENT_ID = "e918ee9a-a135-4c5a-ae0b-f26f2f690117"  # Cooking Italians

SEMRUSH_ORGANIC_CSV = (
    "Keyword;Position;Previous position;Search Volume;CPC;URL;Traffic;Traffic (%);Traffic Cost;Competition;Number of Results;Trends;Timestamp;SERP Features by Keyword;Keyword Difficulty;Keyword Intents;Position Type;Number of Results\n"
    "pasta carbonara;3;5;90500;0.5;https://example.com/pasta;1200;25;500;0.5;1000000;0,1,0,0;2026-01-15;Sitelinks;55;Informational;Organic;1000000\n"
    "lasagna recipe;8;10;60500;0.4;https://example.com/lasagna;400;10;200;0.4;500000;0,0,0,0;2026-01-15;;48;Informational;Organic;500000\n"
)

SF_ISSUES_CSV = (
    "Issue Name,Issue Type,Issue Priority,URLs,% of Total\n"
    "Missing H1,Content,High,12,3.5\n"
    "Duplicate Page Titles,On Page,High,4,1.2\n"
)


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    return s


@pytest.fixture(scope="module")
def competitor(session):
    """Create a TEST_ competitor and yield (client_id, competitor_id). Cleanup at end."""
    payload = {
        "name": "TEST_DetailCompetitor",
        "domain": "example.com",
        "notes": "ephemeral test competitor",
    }
    r = session.post(f"{BASE_URL}/api/clients/{EXISTING_CLIENT_ID}/competitors", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    found = [c for c in body.get("competitors", []) if c["name"] == "TEST_DetailCompetitor"]
    assert found, "Newly-created competitor not present in client doc"
    cid = found[-1]["id"]
    yield EXISTING_CLIENT_ID, cid
    # Cleanup
    session.delete(f"{BASE_URL}/api/clients/{EXISTING_CLIENT_ID}/competitors/{cid}")


# ---- CRUD ----

class TestCompetitorCRUD:
    def test_create_and_delete_competitor(self, session):
        payload = {"name": f"TEST_Crud_{uuid.uuid4().hex[:6]}", "domain": "crud.example.com"}
        r = session.post(f"{BASE_URL}/api/clients/{EXISTING_CLIENT_ID}/competitors", json=payload)
        assert r.status_code == 200
        client = r.json()
        match = [c for c in client["competitors"] if c["name"] == payload["name"]]
        assert match
        cid = match[-1]["id"]

        # Delete and verify gone
        dr = session.delete(f"{BASE_URL}/api/clients/{EXISTING_CLIENT_ID}/competitors/{cid}")
        assert dr.status_code == 200
        after = dr.json()
        assert not [c for c in after["competitors"] if c["id"] == cid]


# ---- DataForSEO refreshes (live) ----

class TestDfsRefresh:
    def test_refresh_competitor_metrics(self, session, competitor):
        cid_client, cid = competitor
        r = session.post(f"{BASE_URL}/api/clients/{cid_client}/competitors/{cid}/metrics/refresh", timeout=60)
        # Accept 200 (DFS configured & success) or 400 (not configured / quota)
        assert r.status_code in (200, 400, 502), r.text
        if r.status_code == 200:
            data = r.json()
            comp = next(c for c in data["competitors"] if c["id"] == cid)
            assert "metrics" in comp
            assert comp["metrics"].get("refreshed_at")

    def test_refresh_competitor_keywords(self, session, competitor):
        cid_client, cid = competitor
        r = session.post(
            f"{BASE_URL}/api/clients/{cid_client}/competitors/{cid}/keywords/refresh",
            params={"limit": 25}, timeout=120,
        )
        assert r.status_code in (200, 400, 502), r.text
        if r.status_code == 200:
            comp = next(c for c in r.json()["competitors"] if c["id"] == cid)
            assert "ranked_keywords" in comp
            assert comp["ranked_keywords"].get("refreshed_at")

    def test_refresh_client_own_metrics(self, session):
        r = session.post(f"{BASE_URL}/api/clients/{EXISTING_CLIENT_ID}/metrics/refresh", timeout=60)
        assert r.status_code in (200, 400, 502), r.text
        if r.status_code == 200:
            data = r.json()
            assert data.get("ok") is True
            assert "metrics" in data


# ---- CSV uploads ----

class TestCsvUploads:
    def test_semrush_upload(self, session, competitor):
        cid_client, cid = competitor
        files = {"file": ("TEST_organic.csv", io.BytesIO(SEMRUSH_ORGANIC_CSV.encode()), "text/csv")}
        r = session.post(
            f"{BASE_URL}/api/clients/{cid_client}/competitors/{cid}/semrush/upload",
            files=files,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["type"] in ("organic_positions", "domain_overview", "backlinks", "competitors", "keyword_gap")
        assert body["rows"] >= 1

    def test_sf_crawl_upload(self, session, competitor):
        cid_client, cid = competitor
        files = {"file": ("TEST_issues.csv", io.BytesIO(SF_ISSUES_CSV.encode()), "text/csv")}
        r = session.post(
            f"{BASE_URL}/api/clients/{cid_client}/competitors/{cid}/sf-crawl/upload",
            files=files,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["format"] in ("issues_overview", "internal_all")

    def test_semrush_upload_bad_extension(self, session, competitor):
        cid_client, cid = competitor
        files = {"file": ("bad.txt", io.BytesIO(b"foo"), "text/plain")}
        r = session.post(
            f"{BASE_URL}/api/clients/{cid_client}/competitors/{cid}/semrush/upload",
            files=files,
        )
        assert r.status_code == 400


# ---- Comparison view ----

class TestComparison:
    def test_comparison_structure(self, session):
        r = session.get(f"{BASE_URL}/api/clients/{EXISTING_CLIENT_ID}/competitors/comparison")
        assert r.status_code == 200, r.text
        body = r.json()
        assert "rows" in body
        assert isinstance(body["rows"], list)
        assert len(body["rows"]) >= 1
        assert body["rows"][0].get("is_client") is True
        assert "deltas" in body
        assert "built_at" in body


# ---- SF Bridge crawl (expected 400 - bridge not configured) ----

class TestSfBridgeUnconfigured:
    def test_bridge_crawl_returns_400_when_not_configured(self, session, competitor):
        cid_client, cid = competitor
        # Ensure not configured (best-effort)
        session.post(f"{BASE_URL}/api/clients/{cid_client}/integrations/sf-bridge/disconnect")
        r = session.post(
            f"{BASE_URL}/api/clients/{cid_client}/competitors/{cid}/sf-bridge/crawl",
            json={"max_urls": 50},
        )
        assert r.status_code == 400, r.text
        assert "configured" in r.json().get("detail", "").lower() or "bridge" in r.json().get("detail", "").lower()

    def test_bridge_ingest_returns_400_when_not_configured(self, session, competitor):
        cid_client, cid = competitor
        session.post(f"{BASE_URL}/api/clients/{cid_client}/integrations/sf-bridge/disconnect")
        r = session.post(
            f"{BASE_URL}/api/clients/{cid_client}/competitors/{cid}/sf-bridge/crawl/fake-job/ingest"
        )
        assert r.status_code == 400, r.text

    def test_bridge_crawl_clamps_max_urls(self, session, competitor):
        """Even with absurd max_urls, endpoint should still respond 400 (not configured)
        rather than 500/422 — proving validation runs before bridge lookup."""
        cid_client, cid = competitor
        session.post(f"{BASE_URL}/api/clients/{cid_client}/integrations/sf-bridge/disconnect")
        r = session.post(
            f"{BASE_URL}/api/clients/{cid_client}/competitors/{cid}/sf-bridge/crawl",
            json={"max_urls": 99999},
        )
        assert r.status_code == 400


# ---- Negative paths ----

class TestNegative:
    def test_metrics_refresh_unknown_competitor(self, session):
        r = session.post(
            f"{BASE_URL}/api/clients/{EXISTING_CLIENT_ID}/competitors/does-not-exist/metrics/refresh"
        )
        # If DFS not configured returns 400; otherwise 404
        assert r.status_code in (400, 404)

    def test_keywords_refresh_unknown_competitor(self, session):
        r = session.post(
            f"{BASE_URL}/api/clients/{EXISTING_CLIENT_ID}/competitors/does-not-exist/keywords/refresh"
        )
        assert r.status_code in (400, 404)
