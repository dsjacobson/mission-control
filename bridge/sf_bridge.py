#!/usr/bin/env python3
"""
SEO Operator – Screaming Frog local bridge
==========================================

Runs on the user's Windows desktop, wraps `ScreamingFrogSEOSpiderCli.exe`,
and exposes a minimal HTTP API so the cloud-hosted SEO Operator can trigger
crawls and fetch CSV exports.

Quick start
-----------
1.  Install Python 3.10+ on Windows.
2.  Make sure Screaming Frog SEO Spider is installed and licensed.
3.  Install deps:
        pip install fastapi uvicorn
4.  Run this bridge:
        python sf_bridge.py --token <pick-any-secret> --port 8765
5.  In another terminal, expose it to the web via ngrok:
        ngrok http 8765
6.  Paste the ngrok URL and the same token into the SEO Operator app
    (Integrations → Screaming Frog bridge).

The bridge stores crawl outputs in `./sf_jobs/<job_id>/`.

Tested CLI path candidates (auto-detected):
    C:\\Program Files (x86)\\Screaming Frog SEO Spider\\ScreamingFrogSEOSpiderCli.exe
    C:\\Program Files\\Screaming Frog SEO Spider\\ScreamingFrogSEOSpiderCli.exe
Override with --cli "path\\to\\ScreamingFrogSEOSpiderCli.exe".
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

try:
    from fastapi import FastAPI, Header, HTTPException, Request
    from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
    import uvicorn
except ImportError:
    sys.stderr.write("ERROR: please run `pip install fastapi uvicorn` first.\n")
    sys.exit(1)


DEFAULT_CLI_PATHS = [
    r"C:\Program Files (x86)\Screaming Frog SEO Spider\ScreamingFrogSEOSpiderCli.exe",
    r"C:\Program Files\Screaming Frog SEO Spider\ScreamingFrogSEOSpiderCli.exe",
    "/Applications/Screaming Frog SEO Spider.app/Contents/MacOS/ScreamingFrogSEOSpiderLauncher",
    "screamingfrogseospider",
]


def find_cli(override: Optional[str]) -> Optional[str]:
    if override:
        return override
    for p in DEFAULT_CLI_PATHS:
        if Path(p).exists() or shutil.which(p):
            return p
    return None


class JobState:
    def __init__(self, job_id: str, root: Path, request: dict):
        self.job_id = job_id
        self.root = root
        self.request = request
        self.status = "queued"   # queued | running | done | failed
        self.error: Optional[str] = None
        self.started_at: Optional[str] = None
        self.finished_at: Optional[str] = None
        self.stdout: List[str] = []

    def to_dict(self) -> dict:
        return {
            "job_id": self.job_id,
            "status": self.status,
            "error": self.error,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "request": self.request,
            "stdout_tail": self.stdout[-30:] if self.stdout else [],
        }


JOBS: Dict[str, JobState] = {}
JOBS_LOCK = threading.Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def run_crawl(state: JobState, cli_path: str) -> None:
    out_dir = state.root
    out_dir.mkdir(parents=True, exist_ok=True)
    args = [
        cli_path,
        "--crawl", state.request["url"],
        "--headless",
        "--output-folder", str(out_dir),
        "--overwrite",
    ]
    export_tabs = state.request.get("export_tabs") or []
    if export_tabs:
        args += ["--export-tabs", ",".join(export_tabs)]
    bulk_exports = state.request.get("bulk_exports") or []
    if bulk_exports:
        args += ["--bulk-export", ",".join(bulk_exports)]
    args += ["--save-crawl"]

    state.status = "running"
    state.started_at = now_iso()
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=60 * 60)
        out_tail = (proc.stdout or "").splitlines()[-30:]
        err_tail = (proc.stderr or "").splitlines()[-30:]
        state.stdout = out_tail + err_tail
        if proc.returncode != 0:
            state.status = "failed"
            # Build an informative error from stderr first, then stdout, then code
            err_text = (proc.stderr or "").strip()
            out_text = (proc.stdout or "").strip()
            state.error = (err_text[-800:] or out_text[-800:] or f"exit code {proc.returncode}")
        else:
            state.status = "done"
    except subprocess.TimeoutExpired:
        state.status = "failed"
        state.error = "Crawl exceeded 60 min timeout"
    except FileNotFoundError:
        state.status = "failed"
        state.error = f"ScreamingFrogSEOSpiderCli not found at {cli_path}"
    except Exception as e:
        state.status = "failed"
        state.error = str(e)[:500]
    state.finished_at = now_iso()


# ---------- HTTP app ----------

def make_app(token: str, cli_path: str, jobs_root: Path) -> FastAPI:
    app = FastAPI(title="SF Bridge")

    def _auth(x_sf_token: Optional[str]):
        if token and x_sf_token != token:
            raise HTTPException(status_code=401, detail="bad token")

    @app.get("/health")
    async def health(x_sf_token: Optional[str] = Header(default=None)):
        _auth(x_sf_token)
        return {
            "ok": True,
            "cli_path": cli_path,
            "cli_present": Path(cli_path).exists() if cli_path else False,
            "version": "1.0",
            "time": now_iso(),
        }

    @app.post("/crawl")
    async def crawl(request: Request, x_sf_token: Optional[str] = Header(default=None)):
        _auth(x_sf_token)
        body = await request.json()
        url = (body or {}).get("url")
        if not url:
            raise HTTPException(400, "missing url")
        job_id = uuid.uuid4().hex[:12]
        state = JobState(job_id, jobs_root / job_id, body)
        with JOBS_LOCK:
            JOBS[job_id] = state
        threading.Thread(target=run_crawl, args=(state, cli_path), daemon=True).start()
        return {"job_id": job_id, "status": state.status}

    @app.get("/crawl/{job_id}")
    async def status(job_id: str, x_sf_token: Optional[str] = Header(default=None)):
        _auth(x_sf_token)
        state = JOBS.get(job_id)
        if not state:
            raise HTTPException(404, "job not found")
        return state.to_dict()

    @app.get("/crawl/{job_id}/files")
    async def files(job_id: str, x_sf_token: Optional[str] = Header(default=None)):
        _auth(x_sf_token)
        state = JOBS.get(job_id)
        if not state:
            raise HTTPException(404, "job not found")
        out = []
        if state.root.exists():
            for f in state.root.rglob("*.csv"):
                out.append(str(f.relative_to(state.root)).replace("\\", "/"))
        return {"files": sorted(out)}

    @app.get("/crawl/{job_id}/file/{filename:path}")
    async def file(job_id: str, filename: str, x_sf_token: Optional[str] = Header(default=None)):
        _auth(x_sf_token)
        state = JOBS.get(job_id)
        if not state:
            raise HTTPException(404, "job not found")
        target = state.root / filename
        try:
            target = target.resolve()
            target.relative_to(state.root.resolve())  # prevent path traversal
        except Exception:
            raise HTTPException(400, "bad path")
        if not target.exists():
            raise HTTPException(404, "file not found")
        return FileResponse(str(target), media_type="text/csv")

    return app


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--token", required=True, help="Shared secret. The cloud app must send this in the X-SF-Token header.")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--cli", default=None, help="Path to ScreamingFrogSEOSpiderCli.exe")
    ap.add_argument("--jobs-dir", default="./sf_jobs")
    args = ap.parse_args()

    cli_path = find_cli(args.cli)
    if not cli_path:
        sys.stderr.write(
            "WARNING: ScreamingFrogSEOSpiderCli not auto-detected. Pass --cli explicitly.\n"
        )
        cli_path = args.cli or DEFAULT_CLI_PATHS[0]

    jobs_root = Path(args.jobs_dir).resolve()
    jobs_root.mkdir(parents=True, exist_ok=True)

    print(f"[sf_bridge] token={args.token[:4]}…  port={args.port}  cli={cli_path}")
    print(f"[sf_bridge] jobs root: {jobs_root}")
    print(f"[sf_bridge] expose to the web with:  ngrok http {args.port}")
    uvicorn.run(make_app(args.token, cli_path, jobs_root), host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
