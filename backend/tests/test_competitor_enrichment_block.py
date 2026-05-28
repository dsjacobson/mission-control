"""Unit tests for `_build_competitor_enrichment_block` in workflow.py.

These run without DB / network — they exercise the pure-cache grounding path
that the Competitor Analysis + Strategy Sprint workflows now consume.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from workflow import (  # noqa: E402
    _build_competitor_enrichment_block,
    _client_known_keywords,
    _dr,
)


def _client(**overrides):
    base = {
        "id": "c1",
        "domain": "mysite.com",
        "competitors": [],
        "keyword_map": {"keywords": {"pasta carbonara": {}, "spaghetti": {}}},
    }
    base.update(overrides)
    return base


def test_dr_scaler():
    assert _dr(750) == "75.0"
    assert _dr(0) == "0.0"
    assert _dr(None) == "?"
    assert _dr("oops") == "oops"


def test_known_keywords_pulls_from_map_and_semrush():
    c = _client(
        semrush_uploads={
            "organic_positions": {"items": [{"keyword": "Pesto Sauce"}, {"keyword": "Spaghetti"}]}
        }
    )
    kws = _client_known_keywords(c)
    assert "pasta carbonara" in kws
    assert "spaghetti" in kws
    assert "pesto sauce" in kws


def test_empty_competitors_returns_none():
    block, cached = _build_competitor_enrichment_block(_client())
    assert block is None
    assert cached == set()


def test_metrics_only_competitor():
    c = _client(competitors=[{
        "id": "comp1",
        "domain": "rival.com",
        "metrics": {
            "refreshed_at": "2026-02-20T00:00:00Z",
            "domain_rating": 850,
            "backlinks": 12000,
            "referring_domains": 1500,
            "referring_domains_dofollow": 1200,
            "spam_score": 4,
        },
    }])
    block, cached = _build_competitor_enrichment_block(c)
    assert block is not None
    assert "Domain authority comparison" in block
    assert "rival.com" in block
    assert "DR=85.0" in block
    assert cached == set()  # no ranked_keywords cache


def test_ranked_keywords_drives_gap_calc_and_caching():
    c = _client(competitors=[{
        "id": "comp1",
        "domain": "rival.com",
        "ranked_keywords": {
            "refreshed_at": "2026-02-20T00:00:00Z",
            "items": [
                # In client's keyword_map — should NOT be a gap
                {"keyword": "pasta carbonara", "position": 3, "search_volume": 5000, "url": "https://rival.com/carbonara"},
                # NEW — should be a gap (vol > 50)
                {"keyword": "lasagna recipe", "position": 4, "search_volume": 3000, "url": "https://rival.com/lasagna"},
                # Too low vol — filtered out
                {"keyword": "obscure thing", "position": 12, "search_volume": 20, "url": ""},
            ],
        },
    }])
    block, cached = _build_competitor_enrichment_block(c)
    assert block is not None
    assert "Top ranked keywords for rival.com" in block
    assert "Cached keyword gaps" in block
    assert "lasagna recipe" in block
    # The known kw should be in "Top ranked" but NOT under gaps
    gaps_section = block.split("Cached keyword gaps")[1]
    assert "pasta carbonara" not in gaps_section
    assert "obscure thing" not in gaps_section  # filtered by vol
    assert cached == {"comp1"}


def test_semrush_positions_fallback_when_no_dfs_cache():
    c = _client(competitors=[{
        "id": "comp1",
        "domain": "rival.com",
        "semrush_uploads": {
            "organic_positions": {
                "items": [
                    {"keyword": "ravioli filling", "position": 5, "search_volume": 800},
                    {"keyword": "gnocchi", "position": 2, "search_volume": 4500},
                ],
            },
        },
    }])
    block, cached = _build_competitor_enrichment_block(c)
    assert block is not None
    assert "Top Semrush positions for rival.com" in block
    assert "gnocchi" in block
    assert cached == set()


def test_sf_crawl_summary_appended():
    c = _client(competitors=[{
        "id": "comp1",
        "domain": "rival.com",
        "sf_crawl": {
            "page_index": [{"url": "u1"}, {"url": "u2"}],
            "issues": [{"k": 1}],
            "issues_summary": {"high_priority": 0},
        },
    }])
    block, _ = _build_competitor_enrichment_block(c)
    assert block is not None
    assert "SF crawl of rival.com" in block
    assert "2 pages indexed" in block
    assert "1 issues" in block


def test_multiple_competitors_combined():
    c = _client(competitors=[
        {
            "id": "comp1",
            "domain": "a.com",
            "metrics": {"refreshed_at": "x", "domain_rating": 600},
            "ranked_keywords": {"items": [{"keyword": "tomato sauce", "search_volume": 1000, "position": 4}]},
        },
        {
            "id": "comp2",
            "domain": "b.com",
            "metrics": {"refreshed_at": "x", "domain_rating": 500},
        },
    ])
    block, cached = _build_competitor_enrichment_block(c)
    assert "a.com" in block and "b.com" in block
    assert "DR=60.0" in block
    assert "DR=50.0" in block
    assert cached == {"comp1"}  # only comp1 has ranked_keywords cache
