"""Multi-agent SEO orchestration powered by OpenAI GPT-5.2 via emergentintegrations.

Agents:
  - coordinator: plans subtasks for a workflow
  - keyword: keyword research
  - audit: technical audit
  - competitor: competitor analysis
  - strategy: strategy synthesis
  - publisher: WordPress draft preparation

All agents return structured JSON, parsed via robust fence-stripping.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage

load_dotenv()

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
MODEL_PROVIDER = "openai"
MODEL_NAME = "gpt-5.2"


AGENT_LABELS = {
    "coordinator": "Coordinator Agent",
    "keyword": "Keyword Research Agent",
    "audit": "Technical Audit Agent",
    "competitor": "Competitor Analysis Agent",
    "strategy": "Strategy Agent",
    "publisher": "Publisher Assistant",
    "onpage": "On-Page Optimizer Agent",
    "content_remediation": "Content Remediation Agent",
    "structural_fix": "Structural Fix Agent",
    "implementation_brief": "Implementation Brief Agent",
    "page_keyword": "Page Keyword Analyst",
}


SYSTEM_PROMPTS = {
    "coordinator": (
        "You are the Coordinator Agent for an autonomous SEO operations system. "
        "Your job is to take a workflow request and break it into 4-6 concrete, "
        "ordered subtasks that specialist agents will execute. Be pragmatic and "
        "specific to the client's domain and goals. Always reply with strict JSON only."
    ),
    "keyword": (
        "You are the Keyword Research Agent. Given a client context, produce a list "
        "of keyword opportunities clustered by topic and intent (informational, "
        "commercial, transactional, navigational). Identify quick wins (low difficulty "
        "+ decent volume) and content gaps. Output strict JSON only."
    ),
    "audit": (
        "You are the Technical SEO Audit Agent. Given a client domain and context, "
        "produce a prioritized list of likely technical issues (without crawling) "
        "based on common patterns for this type of site, plus recommended fixes. "
        "Score each by impact (1-5) and effort (1-5). Output strict JSON only."
    ),
    "competitor": (
        "You are the Competitor Analysis Agent. Compare the client against the "
        "provided competitors. Surface content coverage gaps, keyword opportunities, "
        "threats, and strategic moves. Output strict JSON only."
    ),
    "strategy": (
        "You are the Strategy Agent. Synthesize prior agent findings (if provided) "
        "and the client's goals into a focused weekly + monthly SEO action plan with "
        "source-backed reasoning. Output strict JSON only."
    ),
    "publisher": (
        "You are the Publisher Assistant. Prepare a WordPress draft post outline "
        "(title, slug, meta description, H2/H3 outline, internal link suggestions, "
        "target keywords). DRAFT ONLY - never publish. Output strict JSON only."
    ),
    "onpage": (
        "You are the On-Page Optimizer Agent. You DO the work — you do not merely "
        "recommend. For each page provided, write a finished, ready-to-paste, "
        "SEO-optimized title tag (≤60 characters), meta description (≤155 characters), "
        "H1, and 2-3 schema/markup notes. Use the page's actual GSC queries (when "
        "given) as keyword signals. Preserve and improve on the current title/meta/H1 "
        "when they are provided (don't blow up a working page). Be concrete and "
        "copy-paste ready. Output strict JSON only."
    ),
    "content_remediation": (
        "You are the Content Remediation Agent. For each affected URL, produce a "
        "concrete remediation directive: target keyword(s), recommended H1, an H2/H3 "
        "outline, suggested word count, and 3-5 talking points. Be specific to the "
        "URL's existing context when provided (don't ignore what the page is about). "
        "Output strict JSON only."
    ),
    "structural_fix": (
        "You are the Structural Fix Agent. For each affected URL produce: the exact "
        "change required (rewrite/redirect/canonical/remove), the destination or "
        "value, and where in the stack the change is made (CMS, .htaccess/nginx, "
        "sitemap, robots.txt, theme file). Be precise and prescriptive. Output strict "
        "JSON only."
    ),
    "implementation_brief": (
        "You are the Implementation Brief Agent for performance + security issues. "
        "Produce a short brief: what to change, why it matters, the suggested "
        "implementation (with one minimal code/config snippet when relevant), "
        "expected impact, and a verification step. Output strict JSON only."
    ),
    "page_keyword": (
        "You are the Page Keyword Analyst. Given a page's title, headings, and a "
        "body sample, identify the single primary target keyword the page is best "
        "positioned to rank for in Google. Pick the most specific phrase that the "
        "page's content genuinely covers, in lowercase. Output strict JSON only."
    ),
}


def _strip_json_fence(text: str) -> str:
    text = text.strip()
    # Remove ```json ... ``` or ``` ... ``` fences
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _safe_parse_json(text: str, fallback: Any = None) -> Any:
    if not text:
        return fallback if fallback is not None else {}
    cleaned = _strip_json_fence(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Try to find first {...} or [...] block
        m = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", cleaned)
        if m:
            try:
                return json.loads(m.group(1))
            except json.JSONDecodeError:
                pass
        return fallback if fallback is not None else {"raw": cleaned}


async def _run_agent(agent: str, session_id: str, prompt: str) -> str:
    """Run a single-turn agent call and return raw response text."""
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"{session_id}:{agent}",
        system_message=SYSTEM_PROMPTS[agent],
    ).with_model(MODEL_PROVIDER, MODEL_NAME)

    response = await chat.send_message(UserMessage(text=prompt))
    return response if isinstance(response, str) else str(response)


# ---------- Coordinator ----------

async def coordinator_plan(run_id: str, workflow_type: str, client: Dict[str, Any], objective: str) -> List[str]:
    prompt = f"""Plan the subtasks for workflow type: {workflow_type}.

