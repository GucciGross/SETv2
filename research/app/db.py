"""Postgres access for the research worker: run state, progress log, sources.

The worker shares the SET database (same DATABASE_URL as the API server) but
only writes to research_runs + sources. Ingestion (chunking/embedding) stays
in the TypeScript pipeline — we hand over raw markdown and let SET own it.
"""
from __future__ import annotations

import json
import os
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

import psycopg
from psycopg.types.json import Json, Jsonb

DATABASE_URL = os.environ.get("DATABASE_URL", "postgres://set:set@localhost:5432/set")

ACTIVE_STATUSES = ("pending", "planning", "researching", "synthesizing")


@contextmanager
def conn():
    with psycopg.connect(DATABASE_URL) as c:
        yield c


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def fetch_run(run_id: str) -> dict | None:
    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM research_runs WHERE id = %s", (run_id,))
        cols = [d.name for d in cur.description]
        row = cur.fetchone()
        return dict(zip(cols, row)) if row else None


def run_status(run_id: str) -> str | None:
    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT status FROM research_runs WHERE id = %s", (run_id,))
        row = cur.fetchone()
        return row[0] if row else None


def cancelled(run_id: str) -> bool:
    return run_status(run_id) == "cancelled"


def set_status(run_id: str, status: str, error: str | None = None) -> None:
    with conn() as c, c.cursor() as cur:
        if status in ("finished", "error", "cancelled"):
            cur.execute(
                "UPDATE research_runs SET status=%s, error=%s, finished_at=now() WHERE id=%s",
                (status, error, run_id),
            )
        else:
            cur.execute("UPDATE research_runs SET status=%s WHERE id=%s", (status, run_id))


def log_event(run_id: str, type_: str, message: str, **detail) -> None:
    """Append a timeline event + merge progress counters in one round-trip."""
    event = {"t": now_iso(), "type": type_, "message": message}
    if detail:
        event["detail"] = {k: v for k, v in detail.items() if v is not None}
    with conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE research_runs SET log = log || %s::jsonb WHERE id = %s",
            (Json([event]), run_id),
        )


def set_progress(run_id: str, **fields) -> None:
    with conn() as c, c.cursor() as cur:
        cur.execute(
            # Jsonb, not Json: a bare Json param types the arg as `json`, and
            # there is no `jsonb || json` operator — every update failed with
            # 'operator does not exist: jsonb || json', silently breaking
            # per-page progress (the fuel-combustion run lost its fetch log)
            "UPDATE research_runs SET progress = progress || %s WHERE id = %s",
            (Jsonb(fields), run_id),
        )


def save_outline(run_id: str, outline: list[dict]) -> None:
    with conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE research_runs SET outline = %s WHERE id = %s",
            (Json(outline), run_id),
        )


def save_report(run_id: str, report_md: str) -> None:
    with conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE research_runs SET report_md = %s, status = 'synthesized' WHERE id = %s",
            (report_md, run_id),
        )


def insert_source(notebook_id: str, url: str, title: str, markdown: str, run_id: str) -> str:
    """Mirror of SET's source-creation insert (rag/routes.ts): status pending,
    text_content carries the markdown; Node's ingestSource chunks + embeds."""
    src_id = str(uuid.uuid4())
    with conn() as c, c.cursor() as cur:
        cur.execute(
            """INSERT INTO sources (id, notebook_id, kind, name, uri, mime, size_bytes, text_content, meta, status)
               VALUES (%s, %s, 'web', %s, %s, 'text/markdown', %s, %s, %s, 'pending')""",
            (
                src_id,
                notebook_id,
                title[:280] or url,
                url,
                len(markdown.encode()),
                markdown,
                Json({"research_run_id": run_id, "url": url, "title": title}),
            ),
        )
    return src_id
