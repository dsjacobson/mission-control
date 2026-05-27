"""Issue categorization for the technical-audit executor.

Maps an issue (title + category) to one of five buckets:
  - metadata     → OnPage agent rewrites title/meta/H1 for affected URLs
  - content      → Content Remediation directive (placeholder content,
                   thin content, duplicate, scraped, missing alt text on body, etc.)
  - structural   → Action checklist (4xx, redirect chains, broken internal links,
                   missing canonicals, orphan pages)
  - performance  → Implementation brief (speed, CSS/JS, image weight, render
                   blocking, CWV)
  - security     → Implementation brief (CSP, HSTS, mixed content, headers)
  - out_of_scope → Handoff note when the agent really can't draft a fix in-app
"""
from __future__ import annotations

import re
from typing import Dict, Tuple


METADATA_KEYWORDS = [
    "title", "meta description", "meta-description", "h1", "h2", "heading",
    "page title", "title tag", "duplicate title", "missing title",
]
CONTENT_KEYWORDS = [
    "lorem ipsum", "placeholder", "thin content", "low content",
    "duplicate content", "scraped", "near duplicate", "spelling", "grammar",
    "readability", "missing alt", "image alt", "alt text",
]
STRUCTURAL_KEYWORDS = [
    "4xx", "404", "5xx", "redirect", "redirection", "redirect chain",
    "broken", "noindex", "no index", "canonical", "orphan", "internal link",
    "external link", "sitemap", "robots", "hreflang", "schema", "structured data",
    "pagination",
]
PERFORMANCE_KEYWORDS = [
    "css", "javascript", " js ", "image", "size", "render blocking", "core web",
    "lcp", "fid", "cls", "cwv", "speed", "weight", "minify", "compress",
    "page weight", "above the fold",
]
SECURITY_KEYWORDS = [
    "csp", "content-security-policy", "hsts", "strict-transport",
    "x-content-type", "x-frame", "referrer-policy", "permissions-policy",
    "mixed content", "https", "http to https", "tls", "ssl certificate",
]


CATEGORY_TO_BUCKET = {
    "on_page": "metadata",
    "indexing": "structural",
    "crawlability": "structural",
    "internal_links": "structural",
    "structured_data": "structural",
    "performance": "performance",
    "mobile": "performance",
    "security": "security",
}


def categorize_issue(title: str, category: str = "") -> Tuple[str, float]:
    """Return (bucket, confidence 0-1). Title-based keyword match overrides
    category if it's stronger."""
    title_low = (title or "").lower()
    category = (category or "").lower().strip()

    def _has(keywords):
        return any(k in title_low for k in keywords)

    # Strong keyword signals override category mapping
    if _has(METADATA_KEYWORDS):
        return ("metadata", 0.9)
    if _has(CONTENT_KEYWORDS):
        return ("content", 0.9)
    if _has(SECURITY_KEYWORDS):
        return ("security", 0.9)
    if _has(PERFORMANCE_KEYWORDS):
        return ("performance", 0.85)
    if _has(STRUCTURAL_KEYWORDS):
        return ("structural", 0.85)

    # Fall back to category mapping
    if category in CATEGORY_TO_BUCKET:
        return (CATEGORY_TO_BUCKET[category], 0.6)

    return ("structural", 0.3)  # safe default


def derive_sf_issue_key(title: str) -> str:
    """Convert an audit issue title (e.g. 'H1 - Missing') into the SF bulk-export
    filename stem ('h1_missing'). Best-effort — used to look up affected URLs
    from the screaming_frog.issue_urls map."""
    s = (title or "").lower()
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s