Client context:
- Name: {client.get('name')}
- Domain: {client.get('domain')}
- Industry: {client.get('industry') or 'unspecified'}
- Target markets: {', '.join(client.get('target_markets') or []) or 'unspecified'}
- Goals: {client.get('goals') or 'unspecified'}
- Competitors: {', '.join(c.get('domain', '') for c in client.get('competitors', [])) or 'none'}
- Objective for this run: {objective or 'standard run'}

Return strict JSON:
{{ "subtasks": ["step 1", "step 2", "step 3", ...] }}
4-6 concise subtasks, ordered."""
    raw = await _run_agent("coordinator", run_id, prompt)
    data = _safe_parse_json(raw, fallback={"subtasks": []})
    subtasks = data.get("subtasks") if isinstance(data, dict) else None
    if not isinstance(subtasks, list):
        subtasks = []
    return [str(s) for s in subtasks][:6]


# ---------- Keyword Research ----------

async def keyword_research(run_id: str, client: Dict[str, Any], objective: str, gsc_context: Optional[str] = None) -> Dict[str, Any]:
    gsc_block = f"\n\nReal GSC performance data (last 28 days):\n{gsc_context}\n" if gsc_context else ""
    prompt = f"""Generate keyword research for:
- Domain: {client.get('domain')}
- Industry: {client.get('industry') or 'unspecified'}
- Goals: {client.get('goals') or 'general SEO growth'}
- Markets: {', '.join(client.get('target_markets') or []) or 'global English'}
- Objective: {objective or 'discover opportunities'}{gsc_block}

