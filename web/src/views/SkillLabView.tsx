import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';

type Notebook = { id: string; title: string };
type Source = { id: string; name: string; kind: string; status: string };
type Summary = { id: string; name: string; status: string; parent_id?: string };
type Plan = { description: string; prerequisites: string[]; outputs: string[]; checks: string[]; pitfalls: string[]; gaps: string[];
  steps: { title: string; action: string; expected: string; verify: string; evidence: { sourceId: string; quote: string }[] }[] };
type Draft = { id: string; input: { name: string; goal: string }; plan: Plan; evidence: { id: string; name: string; digest: string }[];
  content_hash: string; status: string; reviewed_at: string | null; parent_id?: string };
const ROBOT_GOAL = 'Use the demonstrated workflow to create a robotic part in Blender and import it into an Unreal Engine simulation. Produce the editable Blender project, exported asset and an imported Unreal asset. Verify scale, axes, pivots, hierarchy, materials and collision against the evidence; mark every unsupported step as a gap. Do not operate physical hardware.';

export default function SkillLabView() {
  const { spaceId } = useParams();
  const [search] = useSearchParams();
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notebookId, setNotebookId] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Summary[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [servers, setServers] = useState('');
  const [notes, setNotes] = useState('');
  const [noteName, setNoteName] = useState('Teaching notes');
  const [planJson, setPlanJson] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const live = useRef(true), inFlight = useRef(false);
  const base = `/spaces/${spaceId}/skill-drafts`;
  const linkedDraft = search.get('draft');

  const showDraft = (value: Draft) => {
    if (!live.current) return;
    setDraft(value); setPlanJson(JSON.stringify(value.plan, null, 2)); setAcknowledged(false);
  };
  const refreshDrafts = async () => {
    const result = await api.get<{ drafts: Summary[]; canEdit: boolean }>(base);
    if (live.current) { setDrafts(result.drafts); setCanEdit(result.canEdit); }
  };
  const refreshSources = async () => {
    const result = await api.get<{ sources: Source[] }>(`/notebooks/${notebookId}`);
    if (live.current) setSources(result.sources);
  };
  const run = async (label: string, action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(label); setError(''); setNotice('');
    try { await action(); }
    catch (e) { if (live.current) setError(e instanceof Error ? e.message : 'Request failed'); }
    finally { inFlight.current = false; if (live.current) setBusy(''); }
  };
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    Promise.all([api.get<{ notebooks: Notebook[] }>(`/spaces/${spaceId}/notebooks`), api.get<{ drafts: Summary[]; canEdit: boolean }>(base)])
      .then(([n, d]) => { if (!cancelled) { setNotebooks(n.notebooks); setDrafts(d.drafts); setCanEdit(d.canEdit); } })
      .catch(e => { if (!cancelled) setError(e.message || 'Could not load Teach AI'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [spaceId]);
  useEffect(() => {
    if (!linkedDraft) return;
    let cancelled = false;
    api.get<{ draft: Draft }>(`${base}/${encodeURIComponent(linkedDraft)}`).then(r => { if (!cancelled) showDraft(r.draft); })
      .catch(e => { if (!cancelled) setError(e.message || 'Could not open skill'); });
    return () => { cancelled = true; };
  }, [linkedDraft, spaceId]);
  useEffect(() => {
    let cancelled = false;
    setSources([]); setSourceIds([]);
    if (!notebookId) { setSourcesLoading(false); return; }
    setSourcesLoading(true);
    api.get<{ sources: Source[] }>(`/notebooks/${notebookId}`).then(r => { if (!cancelled) setSources(r.sources); })
      .catch(e => { if (!cancelled) setError(e.message || 'Could not load sources'); })
      .finally(() => { if (!cancelled) setSourcesLoading(false); });
    return () => { cancelled = true; };
  }, [notebookId]);

  const download = async () => {
    if (!draft) return;
    const res = await api.raw(`${base}/${draft.id}/export.zip`);
    if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || 'Export failed'); }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a'); a.href = url; a.download = `${draft.input.name}.zip`;
    document.body.appendChild(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (live.current) setNotice('Downloaded. Review the files, then place the skill folder under .agents/skills. Existing skills are not overwritten by SET.');
  };
  const bullets = (items: string[]) => items.length ? <ul className="list-disc pl-5 space-y-1">{items.map((item, i) => <li key={i}>{item}</li>)}</ul> : <p className="text-set-dim">None documented.</p>;

  return <main className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
    <header className="flex flex-wrap justify-between items-start gap-3">
      <div><p className="text-xs set-mono text-set-dim mb-2">KNOWLEDGE / PROCEDURE / ARTIFACT</p>
        <h1 className="text-2xl font-bold text-set-text">Teach AI</h1>
        <p className="text-sm text-set-dim mt-2 max-w-2xl">Learn it. Show it. Make it reusable. Turn your evidence into skills an agent can follow to produce real work.</p></div>
      <Link className="set-btn" to={`/app/space/${spaceId}/notebooks`}>Back to notebooks</Link>
    </header>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs set-mono" aria-label="Skill workflow">
      {['01  Select evidence', '02  Compile a draft', '03  Review instructions', '04  Export to Codex'].map(label => <div key={label} className="set-card p-3">{label}</div>)}
    </div>
    <div className="set-card p-4 text-sm text-set-dim">This teaches a reusable procedure, not model weights. SET does not execute Blender or Unreal here. Every export is labeled <strong className="text-set-text">execution not tested</strong>.</div>
    {error && <div role="alert" className="set-card border-red-400/50 p-4 text-sm text-red-300">{error}</div>}
    {notice && <p role="status" className="set-card p-4 text-sm">{notice}</p>}
    {busy && <p role="status" aria-live="polite" className="text-sm text-set-dim">{busy}</p>}
    {loading ? <p role="status">Loading teaching workspace…</p> : <>
      {!canEdit && <p className="text-sm text-set-dim">You can read and export reviewed skills. Editor access is required to compile, revise or review.</p>}
      <div className="grid lg:grid-cols-2 gap-5 items-start">
        <section className="set-card p-4 md:p-5 space-y-4" aria-labelledby="teaching-material">
          <h2 id="teaching-material" className="font-semibold text-set-text">Teaching material</h2>
          <label className="block text-sm">Notebook
            <select className="set-input w-full mt-1" value={notebookId} disabled={!!busy} onChange={e => setNotebookId(e.target.value)}>
              <option value="">Choose a notebook</option>{notebooks.map(n => <option key={n.id} value={n.id}>{n.title}</option>)}
            </select>
          </label>
          {!notebooks.length && <p className="text-sm text-set-dim">Create a notebook first. It remains the shared source library for you and your AI.</p>}
          {notebookId && <>
            <div className="flex gap-3 justify-between items-center"><span className="text-xs text-set-dim">Select up to 12 indexed sources · {sourceIds.length} selected</span>
              <button className="set-btn text-xs" disabled={!!busy || sourcesLoading} onClick={() => void run('Refreshing sources…', refreshSources)}>Refresh</button></div>
            {sourcesLoading ? <p role="status" className="text-sm">Loading sources…</p> : <div className="max-h-64 overflow-auto space-y-2">
              {sources.map(s => <label key={s.id} className="set-card p-3 flex gap-3 items-start text-sm">
                <input type="checkbox" className="mt-1" checked={sourceIds.includes(s.id)} disabled={!!busy || !canEdit || s.status !== 'ready' || (!sourceIds.includes(s.id) && sourceIds.length >= 12)}
                  onChange={e => setSourceIds(ids => e.target.checked ? [...ids, s.id] : ids.filter(id => id !== s.id))} />
                <span className="min-w-0"><span className="block break-words">{s.name}</span><span className="text-xs text-set-dim">{s.kind} · {s.status}</span></span>
              </label>)}
              {!sources.length && <p className="text-sm text-set-dim">No sources yet. Add notes, documentation or a demonstration transcript below.</p>}
            </div>}
            <p className="text-xs text-set-dim">60,000-character evidence budget. Larger selections are rejected, never silently summarized away.</p>
            <details className="border-t border-set-border pt-3"><summary className="cursor-pointer text-sm">Add teaching notes, transcripts or documents</summary>
              <fieldset disabled={!!busy || !canEdit} className="space-y-3 mt-3">
                <label className="block text-sm">Source name<input className="set-input w-full mt-1" maxLength={200} value={noteName} onChange={e => setNoteName(e.target.value)} /></label>
                <label className="block text-sm">Notes / transcript<textarea className="set-input w-full mt-1 min-h-36" maxLength={60000} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Describe what was done, why, application versions, timestamps, inputs, outputs and how success was checked." /></label>
                <button className="set-btn" disabled={!notes.trim() || !noteName.trim()} onClick={() => void run('Saving teaching source…', async () => {
                  await api.post(`/notebooks/${notebookId}/sources`, { name: noteName.trim(), text: notes, kind: 'txt' });
                  if (live.current) { setNotes(''); setNotice('Source saved. Refresh after indexing to select it.'); } await refreshSources();
                })}>Save source</button>
                <label className="block text-sm">Upload documents or transcript files
                  <input className="block w-full text-sm mt-2" type="file" multiple accept=".pdf,.md,.markdown,.txt,.srt,.vtt,.csv,.json" onChange={e => {
                    const files = Array.from(e.target.files ?? []); e.target.value = '';
                    if (!files.length) return;
                    if (files.length > 12 || files.some(f => f.size > 20 * 1024 * 1024 || !/\.(pdf|md|markdown|txt|srt|vtt|csv|json)$/i.test(f.name))) { setError('Choose up to 12 supported text/PDF files, each no larger than 20 MB.'); return; }
                    void run('Uploading teaching material…', async () => { await api.upload(`/notebooks/${notebookId}/sources`, files); await refreshSources(); if (live.current) setNotice('Uploaded. Refresh after indexing to select the new sources.'); });
                  }} />
                </label>
                <p className="text-xs text-set-dim">For videos and visual demonstrations, supply a transcript and written observations with timestamps. This first compiler does not watch footage or analyze raw images.</p>
              </fieldset>
            </details>
          </>}
          <fieldset disabled={!!busy || !canEdit} className="border-t border-set-border pt-4 space-y-3">
            <div className="flex flex-wrap justify-between items-center gap-2"><h3 className="text-sm font-semibold">What should the AI learn to make?</h3>
              <button className="set-btn text-xs" onClick={() => { setName('robotic-part-blender-to-unreal'); setGoal(ROBOT_GOAL); setServers('blender | Inspect and author the demonstrated robotic part, then export the agreed asset format\nunreal | Import and inspect the asset in a disposable Unreal simulation project'); }}>Use robotics example</button></div>
            <label className="block text-sm">Skill name<input className="set-input w-full mt-1" maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="robotic-part-blender-to-unreal" /></label>
            <label className="block text-sm">Goal and success criteria<textarea className="set-input w-full mt-1 min-h-32" maxLength={2000} value={goal} onChange={e => setGoal(e.target.value)} /></label>
            <label className="block text-sm">Required MCP aliases and capabilities <span className="text-set-dim">(optional)</span>
              <textarea className="set-input w-full mt-1 min-h-24 font-mono text-xs" maxLength={4000} value={servers} onChange={e => setServers(e.target.value)} placeholder="blender | Model and export the part&#10;unreal | Import and inspect the asset" />
            </label>
            <p className="text-xs text-set-dim">One alias | purpose per line. These declare requirements; they do not install, connect or authorize a server. Compilation sends selected evidence to your configured AI provider.</p>
            <button className="set-btn-primary w-full" disabled={!notebookId || !sourceIds.length || !name.trim() || goal.trim().length < 10} onClick={() => void run('Compiling a source-backed skill draft…', async () => {
              const mcpRequirements = servers.split('\n').filter(line => line.trim()).map(line => {
                const split = line.indexOf('|'); if (split < 1) throw new Error('Use alias | purpose for each MCP requirement.');
                return { server: line.slice(0, split).trim(), purpose: line.slice(split + 1).trim() };
              });
              const result = await api.post<{ draft: Draft }>(base, { notebookId, sourceIds, name: name.trim(), goal: goal.trim(), mcpRequirements });
              showDraft(result.draft); await refreshDrafts(); if (live.current) setNotice('Draft created. Check every step and citation before approval. No app has been executed.');
            })}>Compile skill draft</button>
          </fieldset>
        </section>
        <section className="space-y-4" aria-labelledby="reviewed-skills">
          <div className="set-card p-4 md:p-5 space-y-3"><h2 id="reviewed-skills" className="font-semibold text-set-text">Skill drafts <span className="text-xs font-normal text-set-dim">Most recent 50</span></h2>
            {!drafts.length ? <p className="text-sm text-set-dim">Your first source-backed procedure will appear here. It stays separate from active copilot skills.</p> :
              <div className="max-h-48 overflow-auto space-y-2">{drafts.map(d => <button key={d.id} className={`set-card p-3 w-full flex justify-between gap-3 text-left text-sm ${draft?.id === d.id ? 'border-set-accent/60' : ''}`}
                disabled={!!busy} onClick={() => void run('Opening skill draft…', async () => showDraft((await api.get<{ draft: Draft }>(`${base}/${d.id}`)).draft))}>
                <span className="break-all">{d.name}{d.parent_id ? ' · revision' : ''}</span><span className="text-xs text-set-dim shrink-0">{d.status}</span></button>)}</div>}
          </div>
          {draft && <article className="set-card p-4 md:p-5 space-y-4 text-sm break-words">
            <header><p className="set-mono text-xs text-set-dim">{draft.status.toUpperCase()} / EXECUTION NOT TESTED</p>
              <h2 className="text-lg font-semibold mt-1">{draft.input.name}</h2><p className="text-set-dim mt-2">{draft.plan.description}</p></header>
            <div><h3 className="font-semibold mb-2">Prerequisites</h3>{bullets(draft.plan.prerequisites)}</div>
            {draft.plan.steps.map((step, i) => <section key={i} className="border-t border-set-border pt-3 space-y-2">
              <h3 className="font-semibold">{i + 1}. {step.title}</h3><p className="whitespace-pre-wrap">{step.action}</p>
              <p><strong>Expected:</strong> {step.expected}</p><p><strong>Verify:</strong> {step.verify}</p>
              <details><summary className="cursor-pointer text-set-dim">Inspect source evidence</summary>{step.evidence.map((e, j) => <blockquote key={j} className="border-l-2 border-set-border pl-3 my-3">
                <p className="text-xs text-set-dim mb-1">{draft.evidence.find(s => s.id === e.sourceId)?.name || e.sourceId}</p><p className="whitespace-pre-wrap">{e.quote}</p>
              </blockquote>)}</details>
            </section>)}
            <div><h3 className="font-semibold mb-2">Required artifacts</h3>{bullets(draft.plan.outputs)}</div>
            <div><h3 className="font-semibold mb-2">Acceptance checks — not run</h3>{bullets(draft.plan.checks)}</div>
            <div><h3 className="font-semibold mb-2">Pitfalls and recovery</h3>{bullets(draft.plan.pitfalls)}</div>
            <div><h3 className="font-semibold mb-2">Evidence gaps</h3>{bullets(draft.plan.gaps)}</div>
            {canEdit && <details className="border-t border-set-border pt-3"><summary className="cursor-pointer">Edit procedure as a new revision</summary>
              <label className="block mt-3 text-xs">Structured procedure JSON<textarea className="set-input w-full min-h-64 mt-2 font-mono text-xs" aria-label="Structured procedure JSON" maxLength={90000} value={planJson} disabled={!!busy} onChange={e => setPlanJson(e.target.value)} /></label>
              <button className="set-btn mt-2" disabled={!!busy} onClick={() => void run('Saving an unapproved revision…', async () => {
                let plan: unknown; try { plan = JSON.parse(planJson); } catch { throw new Error('The procedure editor requires valid JSON.'); }
                const result = await api.post<{ draft: Draft }>(`${base}/${draft.id}/revisions`, { expectedHash: draft.content_hash, plan });
                showDraft(result.draft); await refreshDrafts();
              })}>Save as new draft</button>
            </details>}
            {canEdit && draft.status === 'draft' && <div className="border-t border-set-border pt-4 space-y-3">
              <label className="flex gap-3 items-start"><input type="checkbox" className="mt-1" disabled={!!busy} checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />
                <span>I reviewed the instructions and source quotations, including rights to use them and any private content. I understand that this does not verify app execution or physical hardware safety.</span></label>
              <button className="set-btn-primary w-full" disabled={!!busy || !acknowledged} onClick={() => void run('Approving this exact revision…', async () => {
                showDraft((await api.post<{ draft: Draft }>(`${base}/${draft.id}/review`, { expectedHash: draft.content_hash, acknowledgeUnverified: true })).draft); await refreshDrafts();
              })}>Approve instructions</button>
            </div>}
            <div className="flex flex-wrap gap-2">
              {draft.status === 'approved' && <button className="set-btn-primary" disabled={!!busy} onClick={() => void run('Checking sources and exporting skill…', download)}>Download Codex skill ZIP</button>}
              {canEdit && draft.status !== 'revoked' && <button className="set-btn" disabled={!!busy} onClick={() => void run('Revoking future exports…', async () => {
                showDraft((await api.post<{ draft: Draft }>(`${base}/${draft.id}/revoke`)).draft); await refreshDrafts();
              })}>Revoke</button>}
              {canEdit && <button className="set-btn" disabled={!!busy} onClick={() => {
                if (!window.confirm('Delete this stored draft? Already downloaded skill copies cannot be recalled.')) return;
                void run('Deleting draft…', async () => { await api.del(`${base}/${draft.id}`); if (live.current) setDraft(null); await refreshDrafts(); });
              }}>Delete draft</button>}
            </div>
            <p className="text-xs text-set-dim">Exports include SKILL.md, workflow, exact citations, source hashes, MCP preflight and an unrun verification checklist. Source edits block stale exports. Revocation cannot recall downloaded copies.</p>
          </article>}
        </section>
      </div>
    </>}
  </main>;
}
