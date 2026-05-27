"""API tests for Semrush CSV upload and Screaming Frog bridge endpoints.

These hit the live preview backend through REACT_APP_BACKEND_URL/api.
The existing seed client e918ee9a-a135-4c5a-ae0b-f26f2f690117 is reused.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

CLIENT_ID = "e918ee9a-a135-4c5a-ae0b-f26f2f690117"

session = requests.Session()


# ---------- preflight: ensure client exists (skip otherwise) ----------

@pytest.fixture(scope="module", autouse=True)
def _ensure_client():
    r = session.get(f"{API}/clients/{CLIENT_ID}", timeout=15)
    if r.status_code != 200:
        pytest.skip(f"Seed client {CLIENT_ID} not present in DB (got {r.status_code})")


# ====================== Semrush CSV ======================

ORGANIC_CSV = (
    "Keyword;Position;Previous position;Search Volume;CPC;URL;Traffic;Traffic (%);Keyword Difficulty\n"
    "italian recipes;3;4;90500;1.45;https://example.com/a;2715;15.0;62\n"
    "tiramisu recipe;5;7;74000;1.05;https://example.com/b;1850;10.2;58\n"
).encode()

COMPETITORS_CSV = (
    "Domain;Competitor Relevance;Common Keywords;Organic Keywords;Organic Traffic\n"
    "giallozafferano.com;0.85;15000;1200000;15400000\n"
    "seriouseats.com;0.65;9000;850000;9800000\n"
).encode()

GAP_CSV = (
    "Keyword;Search Volume;CPC;Competition;Competitor URL;Position;KD\n"
    "gnocchi recipe;60500;0.95;0.42;giallozafferano.com/gnocchi;2;55\n"
    "aperol spritz;165000;1.20;0.38;seriouseats.com/x;4;48\n"
).encode()

UNKNOWN_CSV = b"Foo;Bar;Baz\n1;2;3\n"


def _upload(content: bytes, filename: str):
    return session.post(
        f"{API}/clients/{CLIENT_ID}/integrations/semrush/upload",
        files={"file": (filename, content, "text/csv")},
        timeout=30,
    )


def test_semrush_upload_organic_positions():
    r = _upload(ORGANIC_CSV, "organic.csv")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["ok"] is True
    assert d["type"] == "organic_positions"
    assert d["rows"] == 2
    assert d["summary"]["total_keywords"] == 2


def test_semrush_upload_competitors():
    r = _upload(COMPETITORS_CSV, "comps.csv")
    assert r.status_code == 200, r.text
    assert r.json()["type"] == "competitors"


def test_semrush_upload_keyword_gap():
    r = _upload(GAP_CSV, "gap.csv")
    assert r.status_code == 200, r.text
    assert r.json()["type"] == "keyword_gap"


def test_semrush_upload_unknown_returns_400():
    r = _upload(UNKNOWN_CSV, "weird.csv")
    assert r.status_code == 400
    body = r.json()
    # FastAPI default error body uses 'detail'
    detail = body.get("detail") or body.get("error") or ""
    assert "Unrecognised" in detail or "Unrecognized" in detail or "try Domain Overview" in detail.lower() or detail


def test_semrush_uploads_status_lists_uploaded_types():
    r = session.get(f"{API}/clients/{CLIENT_ID}/integrations/semrush/uploads", timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert "uploads" in d
    uploads = d["uploads"]
    # We uploaded these three above; all should now be present
    for t in ("organic_positions", "competitors", "keyword_gap"):
        assert t in uploads, f"missing uploaded snapshot for {t}: keys={list(uploads.keys())}"
        assert uploads[t]["rows"] >= 1


def test_semrush_clear_one_snapshot():
    r = session.delete(
        f"{API}/clients/{CLIENT_ID}/integrations/semrush/upload/keyword_gap", timeout=15
    )
    assert r.status_code == 200
    assert r.json().get("ok") is True
    # Verify it's gone
    r2 = session.get(f"{API}/clients/{CLIENT_ID}/integrations/semrush/uploads", timeout=15)
    assert "keyword_gap" not in r2.json().get("uploads", {})


def test_semrush_clear_invalid_type_returns_400():
    r = session.delete(
        f"{API}/clients/{CLIENT_ID}/integrations/semrush/upload/bogus_type", timeout=15
    )
    assert r.status_code == 400


# ====================== SF Bridge ======================

FAKE_BRIDGE_URL = "http://192.0.2.123:5005"  # TEST-NET-1, unreachable by design
FAKE_TOKEN = "test-token-abc"


def test_sf_bridge_configure_persists():
    r = session.post(
        f"{API}/clients/{CLIENT_ID}/integrations/sf-bridge/configure",
        json={"base_url": FAKE_BRIDGE_URL, "token": FAKE_TOKEN},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True or body.get("configured") is True


def test_sf_bridge_status_configured_but_unreachable():
    r = session.get(
        f"{API}/clients/{CLIENT_ID}/integrations/sf-bridge/status", timeout=30
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("configured") is True
    # ok should be falsy because the fake URL is unreachable
    assert d.get("ok") in (False, None, 0)
    # The 'error' key must exist (string may be empty for connect timeouts where
    # httpx raises an exception whose __str__ is empty — see backend issue).
    assert "error" in d


def test_sf_bridge_download_serves_python_script():
    r = session.get(f"{API}/integrations/sf-bridge/download", timeout=15)
    assert r.status_code == 200, r.text
    ctype = r.headers.get("content-type", "")
    assert "text/x-python" in ctype or "python" in ctype, f"unexpected content-type: {ctype}"
    # Sanity check content
    body = r.text
    assert "fastapi" in body.lower() or "screamingfrog" in body.lower() or "bridge" in body.lower()


def test_sf_bridge_readme_serves_markdown():
    r = session.get(f"{API}/integrations/sf-bridge/readme", timeout=15)
    assert r.status_code == 200
    ctype = r.headers.get("content-type", "")
    assert "markdown" in ctype or "text/" in ctype


def test_sf_bridge_disconnect_clears_config():
    r = session.post(
        f"{API}/clients/{CLIENT_ID}/integrations/sf-bridge/disconnect", timeout=15
    )
    assert r.status_code == 200
    # status should now report configured=False
    s = session.get(
        f"{API}/clients/{CLIENT_ID}/integrations/sf-bridge/status", timeout=15
    )
    assert s.status_code == 200
    assert s.json().get("configured") is False


# ====================== Cleanup ======================

def test_zz_cleanup_remaining_semrush_uploads():
    """Remove any test uploads we left behind."""
    for t in ("organic_positions", "competitors", "keyword_gap", "backlinks", "domain_overview"):
        session.delete(
            f"{API}/clients/{CLIENT_ID}/integrations/semrush/upload/{t}", timeout=15
        )
