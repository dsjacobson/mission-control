"""Tests for issue categorization."""
from issue_router import categorize_issue, derive_sf_issue_key


def test_metadata_buckets():
    assert categorize_issue("H1 - Missing")[0] == "metadata"
    assert categorize_issue("Page Title - Duplicate", "on_page")[0] == "metadata"
    assert categorize_issue("Meta Description - Over 155 Characters")[0] == "metadata"
    assert categorize_issue("H2 - Missing")[0] == "metadata"


def test_content_buckets():
    assert categorize_issue("Lorem Ipsum Placeholder Content on Live Pages")[0] == "content"
    assert categorize_issue("Thin Content")[0] == "content"
    assert categorize_issue("Duplicate Content - Near Duplicate")[0] == "content"
    assert categorize_issue("Images - Missing Alt Text")[0] == "content"


def test_structural_buckets():
    assert categorize_issue("Response Codes - 4xx Client Errors")[0] == "structural"
    assert categorize_issue("Redirect Chains")[0] == "structural"
    assert categorize_issue("Canonical - Missing")[0] == "structural"
    assert categorize_issue("Orphan Pages")[0] == "structural"
    assert categorize_issue("Internal links - Broken")[0] == "structural"


def test_performance_buckets():
    assert categorize_issue("CSS - Render Blocking")[0] == "performance"
    assert categorize_issue("Images - Over 100KB")[0] == "performance"
    assert categorize_issue("JavaScript - Render Blocking")[0] == "performance"


def test_security_buckets():
    assert categorize_issue("Security: Missing Content-Security-Policy Header")[0] == "security"
    assert categorize_issue("HSTS Header Missing")[0] == "security"
    assert categorize_issue("Mixed Content")[0] == "security"


def test_category_fallback():
    # When title doesn't have keywords, fall back to category
    bucket, conf = categorize_issue("Foobar Issue", "indexing")
    assert bucket == "structural"
    assert conf == 0.6


def test_derive_sf_key():
    assert derive_sf_issue_key("H1 - Missing") == "h1_missing"
    assert derive_sf_issue_key("Meta Description - Over 155 Characters") == "meta_description_over_155_characters"
    assert derive_sf_issue_key("Page Titles: Missing") == "page_titles_missing"