Return strict JSON with this exact shape:
{{
  "clusters": [
    {{
      "topic": "string",
      "intent": "informational|commercial|transactional|navigational",
      "keywords": [
        {{ "keyword": "string", "volume_estimate": "low|medium|high", "difficulty": "low|medium|high", "quick_win": true }}
      ]
    }}
  ],
  "quick_wins": ["keyword 1", "keyword 2"],
  "content_gaps": ["gap 1", "gap 2"],
  "draft_briefs": [
    {{ "title": "string", "primary_keyword": "string", "outline": ["H2", "H2", "H2"] }}
  ]
}}
Provide 3-5 clusters, 4-8 keywords per cluster, 2-3 draft briefs.
If GSC data is provided above, prioritize "quick_wins" using actual queries that rank in positions 4-20 with non-zero impressions, and ground "content_gaps" in pages with high impressions but low CTR."""
    raw = await _run_agent("keyword", run_id, prompt)
    return _safe_parse_json(raw, fallback={"clusters": [], "quick_wins": [], "content_gaps": [], "draft_briefs": []})


# ---------- Technical Audit ----------

async def technical_audit(run_id: str, client: Dict[str, Any], objective: str, sf_context: Optional[str] = None, ga_context: Optional[str] = None, gsc_context: Optional[str] = None) -> Dict[str, Any]:
    extra_blocks = []
    if sf_context:
        extra_blocks.append(f"Real Screaming Frog crawl data:\n{sf_context}")
    if ga_context:
        extra_blocks.append(f"GA4 traffic signals (last 28 days):\n{ga_context}")
    if gsc_context:
        extra_blocks.append(f"GSC performance signals (last 28 days):\n{gsc_context}")
    extra = ("\n\n" + "\n\n".join(extra_blocks)) if extra_blocks else ""
    prompt = f"""Produce a prioritized technical SEO audit checklist for:
- Domain: {client.get('domain')}
- Industry: {client.get('industry') or 'unspecified'}
- Goals: {client.get('goals') or 'general SEO growth'}
- Objective: {objective or 'identify highest impact technical issues'}{extra}

Return strict JSON with this exact shape:
{{
  "issues": [
    {{
      "id": "issue-1",
      "category": "crawlability|indexing|performance|structured_data|on_page|mobile|security|internal_links",
      "title": "string",
      "description": "string",
      "impact": 1-5,
      "effort": 1-5,
      "priority": "P0|P1|P2",
      "recommended_fix": "string"
    }}
  ],
  "summary": "string"
}}
Provide 8-12 issues across categories, sorted by priority then impact descending.
If a real Screaming Frog crawl is provided, anchor priorities to actual urls_affected counts and discovered issue names. If GA4 or GSC signals are provided, weight impact higher for issues affecting top-traffic pages or queries."""
    raw = await _run_agent("audit", run_id, prompt)
    return _safe_parse_json(raw, fallback={"issues": [], "summary": ""})


# ---------- Competitor Analysis ----------

async def competitor_analysis(run_id: str, client: Dict[str, Any], objective: str, seo_context: Optional[str] = None) -> Dict[str, Any]:
    competitors = client.get("competitors", [])
    if not competitors:
        return {
            "competitors": [],
            "summary": "No competitors configured for this client. Add competitors to run analysis.",
            "opportunities": [],
            "threats": [],
            "strategic_moves": [],
        }
    comp_lines = "\n".join(f"- {c.get('name')} ({c.get('domain')})" for c in competitors)
    seo_block = f"\n\nReal SEO data:\n{seo_context}\n" if seo_context else ""
    prompt = f"""Compare client against competitors.

Client:
- Name: {client.get('name')}
- Domain: {client.get('domain')}
- Industry: {client.get('industry') or 'unspecified'}
- Goals: {client.get('goals') or 'general SEO growth'}

Competitors:
{comp_lines}

Objective: {objective or 'identify gaps and opportunities'}{seo_block}

