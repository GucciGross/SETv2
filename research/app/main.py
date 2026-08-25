"""SET research worker — FastAPI service wrapping the CrewAI deep-research flow.

The Node API creates a research_runs row, then POSTs the run here with the
space's provider config + Firecrawl key. We execute the flow in a background
task, streaming progress into the run row; Node polls and handles ingestion
(chunk/embed) + report-page creation on its side.
"""
from __future__ import annotations

import asyncio
import logging
import os

from fastapi import FastAPI
from pydantic import BaseModel

from . import db
from .flow import DeepResearchFlow, ResearchCancelled, ResearchState
from .weblayer import WebLayer

log = logging.getLogger("set-research")
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))

app = FastAPI(title="SET Research Worker", version="0.1.0")


class RunRequest(BaseModel):
    run_id: str
    question: str
    notebook_id: str | None = None
    max_pages: int = 40
    max_minutes: int = 15
    llm_config: dict = {}          # {base_url, api_key, chat_model}
    # optional Firecrawl-compatible override (self-hosted or cloud); the
    # in-stack SearXNG + Playwright services are the default, no keys needed
    firecrawl_key: str | None = None
    firecrawl_url: str | None = None


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "set-research"}


@app.post("/runs")
async def create_run(req: RunRequest) -> dict:
    row = db.fetch_run(req.run_id)
    if row is None:
        return {"ok": False, "error": "run not found"}
    if row["status"] not in ("pending",):
        return {"ok": False, "error": f"run is {row['status']}, not pending"}
    asyncio.get_event_loop().run_in_executor(None, _execute, req)
    return {"ok": True, "accepted": req.run_id}


def _execute(req: RunRequest) -> None:
    """Runs in a worker thread; owns status transitions around the flow."""
    from . import flow as flow_mod

    import os
    layer = WebLayer(
        searxng_url=os.environ.get("SEARXNG_URL", ""),
        chrome_url=os.environ.get("CHROME_CDP_URL", ""),
        playwright_url=os.environ.get("PLAYWRIGHT_URL", ""),
        firecrawl_url=req.firecrawl_url or "",
        firecrawl_key=req.firecrawl_key,
    )
    state = ResearchState(
        run_id=req.run_id,
        question=req.question,
        llm_config=req.llm_config,
        pages_budget=max(1, min(req.max_pages, 120)),
        deadline=__import__("time").time() + max(1, min(req.max_minutes, 60)) * 60,
        search_enabled=layer.has_search,
    )
    flow_mod.WEB = layer
    flow_mod.STATE = None  # bound to the flow's live state inside @start
    try:
        db.log_event(req.run_id, "start", "Research worker picked up the run",
                     search_enabled=state.search_enabled, pages_budget=state.pages_budget)
        DeepResearchFlow().kickoff(inputs=state.model_dump())
        db.set_status(req.run_id, "synthesized")  # Node ingests → finished
    except ResearchCancelled:
        db.log_event(req.run_id, "cancel", "Run cancelled by user")
        # keep 'cancelled' status set by the cancel endpoint
    except Exception as e:  # noqa: BLE001 — surface every failure into the run row
        log.exception("research run %s failed", req.run_id)
        db.set_status(req.run_id, "error", error=str(e)[:800])
        db.log_event(req.run_id, "error", f"Run failed: {str(e)[:200]}")
    finally:
        layer.shutdown()
