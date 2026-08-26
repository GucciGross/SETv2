"""The deep-research CrewAI Flow.

Shape (PLAN.md Phase 1):

    plan ──► router ──► research rounds (loop) ──► synthesize ──► persist
                │              ▲   │
                └──────────────┘   └──► synthesize when covered / budget out

- Planner crew turns the question into a reviewed outline of sub-questions.
- Research rounds run a researcher crew with real web tools (Firecrawl search +
  scrape via SET's polite web layer); every fetched page becomes a notebook
  source. The router loops until the outline is covered or the budget is hit.
- Synthesis crew (analyst → writer → citation editor) writes a cited report;
  every citation must map to a fetched source or the editor strips it.
- persist() writes sources + report; Node chunks/embeds via the normal
  pipeline, so citations, search and study decks work on the output for free.

No detection evasion, robots.txt respected on the fallback fetcher, hard page
and time budgets, cancellation checked between rounds.
"""
from __future__ import annotations

import time
from typing import Any

from crewai import Agent, Crew, LLM, Task
from crewai.flow.flow import Flow, listen, router, start
from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from . import db
from .weblayer import WebLayer

# ---------------------------------------------------------------- web tools
# Module-level web layer: BaseTool instances are shared across crews; the
# layer is configured per-run before kickoff.
WEB: WebLayer = WebLayer()
STATE: "ResearchState | None" = None  # set by the service before kickoff


class WebSearchTool(BaseTool):
    name: str = "web_search"
    description: str = (
        "Search the public web. Input: a focused search query. Returns up to 6 results "
        "as 'title — url — snippet' lines. Use it to find authoritative pages for a "
        "sub-question, then fetch the best ones with web_fetch."
    )

    def _run(self, query: str) -> str:
        if not WEB.has_search:
            return "Search unavailable: no Firecrawl key configured for this space. Use web_fetch on URLs you already know."
        results = WEB.search(query.strip(), limit=6)
        if not results:
            return "No results found. Try a different query."
        return "\n".join(f"{r['title']} — {r['url']} — {r['snippet'][:180]}" for r in results)


class WebFetchTool(BaseTool):
    name: str = "web_fetch"
    description: str = (
        "Fetch one web page and return readable markdown (max ~12k chars). Input: the "
        "absolute URL. Returns the content, or a notice when the site declines. "
        "Prefer authoritative sources; skip paywalls/social feeds."
    )

    def _run(self, url: str) -> str:
        url = url.strip()
        st = STATE
        if st is not None and st.pages_visited >= st.pages_budget:
            return "Page budget exhausted — do not fetch more pages; synthesize from what you have."
        got = WEB.fetch_markdown(url)
        if got is None:
            return f"Could not fetch {url} (blocked, unreachable, or robots.txt disallows). Note it and try another source."
        title, markdown = got
        if st is not None:
            add_source(st, url, title, markdown)
            for img in (WEB.last_images or [])[:2]:
                img["source_url"] = url
                img["source_title"] = title
                st.images.append(img)
            db.log_event(st.run_id, "fetch", f"Fetched: {title[:120]}", url=url,
                         pages=st.pages_visited, budget=st.pages_budget)
            db.set_progress(st.run_id, pages_visited=st.pages_visited, pages_budget=st.pages_budget)
        return markdown[:12000]


# ---------------------------------------------------------------- state
class ResearchState(BaseModel):
    # every field needs a default: CrewAI instantiates the state model empty
    # when the Flow object is created, then merges kickoff(inputs=...) in
    run_id: str = ""
    question: str = ""
    llm_config: dict[str, Any] = Field(default_factory=dict)
    # {base_url, api_key, chat_model, vision_model} — crews can mix models per
    # agent; we assign by capability: tool/reasoning roles → chat_model,
    # page-reading-by-eye → vision_model (see weblayer._vision_read)
    subquestions: list[dict] = Field(default_factory=list)  # {id, question, queries, status, note}
    sources: list[dict] = Field(default_factory=list)       # {url, title, markdown}
    images: list[dict] = Field(default_factory=list)        # {url, source_url, source_title}
    findings: list[dict] = Field(default_factory=list)      # {subquestion_id, text, citations:[url]}
    pages_budget: int = 40
    pages_visited: int = 0
    max_rounds: int = 6  # scaled up from max_minutes at kickoff
    round_no: int = 0
    deadline: float = 0.0
    report_md: str = ""
    search_enabled: bool = False
    style: str = "ste"  # ste | professional | executive | study | template:<name>
    style_instructions: str = ""  # workspace template text; overrides the enum styles