Return strict JSON:
{{
  "competitors": [
    {{
      "domain": "string",
      "strengths": ["..."],
      "weaknesses": ["..."],
      "content_focus": ["..."],
      "estimated_keyword_overlap_pct": 0-100
    }}
  ],
  "keyword_gaps": ["keyword we should target", "..."],
  "content_gaps": ["topic", "..."],
  "opportunities": ["..."],
  "threats": ["..."],
  "strategic_moves": ["..."],
  "summary": "string"
}}"""
    raw = await _run_agent("competitor", run_id, prompt)
    return _safe_parse_json(raw, fallback={"competitors": [], "summary": ""})


# ---------- Strategy ----------

async def strategy_synthesis(run_id: str, client: Dict[str, Any], objective: str, prior: Dict[str, Any] | None = None, seo_context: Optional[str] = None) -> Dict[str, Any]:
    prior_summary = ""
    if prior:
        try:
            prior_summary = json.dumps({k: prior.get(k) for k in list(prior.keys())[:4]}, indent=2)[:3000]
        except Exception:
            prior_summary = ""
    seo_block = f"\n\nReal SEO data (use to ground every recommendation):\n{seo_context}\n" if seo_context else ""
    prompt = f"""Build a focused SEO strategy plan.

Client:
- Name: {client.get('name')}
- Domain: {client.get('domain')}
- Industry: {client.get('industry') or 'unspecified'}
- Goals: {client.get('goals') or 'general SEO growth'}
- Markets: {', '.join(client.get('target_markets') or []) or 'global English'}

Objective: {objective or 'monthly strategy sprint'}

Prior findings context (if any):
{prior_summary or 'none'}{seo_block}

Return strict JSON:
{{
  "weekly_plan": [
    {{ "week": 1, "focus": "string", "actions": ["..."] }}
  ],
  "monthly_themes": ["..."],
  "recommendations": [
    {{ "title": "string", "rationale": "string", "expected_impact": "low|medium|high" }}
  ],
  "campaign_ideas": [
    {{ "title": "string", "description": "string", "channels": ["..."] }}
  ],
  "executive_summary": "string"
}}
Cover 4 weeks, 3-5 recommendations, 2-3 campaign ideas."""
    raw = await _run_agent("strategy", run_id, prompt)
    return _safe_parse_json(raw, fallback={"weekly_plan": [], "recommendations": [], "executive_summary": ""})


# ---------- Publisher (WordPress draft) ----------

async def publisher_draft(run_id: str, client: Dict[str, Any], topic: str) -> Dict[str, Any]:
    prompt = f"""Prepare a WordPress draft outline for:
- Client domain: {client.get('domain')}
- Topic: {topic}

Return strict JSON:
{{
  "title": "string",
  "slug": "string",
  "meta_description": "string (max 160 chars)",
  "target_keywords": ["..."],
  "outline": [
    {{ "heading": "H2 title", "subheadings": ["H3 a", "H3 b"], "notes": "..." }}
  ],
  "internal_link_suggestions": ["..."],
  "cta": "string"
}}"""
    raw = await _run_agent("publisher", run_id, prompt)
    return _safe_parse_json(raw, fallback={"title": topic, "outline": []})


# ---------- On-Page Optimizer ----------

async def optimize_pages(run_id: str, client: Dict[str, Any], pages: List[Dict[str, Any]], issue_context: Optional[str] = None) -> List[Dict[str, Any]]:
    """For each page produce concrete, ready-to-paste title, meta, H1.

    pages: list of {url, current_title?, current_meta?, current_h1?, gsc_queries: [str], clicks?, impressions?}
    issue_context: optional description of the specific technical issue this run should focus on
                   (e.g. "Pages missing H1 tag — generate compelling H1s for the listed URLs").
    Returns enriched list with proposed_title, proposed_meta, proposed_h1, target_keyword,
    title_char_count, meta_char_count, schema_notes.
    """
    if not pages:
        return []
    pages = pages[:10]  # safety cap

    # Build compact prompt
    page_blocks = []
    for i, p in enumerate(pages, 1):
        queries = ", ".join((p.get("gsc_queries") or [])[:8]) or "n/a"
        page_blocks.append(
            f"{i}. URL: {p.get('url')}\n"
            f"   Current title: {p.get('current_title') or '(missing)'}\n"
            f"   Current meta: {p.get('current_meta') or '(missing)'}\n"
            f"   Current H1: {p.get('current_h1') or '(unknown)'}\n"
            f"   GSC top queries: {queries}\n"
            f"   Clicks (28d): {p.get('clicks', 'n/a')} · Impressions: {p.get('impressions', 'n/a')}"
        )
    body = "\n\n".join(page_blocks)

    focus_block = ""
    if issue_context:
        focus_block = f"\n\nSpecific issue to address for these pages:\n{issue_context}\n"

    prompt = f"""Client: {client.get('name')} · {client.get('domain')}
