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

async def technical_audit(run_id: str, client: Dict[str, Any], objective: str) -> Dict[str, Any]:
    prompt = f"""Produce a prioritized technical SEO audit checklist for:
- Domain: {client.get('domain')}
- Industry: {client.get('industry') or 'unspecified'}
- Goals: {client.get('goals') or 'general SEO growth'}
- Objective: {objective or 'identify highest impact technical issues'}

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
Provide 8-12 issues across categories, sorted by priority then impact descending."""
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

async def strategy_synthesis(run_id: str, client: Dict[str, Any], objective: str, prior: Dict[str, Any] | None = None) -> Dict[str, Any]:
    prior_summary = ""
    if prior:
        try:
            prior_summary = json.dumps({k: prior.get(k) for k in list(prior.keys())[:4]}, indent=2)[:3000]
        except Exception:
            prior_summary = ""
    prompt = f"""Build a focused SEO strategy plan.

Client:
- Name: {client.get('name')}
- Domain: {client.get('domain')}
- Industry: {client.get('industry') or 'unspecified'}
- Goals: {client.get('goals') or 'general SEO growth'}
- Markets: {', '.join(client.get('target_markets') or []) or 'global English'}

Objective: {objective or 'monthly strategy sprint'}

Prior findings context (if any):
{prior_summary or 'none'}

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
