import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../stores/app';
import Mascot, { DEFAULT_MASCOT, type MascotConfig } from '../components/Mascot';
// @ts-nocheck
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from '../components/DitherChart';
import {
  FileText, BookOpen, Database, Users, Bell, ListTodo, ArrowRight, Sparkles, TrendingUp,
} from 'lucide-react';

/** Space dashboard: the home view with dithered analytics, tasks, and quick actions. */
export default function DashboardView() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const { user, spaces } = useApp();
  const [stats, setStats] = useState<any>(null);
  const [tasks, setTasks] = useState<any>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [mcpStats, setMcpStats] = useState<any>(null);
  const mascot: MascotConfig = (user as any)?.mascot ?? DEFAULT_MASCOT;
  const space = spaces.find((s) => s.id === spaceId);

  useEffect(() => {
    if (!spaceId) return;
    (async () => {
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
    })();
  }, [spaceId]);

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
    <div className="p-4 sm:p-6 max-w-6xl mx-auto pb-24">
      {/* Hero greeting */}
      <div className="flex items-center gap-4 mb-6">
        <Mascot config={mascot} mood={overdue.length > 0 ? 'thinking' : 'idle'} size={56} />
        <div>
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
          className="ml-auto set-btn flex items-center gap-1.5 text-xs"
          onClick={() => navigate(`/app/space/${spaceId}/tasks`)}
        >
          <ListTodo size={14} /> My Tasks <ArrowRight size={12} />
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { icon: <FileText size={18} />, label: 'Pages', value: stats?.pages ?? '—', to: `/app/space/${spaceId}/page` },
          { icon: <BookOpen size={18} />, label: 'Notebooks', value: stats?.notebooks ?? '—', to: `/app/space/${spaceId}/notebooks` },
          { icon: <Database size={18} />, label: 'Databases', value: stats?.databases ?? '—', to: `/app/space/${spaceId}` },
          { icon: <ListTodo size={18} />, label: 'My Tasks', value: openTasks, to: `/app/space/${spaceId}/tasks` },
        ].map((card) => (
          <button
            key={card.label}
            className="set-card p-4 text-left hover:border-set-accent/40 transition-colors"
            onClick={() => navigate(card.to)}
          >
            <div className="text-set-dim mb-2">{card.icon}</div>
            <div className="text-2xl font-bold text-white">{card.value}</div>
            <div className="text-[11px] text-set-dim uppercase tracking-wide">{card.label}</div>
          </button>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        {/* Activity chart (dithered area) */}
        <div className="set-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={15} className="text-blue-300" />
            <h3 className="text-sm font-semibold text-white">Activity — last 7 days</h3>
          </div>
          {chartData.some((d) => d.events > 0) ? (
            <div className="rounded-xl border border-set-border overflow-hidden">
              <AreaChart data={chartData} config={{ events: { label: 'Events', color: 'blue' }, pages: { label: 'Pages created', color: 'purple' } }} bloom="low">
                <XAxis dataKey="day" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Area dataKey="events" variant="gradient" />
                <Area dataKey="pages" variant="dotted" />
              </AreaChart>
            </div>
          ) : (
            <p className="text-sm text-set-dim py-8 text-center">No activity yet — start creating pages or commenting.</p>
          )}
        </div>

        {/* MCP tool usage (dithered bars) */}
        <div className="set-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={15} className="text-violet-300" />
            <h3 className="text-sm font-semibold text-white">Agent tool usage</h3>
          </div>
          {mcpData.length > 0 ? (
            <div className="rounded-xl border border-set-border overflow-hidden">
              <BarChart data={mcpData} config={{ calls: { label: 'Calls', color: 'green' }, success: { label: 'Success %', color: 'blue' } }} bloom="low">
                <XAxis dataKey="tool" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="calls" variant="gradient" />
                <Bar dataKey="success" variant="dotted" />
              </BarChart>
            </div>
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

      {/* Bottom row: tasks + activity feed */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* My assignments */}
        <div className="set-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <ListTodo size={15} className="text-green-300" />
            <h3 className="text-sm font-semibold text-white">My assignments</h3>
          </div>
          {(tasks?.paths ?? []).length === 0 && <p className="text-sm text-set-dim">No assignments.</p>}
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
            <h3 className="text-sm font-semibold text-white">Recent activity</h3>
          </div>
          {activity.length === 0 && <p className="text-sm text-set-dim">Nothing yet.</p>}
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
  );
}