Industry: {client.get('industry') or 'unspecified'}
Goals: {client.get('goals') or 'general SEO growth'}{focus_block}

Optimize the following pages. For each, write a ready-to-paste:
- proposed_title (≤60 chars, include primary target keyword, distinct from competitors, click-worthy)
- proposed_meta (≤155 chars, action-oriented, include primary keyword)
- proposed_h1 (clear, keyword-aligned, can differ slightly from title)
- target_keyword (the single primary keyword you optimized for)
- schema_notes (2-3 short suggestions: Article, Recipe, Product, FAQPage, BreadcrumbList, etc.)

Pages:
{body}

Return strict JSON:
{{
  "pages": [
    {{
      "url": "string",
      "proposed_title": "string",
      "proposed_meta": "string",
      "proposed_h1": "string",
      "target_keyword": "string",
      "schema_notes": ["...", "..."],
      "rationale": "string (1-2 sentences explaining the keyword choice)"
    }}
  ]
}}
Order the pages identically to the input list. Use distinct keywords across pages."""

    raw = await _run_agent("onpage", run_id, prompt)
    data = _safe_parse_json(raw, fallback={"pages": []})
    out_pages = data.get("pages") if isinstance(data, dict) else None
    if not isinstance(out_pages, list):
        return []

    # Merge with input context (preserve current values for before/after)
    result = []
    for i, prop in enumerate(out_pages[: len(pages)]):
        src = pages[i] if i < len(pages) else {}
        title = (prop.get("proposed_title") or "").strip()
        meta = (prop.get("proposed_meta") or "").strip()
        result.append({
            "url": prop.get("url") or src.get("url"),
            "current_title": src.get("current_title") or "",
            "current_meta": src.get("current_meta") or "",
            "current_h1": src.get("current_h1") or "",
            "proposed_title": title,
            "proposed_meta": meta,
            "proposed_h1": (prop.get("proposed_h1") or "").strip(),
            "target_keyword": prop.get("target_keyword") or "",
            "schema_notes": prop.get("schema_notes") or [],
            "rationale": prop.get("rationale") or "",
            "title_char_count": len(title),
            "meta_char_count": len(meta),
            "gsc_clicks": src.get("clicks"),
            "gsc_impressions": src.get("impressions"),
        })
    return result



# ---------- Content Remediation (placeholder content, thin content, etc.) ----------

async def content_remediation(
    run_id: str,
    client: Dict[str, Any],
    issue: Dict[str, Any],
    pages: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Produce a per-URL remediation directive for content issues like Lorem Ipsum,
    thin content, duplicate content, missing alt text, etc.

    pages: [{url, title?, h1?, h2?, word_count?, content_sample?, gsc_queries?: [...]}, ...]
    """
    if not pages:
        return {"urls": [], "note": "No affected URLs available."}
    pages = pages[:25]
    blocks = []
    for i, p in enumerate(pages, 1):
        blocks.append(
            f"{i}. URL: {p.get('url')}\n"
            f"   Current title: {p.get('title') or '(none)'}\n"
            f"   Current H1: {p.get('h1') or '(none)'}\n"
            f"   Current word count: {p.get('word_count') if p.get('word_count') is not None else 'unknown'}\n"
            f"   GSC top queries (site-level): {', '.join((p.get('gsc_queries') or [])[:5]) or 'n/a'}"
        )
    prompt = f"""Client: {client.get('name')} · {client.get('domain')}
Industry: {client.get('industry') or 'unspecified'}
Goals: {client.get('goals') or 'general SEO growth'}

Issue: {issue.get('title')}
Description: {issue.get('description') or ''}
Recommended fix: {issue.get('recommended_fix') or ''}

Produce a per-URL content remediation directive. For each page propose:
- target_keyword (single primary)
- recommended_h1
- outline (array of 4-7 H2/H3 entries, each with "heading" and a 1-line "intent")
- recommended_word_count (integer)
- talking_points (3-5 short bullets the writer must include)
- why_this_matters (1 sentence explaining the SEO benefit)

URLs:
{chr(10).join(blocks)}

Return strict JSON:
{{
  "urls": [
    {{
      "url": "string",
      "target_keyword": "string",
      "recommended_h1": "string",
      "outline": [{{"heading": "string", "intent": "string"}}],
      "recommended_word_count": 0,
      "talking_points": ["...", "..."],
      "why_this_matters": "string"
    }}
  ],
  "summary": "string (1-2 sentences across the batch)"
}}
Order matches input. Keep directives unique per URL."""
    raw = await _run_agent("content_remediation", run_id, prompt)
    data = _safe_parse_json(raw, fallback={"urls": [], "summary": ""})
    return data if isinstance(data, dict) else {"urls": [], "summary": ""}


