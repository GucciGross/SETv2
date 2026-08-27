import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { DitherAvatar } from '../components/dither-kit';
import {
  BookOpen, FileText, Loader2, Search, Telescope, XCircle, CheckCircle2, AlertTriangle, Sparkles, Package, Link2,
} from 'lucide-react';

/** Deep research (PLAN.md Phase 1): launch CrewAI research runs, watch progress,
 *  open the resulting notebook + cited report. */
const STATUS_STYLE: Record<string, string> = {
  pending: 'text-set-dim', planning: 'text-blue-300', researching: 'text-violet-300',
  synthesizing: 'text-amber-300', synthesized: 'text-amber-300', ingesting: 'text-cyan-300',
  finished: 'text-green-400', error: 'text-red-400', cancelled: 'text-set-dim',
};
const ACTIVE = new Set(['pending', 'planning', 'researching', 'synthesizing', 'synthesized', 'ingesting']);

export function ResearchList() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [runs, setRuns] = useState<any[]>([]);
  const [question, setQuestion] = useState(() => searchParams.get('q') ?? '');
  const [notebookId, setNotebookId] = useState('');
  const [notebooks, setNotebooks] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [minutes, setMinutes] = useState(() => +(searchParams.get('minutes') ?? 25));
  const [style, setStyle] = useState<string>(() => searchParams.get('style') ?? 'ste');
  const [templates, setTemplates] = useState<any[]>([]);
  useEffect(() => {
    api.get(`/spaces/${spaceId}/settings`).then(({ settings }) => {
      setTemplates(settings?.research?.templates ?? []);
    }).catch(() => {});
  }, [spaceId]);

  const DURATIONS: [number, string][] = [
    [5, '5 minutes'], [15, '15 minutes'], [25, '25 minutes (default)'], [60, '1 hour'],
    [180, '3 hours'], [720, '12 hours'], [1440, '1 day'], [2880, '2 days'], [4320, '3 days'],
  ];

  const load = () => api.get(`/spaces/${spaceId}/research`).then((r) => setRuns(r.runs)).catch(() => {});
  useEffect(() => {
    load();
    api.get(`/spaces/${spaceId}/notebooks`).then((r) => setNotebooks(r.notebooks)).catch(() => {});
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [spaceId]);

  const launch = async (q = question) => {
    if (q.trim().length < 8) return;
    setBusy(true);
    try {
      const { run } = await api.post(`/spaces/${spaceId}/research`, {
        question: q.trim(),
        maxMinutes: minutes,
        style,
        ...(notebookId ? { notebookId } : {}),
      });
      navigate(`/app/space/${spaceId}/research/${run.id}`);
    } finally {
      setBusy(false);
    }
  };

  // shared research link: /research?q=…&style=…&minutes=…&go=1
  const sharedQ = searchParams.get('q');
  useEffect(() => {
    if (searchParams.get('go') === '1' && sharedQ && sharedQ.trim().length >= 8) {
      void launch(sharedQ);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedQ]);

  const shareLink = () => {
    const u = new URL(window.location.href);
    u.search = `?q=${encodeURIComponent(question)}&style=${style}&minutes=${minutes}&go=1`;
    navigator.clipboard?.writeText(u.toString());
  };

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto pb-24">
      <div className="flex items-center gap-2 mb-1">
        <Telescope size={20} className="text-violet-300" />
        <h1 className="text-xl font-bold text-white">Deep research</h1>
      </div>
      <p className="text-sm text-set-dim mb-4">
        A research crew plans sub-questions, reads the live web (Firecrawl), and writes a cited
        report into a notebook — every page it reads becomes a searchable, citable source.
      </p>

      <div className="set-card p-4 mb-6">
        <textarea
          className="set-input w-full min-h-[72px] resize-y"
          placeholder="What should we research? e.g. 'Compare solid-state battery chemistry approaches and their commercialization timelines'"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <select
            className="set-input text-xs w-[190px]"
            value={style}
            onChange={(e) => setStyle(e.target.value as any)}
          >
            <option value="ste">Simplified Technical English (default)</option>
            <option value="professional">Professional analysis</option>
            <option value="executive">Executive brief</option>
            <option value="study">Study notes</option>
            {templates.map((t) => (
              <option key={t.id} value={`tpl:${t.id}`}>{t.name}</option>
            ))}
          </select>
          <select
            className="set-input text-xs w-[150px]"
            value={minutes}
            onChange={(e) => setMinutes(+e.target.value)}
          >
            {DURATIONS.map(([m, label]) => (
              <option key={m} value={m}>⏱ {label}</option>
            ))}
          </select>
          <select
            className="set-input text-xs flex-1 min-w-[180px]"
            value={notebookId}
            onChange={(e) => setNotebookId(e.target.value)}
          >
            <option value="">→ new notebook per run</option>
            {notebooks.map((n) => (
              <option key={n.id} value={n.id}>add to “{n.title}”</option>
            ))}
          </select>
          <button className="set-btn-primary text-sm flex items-center gap-1.5" disabled={busy || question.trim().length < 8} onClick={() => launch()}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            {busy ? 'Starting…' : 'Start research'}
          </button>
          <button className="set-btn text-xs flex items-center gap-1" disabled={question.trim().length < 8} onClick={shareLink} title="Copy a link that reproduces this research setup">
            <Link2 size={12} /> Share setup
          </button>
        </div>
      </div>

      {runs.length === 0 && (
        <div className="flex items-center gap-3 py-2">
          <DitherAvatar name="deep-research" hue={265} size={30} className="rounded shrink-0 opacity-80" />
          <p className="text-sm text-set-dim">No research runs yet — the crew is standing by.</p>
        </div>
      )}
      <div className="space-y-2">
        {runs.map((r) => (
          <Link
            key={r.id}
            to={`/app/space/${spaceId}/research/${r.id}`}
            className="set-card p-3 flex items-center gap-3 hover:border-set-accent/40 transition-colors"
          >
            {ACTIVE.has(r.status) ? <Loader2 size={16} className="animate-spin text-violet-300 shrink-0" /> :
              r.status === 'finished' ? <CheckCircle2 size={16} className="text-green-400 shrink-0" /> :
              r.status === 'error' ? <AlertTriangle size={16} className="text-red-400 shrink-0" /> :
              <XCircle size={16} className="text-set-dim shrink-0" />}
            <span className="flex-1 min-w-0">
              <span className="block text-sm text-white truncate">{r.question}</span>
              <span className="block text-[11px] text-set-dim">
                {new Date(r.created_at).toLocaleString()} · {r.source_count ?? 0} sources
              </span>
            </span>
            <span className={`text-[11px] uppercase tracking-wide shrink-0 ${STATUS_STYLE[r.status] ?? ''}`}>{r.status}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function ResearchRun() {
  const { spaceId, runId } = useParams();
  const navigate = useNavigate();
  const [run, setRun] = useState<any>(null);
  const [simplifying, setSimplifying] = useState(false);
  const active = ACTIVE.has(run?.status ?? 'pending');
  const exportH5P = async () => {
    const deckId = run?.progress?.auto_deck_id;
    if (!deckId) return;
    const res = await fetch(`/api/decks/${deckId}/h5p`, { headers: { authorization: `Bearer ${localStorage.getItem('set_token')}` } });
    if (!res.ok) return alert('H5P export failed');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'set-deck.h5p';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const makeDeck = async (kind: 'flashcards' | 'quiz') => {
    setSimplifying(true); // reuse spinner state
    try {
      const { deckId, notebookId } = await api.post(`/research/${runId}/deck`, { kind });
      navigate(`/app/space/${spaceId}/notebook/${notebookId}/deck/${deckId}`);
    } catch (e: any) {
      alert(e.message || 'deck generation failed');
    } finally {
      setSimplifying(false);
    }
  };
  const simplify = async () => {
    setSimplifying(true);
    try {
      await api.post(`/research/${runId}/simplify`);
      const { run } = await api.get(`/research/${runId}`);
      setRun(run);
    } catch (e: any) {
      alert(e.message || 'rewrite failed');
    } finally {
      setSimplifying(false);
    }
  };

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const { run } = await api.get(`/research/${runId}`);
        if (!stop) setRun(run);
      } catch { /* transient */ }
    };
    tick();
    const t = setInterval(tick, 2500);
    return () => { stop = true; clearInterval(t); };
  }, [runId]);

  const outline = useMemo(() => (run?.outline ?? []) as any[], [run?.outline]);
  const log = useMemo(() => (run?.log ?? []) as any[], [run?.log]);
  const sources = useMemo(() => (run?.sources ?? []) as any[], [run?.sources]);
  const progress = run?.progress ?? {};

  if (!run) return <div className="p-8 text-set-dim">Loading run…</div>;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto pb-24">
      <div className="flex items-start gap-3 mb-4">
        <div className="flex-1">
          <h1 className="text-lg font-bold text-white leading-snug">{run.question}</h1>
          <div className="text-xs text-set-dim mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={STATUS_STYLE[run.status] ?? ''}>● {run.status}</span>
            {progress.pages_budget ? <span>{progress.pages_visited ?? 0}/{progress.pages_budget} pages</span> : null}
            {run.notebook_id && (
              <Link className="underline underline-offset-2 flex items-center gap-1" to={`/app/space/${spaceId}/notebook/${run.notebook_id}`}>
                <BookOpen size={11} /> {run.notebook_title ?? 'notebook'}
              </Link>
            )}
            {run.report_page_id && (
              <Link className="underline underline-offset-2 flex items-center gap-1" to={`/app/space/${spaceId}/page/${run.report_page_id}`}>
                <FileText size={11} /> report
              </Link>
            )}
          </div>
        </div>
        {active && (
          <button
            className="set-btn-ghost text-xs flex items-center gap-1 shrink-0"
            onClick={() => api.post(`/research/${runId}/cancel`)}
          >
            <XCircle size={13} /> Cancel
          </button>
        )}
      </div>

      {run.status === 'error' && (
        <div className="set-card p-3 mb-4 border-red-500/40 text-sm text-red-300">{run.error}</div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {/* outline — min-w-0: long source URLs elsewhere on mobile must not inflate the column */}
        <div className="set-card p-4 min-w-0">
          <h3 className="set-mono set-mono-dim mb-2">Research outline</h3>
          {outline.length === 0 && <p className="text-xs text-set-dim">Planning…</p>}
          <div className="space-y-1.5">
            {outline.map((sq: any) => (
              <div key={sq.id} className="flex items-start gap-2 text-sm min-w-0">
                {sq.status === 'covered'
                  ? <CheckCircle2 size={14} className="text-green-400 mt-0.5 shrink-0" />
                  : <div className="w-3.5 h-3.5 rounded-full border border-set-dim/60 mt-1 shrink-0" />}
                <span className={`min-w-0 ${sq.status === 'covered' ? 'text-set-text' : 'text-set-dim'}`}>{sq.question}</span>
              </div>
            ))}
          </div>
        </div>

        {/* sources */}
        <div className="set-card p-4 min-w-0">
          <h3 className="set-mono set-mono-dim mb-2">Sources ({sources.length})</h3>
          {sources.length === 0 && <p className="text-xs text-set-dim">None yet.</p>}
          <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
            {sources.map((s: any) => (
              <a key={s.id} href={s.uri ?? '#'} target="_blank" rel="noreferrer"
                 className="block text-xs text-set-dim hover:text-set-text truncate min-w-0"
                 title={s.name}>
                <span className={
                  s.status === 'ready' ? 'text-green-400' : s.status === 'error' ? 'text-red-400' : 'text-amber-300'
                }>● </span>
                {s.name}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* timeline */}
      <div className="set-card p-4 mt-4">
        <h3 className="set-mono set-mono-dim mb-2">Activity</h3>
        <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
          {log.length === 0 && <p className="text-xs text-set-dim">Waiting for the worker…</p>}
          {log.map((e: any, i: number) => (
            <div key={i} className="text-xs flex gap-2">
              <span className="text-set-dim/70 shrink-0">{new Date(e.t).toLocaleTimeString()}</span>
              <span className="text-set-dim">{e.message}</span>
            </div>
          ))}
        </div>
      </div>

      {run.status === 'finished' && (
        <div className="set-card p-4 mt-4">
          <div className="flex items-center gap-2.5 mb-3">
            <CheckCircle2 className="text-green-400 shrink-0" size={18} />
            <span className="text-sm text-set-text flex-1">
              Research complete — {sources.length} sources indexed, report ready.
            </span>
          </div>
          {/* actions wrap on narrow screens; one primary (read), the rest secondary */}
          <div className="flex flex-wrap gap-2">
            {run.report_md && (
              <Link to={`/app/space/${spaceId}/research/${runId}/paper`} className="set-btn-primary text-xs flex items-center gap-1.5">
                <BookOpen size={13} /> Read as paper
              </Link>
            )}
            {run.notebook_id && (
              <Link to={`/app/space/${spaceId}/notebook/${run.notebook_id}`} className="set-btn text-xs flex items-center gap-1.5">
                <BookOpen size={13} /> Open notebook
              </Link>
            )}
            {run.progress?.auto_deck_id ? (
              <Link to={`/app/space/${spaceId}/notebook/${run.notebook_id}/deck/${run.progress.auto_deck_id}`} className="set-btn text-xs flex items-center gap-1.5">
                <Sparkles size={13} /> Open study deck
              </Link>
            ) : (
              <button className="set-btn text-xs flex items-center gap-1.5" disabled={simplifying} onClick={() => makeDeck('flashcards')}>
                <Sparkles size={13} /> Study deck
              </button>
            )}
            <button className="set-btn text-xs flex items-center gap-1.5" disabled={simplifying} onClick={() => makeDeck('quiz')}>
              <BookOpen size={13} /> Quiz me
            </button>
            {run.progress?.auto_deck_id && (
              <button className="set-btn text-xs flex items-center gap-1.5" onClick={exportH5P}>
                <Package size={13} /> Export H5P
              </button>
            )}
            {run.report_page_id && (
              <button className="set-btn-ghost text-xs flex items-center gap-1.5" disabled={simplifying} onClick={simplify} title="Re-write the report page in Simplified Technical English">
                {simplifying ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
                {simplifying ? 'Rewriting…' : 'Plain-English rewrite'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
