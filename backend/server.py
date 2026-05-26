"""FastAPI server for Autonomous SEO Agency Operator."""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, HTTPException, Query, UploadFile, File
from fastapi.responses import RedirectResponse
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
    RunCreate,
    WorkflowRun,
    new_id,
    now_iso,
)
from workflow import launch_workflow_task
import gsc
import ga
import screamingfrog

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
    result = await db.approvals.update_one({"id": approval_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(404, "Approval not found")
    return await db.approvals.find_one({"id": approval_id}, {"_id": 0})


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


@api.get("/integrations/dataforseo/status")
async def dataforseo_status():
    import dataforseo as _dfs
    if not _dfs.is_configured():
        return {"configured": False, "ok": False}
    return {"configured": True, **await _dfs.test_connection()}


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