async def content_draft_for_url(
    run_id: str,
    client: Dict[str, Any],
    directive: Dict[str, Any],
) -> Dict[str, Any]:
    """Expand a single URL's remediation directive into full draft copy."""
    prompt = f"""Client: {client.get('name')} · {client.get('domain')}
Industry: {client.get('industry') or 'unspecified'}

URL: {directive.get('url')}
Target keyword: {directive.get('target_keyword')}
Recommended H1: {directive.get('recommended_h1')}
Outline: {json.dumps(directive.get('outline') or [], ensure_ascii=False)}
Talking points: {json.dumps(directive.get('talking_points') or [], ensure_ascii=False)}
Target word count: {directive.get('recommended_word_count') or 900}

Write the full body content. Match the outline section-by-section. Use the H1
as the page heading. Each H2 from the outline becomes a body section.

Return strict JSON:
{{
  "url": "string",
  "h1": "string",
  "sections": [{{"h2": "string", "body": "string (3-5 paragraphs)"}}],
  "intro": "string (2-3 sentences, before the first H2)",
  "word_count_estimate": 0
}}"""
    raw = await _run_agent("publisher", run_id, prompt)
    data = _safe_parse_json(raw, fallback={"sections": []})
    return data if isinstance(data, dict) else {"sections": []}


# ---------- Structural Fix (4xx, redirects, canonicals, orphans, sitemaps) ----------

async def structural_fix(
    run_id: str,
    client: Dict[str, Any],
    issue: Dict[str, Any],
    pages: List[Dict[str, Any]],
) -> Dict[str, Any]:
    pages = pages[:30]
    blocks = []
    for i, p in enumerate(pages, 1):
        blocks.append(
            f"{i}. URL: {p.get('url')}\n"
            f"   Status code: {p.get('status_code')} · Indexability: {p.get('indexability') or 'unknown'}\n"
            f"   Canonical: {p.get('canonical') or '(none)'} · Inlinks: {p.get('inlinks')}"
        )
    blob = chr(10).join(blocks) if blocks else "(no affected URLs available)"
    prompt = f"""Client: {client.get('name')} · {client.get('domain')}

Issue: {issue.get('title')}
Description: {issue.get('description') or ''}
Recommended fix: {issue.get('recommended_fix') or ''}

Produce a precise per-URL action plan. For each URL state:
- action: one of [redirect_301, redirect_302, set_canonical, remove, noindex,
  add_to_sitemap, add_internal_link, fix_link_target, fix_status_code,
  add_hreflang, add_schema, other]
- destination_or_value: if action is a redirect or canonical, the target URL;
  for noindex/sitemap actions describe the change; for "other" describe it
- where_to_make_change: one of [WordPress admin, .htaccess, nginx config,
  sitemap.xml, robots.txt, theme template, page content, CDN config]
- notes: 1 sentence justifying

URLs:
{blob}

Return strict JSON:
{{
  "actions": [
    {{
      "url": "string",
      "action": "string",
      "destination_or_value": "string",
      "where_to_make_change": "string",
      "notes": "string"
    }}
  ],
  "summary": "string (1-2 sentences)"
}}
If no URLs were provided, still produce 1 action describing how to find affected
URLs and what to do once found."""
    raw = await _run_agent("structural_fix", run_id, prompt)
    data = _safe_parse_json(raw, fallback={"actions": [], "summary": ""})
    return data if isinstance(data, dict) else {"actions": [], "summary": ""}


