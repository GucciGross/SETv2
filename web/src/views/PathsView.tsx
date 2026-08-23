import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../stores/app';
import { Plus, Check, Users, CalendarClock } from 'lucide-react';

export default function PathsView() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const { pages, user } = useApp();
  const [paths, setPaths] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const load = async () => {
    if (!spaceId) return;
    setPaths((await api.get(`/spaces/${spaceId}/paths`)).paths);
  };
  useEffect(() => {
    load();
    if (spaceId) api.get(`/spaces/${spaceId}/members`).then((r) => setMembers(r.members)).catch(() => {});
  }, [spaceId]);

  const create = async () => {
    if (!title.trim() || !spaceId) return;
    const { path } = await api.post(`/spaces/${spaceId}/paths`, {
      title,
      items: selected.map((pageId) => ({ pageId })),
    });
    setCreating(false);
    setTitle('');
    setSelected([]);
    load();
    navigate(`/app/space/${spaceId}/paths#${path.id}`);
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {(() => {
        const mine = paths.filter((p) => (p.assignees ?? []).includes(user?.id));
        if (!mine.length) return null;
        return (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-set-dim uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <CalendarClock size={14} /> My assignments
            </h2>
            <div className="space-y-2">
              {mine.map((p) => {
                const total = Number(p.item_count) || 1;
                const pct = Math.min(100, Math.round(((Number(p.done_count) || 0) / total) * 100));
                const overdue = p.due_date && new Date(p.due_date) < new Date(new Date().toDateString()) && pct < 100;
                return (
                  <button key={p.id} className="set-card p-3 w-full text-left hover:border-set-accent/40" onClick={() => document.getElementById(`path-${p.id}`)?.scrollIntoView({ behavior: 'smooth' })}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-white">{p.title}</span>
                      {p.due_date && (
                        <span className={`text-xs ${overdue ? 'text-red-400' : 'text-set-dim'}`}>
                          due {new Date(p.due_date).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 h-1.5 bg-set-panel2 rounded-full overflow-hidden">
                      <div className={`h-full transition-all ${overdue ? 'bg-red-500/70' : 'bg-green-500/70'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-[10px] text-set-dim mt-1">{p.done_count ?? 0}/{total} complete</div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white"> Learning Paths</h1>
          <p className="text-set-dim text-sm">Curricula with per-member readiness tracking.</p>
        </div>
        <button className="set-btn flex items-center gap-1" onClick={() => setCreating((c) => !c)}><Plus size={14} /> New path</button>
      </div>

      {creating && (
        <div className="set-card p-4 mb-4">
          <input className="set-input mb-3" placeholder="Path title (e.g. Robot Onboarding)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="text-xs text-set-dim mb-1">Select pages in order:</div>
          <div className="max-h-48 overflow-auto space-y-1 mb-3">
            {pages.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-set-panel2 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-set-accent"
                  checked={selected.includes(p.id)}
                  onChange={(e) => setSelected((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))}
                />
                {p.icon ?? ''} {p.title}
                <span className="ml-auto text-xs text-set-dim">#{selected.indexOf(p.id) + 1 || '—'}</span>
              </label>
            ))}
          </div>
          <button className="set-btn-primary" onClick={create}>Create path ({selected.length} steps)</button>
        </div>
      )}

      <div className="space-y-3">
        {paths.map((p) => (
          <PathCard key={p.id} path={p} onChanged={load} />
        ))}
        {paths.length === 0 && !creating && <p className="text-sm text-set-dim">No learning paths yet.</p>}
      </div>
    </div>
  );
}

function PathCard({ path, onChanged }: { path: any; onChanged: () => void }) {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const { user } = useApp();
  const [detail, setDetail] = useState<any>(null);
  const [progress, setProgress] = useState<Record<number, boolean>>({});
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignees, setAssignees] = useState<string[]>(path.assignees ?? []);
  const [dueDate, setDueDate] = useState<string>(path.due_date ?? '');
  const [roster, setRoster] = useState<{ userId: string; name: string; done: number; total: number }[]>([]);
  const [members, setMembers] = useState<any[]>([]);

  useEffect(() => {
    api.get(`/spaces/${spaceId}/members`).then((r) => setMembers(r.members)).catch(() => {});
  }, [spaceId]);

  useEffect(() => {
    if (assignOpen && assignees.length) {
      api.get(`/paths/${path.id}/progress/all`).then((r) => setRoster(r.members)).catch(() => setRoster([]));
    }
  }, [assignOpen, assignees.length, path.id]);

  const saveAssignment = async () => {
    await api.patch(`/paths/${path.id}/assign`, { assignees, dueDate: dueDate || null });
    setAssignOpen(false);
    onChanged();
  };

  useEffect(() => {
    api.get(`/paths/${path.id}`).then((r) => {
      setDetail(r.path);
      setProgress(Object.fromEntries(r.progress.map((p: any) => [p.item_index, p.done])));
    });
  }, [path.id]);

  const items = detail?.items ?? [];
  const done = Object.values(progress).filter(Boolean).length;

  const toggle = async (i: number) => {
    const next = !progress[i];
    setProgress((p) => ({ ...p, [i]: next }));
    await api.post(`/paths/${path.id}/progress`, { itemIndex: i, done: next });
  };

  return (
    <div className="set-card p-4">
      <div id={`path-${path.id}`} className="flex items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-white">{path.title}</div>
          <div className="text-xs text-set-dim">{path.description} · {done}/{items.length} complete</div>
        </div>
        <div className="flex items-center gap-2">
          {path.due_date && (
            <span className="text-xs text-set-dim flex items-center gap-1">
              <CalendarClock size={12} /> {new Date(path.due_date).toLocaleDateString()}
            </span>
          )}
          {(path.assignees ?? []).length > 0 && (
            <span className="set-chip border-set-border bg-set-panel2 text-set-dim" title={`${path.assignees.length} assigned`}>
              <Users size={11} /> {path.assignees.length}
            </span>
          )}
          <button className="set-btn-ghost text-xs flex items-center gap-1" onClick={() => setAssignOpen((o) => !o)}>
            <Users size={12} /> Assign
          </button>
          <div className="w-28 h-2 bg-set-panel2 rounded-full overflow-hidden hidden sm:block">
            <div className="h-full bg-green-500/70 transition-all" style={{ width: items.length ? `${(done / items.length) * 100}%` : '0%' }} />
          </div>
        </div>
      </div>

      {assignOpen && (
        <div className="mt-3 set-card p-3 bg-set-panel2/50 fadein">
          <div className="text-xs uppercase text-set-dim font-semibold mb-2">Assign to members</div>
          <div className="grid sm:grid-cols-2 gap-1 mb-3">
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-set-panel2 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-set-accent"
                  checked={assignees.includes(m.id)}
                  onChange={(e) => setAssignees((a) => (e.target.checked ? [...a, m.id] : a.filter((x) => x !== m.id)))}
                />
                {m.name} <span className="text-[10px] text-set-dim">{m.role}</span>
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm mb-3">
            <span className="text-set-dim text-xs">Due date</span>
            <input type="date" className="set-input w-44" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          {roster.length > 0 && (
            <div className="mb-3 space-y-1">
              <div className="text-xs uppercase text-set-dim font-semibold mb-1">Team progress</div>
              {roster.map((r) => (
                <div key={r.userId} className="flex items-center gap-2 text-sm">
                  <span className="w-28 truncate">{r.name}{r.userId === user?.id ? ' (you)' : ''}</span>
                  <div className="flex-1 h-1.5 bg-set-panel2 rounded-full overflow-hidden">
                    <div className="h-full bg-set-accent/70" style={{ width: `${r.total ? (r.done / r.total) * 100 : 0}%` }} />
                  </div>
                  <span className="text-xs text-set-dim w-10 text-right">{r.done}/{r.total}</span>
                </div>
              ))}
            </div>
          )}
          <button className="set-btn-primary text-xs" onClick={saveAssignment}>Save assignment</button>
        </div>
      )}
      <div className="mt-3 space-y-1">
        {items.map((item: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <button
              className={`w-5 h-5 rounded border flex items-center justify-center ${progress[i] ? 'bg-green-500/30 border-green-500/50 text-green-300' : 'border-set-border text-transparent hover:border-set-accent/50'}`}
              onClick={() => toggle(i)}
            >
              <Check size={12} />
            </button>
            <span className={progress[i] ? 'line-through text-set-dim' : ''}>{item.note && <span className="text-[10px] text-set-dim mr-1 uppercase">{item.note}</span>}</span>
            <button className="text-blue-200 hover:underline truncate" onClick={() => navigate(`/app/space/${spaceId}/page/${item.pageId}`)}>
              {item.title ?? 'Page'}
            </button>
          </div>
        ))}
        {items.length === 0 && <div className="text-xs text-set-dim">Empty path</div>}
      </div>
    </div>
  );
}
