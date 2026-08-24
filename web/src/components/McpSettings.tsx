import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Plug, Activity, ScrollText, KeyRound, Ban, Copy, Check } from 'lucide-react';

/** Settings → MCP: endpoint info, connected clients, tokens, analytics, logs. */
export default function McpSettings() {
  const { spaceId } = useParams();
  const [stats, setStats] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [tokens, setTokens] = useState<any[]>([]);
  const [tab, setTab] = useState<'analytics' | 'logs' | 'tokens'>('analytics');
  const [copied, setCopied] = useState(false);
  const mcpUrl = `${window.location.origin}/api/mcp`;

  const load = async () => {
    if (!spaceId) return;
    const s = await api.get(`/spaces/${spaceId}/mcp/stats`).catch(() => null);
    setStats(s);
    const l = await api.get(`/spaces/${spaceId}/mcp/logs`).catch(() => ({ logs: [] }));
    setLogs(l.logs ?? []);
    const t = await api.get(`/spaces/${spaceId}/mcp/tokens`).catch(() => ({ tokens: [] }));
    setTokens(t.tokens ?? []);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  const copy = async () => {
    await navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const maxCalls = Math.max(1, ...(stats?.perTool ?? []).map((t: any) => t.calls));

  return (
    <div>
      <p className="text-sm text-set-dim mb-4">
        Connect AI clients (Claude, ChatGPT, Cursor, custom agents) to this workspace over the Model Context Protocol.
        Users approve each client and choose its access level at consent.
      </p>

      {/* Endpoint card */}
      <div className="set-card p-4 mb-4">
        <div className="text-xs uppercase tracking-widest text-set-dim mb-2 flex items-center gap-1.5"><Plug size={12} /> MCP endpoint</div>
        <div className="flex items-center gap-2">
          <code className="flex-1 font-mono text-xs bg-set-panel2 rounded px-2.5 py-2 truncate border border-set-border">{mcpUrl}</code>
          <button className="set-btn text-xs flex items-center gap-1 shrink-0" onClick={copy}>
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="text-[11px] text-set-dim mt-2">
          Quickstart and client guides: <a href="/agents" target="_blank" className="text-set-accent hover:underline">/agents</a> ·
          Machine-readable manifest: <a href="/api/mcp/docs.json" target="_blank" className="text-set-accent hover:underline">/api/mcp/docs.json</a>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <div className="set-card p-3 text-center">
          <div className="text-xl font-bold text-white">{stats?.totals?.calls_7d ?? 0}</div>
          <div className="text-[10px] text-set-dim uppercase">calls (7d)</div>
        </div>
        <div className="set-card p-3 text-center">
          <div className="text-xl font-bold text-white">{stats?.totals?.success_rate ?? 100}%</div>
          <div className="text-[10px] text-set-dim uppercase">success</div>
        </div>
        <div className="set-card p-3 text-center">
          <div className="text-xl font-bold text-white">{stats?.clients?.length ?? 0}</div>
          <div className="text-[10px] text-set-dim uppercase">clients</div>
        </div>
        <div className="set-card p-3 text-center">
          <div className="text-xl font-bold text-white">{tokens.length}</div>
          <div className="text-[10px] text-set-dim uppercase">active tokens</div>
        </div>
      </div>

      <div className="flex gap-1 mb-3">
        {([['analytics', 'Analytics', <Activity key="a" size={13} />], ['logs', 'Logs', <ScrollText key="b" size={13} />], ['tokens', 'Access', <KeyRound key="c" size={13} />]] as const).map(([id, label, icon]) => (
          <button key={id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm ${tab === id ? 'bg-set-accent/20 text-blue-200' : 'text-set-dim hover:text-set-text'}`} onClick={() => setTab(id as any)}>
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === 'analytics' && (
        <div className="set-card p-4">
          {(stats?.perTool ?? []).length === 0 && <p className="text-sm text-set-dim">No tool calls in the last 7 days. Connect a client at <a className="text-set-accent" href="/agents" target="_blank">/agents</a> to begin.</p>}
          {(stats?.perTool ?? []).map((t: any) => (
            <div key={t.tool} className="mb-3">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-mono text-set-text">{t.tool}</span>
                <span className="text-set-dim">{t.calls} calls · {t.success_rate}% ok · p95 {t.p95}ms</span>
              </div>
              <div className="h-1.5 bg-set-panel2 rounded-full overflow-hidden">
                <div className="h-full bg-set-accent/70" style={{ width: `${(t.calls / maxCalls) * 100}%` }} />
              </div>
            </div>
          ))}
          {(stats?.clients ?? []).length > 0 && (
            <div className="mt-4">
              <div className="text-xs uppercase text-set-dim mb-2">Connected clients</div>
              {stats.clients.map((c: any) => (
                <div key={c.client_id} className="flex items-center justify-between text-sm py-1 border-t border-set-border/40">
                  <span className="text-white">{c.client_name}</span>
                  <span className="text-xs text-set-dim">{c.active_tokens} token(s) · last seen {c.last_seen_at ? new Date(c.last_seen_at).toLocaleDateString() : 'never'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'logs' && (
        <div className="set-card divide-y divide-set-border/50 max-h-96 overflow-y-auto">
          {logs.length === 0 && <div className="p-4 text-sm text-set-dim">No calls logged yet.</div>}
          {logs.map((l, i) => (
            <div key={i} className="px-3 py-2 flex items-start gap-2 text-xs">
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${l.ok ? 'bg-green-400' : 'bg-red-400'}`} />
              <div className="flex-1 min-w-0">
                <div>
                  <span className="font-mono text-set-text">{l.tool}</span>
                  <span className="text-set-dim"> · {l.client_name ?? l.user_name ?? 'unknown'} · {l.duration_ms}ms · {new Date(l.created_at).toLocaleString()}</span>
                </div>
                {l.error && <div className="text-red-400/80 break-words">{l.error}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'tokens' && (
        <div className="set-card divide-y divide-set-border/50">
          {tokens.length === 0 && <div className="p-4 text-sm text-set-dim">No active access tokens. Tokens appear here after a client completes OAuth consent.</div>}
          {tokens.map((t) => (
            <div key={t.id} className="px-3 py-2.5 flex items-center gap-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="text-white truncate">{t.client_name ?? t.client_id.slice(0, 12)}</div>
                <div className="text-[11px] text-set-dim">
                  {t.scope.replace('mcp:read mcp:write', 'read+write').replace('mcp:read', 'read-only')} ·
                  granted {new Date(t.created_at).toLocaleDateString()} ·
                  last used {t.last_used_at ? new Date(t.last_used_at).toLocaleString() : 'never'}
                </div>
              </div>
              <button
                className="set-btn text-xs flex items-center gap-1 text-red-300 shrink-0"
                onClick={async () => {
                  if (!confirm(`Revoke access for ${t.client_name ?? 'this client'}? Connected agents stop working immediately.`)) return;
                  await api.post(`/spaces/${spaceId}/mcp/tokens/${t.id}/revoke`);
                  load();
                }}
              >
                <Ban size={12} /> Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