# CrewAI wraps the state model (StateWithId), so keep it plain data and use
# module-level helpers instead of methods.
def add_source(st: Any, url: str, title: str, markdown: str) -> None:
    if any(s["url"] == url for s in st.sources):
        return
    st.sources.append({"url": url, "title": title, "markdown": markdown})
    st.pages_visited += 1


def open_subquestions(st: Any) -> list[dict]:
    return [sq for sq in st.subquestions if sq.get("status") != "covered"]


def budget_left(st: Any) -> bool:
    return (
        st.pages_visited < st.pages_budget
        and time.time() < st.deadline
        and st.round_no < st.max_rounds
    )


# ------------------------------------------------------- structured outputs
class SubQuestion(BaseModel):
    id: str = Field(description="short slug, e.g. 'pricing-models'")
    question: str
    rationale: str = ""
    queries: list[str] = Field(default_factory=list, description="1-3 focused web search queries")


class ResearchPlan(BaseModel):
    subquestions: list[SubQuestion] = Field(description="4-8 specific, answerable sub-questions that together fully cover the research question")
    quality_bar: str = Field(default="", description="what counts as a good source for this topic")


class RoundReport(BaseModel):
    subquestion_id: str
    findings: str = Field(description="substantive findings with concrete facts, numbers, quotes")
    citations: list[str] = Field(default_factory=list, description="URLs actually used for these findings")


class RoundFindings(BaseModel):
    reports: list[RoundReport]


class CitationCheck(BaseModel):
    report_md: str = Field(description="the final report markdown with [S#] citations")
    removed_citations: list[str] = Field(default_factory=list, description="citations removed because no fetched source backed them")


