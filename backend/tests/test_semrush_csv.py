"""Unit tests for the Semrush CSV parser."""
import pytest

import semrush_csv as sc


def test_organic_positions_semicolon():
    text = (
        "Keyword;Position;Previous position;Search Volume;CPC;URL;Traffic;Traffic (%);Keyword Difficulty\n"
        "italian recipes;3;4;90500;1.45;https://example.com/a;2715;15.0;62\n"
        "tiramisu recipe;5;7;74000;1.05;https://example.com/b;1850;10.2;58\n"
    )
    out = sc.parse_csv(text)
    assert out["type"] == "organic_positions"
    assert out["rows"] == 2
    assert out["summary"]["total_keywords"] == 2
    assert out["summary"]["top_1_3"] == 1
    assert out["items"][0]["keyword"] == "italian recipes"
    assert out["items"][0]["traffic"] == 2715
    assert out["items"][0]["kd"] == 62.0


def test_competitors():
    text = (
        "Domain;Competitor Relevance;Common Keywords;Organic Keywords;Organic Traffic\n"
        "giallozafferano.com;0.85;15000;1200000;15400000\n"
        "seriouseats.com;0.65;9000;850000;9800000\n"
    )
    out = sc.parse_csv(text)
    assert out["type"] == "competitors"
    assert out["summary"]["total_competitors"] == 2
    assert out["items"][0]["domain"] == "giallozafferano.com"
    assert out["items"][0]["competitor_relevance"] == 0.85


def test_keyword_gap():
    text = (
        "Keyword;Search Volume;CPC;Competition;Competitor URL;Position;KD\n"
        "gnocchi recipe;60500;0.95;0.42;giallozafferano.com/gnocchi;2;55\n"
        "aperol spritz;165000;1.20;0.38;seriouseats.com/x;4;48\n"
    )
    out = sc.parse_csv(text)
    assert out["type"] == "keyword_gap"
    assert out["summary"]["total_gaps"] == 2
    # Sorted by volume desc
    assert out["items"][0]["keyword"] == "aperol spritz"


def test_backlinks():
    text = (
        "Page ascore;Source title;Source url;Target url;Anchor;Nofollow;First seen\n"
        "42;Cool blog;https://siteA.com/x;https://cookingitalians.com/a;tiramisu;false;2025-01-01\n"
        "55;Other;https://siteB.com/y;https://cookingitalians.com/b;recipes;true;2025-02-01\n"
    )
    out = sc.parse_csv(text)
    assert out["type"] == "backlinks"
    assert out["summary"]["total_backlinks"] == 2
    assert out["summary"]["follow_links"] == 1
    assert out["summary"]["nofollow_links"] == 1


def test_domain_overview():
    text = (
        "Domain;Database;Rank;Organic Keywords;Organic Traffic;Organic Cost\n"
        "cookingitalians.com;us;120;25000;180000;120000\n"
    )
    out = sc.parse_csv(text)
    assert out["type"] == "domain_overview"
    assert out["summary"]["domain"] == "cookingitalians.com"
    assert out["summary"]["organic_keywords"] == 25000


def test_unknown_format_returns_unknown():
    text = "Foo;Bar;Baz\n1;2;3\n"
    out = sc.parse_csv(text)
    assert out["type"] == "unknown"


def test_empty():
    out = sc.parse_csv("")
    assert out["type"] == "empty"


def test_comma_delimiter():
    text = (
        "Domain,Competitor Relevance,Common Keywords,Organic Keywords,Organic Traffic\n"
        "x.com,0.5,100,1000,5000\n"
    )
    out = sc.parse_csv(text)
    assert out["type"] == "competitors"
    assert out["items"][0]["domain"] == "x.com"
