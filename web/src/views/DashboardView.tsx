import { useCallback, useEffect, useState } from 'react';
import { PullToRefresh } from '../components/PullToRefresh';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../stores/app';
import Mascot, { DEFAULT_MASCOT, type MascotConfig } from '../components/Mascot';
// @ts-nocheck
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, DitherGradient, DitherAvatar } from '../components/DitherChart';
import ErrorBoundary from '../components/ErrorBoundary';
import Checklist from '../components/onboarding/Checklist';
import {
  FileText, BookOpen, Database, Users, Bell, ListTodo, ArrowRight, Sparkles, TrendingUp, ChevronDown, CloudSun, Zap, NotebookPen,
} from 'lucide-react';

/** Today's brief strip: reviews due, amber pages, ranked next steps, recent builds. */
function BriefCard({ spaceId }: { spaceId: string }) {
  const navigate = useNavigate();
  const [brief, setBrief] = useState<any>(null);
  const [writing, setWriting] = useState(false);

  useEffect(() => {
    if (!spaceId) return;
    api.get(`/spaces/${spaceId}/brief`).then((r) => setBrief(r.brief)).catch(() => {});
  }, [spaceId]);

  if (!brief) return null;
  const empty = brief.reviews?.dueNow === 0 && !brief.decaying?.length && !brief.next?.length && !brief.builds?.length;
  if (empty) return null;

  const write = async () => {
    if (writing) return;
    setWriting(true);
    try {
      const r = await api.post(`/spaces/${spaceId}/brief/to-daily`);
      if (r?.pageId) navigate(`/app/space/${spaceId}/page/${r.pageId}`);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setWriting(false);
    }
  };

  return (
    <div data-tour="brief" className="set-card p-4 mb-6">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <CloudSun size={15} className="text-amber-300" />
        <span className="text-sm text-white">Today’s brief</span>
        <div className="flex flex-wrap items-center gap-1.5 ml-1">
          {brief.reviews?.dueNow > 0 && (
            <button
              className="rounded-full bg-amber-400/15 text-amber-300 px-2 py-0.5 text-[11px] hover:bg-amber-400/25"
              onClick={() => {
                const worst = brief.reviews.decks[0];
                if (worst) navigate(`/app/space/${spaceId}/notebook/${worst.notebookId ?? 'none'}/deck/${worst.id}`);
              }}
            >
              <Zap size={10} className="inline -mt-0.5 mr-1" />{brief.reviews.dueNow} cards due
            </button>
          )}
          {brief.decaying?.length > 0 && (
            <button className="rounded-full bg-amber-400/10 text-amber-200/80 px-2 py-0.5 text-[11px] hover:bg-amber-400/20" onClick={() => navigate(`/app/space/${spaceId}/graph`)}>
              {brief.decaying.length} going amber
            </button>
          )}
          {brief.builds?.length > 0 && (
            <span className="rounded-full bg-set-panel2 text-set-dim px-2 py-0.5 text-[11px]">
              {brief.builds.length} build{brief.builds.length > 1 ? 's' : ''} · latest {brief.builds[0].status}
            </span>
          )}
        </div>
        <button className="ml-auto set-btn text-[11px] flex items-center gap-1" onClick={write} disabled={writing}>
          <NotebookPen size={12} /> {writing ? 'writing…' : 'write to today’s note'}
        </button>
      </div>
      {brief.next?.length > 0 && (
        <div className="space-y-1">
          {brief.next.slice(0, 3).map((n: any) => (
            <button
              key={n.pageId}
              className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-set-panel2 group"
              onClick={() => navigate(`/app/space/${spaceId}/page/${n.pageId}`)}
            >
              <ArrowRight size={12} className="text-set-dim group-hover:text-set-accent shrink-0" />
              <span className="text-sm text-set-text truncate">{n.title}</span>
              <span className="text-[11px] text-set-dim truncate ml-auto shrink-0 max-w-[55%]">{n.reason}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Space dashboard: the home view with dithered analytics, tasks, and quick actions. */
export default function DashboardView() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const { user, spaces, pages } = useApp();
  const [stats, setStats] = useState<any>(null);
  const [tasks, setTasks] = useState<any>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [mcpStats, setMcpStats] = useState<any>(null);
  const mascot: MascotConfig = (user as any)?.mascot ?? DEFAULT_MASCOT;
  const space = spaces.find((s) => s.id === spaceId);

  const load = useCallback(async () => {
    if (!spaceId) return;
    const [s, t, a, m] = await Promise.all([
      api.post('/terminal/exec', { spaceId, command: 'stat' }).catch(() => null),
      api.get(`/spaces/${spaceId}/mytasks`).catch(() => null),
      api.get(`/spaces/${spaceId}/activity?limit=8`).catch(() => ({ activities: [] })),
      api.get(`/spaces/${spaceId}/mcp/stats`).catch(() => null),
    ]);
    if (s?.output) {
      const match = s.output.match(/pages: (\d+)\s+notebooks: (\d+)\s+databases: (\d+)/);
      if (match) setStats({ pages: +match[1], notebooks: +match[2], databases: +match[3] });
    }
    setTasks(t);
    setActivity(a.activities ?? []);
    setMcpStats(m);
  }, [spaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const openTasks = tasks?.tasks?.length ?? 0;
  const assignedPaths = tasks?.paths?.length ?? 0;
  const overdue = (tasks?.paths ?? []).filter((p: any) => p.due_date && new Date(p.due_date) < new Date() && p.done < p.total);

  // build chart data from activity (last 7 days)
  const chartData = (() => {
    const days: any[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const label = d.toLocaleDateString('en', { weekday: 'short' });
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const dayActs = activity.filter((a) => new Date(a.created_at).getTime() >= dayStart && new Date(a.created_at).getTime() < dayStart + 86400000);
      days.push({ day: label, events: dayActs.length, pages: dayActs.filter((a) => a.type === 'page_created').length });
    }
    return days;
  })();

  // mcp tool calls data
  const mcpData = (mcpStats?.perTool ?? []).slice(0, 8).map((t: any) => ({
    tool: t.tool.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()).slice(0, 14),
    calls: t.calls,
    success: t.success_rate,
  }));

  return (
    <PullToRefresh onRefresh={load}>
    <div className="p-4 sm:p-6 max-w-6xl mx-auto pb-24">
      <details data-tour="checklist" className="mb-4 group">
        <summary className="cursor-pointer list-none flex items-center gap-2 text-xs text-set-dim hover:text-set-text select-none">
          <span className="w-24 h-1.5 rounded-full bg-set-panel2 overflow-hidden inline-flex">
            <ChecklistProgress className="h-full bg-set-accent/70" />
          </span>
          <span>Getting started</span>
          <ChevronDown size={12} className="transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-2">
          <Checklist onRevealWelcome={() => {
            useApp.setState({ user: { ...(user as any), onboarding: { ...(user as any)?.onboarding, welcomed: false } } });
            window.dispatchEvent(new CustomEvent('set:open-welcome'));
          }} />
        </div>
      </details>

      <BriefCard spaceId={spaceId!} />

      {/* Hero greeting — the dither wash gives the canvas its brand texture */}
      <div className="relative overflow-hidden rounded-xl border border-set-border bg-set-panel mb-6 shadow-card">
        <DitherGradient from="blue" direction="up" opacity={0.1} cell={3} className="dither-mask-t" />
        <div className="relative flex flex-wrap items-center gap-x-4 gap-y-3 p-5">
          <Mascot config={mascot} mood={overdue.length > 0 ? 'thinking' : 'idle'} size={56} />
          <div className="min-w-0 flex-1 basis-52">
            <div className="set-mono set-mono-dim mb-1">
              {space ? space.name.toUpperCase() : 'WORKSPACE'} · {new Date().toLocaleDateString('en', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()}
            </div>
            <h1 className="text-2xl font-bold text-white">
              {new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'}, {user?.name?.split(' ')[0]}
            </h1>
            <p className="text-sm text-set-dim">
              {overdue.length > 0
                ? `${overdue.length} assignment${overdue.length > 1 ? 's' : ''} overdue — let's catch up.`
                : openTasks > 0
                  ? `${openTasks} open task${openTasks > 1 ? 's' : ''} across your workspace.`
                  : 'All clear. What would you like to work on?'}
            </p>
          </div>
          <button
            className="ml-auto set-btn flex items-center gap-1.5 text-xs shrink-0"
            onClick={() => navigate(`/app/space/${spaceId}/tasks`)}
          >
            <ListTodo size={14} /> My Tasks <ArrowRight size={12} />
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { icon: <FileText size={18} />, label: 'Pages', value: stats?.pages ?? '—', to: `/app/space/${spaceId}/pages` },
          { icon: <BookOpen size={18} />, label: 'Notebooks', value: stats?.notebooks ?? '—', to: `/app/space/${spaceId}/notebooks` },
          { icon: <Database size={18} />, label: 'Databases', value: stats?.databases ?? '—', to: `/app/space/${spaceId}/databases` },
          { icon: <ListTodo size={18} />, label: 'My Tasks', value: openTasks, to: `/app/space/${spaceId}/tasks` },
        ].map((card, i) => (
          <button
            key={card.label}
            className="group set-card p-4 text-left hover:border-set-accent/40 transition-all hover:-translate-y-0.5 hover:shadow-pop"
            onClick={() => navigate(card.to)}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-set-dim group-hover:text-set-accent transition-colors">{card.icon}</span>
              <span className="set-mono set-mono-dim opacity-60">{String(i + 1).padStart(2, '0')}</span>
            </div>
            <div className="text-2xl font-bold text-white set-mono-num">{card.value}</div>
            <div className="set-mono set-mono-dim">{card.label}</div>
          </button>
        ))}
      </div>

      {/* Charts row — hidden entirely until there is something to show */}
      {(mcpData.length > 0 || chartData.some((d) => d.events > 0)) && (
      <div className={`grid gap-4 mb-6 ${mcpData.length > 0 && chartData.some((d) => d.events > 0) ? 'lg:grid-cols-2' : ''}`}>
        {/* Activity chart (dithered area) */}
        <div className="set-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={15} className="text-blue-300" />
            <h3 className="set-mono set-mono-dim">Activity — last 7 days</h3>
          </div>
          {chartData.some((d) => d.events > 0) ? (
            <ErrorBoundary>
              <div className="rounded-xl border border-set-border overflow-hidden h-60">
                <AreaChart data={chartData} config={{ events: { label: 'Events', color: 'blue' }, pages: { label: 'Pages created', color: 'purple' } }} bloom="low">
                  <XAxis dataKey="day" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Area dataKey="events" variant="gradient" />
                  <Area dataKey="pages" variant="dotted" />
                </AreaChart>
              </div>
            </ErrorBoundary>
          ) : (
            <p className="text-sm text-set-dim py-8 text-center">No activity yet — start creating pages or commenting.</p>
          )}
        </div>

        {/* MCP tool usage (dithered bars) */}
        <div className="set-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={15} className="text-violet-300" />
            <h3 className="set-mono set-mono-dim">Agent tool usage</h3>
          </div>
          {mcpData.length > 0 && chartData.some((d) => d.events > 0) ? (
            <ErrorBoundary>
              <div className="rounded-xl border border-set-border overflow-hidden h-60">
                <BarChart data={mcpData} config={{ calls: { label: 'Calls', color: 'green' }, success: { label: 'Success %', color: 'blue' } }} bloom="low">
                  <XAxis dataKey="tool" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="calls" variant="gradient" />
                  <Bar dataKey="success" variant="dotted" />
                </BarChart>
              </div>
            </ErrorBoundary>
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm text-set-dim mb-3">No agent calls yet.</p>
              <a href="/agents" className="set-btn text-xs inline-flex items-center gap-1.5">
                <Sparkles size={12} /> Connect an agent
              </a>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Bottom row: tasks + activity feed */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* My assignments */}
        <div className="set-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <ListTodo size={15} className="text-green-300" />
            <h3 className="set-mono set-mono-dim">My assignments</h3>
          </div>
          {(tasks?.paths ?? []).length === 0 && (
            <div className="flex items-center gap-3 py-1">
              <DitherAvatar name={space?.name ?? 'set'} hue={222} size={28} className="rounded shrink-0 opacity-70" />
              <p className="text-sm text-set-dim">No assignments.</p>
            </div>
          )}
          {(tasks?.paths ?? []).slice(0, 4).map((p: any) => {
            const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
            const isOverdue = p.due_date && new Date(p.due_date) < new Date() && pct < 100;
            return (
              <button
                key={p.id}
                className="w-full text-left py-2 border-t border-set-border/40 first:border-t-0 hover:bg-set-panel2/30 px-1 rounded"
                onClick={() => navigate(`/app/space/${spaceId}/paths`)}
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white truncate">{p.title}</span>
                  {p.due_date && (
                    <span className={`text-xs ml-2 shrink-0 ${isOverdue ? 'text-red-400' : 'text-set-dim'}`}>
                      {new Date(p.due_date).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 h-1 bg-set-panel2 rounded-full overflow-hidden">
                  <div className={`h-full ${isOverdue ? 'bg-red-500/70' : 'bg-green-500/70'}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="text-[10px] text-set-dim mt-0.5">{p.done}/{p.total} complete</div>
              </button>
            );
          })}
        </div>

        {/* Recent activity */}
        <div className="set-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users size={15} className="text-amber-300" />
            <h3 className="set-mono set-mono-dim">Recent activity</h3>
          </div>
          {activity.length === 0 && (
            <div className="flex items-center gap-3 py-1">
              <DitherAvatar name={(user?.name ?? 'set') + ':act'} hue={222} size={28} className="rounded shrink-0 opacity-70" />
              <p className="text-sm text-set-dim">Nothing yet.</p>
            </div>
          )}
          {activity.slice(0, 6).map((a, i) => (
            <div key={i} className="flex items-start gap-2.5 py-1.5 border-t border-set-border/30 first:border-t-0 text-sm">
              <Bell size={12} className="mt-1 text-set-dim shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="text-white">{a.actor_name || a.actor}</span>{' '}
                <span className="text-set-dim">{a.type.replace(/_/g, ' ')}</span>
              </span>
              <span className="text-[10px] text-set-dim shrink-0">
                {new Date(a.created_at).toLocaleDateString()}
              </span>
            </div>
          ))}
          <button
            className="set-btn-ghost text-xs mt-2 w-full flex items-center justify-center gap-1"
            onClick={() => navigate(`/app/space/${spaceId}/activity`)}
          >
            View all <ArrowRight size={11} />
          </button>
        </div>
      </div>
    </div>
    </PullToRefresh>
  );
}


/** Slim progress fill for the collapsed onboarding checklist. */
function ChecklistProgress({ className }: { className?: string }) {
  const onboarding = (useApp.getState() as any)?.user?.onboarding;
  const steps = ['page', 'notebook', 'chat', 'surface'] as const;
  const done = steps.filter((k) => (onboarding ?? {})[k]).length;
  return <span className={className} style={{ width: `${(done / steps.length) * 100}%` }} />;
}