# ---------------------------------------------------------------- the flow
class DeepResearchFlow(Flow[ResearchState]):
    """State carries the whole run; the service wrapper sets STATE/WEB, kicks
    off, and owns DB status transitions around it."""

    def _llm(self, role: str = "reason") -> LLM:
        """Per-agent model selection. Roles:
        reason  — planning, analysis, synthesis (strong text model)
        tools   — the field researcher (must be tool-calling capable)
        vision  — n/a here; the vision model lives in weblayer's reader path
        """
        cfg = self.state.llm_config
        model = cfg.get("chat_model", "gpt-4o-mini")
        return LLM(
            model=f"openai/{model}",
            base_url=cfg.get("base_url"),
            api_key=cfg.get("api_key") or "unset",
            temperature=0.2 if role == "tools" else 0.3,
        )

    # ---- step 1: plan -----------------------------------------------------
    @start()
    def plan(self):
        global STATE
        STATE = self.state  # the flow's hydrated StateWithId — tools read this
        st = self.state
        db.set_status(st.run_id, "planning")
        db.log_event(st.run_id, "plan", "Planning research outline…")

        strategist = Agent(
            role="Research Strategist",
            goal=f"Decompose the research question into specific, non-overlapping sub-questions that fully cover it: {st.question}",
            backstory=(
                "A senior research methodologist who has designed hundreds of investigative "
                "briefings. You know the difference between a vague topic and an answerable "
                "question, and you never miss an angle that matters."
            ),
            llm=self._llm("reason"), allow_delegation=False, verbose=False,
        )
        reviewer = Agent(
            role="Plan Critic",
            goal="Reject vague or redundant sub-questions; force measurable, sourceable questions",
            backstory="A demanding editor who returns plans that would waste research budget.",
            llm=self._llm("reason"), allow_delegation=False, verbose=False,
        )
        draft = Task(
            description=(
                f"Research question: {st.question}\n"
                f"Web search available: {st.search_enabled}\n"
                "Produce 4-8 sub-questions. If search is unavailable, favor questions the "
                "model + known URLs can address. Each needs 1-3 focused search queries."
            ),
            expected_output="A research plan of specific sub-questions.",
            agent=strategist,
            output_pydantic=ResearchPlan,
        )
        review = Task(
            description=(
                "Critique the plan: merge overlaps, sharpen vague questions, drop anything "
                "unanswerable from public sources. Return the improved plan."
            ),
            expected_output="The refined research plan.",
            agent=reviewer,
            context=[draft],
            output_pydantic=ResearchPlan,
        )
        plan = Crew(agents=[strategist, reviewer], tasks=[draft, review], verbose=False).kickoff()
        result: ResearchPlan = plan.pydantic

        st.subquestions = [
            {"id": sq.id or f"q{i}", "question": sq.question, "queries": sq.queries,
             "rationale": sq.rationale, "status": "open", "note": ""}
            for i, sq in enumerate(result.subquestions)
        ]
        db.save_outline(st.run_id, st.subquestions)
        db.log_event(
            st.run_id, "plan", f"Outline ready — {len(st.subquestions)} sub-questions",
            quality_bar=result.quality_bar,
        )
        return result

    # ---- step 2: research rounds — explicit deterministic loop ------------
    @listen(plan)
    def research_phase(self, _):
        """Rounds run in-method: immune to router-label refires/re-entry."""
        st = self.state
        if not st.search_enabled:
            db.log_event(st.run_id, "plan",
                         "No search backend configured — researching from direct fetches of known sources only.")
        while True:
            if db.cancelled(st.run_id):
                raise ResearchCancelled()
            if not budget_left(st):
                db.log_event(st.run_id, "research",
                             "Budget reached — moving to synthesis with what we have.")
                break
            if self._one_round() == 0:
                break
        return len(open_subquestions(st))

    def _one_round(self) -> int:
        st = self.state
        st.round_no += 1
        db.set_status(st.run_id, "researching")
        open_sqs = open_subquestions(st)[:3]
        db.log_event(st.run_id, "research",
                     f"Round {st.round_no}/{st.max_rounds} — researching {len(open_sqs)} sub-question(s)",
                     subquestions=[s["question"][:80] for s in open_sqs])

        llm = self._llm()
        researcher = Agent(
            role="Field Researcher",
            goal="Answer the assigned sub-questions with facts from real, fetched pages",
            backstory=(
                "A meticulous researcher who always searches first, fetches the most "
                "authoritative-looking results, quotes concrete facts, and honestly reports "
                "when a question cannot be answered from the fetched material."
            ),
            tools=[WebSearchTool(), WebFetchTool()],
            llm=self._llm("tools"), allow_delegation=False, verbose=False, max_iter=12,
        )
        task = Task(
            description=self._round_brief(open_sqs),
            expected_output="Findings per sub-question with citations.",
            agent=researcher,
            output_pydantic=RoundFindings,
        )
        result: RoundFindings = Crew(agents=[researcher], tasks=[task], verbose=False).kickoff().pydantic

        known_urls = {s["url"] for s in st.sources}
        for rep in result.reports:
            valid = [c for c in rep.citations if c in known_urls]
            st.findings.append(
                {"subquestion_id": rep.subquestion_id, "text": rep.findings, "citations": valid}
            )
            for sq in st.subquestions:
                if sq["id"] == rep.subquestion_id and len(rep.findings) > 120:
                    sq["status"] = "covered"
        db.save_outline(st.run_id, st.subquestions)
        remaining = len(open_subquestions(st))
        db.log_event(st.run_id, "research",
                     f"Round {st.round_no} done — {st.pages_visited}/{st.pages_budget} pages, {remaining} sub-question(s) open")
        return remaining

    def _round_brief(self, open_sqs: list[dict]) -> str:
        st = self.state
        sq_lines = "\n".join(
            f"- [{sq['id']}] {sq['question']} (try: {', '.join(sq['queries'])})" for sq in open_sqs
        )
        known = "\n".join(f"- {s['url']}" for s in st.sources[-15:]) or "(none yet)"
        return (
            f"Research question: {st.question}\n\n"
            f"Sub-questions to answer NOW (use their ids verbatim):\n{sq_lines}\n\n"
            f"Pages already fetched (do not re-fetch):\n{known}\n\n"
            f"Budget: {st.pages_budget - st.pages_visited} pages left.\n"
            "Search first, fetch the most authoritative results, then report concrete findings. "
            "Cite only URLs you actually fetched with web_fetch. If a sub-question can't be "
            "answered, report findings anyway with what you found and say so."
        )

    # ---- step 3: synthesize ------------------------------------------------
    @listen(research_phase)
    def synthesize(self, _):
        st = self.state
        if db.cancelled(st.run_id):
            raise ResearchCancelled()
        db.set_status(st.run_id, "synthesizing")
        db.log_event(st.run_id, "synthesize", f"Writing report from {len(st.sources)} sources…")
        llm = self._llm()

        src_lines = "\n".join(f"- [S{i+1}] {s['title']} — {s['url']}" for i, s in enumerate(st.sources))
        findings_text = "\n\n".join(
            f"[{f['subquestion_id']}] {f['text']}\n  (sources: {', '.join(f['citations'])})"
            for f in st.findings
        ) or "(no structured findings — synthesize from fetched sources below)"

        style_rules = {
            "ste": (
                "STYLE: Simplified Technical English (ASD-STE100). Short sentences "
                "(aim 15 words or fewer, one idea each). Active voice only. Everyday words; "
                "define jargon on first use. No filler or marketing language. Concrete facts: "
                "numbers, names, dates, comparisons."
            ),
            "professional": (
                "STYLE: professional analytical report. Clear topic sentences, measured tone, "
                "precise terminology with definitions where needed, no marketing language."
            ),
            "executive": (
                "STYLE: executive brief, at most ~600 words. Lead with the decision-relevant "
                "answer. Bullet-point key facts with figures. Note risks and unknowns in one "
                "short section. No background padding."
            ),
            "study": (
                "STYLE: study notes for a learner. Short sections per concept, key-term "
                "definitions, comparison tables where useful, a 'Check yourself' list of 5-8 "
                "questions with answers at the end."
            ),
        }.get(st.style, "STYLE: Simplified Technical English (ASD-STE100).")
        if st.style_instructions.strip():
            style_rules = "STYLE (workspace template): " + st.style_instructions.strip()

        analyst = Agent(
            role="Lead Analyst",
            goal="Weave all findings into one coherent, cited analytical report",
            backstory="A boutique-firm analyst famous for reports where every claim has a source.",
            llm=self._llm("reason"), allow_delegation=False, verbose=False,
        )
        writer = Task(
            description=(
                f"Research question: {st.question}\n\nFINDINGS BY SUB-QUESTION:\n{findings_text}\n\n"
                f"FETCHED SOURCES (cite as [S#]):\n{src_lines}\n\n"
                "Write a structured markdown report: `# <title>`, TL;DR, then one section per "
                "sub-topic with facts and [S#] citations, then 'Gaps & open questions' listing "
                "what could not be answered. Never invent a citation."
            ),
            expected_output="A cited markdown research report.",
            agent=analyst,
        )
        editor = Agent(
            role="Citations Editor",
            goal="Every [S#] citation must map to a fetched source; fix or strip anything else",
            backstory="A fact-checker who has zero tolerance for unverifiable claims.",
            llm=self._llm("reason"), allow_delegation=False, verbose=False,
        )
        check = Task(
            description=(
                f"Validate the draft against this exact source list; remove or repair invalid citations.\n{src_lines}\n"
                "Return the final report with only valid [S#] citations."
            ),
            expected_output="The final validated report.",
            agent=editor,
            context=[writer],
            output_pydantic=CitationCheck,
        )
        result: CitationCheck = Crew(agents=[analyst, editor], tasks=[writer, check], verbose=False).kickoff().pydantic
        st.report_md = result.report_md
        if result.removed_citations:
            db.log_event(st.run_id, "synthesize",
                         f"Editor stripped {len(result.removed_citations)} unsupported citation(s)")
        return result

    # ---- step 4: persist ---------------------------------------------------
    @listen(synthesize)
    def persist(self, _):
        st = self.state
        if db.cancelled(st.run_id):
            raise ResearchCancelled()
        nb = db.fetch_run(st.run_id) or {}
        notebook_id = nb.get("notebook_id")
        saved = 0
        if notebook_id:
            for s in st.sources:
                db.insert_source(str(notebook_id), s["url"], s["title"], s["markdown"], st.run_id)
                saved += 1
        # visuals: render ```set:chart fences to PNGs + build a picture gallery
        import os
        base_url = os.environ.get("ASSET_BASE_URL", "http://server:4000").rstrip("/")
        data_dir = os.environ.get("DATA_DIR", "/app/data")
        try:
            from . import visuals
            report = visuals.render_fences(st.report_md, data_dir, st.run_id, base_url)
            gallery = visuals.build_gallery(st.images, data_dir, st.run_id, base_url)
            if gallery:
                report = report.rstrip() + "\n" + gallery
            st.report_md = report
        except Exception as e:  # visuals must never fail the run
            db.log_event(st.run_id, "persist", f"Visuals skipped: {str(e)[:120]}")
        db.save_report(st.run_id, st.report_md)
        db.log_event(st.run_id, "persist",
                     f"Saved {saved} sources + report — handing to ingestion",
                     notebook=str(notebook_id) if notebook_id else None)
        return saved


class ResearchCancelled(Exception):
    pass
