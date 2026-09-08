import { useCallback, useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Play, Puzzle, ExternalLink, X } from 'lucide-react';
import { api } from '../../lib/api';
import { activityApi, placementQuery, studioPath, type ActivityList, type H5PActivity, type Placement } from './api';
import H5PFrame from './H5PFrame';

/** Reuse the same activity in a page, notebook or path without copying its content. */
export default function H5PCollection({ spaceId, placement }: { spaceId: string; placement: Placement }) {
  const heading = useId(), navigate = useNavigate();
  const [data, setData] = useState<ActivityList | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false), [options, setOptions] = useState<H5PActivity[]>([]);
  const [search, setSearch] = useState(''), [selected, setSelected] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const load = useCallback(async () => {
    try { setData(await api.get<ActivityList>(`/spaces/${spaceId}/h5p/activities?${placementQuery(placement)}&offset=${offset}`)); setError(''); }
    catch (reason: any) { setError(reason.message); }
  }, [spaceId, placement.kind, placement.id, offset]);
  useEffect(() => { setOpen(null); void load(); }, [load]);
  useEffect(() => {
    if (!picker) return;
    let active = true;
    const timer = setTimeout(() => { api.get<ActivityList>(`/spaces/${spaceId}/h5p/activities?search=${encodeURIComponent(search)}`).then((r) => { if (active) setOptions(r.activities); }).catch((e) => { if (active) setError(e.message); }); }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [picker, search, spaceId]);
  const act = async (operation: () => Promise<void>) => { setBusy(true); setError(''); try { await operation(); } catch (reason: any) { setError(reason.message); } finally { setBusy(false); } };
  return <section aria-labelledby={heading} className="mt-6 border-t border-set-border pt-4 min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h2 id={heading} className="text-sm font-semibold flex items-center gap-2"><Puzzle size={16} /> Interactive activities</h2>
      {data?.canEdit && <div className="flex flex-wrap gap-2">
        <button className="set-btn text-xs" disabled={busy} onClick={() => setPicker((v) => !v)}>Attach existing</button>
        <button className="set-btn text-xs inline-flex gap-1 items-center" disabled={busy} onClick={() => void act(async () => {
          const result = await api.post<{ activity: H5PActivity }>(`/spaces/${spaceId}/h5p/activities`, { placement });
          navigate(studioPath(spaceId, result.activity.id));
        })}><Plus size={13} /> Create activity</button>
      </div>}
    </div>
    {error && <p role="alert" className="text-sm text-red-400 mb-2">{error} <button className="underline" onClick={() => void load()}>Retry</button></p>}
    {picker && <form className="set-card p-3 space-y-2 mb-3" onSubmit={(e) => { e.preventDefault(); void act(async () => {
      if (!selected) return;
      await api.put(activityApi(selected, '/placements'), placement); setPicker(false); setSelected(''); await load();
    }); }}>
      <label className="block text-xs">Search workspace activities<input className="set-input w-full mt-1" value={search} onChange={(e) => { setSearch(e.target.value); setSelected(''); }} /></label>
      <label className="block text-xs">Choose activity<select className="set-input w-full mt-1" value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">Select an activity</option>{options.map((a) => <option key={a.id} value={a.id}>{a.title}{a.publishedRevision ? '' : ' (draft)'}</option>)}</select></label>
      <button className="set-btn-primary text-xs" disabled={!selected || busy}>Attach activity</button>
    </form>}
    {!data && !error && <p role="status" className="text-xs text-set-dim">Loading activities…</p>}
    {data && data.total === 0 && <p className="text-sm text-set-dim">{data.canEdit ? 'Add an interactive video, exercise, simulation or any installed H5P content type.' : 'No published activities here yet.'}</p>}
    <div className="space-y-3">{data?.activities.map((activity) => <article key={activity.id} className="set-card p-3 min-w-0">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="font-medium text-sm flex-1 min-w-0 break-words">{activity.title}</span>
        <span className="text-xs text-set-dim">{activity.publishedRevision ? 'Published' : 'Draft'}</span>
        {(activity.publishedRevision || (activity.canEdit && activity.draftRevision > 0)) && <button className="set-btn text-xs inline-flex items-center gap-1" onClick={() => setOpen(open === activity.id ? null : activity.id)}><Play size={12} />{open === activity.id ? 'Close' : activity.publishedRevision ? 'Play' : 'Preview'}</button>}
        <Link className="set-btn text-xs inline-flex items-center gap-1" to={studioPath(spaceId, activity.id)}><ExternalLink size={12} /> Studio</Link>
        {activity.canEdit && <button className="set-btn-ghost" aria-label={`Remove ${activity.title} from this ${placement.kind}`} disabled={busy} onClick={() => void act(async () => { await api.post(activityApi(activity.id, '/placements/remove'), placement); await load(); })}><X size={14} /></button>}
      </div>
      {open === activity.id && <div className="mt-3"><H5PFrame activity={activity} mode={activity.publishedRevision ? 'play' : 'preview'} /></div>}
    </article>)}</div>
    {data && data.total > 40 && <div className="flex gap-3 items-center mt-3 text-xs"><button className="set-btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 40))}>Previous</button><span>{offset + 1}–{Math.min(offset + 40, data.total)} of {data.total}</span><button className="set-btn" disabled={offset + 40 >= data.total} onClick={() => setOffset(offset + 40)}>Next</button></div>}
  </section>;
}
