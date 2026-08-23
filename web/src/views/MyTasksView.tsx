import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { ListTodo, CalendarClock, CheckSquare, Square, Loader2 } from 'lucide-react';

/** My Tasks: assignments and open checkbox tasks from across the space, in one view. */
export default function MyTasksView() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<{ paths: any[]; tasks: any[]; completedToday: number } | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!spaceId) return;
    setData(await api.get(`/spaces/${spaceId}/mytasks`).catch(() => null));
  }, [spaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (task: any) => {
    if (!spaceId) return;
    setToggling(task.pageId + task.index);
    try {
      await api.post(`/spaces/${spaceId}/mytasks/toggle`, { pageId: task.pageId, index: task.index, checked: true });
      await load();
    } finally {
      setToggling(null);
    }
  };

  if (!data) return <div className="p-8 text-set-dim">Loading your tasks…</div>;

  const today = new Date().toDateString();

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1 flex items-center gap-2"><ListTodo size={22} /> My Tasks</h1>
      <p className="text-set-dim text-sm mb-6">
        Everything assigned to you or waiting on a checkbox — {data.tasks.length} open task{data.tasks.length === 1 ? '' : 's'},
        {' '}{data.completedToday} completed in this space.
      </p>

      {data.paths.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-set-dim mb-2 flex items-center gap-1.5">
            <CalendarClock size={13} /> Assignments
          </h2>
          <div className="space-y-2">
            {data.paths.map((p) => {
              const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
              const overdue = p.due_date && new Date(p.due_date) < new Date(today) && pct < 100;
              return (
                <button key={p.id} className="set-card p-3 w-full text-left hover:border-set-accent/40" onClick={() => navigate(`/app/space/${spaceId}/paths`)}>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span className="text-white">{p.title}</span>
                    {p.due_date && (
                      <span className={`text-xs ${overdue ? 'text-red-400' : 'text-set-dim'}`}>
                        due {new Date(p.due_date).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div className="h-1.5 bg-set-panel2 rounded-full overflow-hidden">
                    <div className={`h-full ${overdue ? 'bg-red-500/70' : 'bg-green-500/70'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="text-[10px] text-set-dim mt-1">{p.done}/{p.total} complete</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-set-dim mb-2 flex items-center gap-1.5">
          <CheckSquare size={13} /> Open tasks in pages
        </h2>
        {data.tasks.length === 0 && (
          <p className="text-sm text-set-dim set-card p-4">All clear — no open checkboxes found in this space's pages.</p>
        )}
        <div className="set-card divide-y divide-set-border/50">
          {data.tasks.map((t) => (
            <div key={t.pageId + t.index} className="flex items-start gap-2.5 px-3 py-2.5 hover:bg-set-panel2/50">
              <button
                className="mt-0.5 text-set-dim hover:text-green-400 shrink-0"
                title="Mark complete"
                disabled={toggling === t.pageId + String(t.index)}
                onClick={() => toggle(t)}
              >
                {toggling === t.pageId + String(t.index) ? <Loader2 size={15} className="animate-spin" /> : <Square size={15} />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-set-text truncate">{t.text}</div>
                <button
                  className="text-[11px] text-set-dim hover:text-set-accent"
                  onClick={() => navigate(`/app/space/${spaceId}/page/${t.pageId}`)}
                >
                  {t.pageTitle}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
