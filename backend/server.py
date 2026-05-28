"""FastAPI server for Autonomous SEO Agency Operator."""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import List, Optional, Dict, Any

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, HTTPException, Query, UploadFile, File
from fastapi.responses import RedirectResponse, FileResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel
from starlette.middleware.cors import CORSMiddleware

from models import (
    Approval,
    ApprovalDecision,
    Client,
    ClientCreate,
    ClientUpdate,
    Competitor,
    CompetitorCreate,
    IntegrationConfig,
    ProgressUpdate,
    RunCreate,
    WorkflowRun,
    new_id,
    now_iso,
)
from workflow import launch_workflow_task
import gsc
import ga
import screamingfrog
import semrush_csv
import semrush
import sf_bridge
import executor
import keyword_map as kw_map_lib
import page_analyzer
import dataforseo as dfs_lib
import competitors_enrich

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
mongo_client = AsyncIOMotorClient(mongo_url)
db = mongo_client[os.environ["DB_NAME"]]

app = FastAPI(title="SEO Operator API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("seo-operator")


def _strip_id(doc):
    if doc and "_id" in doc:
        doc.pop("_id", None)
    return doc


# ============ Health ============

@api.get("/")
async def root():
    return {"service": "seo-operator", "status": "ok"}


# ============ Clients ============

@api.get("/clients", response_model=List[Client])
async def list_clients():
    docs = await db.clients.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return docs


@api.post("/clients", response_model=Client)
async def create_client(payload: ClientCreate):
    client = Client(**payload.model_dump())
    await db.clients.insert_one(client.model_dump())
    return client


@api.get("/clients/{client_id}", response_model=Client)
async def get_client(client_id: str):
    doc = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Client not found")
    return doc


@api.patch("/clients/{client_id}", response_model=Client)
async def update_client(client_id: str, payload: ClientUpdate):
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update:
        doc = await db.clients.find_one({"id": client_id}, {"_id": 0})
        if not doc:
            raise HTTPException(404, "Client not found")
        return doc
    update["updated_at"] = now_iso()
    result = await db.clients.update_one({"id": client_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(404, "Client not found")
    doc = await db.clients.find_one({"id": client_id}, {"_id": 0})
    return doc


@api.delete("/clients/{client_id}")
async def delete_client(client_id: str):
    result = await db.clients.delete_one({"id": client_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Client not found")
    # Cleanup associated data
    await db.runs.delete_many({"client_id": client_id})
    await db.approvals.delete_many({"client_id": client_id})
    return {"ok": True}


# ============ Competitors ============

@api.post("/clients/{client_id}/competitors", response_model=Client)
async def add_competitor(client_id: str, payload: CompetitorCreate):
    competitor = Competitor(**payload.model_dump())
    result = await db.clients.update_one(
        {"id": client_id},
        {"$push": {"competitors": competitor.model_dump()}, "$set": {"updated_at": now_iso()}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Client not found")
    return await db.clients.find_one({"id": client_id}, {"_id": 0})


@api.delete("/clients/{client_id}/competitors/{competitor_id}", response_model=Client)
async def remove_competitor(client_id: str, competitor_id: str):
    result = await db.clients.update_one(
        {"id": client_id},
        {"$pull": {"competitors": {"id": competitor_id}}, "$set": {"updated_at": now_iso()}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Client not found")
    return await db.clients.find_one({"id": client_id}, {"_id": 0})


# ============ Competitor enrichment ============

@api.post("/clients/{client_id}/competitors/{competitor_id}/metrics/refresh")
async def competitor_refresh_metrics(client_id: str, competitor_id: str):
    if not (semrush.is_configured() or dfs_lib.is_configured()):
        raise HTTPException(400, "Neither Semrush nor DataForSEO is configured")
    try:
        await competitors_enrich.refresh_metrics(db, client_id, competitor_id)
    except RuntimeError as e:
        raise HTTPException(404 if "not found" in str(e).lower() else 422, str(e))
    return await db.clients.find_one({"id": client_id}, {"_id": 0})


@api.post("/clients/{client_id}/competitors/{competitor_id}/keywords/refresh")
async def competitor_refresh_keywords(client_id: str, competitor_id: str, limit: int = 200):
    if not dfs_lib.is_configured():
        raise HTTPException(400, "DataForSEO not configured")
    try:
        await competitors_enrich.refresh_ranked_keywords(db, client_id, competitor_id, limit=min(limit, 1000))
    except RuntimeError as e:
        raise HTTPException(404, str(e))
    return await db.clients.find_one({"id": client_id}, {"_id": 0})


@api.post("/clients/{client_id}/competitors/{competitor_id}/semrush/upload")
async def competitor_semrush_upload(client_id: str, competitor_id: str, file: UploadFile = File(...)):
    c = await db.clients.find_one(
        {"id": client_id, "competitors.id": competitor_id},
        {"_id": 0, "competitors.$": 1},
    )
    if not c:
        raise HTTPException(404, "Competitor not found")
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "Only .csv files supported")
    raw = await file.read()
    text = raw.decode("utf-8-sig", errors="replace")
    parsed = semrush_csv.parse_csv(text)
    if parsed["type"] in ("empty", "unknown"):
        raise HTTPException(400, parsed.get("note") or "Could not recognise this Semrush export")
    await competitors_enrich.save_semrush_upload(db, client_id, competitor_id, parsed, filename=file.filename)
    return {"ok": True, "type": parsed["type"], "rows": parsed["rows"], "summary": parsed["summary"]}


@api.post("/clients/{client_id}/competitors/{competitor_id}/sf-crawl/upload")
async def competitor_sf_upload(client_id: str, competitor_id: str, file: UploadFile = File(...)):
    c = await db.clients.find_one(
        {"id": client_id, "competitors.id": competitor_id},
        {"_id": 0, "competitors.$": 1},
    )
    if not c:
        raise HTTPException(404, "Competitor not found")
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "Only .csv files supported")
    raw = await file.read()
    text = raw.decode("utf-8-sig", errors="replace")
    parsed = screamingfrog.parse_csv(text)
    if parsed.get("format") in ("empty", "unknown"):
        raise HTTPException(400, "Could not recognise this Screaming Frog export — try issues_overview or internal_all.csv")
    await competitors_enrich.save_sf_crawl(db, client_id, competitor_id, parsed, filename=file.filename)
    return {"ok": True, "format": parsed.get("format"), "rows": parsed.get("rows"), "summary": parsed.get("summary")}


@api.get("/clients/{client_id}/competitors/comparison")
async def competitors_comparison(client_id: str):
    return await competitors_enrich.build_comparison(db, client_id)


@api.post("/clients/{client_id}/metrics/refresh")
async def client_refresh_metrics(client_id: str):
    """Refresh authority/backlinks for the client's OWN domain (for comparison view)."""
    if not (semrush.is_configured() or dfs_lib.is_configured()):
        raise HTTPException(400, "Neither Semrush nor DataForSEO is configured")
    try:
        metrics = await competitors_enrich.refresh_client_metrics(db, client_id)
    except RuntimeError as e:
        raise HTTPException(404 if "not found" in str(e).lower() else 422, str(e))
    return {"ok": True, "metrics": metrics}


@api.post("/clients/{client_id}/competitors/refresh-all")
async def refresh_all_competitor_metrics(client_id: str):
    """Bulk-refresh metrics for the client + every tracked competitor. Runs them
    in parallel so a 5-competitor refresh takes ~the same time as 1."""
    if not (semrush.is_configured() or dfs_lib.is_configured()):
        raise HTTPException(400, "Neither Semrush nor DataForSEO is configured")
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "competitors": 1})
    if not client:
        raise HTTPException(404, "Client not found")
    competitors = client.get("competitors") or []

    import asyncio as _asyncio

    async def _client_task():
        try:
            await competitors_enrich.refresh_client_metrics(db, client_id)
            return ("client", "ok", None)
        except Exception as e:  # noqa: BLE001
            return ("client", "error", str(e)[:160])

    async def _comp_task(cid: str, cname: str):
        try:
            await competitors_enrich.refresh_metrics(db, client_id, cid)
            return (cname, "ok", None)
        except Exception as e:  # noqa: BLE001
            return (cname, "error", str(e)[:160])

    tasks = [_client_task()] + [_comp_task(c["id"], c.get("name", c.get("domain", "?"))) for c in competitors if c.get("id")]
    outcomes = await _asyncio.gather(*tasks, return_exceptions=False)

    succeeded = [o for o in outcomes if o[1] == "ok"]
    failed = [{"name": o[0], "error": o[2]} for o in outcomes if o[1] != "ok"]
    updated = await db.clients.find_one({"id": client_id}, {"_id": 0})
    return {
        "ok": len(failed) == 0,
        "refreshed": len(succeeded),
        "failed": failed,
        "client": updated,
    }


# ---------- Competitor SF bridge crawl ----------

class CompetitorSfCrawlRequest(BaseModel):
    max_urls: int = 200


@api.post("/clients/{client_id}/competitors/{competitor_id}/sf-bridge/crawl")
async def competitor_sf_bridge_crawl(
    client_id: str,
    competitor_id: str,
    payload: CompetitorSfCrawlRequest = CompetitorSfCrawlRequest(),
):
    """Trigger an SF crawl for a competitor domain via the local bridge.
    Capped at 200 URLs to keep things fast/cheap."""
    cfg = await sf_bridge.get_config(db, client_id)
    if not cfg:
        raise HTTPException(400, "Bridge not configured")
    c = await competitors_enrich._get_competitor(db, client_id, competitor_id)
    if not c:
        raise HTTPException(404, "Competitor not found")
    domain = (c.get("domain") or "").strip()
    if not domain:
        raise HTTPException(400, "Competitor has no domain")
    url = domain if domain.startswith(("http://", "https://")) else f"https://{domain}"
    max_urls = max(10, min(payload.max_urls, 200))
    try:
        started = await sf_bridge.start_crawl(
            cfg["base_url"], cfg.get("token"), url, max_urls=max_urls,
        )
    except sf_bridge.BridgeError as e:
        raise HTTPException(502, str(e))
    except Exception as e:
        raise HTTPException(502, f"Could not reach bridge: {str(e) or type(e).__name__}")
    job_id = started.get("job_id")
    await db.clients.update_one(
        {"id": client_id, "competitors.id": competitor_id},
        {"$set": {"competitors.$.sf_crawl.active_job": {
            "job_id": job_id,
            "url": url,
            "max_urls": max_urls,
            "started_at": now_iso(),
            "status": started.get("status", "running"),
        }}},
    )
    return {"ok": True, "job_id": job_id, "status": started.get("status")}


@api.post("/clients/{client_id}/competitors/{competitor_id}/sf-bridge/crawl/{job_id}/ingest")
async def competitor_sf_bridge_ingest(client_id: str, competitor_id: str, job_id: str):
    """Pull issues_overview + internal_all CSVs from the bridge and save under the competitor."""
    cfg = await sf_bridge.get_config(db, client_id)
    if not cfg:
        raise HTTPException(400, "Bridge not configured")
    c = await competitors_enrich._get_competitor(db, client_id, competitor_id)
    if not c:
        raise HTTPException(404, "Competitor not found")
    try:
        files = await sf_bridge.list_files(cfg["base_url"], cfg.get("token"), job_id)
    except sf_bridge.BridgeError as e:
        raise HTTPException(502, str(e))
    except Exception as e:
        raise HTTPException(502, f"Could not reach bridge: {str(e) or type(e).__name__}")
    if not files:
        raise HTTPException(400, "No CSVs available yet — wait for the crawl to finish")

    def _is_issues_overview(f):
        low = f.lower()
        return "issues_overview" in low and low.endswith(".csv")

    def _is_internal_all(f):
        low = f.lower()
        return ("internal_all" in low or low.endswith("internal_all.csv")) and low.endswith(".csv")

    issues_files = [f for f in files if _is_issues_overview(f)]
    internal_files = [f for f in files if _is_internal_all(f)]
    response: Dict[str, Any] = {"ok": True, "ingested": {}}

    if issues_files:
        chosen = issues_files[0]
        try:
            text = await sf_bridge.fetch_file(cfg["base_url"], cfg.get("token"), job_id, chosen)
        except Exception as e:
            raise HTTPException(502, f"Could not fetch {chosen}: {str(e) or type(e).__name__}")
        parsed = screamingfrog.parse_csv(text)
        if parsed.get("format") == "issues_overview":
            await competitors_enrich.save_sf_crawl(db, client_id, competitor_id, parsed, filename=f"bridge:{chosen}")
            response["ingested"]["issues_overview"] = {
                "file": chosen,
                "rows": parsed.get("rows"),
                "summary": parsed.get("summary"),
            }

    if internal_files:
        chosen = internal_files[0]
        try:
            text = await sf_bridge.fetch_file(cfg["base_url"], cfg.get("token"), job_id, chosen)
        except Exception as e:
            response["ingested"]["internal_all_error"] = str(e) or type(e).__name__
        else:
            parsed_int = screamingfrog.parse_csv(text)
            if parsed_int.get("format") == "internal_all":
                await competitors_enrich.save_sf_crawl(db, client_id, competitor_id, parsed_int, filename=f"bridge:{chosen}")
                response["ingested"]["internal_all"] = {
                    "file": chosen,
                    "rows": parsed_int.get("rows"),
                    "page_index_size": parsed_int.get("summary", {}).get("page_index_size", 0),
                }

    if not response["ingested"]:
        raise HTTPException(400, "No recognisable SF CSVs found in this job")
    return response




# ============ Integrations ============

@api.put("/clients/{client_id}/integrations", response_model=Client)
async def update_integrations(client_id: str, payload: IntegrationConfig):
    result = await db.clients.update_one(
        {"id": client_id},
        {"$set": {"integrations": payload.model_dump(), "updated_at": now_iso()}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Client not found")
    return await db.clients.find_one({"id": client_id}, {"_id": 0})


# ============ Runs ============

@api.post("/runs", response_model=WorkflowRun)
async def create_run(payload: RunCreate):
    client = await db.clients.find_one({"id": payload.client_id}, {"_id": 0})
    if not client:
        raise HTTPException(404, "Client not found")
    run = WorkflowRun(
        client_id=payload.client_id,
        client_name=client.get("name", ""),
        type=payload.type,
        objective=payload.objective,
    )
    await db.runs.insert_one(run.model_dump())
    launch_workflow_task(db, run.id)
    return run


@api.get("/runs", response_model=List[WorkflowRun])
async def list_runs(client_id: Optional[str] = Query(None), limit: int = 50):
    q = {"client_id": client_id} if client_id else {}
    docs = await db.runs.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return docs


@api.get("/runs/{run_id}", response_model=WorkflowRun)
async def get_run(run_id: str):
    doc = await db.runs.find_one({"id": run_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Run not found")
    return doc


@api.get("/runs/active/all", response_model=List[WorkflowRun])
async def list_active_runs():
    docs = await db.runs.find(
        {"status": {"$in": ["queued", "running"]}}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    return docs


# ============ Approvals ============

@api.get("/approvals", response_model=List[Approval])
async def list_approvals(
    client_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
):
    q = {}
    if client_id:
        q["client_id"] = client_id
    if status:
        q["status"] = status
    docs = await db.approvals.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@api.post("/approvals/{approval_id}/decision", response_model=Approval)
async def decide_approval(approval_id: str, decision: ApprovalDecision):
    if decision.status not in ("approved", "rejected"):
        raise HTTPException(400, "Status must be approved or rejected")
    update = {
        "status": decision.status,
        "decided_at": now_iso(),
        "decision_note": decision.note or "",
    }
    if decision.edited_content is not None:
        update["content"] = decision.edited_content
    if decision.status == "approved":
        update["progress"] = "open"
    result = await db.approvals.update_one({"id": approval_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(404, "Approval not found")
    return await db.approvals.find_one({"id": approval_id}, {"_id": 0})


@api.post("/approvals/{approval_id}/progress", response_model=Approval)
async def update_progress(approval_id: str, payload: ProgressUpdate):
    """Move an approved item along its lifecycle: open → in_progress → done → archived.
    
    Auto-triggers agent execution when moving to in_progress if no artifact exists yet."""
    if payload.progress not in ("open", "in_progress", "done", "archived"):
        raise HTTPException(400, "Invalid progress value")
    update = {
        "progress": payload.progress,
        "progress_updated_at": now_iso(),
    }
    if payload.note is not None:
        update["progress_note"] = payload.note
    result = await db.approvals.update_one(
        {"id": approval_id, "status": "approved"},
        {"$set": update},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Approved approval not found")

    # Auto-execute when moving to in_progress without an existing artifact
    doc = await db.approvals.find_one({"id": approval_id}, {"_id": 0})
    if (
        payload.progress == "in_progress"
        and executor.is_executable(doc.get("kind", ""))
        and (doc.get("artifact_status") or "none") in ("none", "error")
    ):
        await db.approvals.update_one(
            {"id": approval_id},
            {"$set": {"artifact_status": "generating", "artifact_error": None}},
        )
        executor.launch_execute(db, approval_id)
        doc["artifact_status"] = "generating"
    return doc


@api.post("/approvals/{approval_id}/execute", response_model=Approval)
async def execute_approval(approval_id: str):
    """Explicitly trigger agent execution for an approved task."""
    doc = await db.approvals.find_one({"id": approval_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Approval not found")
    if doc.get("status") != "approved":
        raise HTTPException(400, "Task must be approved first")
    if not executor.is_executable(doc.get("kind", "")):
        raise HTTPException(400, f"No executor available for kind '{doc.get('kind')}'")
    if doc.get("artifact_status") == "generating":
        return doc
    await db.approvals.update_one(
        {"id": approval_id},
        {"$set": {"artifact_status": "generating", "artifact_error": None}},
    )
    executor.launch_execute(db, approval_id)
    doc["artifact_status"] = "generating"
    return doc


class ArtifactEdit(BaseModel):
    artifact: Dict[str, Any]


@api.put("/approvals/{approval_id}/artifact", response_model=Approval)
async def edit_artifact(approval_id: str, payload: ArtifactEdit):
    """Inline edit the agent-generated artifact."""
    result = await db.approvals.update_one(
        {"id": approval_id},
        {"$set": {"artifact": payload.artifact, "artifact_status": "ready"}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Approval not found")
    return await db.approvals.find_one({"id": approval_id}, {"_id": 0})


class ContentEdit(BaseModel):
    content: Dict[str, Any]


class DraftRequest(BaseModel):
    url: str


@api.post("/approvals/{approval_id}/expand-draft", response_model=Approval)
async def expand_draft(approval_id: str, payload: DraftRequest):
    """Expand a per-URL content remediation directive into full draft copy."""
    try:
        await executor.expand_content_draft(db, approval_id, payload.url)
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    return await db.approvals.find_one({"id": approval_id}, {"_id": 0})


@api.put("/approvals/{approval_id}/content", response_model=Approval)
async def edit_content(approval_id: str, payload: ContentEdit):
    result = await db.approvals.update_one(
        {"id": approval_id},
        {"$set": {"content": payload.content}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Approval not found")
    return await db.approvals.find_one({"id": approval_id}, {"_id": 0})


@api.get("/clients/{client_id}/deliverables")
async def list_deliverables(client_id: str):
    """All approved items for a client, grouped by kind with progress counters."""
    items = await db.approvals.find(
        {"client_id": client_id, "status": "approved"},
        {"_id": 0},
    ).sort("decided_at", -1).to_list(500)
    groups: dict = {}
    counters = {"total": 0, "open": 0, "in_progress": 0, "done": 0, "archived": 0}
    for it in items:
        kind = it.get("kind", "other")
        groups.setdefault(kind, []).append(it)
        counters["total"] += 1
        counters[it.get("progress") or "open"] = counters.get(it.get("progress") or "open", 0) + 1
    return {"groups": groups, "counters": counters}


@api.get("/clients/{client_id}/tasks")
async def list_tasks(client_id: str, status_filter: Optional[str] = Query(None, alias="status")):
    """Flat client-facing task list. Each approval is a task with a clear action."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1, "domain": 1, "share_token": 1})
    if not client:
        raise HTTPException(404, "Client not found")
    q: dict = {"client_id": client_id, "status": "approved"}
    if status_filter:
        q["progress"] = status_filter
    items = await db.approvals.find(q, {"_id": 0}).sort("decided_at", -1).to_list(500)
    counters = {"total": len(items), "open": 0, "in_progress": 0, "done": 0, "archived": 0}
    for it in items:
        p = it.get("progress") or "open"
        counters[p] = counters.get(p, 0) + 1
    return {
        "client": {"name": client.get("name"), "domain": client.get("domain"), "share_token": client.get("share_token")},
        "counters": counters,
        "tasks": items,
    }


@api.get("/share/{token}/tasks")
async def share_tasks(token: str):
    """Public read-only client-facing view of approved tasks for a client."""
    client = await db.clients.find_one({"share_token": token}, {"_id": 0, "name": 1, "domain": 1, "id": 1})
    if not client:
        raise HTTPException(404, "Share link invalid or expired")
    items = await db.approvals.find(
        {"client_id": client["id"], "status": "approved", "progress": {"$ne": "archived"}},
        {"_id": 0, "id": 1, "kind": 1, "title": 1, "summary": 1, "content": 1, "progress": 1,
         "decided_at": 1, "progress_updated_at": 1,
         "artifact": 1, "artifact_status": 1, "artifact_generated_at": 1},
    ).sort("decided_at", -1).to_list(500)
    counters = {"total": len(items), "open": 0, "in_progress": 0, "done": 0}
    for it in items:
        p = it.get("progress") or "open"
        if p in counters:
            counters[p] += 1
    return {
        "client": {"name": client.get("name"), "domain": client.get("domain")},
        "counters": counters,
        "tasks": items,
    }


@api.post("/clients/{client_id}/share-token/rotate")
async def rotate_share_token(client_id: str):
    new_token = new_id()
    res = await db.clients.update_one({"id": client_id}, {"$set": {"share_token": new_token}})
    if res.matched_count == 0:
        raise HTTPException(404, "Client not found")
    return {"share_token": new_token}


# ============ GSC Integration ============

@api.get("/integrations/gsc/connect")
async def gsc_connect(client_id: str = Query(...)):
    if not gsc.is_configured():
        raise HTTPException(500, "GSC OAuth not configured on server")
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1})
    if not client:
        raise HTTPException(404, "Client not found")
    state = gsc.build_state(client_id)
    url = gsc.build_authorization_url(state)
    return RedirectResponse(url=url, status_code=302)


@api.get("/integrations/gsc/callback")
async def gsc_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
):
    frontend = os.environ.get("FRONTEND_BASE_URL", "")
    if error or not code or not state:
        reason = error or "missing_code_or_state"
        return RedirectResponse(url=f"{frontend}/?gsc_error={reason}", status_code=303)
    try:
        state_data = gsc.parse_state(state)
        client_id = state_data["client_id"]
    except Exception:
        return RedirectResponse(url=f"{frontend}/?gsc_error=invalid_state", status_code=303)

    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1})
    if not client:
        return RedirectResponse(url=f"{frontend}/?gsc_error=client_not_found", status_code=303)

    try:
        token_data = await gsc.exchange_code_for_tokens(code)
    except Exception:
        logger.exception("GSC token exchange failed")
        return RedirectResponse(url=f"{frontend}/clients/{client_id}/integrations?gsc=error&reason=exchange_failed", status_code=303)

    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    if not access_token or not refresh_token:
        return RedirectResponse(
            url=f"{frontend}/clients/{client_id}/integrations?gsc=error&reason=missing_refresh_token",
            status_code=303,
        )

    google_email = await gsc.fetch_google_email(access_token)
    expiry_iso = gsc._expiry_from_expires_in(token_data.get("expires_in"))
    await gsc.save_gsc_tokens(
        db=db,
        client_id=client_id,
        access_token=access_token,
        refresh_token=refresh_token,
        expiry_iso=expiry_iso,
        scope=token_data.get("scope", ""),
        token_type=token_data.get("token_type", "Bearer"),
        google_email=google_email,
    )
    return RedirectResponse(
        url=f"{frontend}/clients/{client_id}/integrations?gsc=connected",
        status_code=303,
    )


@api.get("/clients/{client_id}/integrations/gsc/status")
async def gsc_status(client_id: str):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1})
    if not client:
        raise HTTPException(404, "Client not found")
    state = await gsc.get_gsc_state(db, client_id) or {}
    cache = state.get("performance_cache") or {}
    return {
        "connected": bool(state.get("connected")),
        "configured": gsc.is_configured(),
        "google_email": state.get("google_email"),
        "selected_site_url": state.get("selected_site_url"),
        "last_refreshed_at": state.get("last_refreshed_at"),
        "has_cache": bool(cache),
        "totals": cache.get("totals"),
    }


@api.get("/clients/{client_id}/integrations/gsc/sites")
async def gsc_sites(client_id: str):
    try:
        access_token, _ = await gsc.ensure_valid_access_token(db, client_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    try:
        sites = await gsc.list_sites(access_token)
    except Exception:
        logger.exception("GSC list sites failed")
        raise HTTPException(502, "Failed to list GSC sites")
    return {"sites": sites}


class SelectSiteRequest(BaseModel):
    site_url: str


@api.post("/clients/{client_id}/integrations/gsc/select-site")
async def gsc_select_site(client_id: str, payload: SelectSiteRequest):
    await gsc.set_selected_site(db, client_id, payload.site_url)
    return {"ok": True, "selected_site_url": payload.site_url}


@api.post("/clients/{client_id}/integrations/gsc/refresh")
async def gsc_refresh(client_id: str):
    state = await gsc.get_gsc_state(db, client_id) or {}
    site_url = state.get("selected_site_url")
    if not site_url:
        raise HTTPException(400, "No GSC site selected. Pick a site first.")
    try:
        cache = await gsc.pull_28d_performance(db, client_id, site_url)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception:
        logger.exception("GSC refresh failed")
        raise HTTPException(502, "Failed to pull GSC data")
    return {"ok": True, "totals": cache.get("totals"), "refreshed_at": cache.get("refreshed_at")}


@api.post("/clients/{client_id}/integrations/gsc/disconnect")
async def gsc_disconnect(client_id: str):
    await gsc.disconnect(db, client_id)
    return {"ok": True}


# ============ GA Integration ============

@api.get("/integrations/ga/connect")
async def ga_connect(client_id: str = Query(...)):
    if not ga.is_configured():
        raise HTTPException(500, "GA OAuth not configured on server")
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1})
    if not client:
        raise HTTPException(404, "Client not found")
    return RedirectResponse(url=ga.build_authorization_url(ga.build_state(client_id)), status_code=302)


@api.get("/integrations/ga/callback")
async def ga_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
):
    frontend = os.environ.get("FRONTEND_BASE_URL", "")
    if error or not code or not state:
        return RedirectResponse(url=f"{frontend}/?ga_error={error or 'missing_code'}", status_code=303)
    try:
        client_id = ga.parse_state(state)["client_id"]
    except Exception:
        return RedirectResponse(url=f"{frontend}/?ga_error=invalid_state", status_code=303)
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1})
    if not client:
        return RedirectResponse(url=f"{frontend}/?ga_error=client_not_found", status_code=303)
    try:
        token_data = await ga.exchange_code_for_tokens(code)
    except Exception:
        logger.exception("GA token exchange failed")
        return RedirectResponse(url=f"{frontend}/clients/{client_id}/integrations?ga=error&reason=exchange_failed", status_code=303)

    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    if not access_token or not refresh_token:
        return RedirectResponse(
            url=f"{frontend}/clients/{client_id}/integrations?ga=error&reason=missing_refresh_token",
            status_code=303,
        )
    google_email = await ga.fetch_google_email(access_token)
    expiry_iso = ga._expiry_from_expires_in(token_data.get("expires_in"))
    await ga.save_tokens(
        db, client_id, access_token, refresh_token, expiry_iso,
        token_data.get("scope", ""), token_data.get("token_type", "Bearer"), google_email,
    )
    return RedirectResponse(url=f"{frontend}/clients/{client_id}/integrations?ga=connected", status_code=303)


@api.get("/clients/{client_id}/integrations/ga/status")
async def ga_status(client_id: str):
    state = await ga.get_state(db, client_id) or {}
    cache = state.get("performance_cache") or {}
    return {
        "connected": bool(state.get("connected")),
        "configured": ga.is_configured(),
        "google_email": state.get("google_email"),
        "selected_property_id": state.get("selected_property_id"),
        "selected_property_name": state.get("selected_property_name"),
        "last_refreshed_at": state.get("last_refreshed_at"),
        "has_cache": bool(cache),
        "totals": cache.get("totals"),
    }


@api.get("/clients/{client_id}/integrations/ga/properties")
async def ga_properties(client_id: str):
    try:
        access_token, _ = await ga.ensure_valid_access_token(db, client_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    try:
        props = await ga.list_properties(access_token)
    except Exception:
        logger.exception("GA list properties failed")
        raise HTTPException(502, "Failed to list GA properties")
    return {"properties": props}


class GaSelectPropertyRequest(BaseModel):
    property_id: str
    property_name: str = ""


@api.post("/clients/{client_id}/integrations/ga/select-property")
async def ga_select_property(client_id: str, payload: GaSelectPropertyRequest):
    await ga.set_selected_property(db, client_id, payload.property_id, payload.property_name)
    return {"ok": True, "property_id": payload.property_id}


@api.post("/clients/{client_id}/integrations/ga/refresh")
async def ga_refresh(client_id: str):
    state = await ga.get_state(db, client_id) or {}
    pid = state.get("selected_property_id")
    if not pid:
        raise HTTPException(400, "No GA property selected.")
    try:
        cache = await ga.pull_28d_traffic(db, client_id, pid)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception:
        logger.exception("GA refresh failed")
        raise HTTPException(502, "Failed to pull GA data")
    return {"ok": True, "totals": cache.get("totals"), "refreshed_at": cache.get("refreshed_at")}


@api.post("/clients/{client_id}/integrations/ga/disconnect")
async def ga_disconnect(client_id: str):
    await ga.disconnect(db, client_id)
    return {"ok": True}


# ============ Screaming Frog ============

@api.post("/clients/{client_id}/integrations/screamingfrog/upload")
async def sf_upload(client_id: str, file: UploadFile = File(...)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1})
    if not client:
        raise HTTPException(404, "Client not found")
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "Only .csv exports are supported (Issues Overview or internal_all)")
    try:
        raw = await file.read()
        text = raw.decode("utf-8", errors="replace")
    except Exception:
        raise HTTPException(400, "Could not read uploaded file")
    parsed = screamingfrog.parse_csv(text)
    if parsed.get("format") == "unknown":
        raise HTTPException(
            400,
            parsed.get("note") or "Unrecognised Screaming Frog export — try Issues Overview CSV.",
        )
    await screamingfrog.save_crawl(db, client_id, parsed, filename=file.filename)
    return {
        "ok": True,
        "format": parsed.get("format"),
        "rows": parsed.get("rows"),
        "summary": parsed.get("summary"),
        "issue_count": len(parsed.get("issues") or []),
    }


@api.get("/clients/{client_id}/integrations/screamingfrog/status")
async def sf_status(client_id: str):
    crawl = await screamingfrog.get_crawl(db, client_id)
    if not crawl:
        return {"uploaded": False}
    return {
        "uploaded": True,
        "filename": crawl.get("filename"),
        "format": crawl.get("format"),
        "rows": crawl.get("rows"),
        "summary": crawl.get("summary"),
        "ingested_at": crawl.get("ingested_at"),
    }


@api.delete("/clients/{client_id}/integrations/screamingfrog")
async def sf_clear(client_id: str):
    await screamingfrog.clear_crawl(db, client_id)
    return {"ok": True}


# ============ Semrush + DataForSEO ============

@api.get("/integrations/semrush/status")
async def semrush_status():
    import semrush as _sem
    if not _sem.is_configured():
        return {"configured": False, "ok": False}
    return {"configured": True, **await _sem.test_connection()}


# ---- Semrush manual CSV uploads (per-client) ----

@api.post("/clients/{client_id}/integrations/semrush/upload")
async def semrush_csv_upload(client_id: str, file: UploadFile = File(...)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1})
    if not client:
        raise HTTPException(404, "Client not found")
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "Only .csv exports are supported")
    try:
        raw = await file.read()
        text = raw.decode("utf-8-sig", errors="replace")
    except Exception:
        raise HTTPException(400, "Could not read uploaded file")
    parsed = semrush_csv.parse_csv(text)
    if parsed["type"] == "unknown":
        raise HTTPException(
            400,
            parsed.get("note") or "Unrecognised Semrush export — try Domain Overview, Organic Positions, Competitors, Backlinks, or Keyword Gap.",
        )
    if parsed["type"] == "empty":
        raise HTTPException(400, "CSV is empty")
    await semrush_csv.save_upload(db, client_id, parsed, filename=file.filename)
    return {
        "ok": True,
        "type": parsed["type"],
        "rows": parsed["rows"],
        "summary": parsed["summary"],
        "ingested_at": parsed["ingested_at"],
    }


@api.get("/clients/{client_id}/integrations/semrush/uploads")
async def semrush_uploads_status(client_id: str):
    uploads = await semrush_csv.get_uploads(db, client_id)
    out = {}
    for t in semrush_csv.SUPPORTED_TYPES:
        u = uploads.get(t)
        if u:
            out[t] = {
                "filename": u.get("filename"),
                "rows": u.get("rows"),
                "summary": u.get("summary"),
                "ingested_at": u.get("ingested_at"),
            }
    return {"uploads": out, "last_uploaded_at": uploads.get("last_uploaded_at")}


@api.delete("/clients/{client_id}/integrations/semrush/upload/{etype}")
async def semrush_csv_clear(client_id: str, etype: str):
    if etype not in semrush_csv.SUPPORTED_TYPES:
        raise HTTPException(400, "Unknown export type")
    await semrush_csv.clear_upload(db, client_id, etype)
    return {"ok": True}


@api.get("/integrations/dataforseo/status")
async def dataforseo_status():
    import dataforseo as _dfs
    if not _dfs.is_configured():
        return {"configured": False, "ok": False}
    return {"configured": True, **await _dfs.test_connection()}


# ============ Screaming Frog bridge ============

class SfBridgeConfig(BaseModel):
    base_url: str
    token: str = ""


@api.post("/clients/{client_id}/integrations/sf-bridge/configure")
async def sf_bridge_configure(client_id: str, payload: SfBridgeConfig):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1})
    if not client:
        raise HTTPException(404, "Client not found")
    if not payload.base_url.strip():
        raise HTTPException(400, "base_url required")
    await sf_bridge.save_config(db, client_id, payload.base_url, payload.token)
    return {"ok": True}


@api.get("/clients/{client_id}/integrations/sf-bridge/status")
async def sf_bridge_status(client_id: str):
    cfg = await sf_bridge.get_config(db, client_id)
    if not cfg:
        return {"configured": False}
    health = await sf_bridge.test_connection(cfg["base_url"], cfg.get("token"))
    return {
        "configured": True,
        "base_url": cfg["base_url"],
        "has_token": bool(cfg.get("token")),
        **health,
    }


class SfCrawlRequest(BaseModel):
    url: str
    max_urls: int = 500


@api.post("/clients/{client_id}/integrations/sf-bridge/crawl")
async def sf_bridge_crawl(client_id: str, payload: SfCrawlRequest):
    cfg = await sf_bridge.get_config(db, client_id)
    if not cfg:
        raise HTTPException(400, "Bridge not configured")
    try:
        started = await sf_bridge.start_crawl(
            cfg["base_url"], cfg.get("token"), payload.url, max_urls=payload.max_urls,
        )
    except sf_bridge.BridgeError as e:
        raise HTTPException(502, str(e))
    except Exception as e:
        raise HTTPException(502, f"Could not reach bridge: {str(e) or type(e).__name__}")
    job_id = started.get("job_id")
    # Persist active job so the UI can poll
    await db.clients.update_one(
        {"id": client_id},
        {"$set": {"sf_bridge.active_job": {
            "job_id": job_id,
            "url": payload.url,
            "started_at": now_iso(),
            "status": started.get("status", "running"),
        }}},
    )
    return {"ok": True, "job_id": job_id, "status": started.get("status")}


@api.get("/clients/{client_id}/integrations/sf-bridge/crawl/{job_id}")
async def sf_bridge_crawl_status(client_id: str, job_id: str):
    cfg = await sf_bridge.get_config(db, client_id)
    if not cfg:
        raise HTTPException(400, "Bridge not configured")
    try:
        return await sf_bridge.get_status(cfg["base_url"], cfg.get("token"), job_id)
    except sf_bridge.BridgeError as e:
        raise HTTPException(502, str(e))
    except Exception as e:
        raise HTTPException(502, f"Could not reach bridge: {str(e) or type(e).__name__}")


@api.post("/clients/{client_id}/integrations/sf-bridge/crawl/{job_id}/ingest")
async def sf_bridge_ingest(client_id: str, job_id: str):
    """Pull all useful CSVs from the bridge: issues_overview (for the audit),
    internal_all (to build a per-URL page index), and every bulk-issue CSV
    (to build issue-name → affected URLs map)."""
    cfg = await sf_bridge.get_config(db, client_id)
    if not cfg:
        raise HTTPException(400, "Bridge not configured")
    try:
        files = await sf_bridge.list_files(cfg["base_url"], cfg.get("token"), job_id)
    except sf_bridge.BridgeError as e:
        raise HTTPException(502, str(e))
    except Exception as e:
        raise HTTPException(502, f"Could not reach bridge: {str(e) or type(e).__name__}. Check that the bridge + ngrok are still running and the URL is current.")
    if not files:
        raise HTTPException(400, "No CSVs available yet — wait for the crawl to finish")

    def _is_issues_overview(f):
        low = f.lower()
        return "issues_overview" in low and low.endswith(".csv")

    def _is_internal_all(f):
        low = f.lower()
        return ("internal_all" in low or low.endswith("internal_all.csv")) and low.endswith(".csv")

    issues_files = [f for f in files if _is_issues_overview(f)]
    internal_files = [f for f in files if _is_internal_all(f)]
    bulk_issue_files = [
        f for f in files
        if f.lower().endswith(".csv")
        and "issues_reports" in f.lower()
        and not _is_issues_overview(f)
    ]

    if not issues_files and not internal_files:
        # Fallback to any CSV
        files.sort()
        issues_files = [files[0]]

    response: Dict[str, Any] = {"ok": True, "ingested": {}}

    # 1) Issues overview (the audit-grounding summary)
    if issues_files:
        chosen = issues_files[0]
        try:
            text = await sf_bridge.fetch_file(cfg["base_url"], cfg.get("token"), job_id, chosen)
        except Exception as e:
            raise HTTPException(502, f"Could not fetch {chosen}: {str(e) or type(e).__name__}")
        parsed = screamingfrog.parse_csv(text)
        if parsed.get("format") not in ("issues_overview", "unknown"):
            # If we got internal_all, still save the page index
            pass
        if parsed.get("format") == "issues_overview":
            await screamingfrog.save_crawl(db, client_id, parsed, filename=f"bridge:{chosen}")
            response["ingested"]["issues_overview"] = {
                "file": chosen,
                "rows": parsed.get("rows"),
                "summary": parsed.get("summary"),
            }

    # 2) Internal_all → page_index
    if internal_files:
        chosen = internal_files[0]
        try:
            text = await sf_bridge.fetch_file(cfg["base_url"], cfg.get("token"), job_id, chosen)
        except Exception as e:
            logger.exception("internal_all fetch failed")
            response["ingested"]["internal_all_error"] = str(e) or type(e).__name__
        else:
            parsed_int = screamingfrog.parse_csv(text)
            if parsed_int.get("format") == "internal_all":
                await screamingfrog.save_page_index(db, client_id, parsed_int, filename=chosen)
                response["ingested"]["internal_all"] = {
                    "file": chosen,
                    "rows": parsed_int.get("rows"),
                    "page_index_size": parsed_int.get("summary", {}).get("page_index_size", 0),
                }

    # 3) Per-issue bulk URL CSVs → issue_urls map
    if bulk_issue_files:
        issue_urls: Dict[str, List[str]] = {}
        for f in bulk_issue_files[:80]:  # safety cap
            try:
                text = await sf_bridge.fetch_file(cfg["base_url"], cfg.get("token"), job_id, f)
            except Exception:
                continue
            urls = screamingfrog.parse_issue_urls_csv(text)
            if not urls:
                continue
            # Derive issue key from filename: issues_reports/h1_missing.csv → "h1_missing"
            key = f.rsplit("/", 1)[-1].rsplit(".", 1)[0]
            issue_urls[key] = urls[:500]
        if issue_urls:
            await screamingfrog.save_issue_urls(db, client_id, issue_urls)
            response["ingested"]["issue_urls"] = {
                "issues": len(issue_urls),
                "total_urls": sum(len(v) for v in issue_urls.values()),
            }

    if not response["ingested"]:
        raise HTTPException(400, "No recognisable SF CSVs found in this job")

    return response


@api.post("/clients/{client_id}/integrations/sf-bridge/disconnect")
async def sf_bridge_disconnect(client_id: str):
    await sf_bridge.clear_config(db, client_id)
    return {"ok": True}


@api.get("/integrations/sf-bridge/download")
async def sf_bridge_download():
    """Serve the local bridge script for the user to run on Windows."""
    path = Path("/app/bridge/sf_bridge.py")
    if not path.exists():
        raise HTTPException(404, "Bridge script not found")
    return FileResponse(str(path), media_type="text/x-python", filename="sf_bridge.py")


@api.get("/integrations/sf-bridge/readme")
async def sf_bridge_readme():
    path = Path("/app/bridge/README.md")
    if not path.exists():
        raise HTTPException(404, "Readme not found")
    return FileResponse(str(path), media_type="text/markdown", filename="README.md")


# ============ Dashboard summary ============

@api.get("/dashboard/summary")
async def dashboard_summary():
    total_clients = await db.clients.count_documents({})
    active_runs = await db.runs.count_documents({"status": {"$in": ["queued", "running"]}})
    completed_runs = await db.runs.count_documents({"status": "completed"})
    pending_approvals = await db.approvals.count_documents({"status": "pending"})
    recent_runs = await db.runs.find({}, {"_id": 0}).sort("created_at", -1).to_list(5)
    return {
        "total_clients": total_clients,
        "active_runs": active_runs,
        "completed_runs": completed_runs,
        "pending_approvals": pending_approvals,
        "recent_runs": recent_runs,
    }


# ============ Keyword Map ============

class KwUpdate(BaseModel):
    target_url: Optional[str] = None
    priority: Optional[bool] = None
    status: Optional[str] = None


class AnalyzePagesRequest(BaseModel):
    urls: List[str]


class SerpRequest(BaseModel):
    keyword: str


SERP_KEYWORD_CAP = 500  # Hard safety cap per the user


@api.post("/clients/{client_id}/keyword-map/build")
async def keyword_map_build(client_id: str):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(404, "Client not found")
    map_doc = await kw_map_lib.build_keyword_map(db, client)
    return {"ok": True, "stats": map_doc.get("stats"), "built_at": map_doc.get("built_at")}


@api.get("/clients/{client_id}/keyword-map")
async def keyword_map_get(client_id: str):
    return await kw_map_lib.get_keyword_map(db, client_id)


@api.patch("/clients/{client_id}/keyword-map/{keyword:path}")
async def keyword_map_update(client_id: str, keyword: str, payload: KwUpdate):
    updated = await kw_map_lib.update_keyword(
        db, client_id, keyword,
        target_url=payload.target_url,
        priority=payload.priority,
        status=payload.status,
    )
    return updated


@api.get("/clients/{client_id}/keyword-map/sparse-urls")
async def keyword_map_sparse(client_id: str, limit: int = 50):
    urls = await kw_map_lib.sparse_urls(db, client_id, limit=limit)
    return {"urls": urls, "total": len(urls)}


@api.post("/clients/{client_id}/keyword-map/analyze-page")
async def keyword_map_analyze_page(client_id: str, payload: AnalyzePagesRequest):
    """Run page-first keyword analysis on one or more URLs."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(404, "Client not found")
    if not payload.urls:
        raise HTTPException(400, "No URLs provided")
    if len(payload.urls) > 25:
        raise HTTPException(400, "Cap is 25 URLs per call")
    results = []
    for url in payload.urls:
        try:
            res = await page_analyzer.analyze_page(db, client, url)
            if res.get("ok"):
                await kw_map_lib.attach_page_suggestion(
                    db, client_id, url,
                    primary_keyword=res.get("primary_keyword_guess", ""),
                    related_keywords=res.get("related_keywords", []),
                    recommended_keyword=res.get("recommended_keyword", ""),
                )
            results.append(res)
        except Exception as e:
            results.append({"url": url, "ok": False, "error": str(e)})
    return {"results": results}


@api.post("/clients/{client_id}/keyword-map/serp")
async def keyword_map_serp(client_id: str, payload: SerpRequest):
    """Pull live SERP top-10 for a single keyword via DataForSEO and attach to the map."""
    if not dfs_lib.is_configured():
        raise HTTPException(400, "DataForSEO is not configured")
    # Check cap
    map_doc = await kw_map_lib.get_keyword_map(db, client_id)
    serp_count = sum(1 for k in (map_doc.get("keywords") or {}).values() if k.get("serp"))
    if serp_count >= SERP_KEYWORD_CAP:
        raise HTTPException(429, f"SERP fetch cap reached ({SERP_KEYWORD_CAP}). Clear some or raise the cap.")
    serp = await dfs_lib.serp_with_backlinks(payload.keyword)
    if not serp.get("organic"):
        raise HTTPException(502, "DataForSEO returned no SERP results")
    await kw_map_lib.attach_serp_landscape(db, client_id, payload.keyword, serp)
    return {"ok": True, "serp": serp}


class RefineRequest(BaseModel):
    limit: int = 100


@api.post("/clients/{client_id}/keyword-map/refine")
async def keyword_map_refine_start(client_id: str, payload: RefineRequest):
    """Start a relevance-first AI refinement of the top N URLs (by inlinks)."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1})
    if not client:
        raise HTTPException(404, "Client not found")
    existing = await kw_map_lib.get_refinement_status(db, client_id)
    if existing.get("status") == "running":
        raise HTTPException(409, f"Refinement already running ({existing.get('completed')}/{existing.get('total')})")
    try:
        state = await kw_map_lib.start_refinement(db, client_id, limit=max(1, min(payload.limit, 5000)))
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    return state


@api.get("/clients/{client_id}/keyword-map/refine/status")
async def keyword_map_refine_status(client_id: str):
    total_pages = await kw_map_lib.page_index_total(db, client_id)
    state = await kw_map_lib.get_refinement_status(db, client_id)
    return {"refinement": state, "page_index_total": total_pages}


@api.get("/clients/{client_id}/keyword-map/refine/url")
async def keyword_map_refine_one(client_id: str, url: str):
    out = await kw_map_lib.get_url_refinement(db, client_id, url)
    if not out:
        raise HTTPException(404, "No refinement for this URL")
    return out


@api.get("/clients/{client_id}/keyword-map/refinements")
async def keyword_map_refinements_list(client_id: str):
    refinements = await kw_map_lib.list_url_refinements(db, client_id)
    return {"refinements": refinements, "count": len(refinements)}




# ============ App wiring ============

app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    mongo_client.close()
