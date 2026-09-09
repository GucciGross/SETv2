import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Archive, Copy, Download, History, Layers, Monitor, Play, Plus, Puzzle, Smartphone, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { useAgentContext } from '@copilotkit/react-core/v2';
import H5PFrame from '../components/h5p/H5PFrame';
import H5PNativeEditor from '../components/h5p/H5PNativeEditor';
import { activityApi, downloadActivity, studioPath, type ActivityList, type H5PActivity, type StudioStatus } from '../components/h5p/api';

export default function H5PStudioView() {
  const { spaceId, activityId } = useParams();
  return spaceId ? activityId ? <ActivityWorkspace key={activityId} spaceId={spaceId} id={activityId} /> : <StudioLibrary key={spaceId} spaceId={spaceId} /> : null;
}
function StudioLibrary({ spaceId }: { spaceId: string }) {
  const navigate = useNavigate(), file = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<StudioStatus | null>(null), [data, setData] = useState<ActivityList | null>(null);
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('all'), [offset, setOffset] = useState(0);
  const [tab, setTab] = useState<'activities' | 'types'>('activities'), [catalog, setCatalog] = useState<any[] | null>(null);
  const [receipt, setReceipt] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  const loadStatus = useCallback(async () => { setStatus(await api.get(`/spaces/${spaceId}/h5p/status`)); }, [spaceId]);
  useEffect(() => { void loadStatus().catch((e) => setError(e.message)); }, [loadStatus, refresh]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      api.get<ActivityList>(`/spaces/${spaceId}/h5p/activities?search=${encodeURIComponent(search)}&status=${filter === 'archived' ? 'all' : filter}&archived=${filter === 'archived'}&offset=${offset}`).then((r) => { if (active) setData(r); }).catch((e) => { if (active) setError(e.message); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [spaceId, search, filter, offset, refresh]);
  useEffect(() => {
    if (tab !== 'types') return;
    let active = true;
    void api.get(`/spaces/${spaceId}/h5p/catalog`).then(r => { if (active) setCatalog(r.catalog.libraries ?? []); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [spaceId, tab, refresh]);
  const act = async (operation: () => Promise<void>) => { setBusy(true); setError(''); try { await operation(); } catch (reason: any) { setError(reason.message); } finally { setBusy(false); } };
  return <main className="h-full overflow-y-auto min-w-0 p-4 md:p-7" aria-label="H5P Studio">
    <div className="max-w-6xl mx-auto">
      <header className="flex items-start justify-between flex-wrap gap-4 mb-6">
        <div><div className="text-xs uppercase tracking-widest text-set-dim mb-2">SET / Interactive learning</div><h1 className="text-2xl font-semibold flex gap-3 items-center"><Puzzle className="text-set-accent" />H5P Studio</h1><p className="text-sm text-set-dim mt-2 max-w-xl">Create once. Teach anywhere in your workspace. Real H5P authoring, reusable activities and a deliberate publish step.</p></div>
        {status?.canEdit && <div className="flex gap-2 flex-wrap">
          <input ref={file} className="sr-only" type="file" accept=".h5p" aria-label="Import H5P package" onChange={(e) => { const selected = e.target.files?.[0]; e.target.value = ''; if (selected) void act(async () => { const r = await api.upload(`/spaces/${spaceId}/h5p/import`, [selected]); navigate(studioPath(spaceId, r.activity.id)); }); }} />
          <button className="set-btn flex items-center gap-2" disabled={busy} onClick={() => file.current?.click()}><Upload size={15} />Import .h5p</button>
          <button className="set-btn-primary flex items-center gap-2" disabled={busy || !status.ready} onClick={() => void act(async () => { const r = await api.post(`/spaces/${spaceId}/h5p/activities`, {}); navigate(studioPath(spaceId, r.activity.id)); })}><Plus size={15} />Create activity</button>
        </div>}
      </header>
      {status && !status.ready && <div role="status" className="set-card p-4 mb-4 border-amber-500/40"><h2 className="font-semibold text-sm">Browser runtime needs installation</h2><p className="text-sm text-set-dim mt-1">An instance administrator must run <code>npm run h5p:setup</code> in the server directory or rebuild the server image. Existing SET content is unaffected.</p><button className="set-btn text-xs mt-2" onClick={() => setRefresh((v) => v + 1)}>Check again</button></div>}
      {!!status?.bundle?.missing.length && <div role="alert" className="set-card p-4 mb-4 border-amber-500/40"><p className="text-sm">Some bundled content types need repair: {status.bundle.missing.join(', ')}.</p>{status.canInstall && <button className="set-btn mt-2" disabled={busy} onClick={() => void act(async () => { await api.post(`/spaces/${spaceId}/h5p/libraries`, { machineName: status.bundle.missing[0] }); await loadStatus(); setRefresh(v => v + 1); })}>Repair bundled content types</button>}</div>}
      {error && <div role="alert" className="set-card p-3 mb-4 border-red-500/40 text-sm">{error}<button className="set-btn text-xs ml-3" onClick={() => { setError(''); setRefresh((v) => v + 1); }}>Retry</button></div>}
      {status?.bundle && <p className="text-sm text-set-dim mb-3">{status.bundle.contentTypes} bundled content types · {status.bundle.libraries} library versions · {status.bundle.ready ? 'Ready for authors and agents' : 'Library repair required'}</p>}
      {(receipt || busy) && <p role="status" className="text-sm text-set-dim mb-3">{busy ? 'Verifying files and dependencies…' : receipt}</p>}
      <div className="flex flex-wrap justify-between gap-3 mb-5">
        <div className="flex gap-1 rounded-lg border border-set-border p-1" aria-label="Studio section">
          <button className={tab === 'activities' ? 'set-btn-primary text-sm' : 'set-btn-ghost text-sm'} aria-pressed={tab === 'activities'} onClick={() => setTab('activities')}>Activities {data ? `(${data.total})` : ''}</button>
          <button className={tab === 'types' ? 'set-btn-primary text-sm' : 'set-btn-ghost text-sm'} aria-pressed={tab === 'types'} onClick={() => setTab('types')}>Content types</button>
        </div>
        <div className="flex gap-2 flex-wrap min-w-0"><input type="search" className="set-input w-full sm:w-60" placeholder={tab === 'types' ? 'Find a content type…' : 'Search activities…'} aria-label="Search H5P Studio" value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} />
          {tab === 'activities' && <select aria-label="Activity status" className="set-input" value={filter} onChange={(e) => { setFilter(e.target.value); setOffset(0); }}><option value="all">All activities</option><option value="published">Published</option>{status?.canEdit && <><option value="draft">Unpublished changes</option><option value="archived">Archived</option></>}</select>}
        </div>
      </div>
      {tab === 'activities' ? <>
        {!data && <p role="status" className="text-set-dim">Loading activity library…</p>}
        {data?.activities.length === 0 && <div className="set-card p-8 text-center"><Layers size={32} className="mx-auto text-set-dim mb-3" /><h2 className="font-semibold">{search || filter !== 'all' ? 'No matching activities' : 'Your interactive library starts here'}</h2><p className="text-sm text-set-dim mt-2">{status?.canEdit ? 'Create or import content, save a draft, preview it, then publish. Attach the same activity to pages, notebooks and learning paths.' : 'Published activities will appear here when your workspace editors share them.'}</p></div>}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data?.activities.map((activity) => <Link to={studioPath(spaceId, activity.id)} key={activity.id} className="set-card p-5 hover:border-set-accent/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-set-accent min-w-0 group">
          <div className="flex justify-between gap-3 mb-7"><span className="p-2 rounded-lg bg-set-panel2"><Puzzle size={20} className="text-set-accent" /></span><span className="text-xs text-set-dim">{activity.archived ? 'Archived' : activity.publishedRevision ? activity.hasUnpublishedChanges ? 'Published · draft changes' : 'Published' : 'Draft'}</span></div>
          <h2 className="font-semibold break-words group-hover:text-set-accent">{activity.title}</h2><p className="text-xs text-set-dim mt-2 break-words">{activity.library ?? 'Choose a content type in the editor'}</p><div className="flex justify-between gap-2 mt-5 text-xs text-set-dim"><span>Revision {activity.draftRevision}</span><span>{new Date(activity.updatedAt).toLocaleDateString()}</span></div>
        </Link>)}</div>
        {data && data.total > 40 && <div className="flex justify-center items-center gap-4 mt-5"><button className="set-btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 40))}>Previous</button><span className="text-xs text-set-dim">{offset + 1}–{Math.min(offset + 40, data.total)} of {data.total}</span><button className="set-btn" disabled={offset + 40 >= data.total} onClick={() => setOffset(offset + 40)}>Next</button></div>}
      </> : <>
        <p className="text-sm text-set-dim mb-4">The official Hub catalog is bundled with SET and works without an installation step. Ready means its files and dependencies were checked. Owners can verify or repair the repository bundle; uploaded activities never install executable code.</p>
        {!catalog && <p role="status" className="text-sm text-set-dim">Loading the H5P catalog…</p>}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{catalog?.filter((type) => `${type.title} ${type.summary ?? ''}`.toLowerCase().includes(search.toLowerCase())).map((type) => {
          const installed = status?.installed.find((l) => l.machineName === type.machineName && l.majorVersion === type.majorVersion && l.minorVersion === type.minorVersion);
          return <article key={type.machineName} className="set-card p-4 flex flex-col min-w-0"><h2 className="font-semibold text-sm">{type.title}</h2><p className="text-xs text-set-dim mt-2 mb-4 flex-1">{type.summary || 'Interactive H5P content type'}</p><div className="flex flex-wrap justify-between items-center gap-2"><span className="text-xs text-set-dim">{installed?.usable ? `Ready ${installed.majorVersion}.${installed.minorVersion}.${installed.patchVersion}` : 'Needs repair'}</span>{status?.canInstall && <button className="set-btn text-xs" disabled={busy} onClick={() => void act(async () => { const result = await api.post(`/spaces/${spaceId}/h5p/libraries`, { machineName: type.machineName }); if (!result.verified) throw new Error('Installation did not pass verification.'); setReceipt(`${type.title}: verified and ready. ${result.changed.length} library versions installed or repaired from the repository bundle.`); await loadStatus(); setRefresh((v) => v + 1); })}>{installed?.usable ? 'Verify type' : 'Repair type'}</button>}</div></article>;
        })}</div>
      </>}
    </div>
  </main>;
}
function ActivityWorkspace({ spaceId, id }: { spaceId: string; id: string }) {
  const navigate = useNavigate();
  const [activity, setActivity] = useState<H5PActivity | null>(null), [tab, setTab] = useState<'edit' | 'preview' | 'play' | 'history' | 'results'>('edit');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [width, setWidth] = useState('full');
  const [history, setHistory] = useState<any[]>([]), [results, setResults] = useState<any[]>([]), [notice, setNotice] = useState('');
  const blocker = useBlocker(dirty);
  useEffect(() => { if (blocker.state === 'blocked') { if (confirm('Leave the editor and discard unsaved changes?')) { setDirty(false); blocker.proceed(); } else blocker.reset(); } }, [blocker]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  useEffect(() => { let active = true; api.get(activityApi(id)).then((r) => { if (active) { setActivity(r.activity); setTab(r.activity.canEdit ? 'edit' : 'play'); } }).catch((e) => { if (active) setError(e.message); }); return () => { active = false; }; }, [id]);
  useEffect(() => {
    if (tab === 'history') api.get(activityApi(id, '/revisions')).then((r) => setHistory(r.revisions)).catch((e) => setError(e.message));
    if (tab === 'results') api.get(activityApi(id, '/results')).then((r) => setResults(r.results)).catch((e) => setError(e.message));
  }, [id, tab, activity?.draftRevision]);
  useAgentContext({ description: 'H5P Studio activity. Drafts require explicit publication; client practice results do not change assessed grades.', value: activity ? JSON.stringify(activity) : 'Loading H5P activity' });
  const switchTab = (next: typeof tab) => { if (!dirty || confirm('Discard unsaved editor changes?')) { setDirty(false); setError(''); setTab(next); } };
  const act = async (operation: () => Promise<void>) => { setBusy(true); setError(''); setNotice(''); try { await operation(); } catch (reason: any) { setError(reason.message); } finally { setBusy(false); } };
  if (!activity) return <div className="p-6">{error ? <p role="alert">{error}</p> : <p role="status">Loading activity…</p>}<Link className="set-btn inline-block mt-3" to={studioPath(spaceId)}>Back to Studio</Link></div>;
  const publish = (value: boolean) => void act(async () => { const result = await api.post(activityApi(id, value ? '/publish' : '/unpublish'), { expectedRevision: activity.draftRevision }); setActivity(result.activity); setNotice(value ? 'Published. Learners can now open this revision.' : 'Unpublished. Previous launches have been revoked.'); });
  return <main className="h-full overflow-y-auto p-4 md:p-6 min-w-0">
    <div className="max-w-6xl mx-auto">
      <Link className="text-xs text-set-dim inline-flex gap-1 items-center mb-4" to={studioPath(spaceId)}><ArrowLeft size={13} />H5P Studio</Link>
      <header className="flex justify-between gap-4 flex-wrap mb-4"><div className="min-w-0"><h1 className="text-xl font-semibold break-words">{activity.title}</h1><p className="text-xs text-set-dim mt-1">{activity.library ?? 'New activity'} · {activity.archived ? 'Archived' : activity.publishedRevision ? `Published revision ${activity.publishedRevision}` : 'Private draft'}{dirty ? ' · Unsaved changes' : ` · Draft ${activity.draftRevision}`}</p></div>
        {activity.canEdit && <div className="flex gap-2 flex-wrap items-start">
          {!activity.archived && <button className="set-btn-primary text-sm" disabled={busy || dirty || !activity.draftRevision || !activity.hasUnpublishedChanges} title={dirty ? 'Save the editor before publishing' : 'Make the saved draft available to learners'} onClick={() => publish(true)}>Publish saved draft</button>}
          {!!activity.publishedRevision && !activity.archived && <button className="set-btn text-sm" disabled={busy || dirty} onClick={() => { if (confirm('Unpublish this activity everywhere in this workspace?')) publish(false); }}>Unpublish</button>}
          {!!activity.draftRevision && <button className="set-btn" aria-label="Export H5P package" title="Export .h5p" disabled={busy || activity.archived} onClick={() => void act(() => downloadActivity(activity))}><Download size={16} /></button>}
          {!!activity.draftRevision && <button className="set-btn" aria-label="Duplicate activity" title="Duplicate" disabled={busy || dirty} onClick={() => void act(async () => { const result = await api.post(activityApi(id, '/duplicate')); navigate(studioPath(spaceId, result.activity.id)); })}><Copy size={16} /></button>}
          <button className="set-btn flex gap-1 items-center text-xs" disabled={busy || dirty} onClick={() => void act(async () => { if (!activity.archived && !confirm('Archive this activity everywhere? Learner access will stop. You can restore it later.')) return; const result = await api.patch(activityApi(id), { archived: !activity.archived }); setActivity(result.activity); })}><Archive size={14} />{activity.archived ? 'Restore activity' : 'Archive'}</button>
        </div>}
      </header>
      {error && <p role="alert" className="set-card p-3 border-red-500/40 text-sm mb-4">{error}</p>}
      {(notice || busy) && <p role="status" className="text-sm text-set-dim mb-3">{busy ? 'Applying changes…' : notice}</p>}
      {!activity.archived ? <>
        <div className="flex flex-wrap justify-between gap-3 mb-4 border-b border-set-border pb-3">
          <nav className="flex flex-wrap gap-1" aria-label="Activity workspace sections">
            {activity.canEdit && <><button className={tab === 'edit' ? 'set-btn-primary' : 'set-btn-ghost'} aria-pressed={tab === 'edit'} onClick={() => switchTab('edit')}>Edit</button><button className={tab === 'preview' ? 'set-btn-primary' : 'set-btn-ghost'} aria-pressed={tab === 'preview'} disabled={!activity.draftRevision} onClick={() => switchTab('preview')}>Preview draft</button></>}
            {!!activity.publishedRevision && <button className={tab === 'play' ? 'set-btn-primary' : 'set-btn-ghost'} aria-pressed={tab === 'play'} onClick={() => switchTab('play')}>Published activity</button>}
            {activity.canEdit && <button className={tab === 'history' ? 'set-btn-primary' : 'set-btn-ghost'} aria-pressed={tab === 'history'} onClick={() => switchTab('history')}>Revisions</button>}
            <button className={tab === 'results' ? 'set-btn-primary' : 'set-btn-ghost'} aria-pressed={tab === 'results'} onClick={() => switchTab('results')}>Practice results</button>
          </nav>
          {(tab === 'preview' || tab === 'play') && <div className="flex gap-1 items-center" aria-label="Preview width"><button className="set-btn" aria-pressed={width === 'full'} aria-label="Full-width preview" onClick={() => setWidth('full')}><Monitor size={15} /></button><button className="set-btn" aria-pressed={width === '375'} aria-label="Phone-width preview" onClick={() => setWidth('375')}><Smartphone size={15} /></button></div>}
        </div>
        {(['edit', 'preview', 'play'] as string[]).includes(tab) && <div className="mx-auto min-w-0" style={{ maxWidth: tab === 'edit' || width === 'full' ? '100%' : 375 }}>
          {tab === 'edit' ? <H5PNativeEditor activity={activity} onDirty={setDirty} onSaved={(saved) => { setActivity(saved); setDirty(false); setNotice('Draft saved. Preview it before publishing.'); }} /> : <H5PFrame activity={activity} mode={tab as 'preview' | 'play'} />}
          <p className="text-xs text-set-dim mt-3">{tab === 'edit' ? 'Use Save draft above or below the authoring fields. Publishing is separate; learners keep using the last published revision.' : tab === 'preview' ? 'Author preview. Practice scores and learner state are not recorded here.' : 'Practice results are client-reported and do not replace assessed grades or path completion.'}</p>
        </div>}
        {tab === 'history' && <section aria-label="Revision history"><p className="text-sm text-set-dim mb-4">Restoring creates a new draft. Previously published revisions remain intact.</p>{history.length === 0 && <p className="text-sm text-set-dim">Save a draft to create the first revision.</p>}<div className="space-y-2">{history.map((revision) => <div key={revision.revision} className="set-card p-4 flex justify-between gap-3 flex-wrap"><div className="min-w-0"><h2 className="text-sm font-medium break-words">Revision {revision.revision} · {revision.title}</h2><p className="text-xs text-set-dim mt-1">{revision.author ?? 'Former member'} · {new Date(revision.created_at).toLocaleString()}{revision.published_at ? ' · Published previously' : ''}</p></div><button className="set-btn text-xs" disabled={busy || revision.revision === activity.draftRevision} onClick={() => void act(async () => { const result = await api.post(activityApi(id, '/restore'), { revision: revision.revision, expectedRevision: activity.draftRevision }); setActivity(result.activity); setTab('edit'); })}>Restore as draft</button></div>)}</div></section>}
        {tab === 'results' && <section aria-label="Practice results"><h2 className="text-sm font-semibold mb-2">Latest practice results per learner and revision</h2><p className="text-sm text-set-dim mb-4">These scores are reported by the browser, not verified assessment grades. Not every H5P content type reports a score.</p>{results.length === 0 && <div className="set-card p-5 text-sm text-set-dim">No reported results yet. Play a published activity that supports score reporting.</div>}<div className="space-y-2">{results.map((result, index) => <div key={index} className="set-card p-4 flex gap-3 justify-between flex-wrap text-sm"><span>{result.learner} · revision {result.revision}</span><strong>{result.score} / {result.max_score}</strong><span className="text-xs text-set-dim">{new Date(result.updated_at).toLocaleString()}</span></div>)}</div><button className="set-btn text-xs mt-3" onClick={() => void act(async () => { setResults((await api.get(activityApi(id, '/results'))).results); })}>Refresh results</button></section>}
      </> : <div className="set-card p-6 text-sm text-set-dim">This activity is archived. Restore it to edit, export or resume learner access.</div>}
    </div>
  </main>;
}