# ---------- Implementation Brief (performance + security) ----------

async def implementation_brief(
    run_id: str,
    client: Dict[str, Any],
    issue: Dict[str, Any],
    affected_url_count: int = 0,
) -> Dict[str, Any]:
    prompt = f"""Client: {client.get('name')} · {client.get('domain')}
Industry: {client.get('industry') or 'unspecified'}

Issue: {issue.get('title')}
Description: {issue.get('description') or ''}
Recommended fix: {issue.get('recommended_fix') or ''}
Affected URLs (from Screaming Frog): {affected_url_count}

Produce a short implementation brief. The user runs a small SEO agency and
implements fixes themselves or hands off to a developer. Be concrete.

Return strict JSON:
{{
  "what_to_change": "string (1-2 sentences, the concrete change)",
  "why_it_matters": "string (1-2 sentences, SEO + UX impact)",
  "implementation": "string (where to make the change — e.g. 'Add to <head> via theme header.php' or 'nginx server block')",
  "snippet": "string (one minimal copy-paste snippet, ≤25 lines, or empty if not applicable)",
  "snippet_language": "string (e.g. 'html', 'nginx', 'apache', 'javascript', 'css', '' if no snippet)",
  "expected_impact": "string (1 sentence — e.g. 'Better LCP scores, ~+0.3s on mobile')",
  "verification_step": "string (1 sentence — how to confirm the fix worked)"
}}"""
    raw = await _run_agent("implementation_brief", run_id, prompt)
    data = _safe_parse_json(raw, fallback={})
    return data if isinstance(data, dict) else {}


# ---------- Page Keyword Analyst (for sparse pages) ----------

async def identify_primary_keyword(
    run_id: str,
    client: Dict[str, Any],
    page: Dict[str, Any],
) -> str:
    """Given a page's title/headings/body sample, return the single best primary
    keyword guess (lowercase). Returns "" if it can't decide."""
    body = (page.get("body_sample") or "")[:4000]
    prompt = f"""Client: {client.get('name')} · {client.get('domain')}
Industry: {client.get('industry') or 'unspecified'}

Page URL: {page.get('url')}
Title: {page.get('title') or '(missing)'}
Meta: {page.get('meta') or '(missing)'}
H1: {", ".join(page.get('h1') or []) or '(missing)'}
H2: {", ".join(page.get('h2') or [])[:400]}
Body sample (first 4000 chars):
{body}

What single primary keyword phrase would this page realistically rank for in
Google today? Pick the most specific phrase the body genuinely covers — not
something aspirational. Lowercase. 1-5 words.

Return strict JSON:
{{
  "primary_keyword": "string",
  "alternates": ["string", "string"],
  "confidence": 0.0
}}"""
    raw = await _run_agent("page_keyword", run_id, prompt)
    data = _safe_parse_json(raw, fallback={"primary_keyword": ""})
    return (data.get("primary_keyword") or "").strip().lower() if isinstance(data, dict) else ""

