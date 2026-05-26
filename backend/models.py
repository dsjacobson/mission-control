"""MongoDB document models for the SEO Operator app."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any, Literal

from pydantic import BaseModel, Field, ConfigDict


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


# ---------- Client / Workspace ----------

class Competitor(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str
    domain: str
    notes: Optional[str] = ""


class IntegrationConfig(BaseModel):
    # All fields are placeholders; user can paste keys later.
    gsc_connected: bool = False
    ga_connected: bool = False
    semrush_api_key: Optional[str] = ""
    dataforseo_login: Optional[str] = ""
    dataforseo_password: Optional[str] = ""
    wordpress_url: Optional[str] = ""
    wordpress_user: Optional[str] = ""
    wordpress_app_password: Optional[str] = ""
    screaming_frog_endpoint: Optional[str] = ""


class Client(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=new_id)
    name: str
    domain: str
    target_markets: List[str] = Field(default_factory=list)
    goals: str = ""
    industry: str = ""
    notes: str = ""
    competitors: List[Competitor] = Field(default_factory=list)
    integrations: IntegrationConfig = Field(default_factory=IntegrationConfig)
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class ClientCreate(BaseModel):
    name: str
    domain: str
    target_markets: List[str] = []
    goals: str = ""
    industry: str = ""
    notes: str = ""


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    domain: Optional[str] = None
    target_markets: Optional[List[str]] = None
    goals: Optional[str] = None
    industry: Optional[str] = None
    notes: Optional[str] = None


class CompetitorCreate(BaseModel):
    name: str
    domain: str
    notes: Optional[str] = ""


# ---------- Workflow Runs ----------

WorkflowType = Literal[
    "keyword_research",
    "technical_audit",
    "competitor_analysis",
    "strategy_sprint",
]

RunStatus = Literal["queued", "running", "completed", "failed"]


class AgentLog(BaseModel):
    id: str = Field(default_factory=new_id)
    timestamp: str = Field(default_factory=now_iso)
    agent: str  # 'coordinator' | 'keyword' | 'audit' | 'competitor' | 'strategy' | 'publisher'
    level: Literal["info", "success", "warning", "error"] = "info"
    message: str


class WorkflowRun(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=new_id)
    client_id: str
    client_name: str = ""
    type: WorkflowType
    status: RunStatus = "queued"
    objective: str = ""
    plan: List[str] = Field(default_factory=list)  # subtasks from coordinator
    logs: List[AgentLog] = Field(default_factory=list)
    results: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


class RunCreate(BaseModel):
    client_id: str
    type: WorkflowType
    objective: str = ""


# ---------- Approvals ----------

ApprovalStatus = Literal["pending", "approved", "rejected"]
ApprovalProgress = Literal["open", "in_progress", "done", "archived"]
ApprovalKind = Literal[
    "content_brief",
    "technical_action",
    "strategy_doc",
    "wordpress_draft",
    "competitor_insight",
]


class Approval(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=new_id)
    run_id: str
    client_id: str
    client_name: str = ""
    kind: ApprovalKind
    title: str
    summary: str = ""
    content: Dict[str, Any] = Field(default_factory=dict)
    status: ApprovalStatus = "pending"
    progress: ApprovalProgress = "open"
    progress_note: Optional[str] = ""
    created_at: str = Field(default_factory=now_iso)
    decided_at: Optional[str] = None
    decision_note: Optional[str] = None
    progress_updated_at: Optional[str] = None


class ApprovalDecision(BaseModel):
    status: ApprovalStatus
    note: Optional[str] = ""
    edited_content: Optional[Dict[str, Any]] = None


class ProgressUpdate(BaseModel):
    progress: ApprovalProgress
    note: Optional[str] = ""
