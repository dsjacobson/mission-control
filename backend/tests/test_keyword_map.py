"""Unit tests for keyword map aggregation + status classification."""
import pytest

import keyword_map as km


def test_build_from_gsc_picks_best_url():
    gsc_cache = {
        "by_query_page": [
            {"query": "pasta recipe", "page": "https://x.com/a", "clicks": 5, "impressions": 100, "position": 8.0},
            {"query": "pasta recipe", "page": "https://x.com/b", "clicks": 50, "impressions": 300, "position": 3.0},
        ]
    }
    kw_map, per_kw = km._build_from_gsc(gsc_cache, "x.com")
    assert "pasta recipe" in kw_map
    slot = kw_map["pasta recipe"]
    # Best by clicks → b
    assert slot["current_url"] == "https://x.com/b"
    assert slot["traffic"] == 55
    assert slot["impressions"] == 400


def test_merge_semrush_positions_fills_missing_fields():
    kw_map = {}
    upload = {"items": [
        {"keyword": "Carbonara Recipe", "position": 4, "search_volume": 5000, "url": "https://x.com/c", "intent": "informational", "traffic": 800},
    ]}
    km._merge_from_semrush_positions(kw_map, upload)
    slot = kw_map["carbonara recipe"]
    assert slot["current_url"] == "https://x.com/c"
    assert slot["search_volume"] == 5000
    assert slot["intent"] == "informational"
    assert slot["sources"]["semrush_pos"]


def test_classify_cannibalized():
    slot = {"keyword": "pasta", "current_url": "https://x.com/a", "current_position": 5, "sources": {"gsc": True}}
    per_kw = {"pasta": [
        {"page": "https://x.com/a", "clicks": 50, "impressions": 500, "position": 5.0},
        {"page": "https://x.com/b", "clicks": 20, "impressions": 200, "position": 12.0},
    ]}
    km._classify_status(slot, per_kw)
    assert slot["status"] == "cannibalized"
    assert len(slot["cannibal_urls"]) == 2


def test_classify_missing_page_when_only_gap():
    slot = {"keyword": "carbonara", "sources": {"semrush_gap": True}, "competitor_urls": [{"url": "comp.com/x"}]}
    km._classify_status(slot, {})
    assert slot["status"] == "missing_page"


def test_classify_under_optimized():
    slot = {"keyword": "k", "current_url": "https://x.com/a", "current_position": 12, "impressions": 500, "sources": {"gsc": True}}
    km._classify_status(slot, {"k": [{"page": "https://x.com/a", "clicks": 5, "impressions": 500, "position": 12.0}]})
    assert slot["status"] == "under_optimized"


def test_classify_aligned():
    slot = {"keyword": "k", "current_url": "https://x.com/a", "current_position": 3, "impressions": 1000, "sources": {"gsc": True}}
    km._classify_status(slot, {"k": [{"page": "https://x.com/a", "clicks": 200, "impressions": 1000, "position": 3.0}]})
    assert slot["status"] == "aligned"


def test_merge_gap_attaches_competitor_urls():
    kw_map = {}
    upload = {"items": [
        {"keyword": "Roman Pasta", "search_volume": 1000, "competitor_url": "comp.com/p", "competitor_position": 2, "intent": "informational"},
    ]}
    km._merge_from_semrush_gap(kw_map, upload)
    slot = kw_map["roman pasta"]
    assert slot["search_volume"] == 1000
    assert slot["sources"]["semrush_gap"]
    assert slot["competitor_urls"][0]["url"] == "comp.com/p"


def test_semrush_only_cannibalization():
    """Two of our URLs ranking for the same keyword in Semrush = cannibalization."""
    kw_map = {}
    upload = {"items": [
        {"keyword": "cassata", "position": 8, "url": "https://x.com/a", "search_volume": 1000},
        {"keyword": "cassata", "position": 14, "url": "https://x.com/b", "search_volume": 1000},
    ]}
    km._merge_from_semrush_positions(kw_map, upload)
    slot = kw_map["cassata"]
    km._classify_status(slot, {})  # no GSC data
    assert slot["status"] == "cannibalized"
    assert len(slot["cannibal_urls"]) == 2


def test_classify_low_position_without_gsc():
    """Without GSC, pos > 20 should be 'low_position', not 'aligned'."""
    slot = {"keyword": "k", "current_url": "https://x.com/a", "current_position": 25, "sources": {"semrush_pos": True}, "semrush_urls": [{"url": "https://x.com/a", "position": 25}]}
    km._classify_status(slot, {})
    assert slot["status"] == "low_position"


def test_classify_under_optimized_without_gsc():
    """Position 6-20 should be under_optimized even without GSC impressions data."""
    slot = {"keyword": "k", "current_url": "https://x.com/a", "current_position": 12, "sources": {"semrush_pos": True}, "semrush_urls": [{"url": "https://x.com/a", "position": 12}]}
    km._classify_status(slot, {})
    assert slot["status"] == "under_optimized"


def test_classify_aligned_top5_no_traffic_data():
    """Position 1-5 should still be aligned even without traffic data."""
    slot = {"keyword": "k", "current_url": "https://x.com/a", "current_position": 3, "sources": {"semrush_pos": True}, "semrush_urls": [{"url": "https://x.com/a", "position": 3}]}
    km._classify_status(slot, {})
    assert slot["status"] == "aligned"
