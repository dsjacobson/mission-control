"""Unit tests for screamingfrog URL normalization + issue-URL matching."""
import pytest

import screamingfrog as sf


def test_normalize_url():
    assert sf._normalize_url("https://example.com/page/") == "example.com/page"
    assert sf._normalize_url("http://www.example.com/page") == "example.com/page"
    assert sf._normalize_url("https://EXAMPLE.com/page#frag") == "example.com/page"
    # All four of these should match the same key:
    keys = {
        sf._normalize_url("https://cookingitalians.com/recipes/"),
        sf._normalize_url("https://cookingitalians.com/recipes"),
        sf._normalize_url("http://www.cookingitalians.com/recipes"),
        sf._normalize_url("https://cookingitalians.com/recipes#section"),
    }
    assert len(keys) == 1


# Fake "db" stub for get_urls_for_issue
class _FakeDB:
    def __init__(self, doc):
        self._doc = doc
        self.clients = self
    async def find_one(self, q, fields=None):
        return self._doc


@pytest.mark.asyncio
async def test_get_urls_for_issue_short_token_h1():
    """Regression: 'H1 - Missing' must match 'h1_missing' even though 'h1' is 2 chars."""
    db = _FakeDB({"screaming_frog": {"issue_urls": {
        "h1_missing": ["https://a.com/1", "https://a.com/2"],
        "page_titles_missing": ["https://a.com/3"],
    }}})
    urls = await sf.get_urls_for_issue(db, "c1", "H1 - Missing")
    assert urls == ["https://a.com/1", "https://a.com/2"]


@pytest.mark.asyncio
async def test_get_urls_for_issue_exact_derived_key():
    db = _FakeDB({"screaming_frog": {"issue_urls": {
        "meta_description_over_155_characters": ["https://a.com/x"],
    }}})
    urls = await sf.get_urls_for_issue(db, "c1", "Meta Description - Over 155 Characters")
    assert urls == ["https://a.com/x"]


@pytest.mark.asyncio
async def test_get_urls_for_issue_no_match_returns_empty():
    db = _FakeDB({"screaming_frog": {"issue_urls": {
        "redirect_chains": ["https://a.com/r"],
    }}})
    urls = await sf.get_urls_for_issue(db, "c1", "Cookie Banner")
    assert urls == []


@pytest.mark.asyncio
async def test_get_pages_by_url_handles_trailing_slash_and_www():
    """SF page index uses one canonical form, lookup URL uses another."""
    db = _FakeDB({"screaming_frog": {"page_index": [
        {"url": "https://cookingitalians.com/recipe", "title": "Recipe Page", "meta_description": "Meta", "h1": "Recipe"},
        {"url": "https://cookingitalians.com/about", "title": "About", "meta_description": "", "h1": "About Us"},
    ]}})
    # GSC-style URL with trailing slash should still find the SF page
    mapping = await sf.get_pages_by_url(db, "c1", [
        "https://cookingitalians.com/recipe/",
        "http://www.cookingitalians.com/about",
    ])
    assert mapping["https://cookingitalians.com/recipe/"]["title"] == "Recipe Page"
    assert mapping["http://www.cookingitalians.com/about"]["h1"] == "About Us"
