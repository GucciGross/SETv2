import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Plus, Zap, ShieldCheck, Users, Cpu, Check, LayoutGrid, Cat, Dices, PackagePlus, PackageMinus, Plug, Sparkles, Radio, Unlink, Telescope, LayoutTemplate, MonitorSmartphone, Copy, Terminal, HeartPulse, Camera, Gauge, Cloud, Scissors, Trash2, Bell, Upload, CreditCard, Coins, Download, CloudSun } from 'lucide-react';
import { useApp } from '../stores/app';
import Mascot, { DEFAULT_MASCOT, type MascotConfig } from '../components/Mascot';
import McpSettings from '../components/McpSettings';
import SkillsSettings from '../components/SkillsSettings';
import { DitherButton } from '../components/dither-kit';

export default function SettingsView() {
  const { spaceId } = useParams();
  const [tab, setTab] = useState<'surfaces' | 'skills' | 'mcp' | 'channels' | 'mascot' | 'providers' | 'members' | 'workspace' | 'research' | 'companion' | 'clipper' | 'notifications' | 'billing'>('surfaces');

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-4">Settings</h1>
      <div className="flex flex-wrap gap-1 mb-4">
        {([
          ['surfaces', 'Work surfaces', <LayoutGrid key="z" size={14} />],
          ['skills', 'Skills', <Sparkles key="y" size={14} />],
          ['mcp', 'MCP', <Plug key="z" size={14} />],
          ['channels', 'Channels', <Radio key="ch" size={14} />],
          ['mascot', 'Mascot', <Cat key="m" size={14} />],
          ['providers', 'AI Providers', <Cpu key="a" size={14} />],
          ['members', 'Members', <Users key="b" size={14} />],
          ['workspace', 'Workspace', <ShieldCheck key="c" size={14} />],
          ['research', 'Deep Research', <Telescope key="r" size={14} />],
          ['companion', 'Companion', <MonitorSmartphone key="cp" size={14} />],
          ['clipper', 'Clipper', <Scissors key="cli" size={14} />],
          ['notifications', 'Notifications', <Bell key="nt" size={14} />],
          ['billing', 'Billing', <CreditCard key="bl" size={14} />],
        ] as const).map(([id, label, icon]) => (
          <button key={id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm ${tab === id ? 'bg-set-accent/20 text-blue-200' : 'text-set-dim hover:text-set-text'}`} onClick={() => setTab(id)}>
            {icon} {label}
          </button>
        ))}
      </div>
      {tab === 'surfaces' && <SurfacesTab spaceId={spaceId!} />}
      {tab === 'skills' && <SkillsSettings />}
      {tab === 'mcp' && <McpSettings />}
      {tab === 'channels' && <ChannelsTab spaceId={spaceId!} />}
      {tab === 'mascot' && <MascotTab />}
      {tab === 'providers' && <ProvidersTab spaceId={spaceId!} />}
      {tab === 'members' && <MembersTab spaceId={spaceId!} />}
      {tab === 'workspace' && <WorkspaceTab spaceId={spaceId!} />}
      {tab === 'research' && <ResearchTab spaceId={spaceId!} />}
      {tab === 'companion' && <CompanionTab spaceId={spaceId!} />}
      {tab === 'clipper' && <ClipperTab />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'billing' && <BillingTab spaceId={spaceId!} />}
    </div>
  );
}

const SURFACES: { key: string; name: string; description: string; core?: boolean }[] = [
  { key: 'core', name: 'Pages / Graph / Databases / Notebooks / Copilot', description: 'The SET knowledge core - always on.', core: true },
  { key: 'coding', name: 'Coding', description: 'Code files with an editor and a sandboxed JavaScript runner' },
  { key: 'terminal', name: 'Terminal', description: 'Workspace console: search pages, query notebooks, run snippets' },
  { key: 'paths', name: 'Learning Paths', description: 'Ordered curricula with per-member progress tracking' },
  { key: 'threeD', name: '3D & CAD', description: 'Interactive 3D learning: GLB/STL/OBJ models, URDF robotics, STEP import' },
  { key: 'library', name: 'Library', description: 'Browse and import open datasets from the HuggingFace Hub (CAD corpora, textbooks, 3D models)' },
  { key: 'canvas', name: 'Canvas', description: 'Experimental infinite-canvas spatial view over your pages' },
  { key: 'wandgx', name: 'WandGx Builder', description: 'Create apps from prompts through a connected WandGx instance — repo, Docker setup and live URL land back on your pages' },
];

function ChannelsTab({ spaceId }: { spaceId: string }) {
  const [data, setData] = useState<{ links: any[]; service: { online: boolean; lastSeen: number | null; channelCode: string | null } } | null>(null);
  const [platformId, setPlatformId] = useState('');
  const [platformName, setPlatformName] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => setData(await api.get(`/spaces/${spaceId}/channels`));
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000); // service heartbeat refresh
    return () => clearInterval(t);
  }, [spaceId]);

  const link = async () => {
    setMsg(null);
    try {
      await api.post(`/spaces/${spaceId}/channels`, { platform: 'slack', platformId, platformName: platformName || undefined });
      setPlatformId('');
      setPlatformName('');
      setMsg({ ok: true, text: 'Workspace linked — mention the bot in Slack to talk to SET.' });
      load();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
  };

  const service = data?.service;

  return (
    <div className="space-y-4">
      <p className="text-sm text-set-dim">
        Let teammates talk to this workspace from Slack — capture notes, search pages and pull answers without leaving the chat.
        Runs through the CopilotKit Channels listener (<code className="text-violet-300">channels</code> service in docker compose, profile <code className="text-violet-300">channels</code>).
      </p>

      <div className="set-card p-4 flex flex-wrap items-center gap-3">
        <span className={`w-2.5 h-2.5 rounded-full ${service?.online ? 'bg-green-400 animate-pulse' : 'bg-set-dim'}`} />
        <div className="flex-1">
          <div className="text-sm text-white">Channel service {service?.online ? 'online' : 'offline'}</div>
          <div className="text-xs text-set-dim">
            {service?.online
              ? `Connected${service.channelCode ? ` as “${service.channelCode}”` : ''} — last heartbeat ${service.lastSeen ? new Date(service.lastSeen).toLocaleTimeString() : '—'}`
              : 'Start it with: docker compose --profile channels up -d (needs INTELLIGENCE_API_KEY + CHANNEL_CODE from your CopilotKit Intelligence project).'}
          </div>
        </div>
      </div>

      <div className="set-card p-4">
        <div className="text-sm font-medium text-white mb-2">Link a Slack workspace</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
          <input className="set-input" placeholder="Slack team/workspace ID (e.g. T0123ABCDEF)" value={platformId} onChange={(e) => setPlatformId(e.target.value)} />
          <input className="set-input" placeholder="Display name (e.g. Acme HQ)" value={platformName} onChange={(e) => setPlatformName(e.target.value)} />
        </div>
        <DitherButton color="purple" variant="gradient" className="rounded-lg text-sm text-white px-3 py-2 border border-set-border" onClick={link} disabled={platformId.trim().length < 2}>
          Link workspace
        </DitherButton>
        <p className="text-xs text-set-dim mt-2">
          The team ID is in your Slack workspace URL/“About this workspace” — messages from that workspace will read and write <em>this</em> SET space, attributed to you as the linking owner.
        </p>
        {msg && <p className={`text-xs mt-2 ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>}
      </div>

      <div className="space-y-2">
        {(data?.links ?? []).map((l: any) => (
          <div key={l.id} className="set-card p-3 flex items-center gap-3">
            <Radio size={15} className="text-violet-300" />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-white">{l.platform_name || l.platform_id} <span className="text-xs text-set-dim uppercase">{l.platform}</span></div>
              <div className="text-xs text-set-dim">linked {new Date(l.created_at).toLocaleDateString()} by {l.linked_by_name ?? '—'}</div>
            </div>
            <button
              className="set-btn-ghost hover:text-red-400 text-xs flex items-center gap-1"
              onClick={async () => {
                if (confirm('Unlink this Slack workspace?')) {
                  await api.del(`/spaces/${spaceId}/channels/${l.id}`);
                  load();
                }
              }}
            >
              <Unlink size={12} /> Unlink
            </button>
          </div>
        ))}
        {data && data.links.length === 0 && <p className="text-sm text-set-dim">No Slack workspaces linked yet.</p>}
      </div>
    </div>
  );
}

function MascotTab() {
  const { user } = useApp();
  const [cfg, setCfg] = useState<MascotConfig>((user as any)?.mascot ?? DEFAULT_MASCOT);
  const [mood, setMood] = useState<'idle' | 'thinking' | 'talking' | 'celebrating'>('idle');
  const [saved, setSaved] = useState(false);

  const save = async () => {
    await api.put('/users/mascot', cfg);
    useApp.setState({ user: { ...(user as any), mascot: cfg } });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const randomize = () => {
    const pick = <T,>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];
    // harmonious pairs: body at full-ish saturation, accent hue-shifted so the
    // combo always reads well together (pure-random hex tends to go muddy)
    const h = Math.floor(Math.random() * 360);
    const hsl = (hue: number, s: number, l: number) => {
      const a = s * Math.min(l, 1 - l);
      const f = (n: number) => {
        const k = (n + hue / 30) % 12;
        const c = l - a * Math.max(-1, Math.min(Math.min(k - 3, 9 - k), 1));
        return Math.round(255 * c).toString(16).padStart(2, '0');
      };
      return `#${f(0)}${f(8)}${f(4)}`;
    };
    const shift = pick([150, 180, 210, -30, 30]);
    setCfg({
      name: pick(['Pixel', 'Maus', 'Bit', 'Nova', 'Gears', 'Sprout', 'Ziggy', 'Tinker', 'Ember', 'Waffle', 'Comet', 'Juno', 'Rune', 'Pip', 'Bolt', 'Fern', 'Echo', 'Mochi', 'Clank', 'Widget']),
      species: pick(['bot', 'cat', 'blob', 'mouse', 'dog', 'fox', 'bird', 'dragon', 'ghost', 'bloub'] as const),
      bodyColor: hsl(h, 0.65, 0.66),
      accentColor: hsl((h + shift + 360) % 360, 0.72, 0.58),
      eyes: pick(['normal', 'happy', 'sleepy', 'visor'] as const),
      accessory: pick(['none', 'antenna', 'halo', 'headphones', 'hardhat', 'party', 'scarf', 'bow'] as const),
      enabled: cfg.enabled,
    });
  };

  const Row = ({ label, children }: any) => (
    <label className="flex items-center gap-3 text-sm">
      <span className="w-28 text-set-dim">{label}</span>
      {children}
    </label>
  );

  return (
    <div>
      <p className="text-sm text-set-dim mb-4">
        Your copilot's desk pet — it reacts while the agent thinks, talks and celebrates. Yours everywhere, on every device you sign in from.
      </p>
      <div className="set-card p-3.5 mb-4 flex items-center gap-3">
        <button
          onClick={() => setCfg({ ...cfg, enabled: cfg.enabled === false })}
          className={`w-10 h-6 rounded-full relative transition-colors shrink-0 ${cfg.enabled === false ? 'bg-set-panel2 border border-set-border' : 'bg-set-accent'}`}
          aria-label="Toggle mascot"
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-150 ${cfg.enabled === false ? 'translate-x-0' : 'translate-x-[16px]'}`} />
        </button>
        <div className="flex-1">
          <div className="text-sm text-white">Show mascot</div>
          <div className="text-xs text-set-dim">Turn off to hide the desk pet everywhere. The copilot itself keeps working.</div>
        </div>
        <button className="set-btn text-xs" onClick={async () => {
          await api.put('/users/mascot', cfg);
          useApp.setState({ user: { ...(user as any), mascot: cfg } });
        }}>Apply now</button>
      </div>
      <div className="set-card p-5 flex flex-col sm:flex-row gap-6 items-center sm:items-start">
        <div className="flex flex-col items-center gap-3 shrink-0">
          <div className="rounded-2xl bg-set-panel2 border border-set-border p-5">
            <Mascot config={cfg} mood={mood} size={130} preview />
          </div>
          <div className="text-sm font-medium">{cfg.name}</div>
          <div className="flex gap-1">
            {(['idle', 'thinking', 'talking', 'celebrating'] as const).map((m) => (
              <button
                key={m}
                className={`text-[10px] px-2 py-1 rounded ${mood === m ? 'bg-set-accent/25 text-blue-200' : 'text-set-dim hover:text-set-text'}`}
                onClick={() => setMood(m)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 space-y-3 w-full">
          <Row label="Name">
            <input className="set-input" value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} maxLength={40} />
          </Row>
          <Row label="Species">
            <select className="set-input" value={cfg.species} onChange={(e) => setCfg({ ...cfg, species: e.target.value as any })}>
              <option value="bot">Bot</option>
              <option value="cat">Cat</option>
              <option value="blob">Blob</option>
              <option value="mouse">Mouse</option>
              <option value="dog">Dog</option>
              <option value="fox">Fox</option>
              <option value="bird">Bird</option>
              <option value="dragon">Dragon</option>
              <option value="ghost">Ghost</option>
              <option value="bloub">Bloub (morphing blob)</option>
            </select>
          </Row>
          <Row label="Body color">
            <input type="color" className="w-12 h-8 rounded bg-transparent cursor-pointer" value={cfg.bodyColor} onChange={(e) => setCfg({ ...cfg, bodyColor: e.target.value })} />
            <code className="text-xs text-set-dim">{cfg.bodyColor}</code>
          </Row>
          <Row label="Accent color">
            <input type="color" className="w-12 h-8 rounded bg-transparent cursor-pointer" value={cfg.accentColor} onChange={(e) => setCfg({ ...cfg, accentColor: e.target.value })} />
            <code className="text-xs text-set-dim">{cfg.accentColor}</code>
          </Row>
          <Row label="Eyes">
            <select className="set-input" value={cfg.eyes} onChange={(e) => setCfg({ ...cfg, eyes: e.target.value as any })}>
              <option value="normal">Normal</option>
              <option value="happy">Happy</option>
              <option value="sleepy">Sleepy</option>
              <option value="visor">Visor</option>
            </select>
          </Row>
          <Row label="Accessory">
            <select className="set-input" value={cfg.accessory} onChange={(e) => setCfg({ ...cfg, accessory: e.target.value as any })}>
              <option value="none">None</option>
              <option value="antenna">Antenna</option>
              <option value="halo">Halo</option>
              <option value="headphones">Headphones</option>
              <option value="hardhat">Hard hat</option>
              <option value="party">Party hat</option>
              <option value="scarf">Scarf</option>
              <option value="bow">Bow</option>
            </select>
          </Row>
          <div className="flex gap-2 pt-1">
            <button className="set-btn-primary text-xs" onClick={save}>{saved ? 'Saved' : 'Save mascot'}</button>
            <button className="set-btn text-xs flex items-center gap-1" onClick={randomize}><Dices size={13} /> Randomize</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SurfacesTab({ spaceId }: { spaceId: string }) {
  const { surfaces, loadSurfaces } = useApp();
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (key: string) => {
    setBusy(key);
    try {
      const { settings } = await api.get(`/spaces/${spaceId}/settings`);
      const next = { ...(settings?.surfaces ?? {}), [key]: !surfaces[key] };
      await api.patch(`/spaces/${spaceId}/settings`, { settings: { surfaces: next } });
      await loadSurfaces(spaceId);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <p className="text-sm text-set-dim mb-4">
        SET ships a complete knowledge core; every other work surface is optional and toggleable per workspace.
      </p>
      <div className="space-y-2">
        {SURFACES.map((s) => {
          const on = s.core ? true : !!surfaces[s.key];
          return (
            <div key={s.key} className="set-card p-3.5 flex flex-wrap items-center gap-3">
              <button
                disabled={s.core || busy === s.key}
                onClick={() => toggle(s.key)}
                className={`w-10 h-6 rounded-full relative transition-colors shrink-0 ${on ? 'bg-set-accent' : 'bg-set-panel2 border border-set-border'} ${s.core ? 'opacity-60 cursor-default' : 'cursor-pointer'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-150 ${on ? 'translate-x-[16px]' : 'translate-x-0'}`} />
              </button>
              <div className="flex-1 min-w-[55%]">
                <div className="text-sm text-white">{s.name}</div>
                <div className="text-xs text-set-dim">{s.description}</div>
              </div>
              <span className={`text-xs ${on ? 'text-green-400' : 'text-set-dim'}`}>{on ? 'enabled' : 'off'}</span>
            </div>
          );
        })}
      </div>
      {surfaces.wandgx && <WandgxCard spaceId={spaceId} />}
    </div>
  );
}

/** WandGx connection status + recent builds (wandgx surface enabled). */
function WandgxCard({ spaceId }: { spaceId: string }) {
  const [status, setStatus] = useState<any>(null);
  const [builds, setBuilds] = useState<any[]>([]);

  useEffect(() => {
    api.get(`/spaces/${spaceId}/wandgx/status`).then(setStatus).catch(() => setStatus({ configured: false }));
    api.get(`/spaces/${spaceId}/wandgx/builds`).then((r) => setBuilds(r.builds ?? [])).catch(() => {});
  }, [spaceId]);

  const color = status?.reachable ? 'bg-green-400' : status?.configured ? 'bg-red-400' : 'bg-amber-400';
  const label = status?.reachable ? 'connected' : status?.configured ? `unreachable${status.detail ? ` (${status.detail})` : ''}` : 'not configured — set WANDGX_URL / WANDGX_TOKEN on the server';

  return (
    <div className="set-card p-3.5 mt-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full ${color}`} />
        <span className="text-sm text-white">WandGx Builder</span>
        <span className="text-xs text-set-dim truncate">{label}</span>
      </div>
      {builds.length > 0 ? (
        <div className="space-y-1">
          {builds.slice(0, 5).map((b) => (
            <div key={b.id} className="flex items-center gap-2 text-xs">
              <span className={`truncate flex-1 ${b.status === 'error' ? 'text-red-400' : 'text-set-text'}`}>{b.title}</span>
              <span className="text-set-dim whitespace-nowrap">{b.status}</span>
              {b.live_url && <a className="text-blue-300 hover:underline" href={b.live_url} target="_blank" rel="noreferrer">live</a>}
              {b.repo_url && <a className="text-blue-300 hover:underline" href={b.repo_url} target="_blank" rel="noreferrer">repo</a>}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-set-dim">No builds yet — open a page and hit “build”, or ask the copilot to build something.</p>
      )}
    </div>
  );
}

function ProvidersTab({ spaceId }: { spaceId: string }) {
  const [providers, setProviders] = useState<any[]>([]);
  const [presets, setPresets] = useState<any[]>([]);
  const [gatewayEnabled, setGatewayEnabled] = useState(false);
  const [usage, setUsage] = useState<{ month: string; totals: any[]; daily: any[]; billing: any } | null>(null);
  const [caps, setCaps] = useState({ capTokens: '', capUsd: '' });
  const [capsSaved, setCapsSaved] = useState(false);
  const [platformMsg, setPlatformMsg] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, any>>({});
  const [form, setForm] = useState({ name: '', baseUrl: '', apiKey: '', chatModel: '', embedModel: '', isDefault: false });

  const load = async () => {
    const r = await api.get(`/spaces/${spaceId}/providers`);
    setProviders(r.providers);
    setGatewayEnabled(!!r.gatewayEnabled);
    setPresets((await api.get('/providers/presets')).presets);
    const u = await api.get(`/spaces/${spaceId}/usage`).catch(() => null);
    if (u) {
      setUsage(u);
      setCaps({
        capTokens: u.billing?.capTokens ? String(u.billing.capTokens) : '',
        capUsd: u.billing?.capUsd ? String(u.billing.capUsd) : '',
      });
    }
  };
  useEffect(() => {
    load();
  }, [spaceId]);

  const saveCaps = async () => {
    await api.patch(`/spaces/${spaceId}/settings`, {
      settings: { billing: { capTokens: caps.capTokens ? Number(caps.capTokens) : null, capUsd: caps.capUsd ? Number(caps.capUsd) : null } },
    });
    setCapsSaved(true);
    setTimeout(() => setCapsSaved(false), 1500);
  };

  const enablePlatform = async () => {
    setPlatformMsg(null);
    try {
      await api.post(`/spaces/${spaceId}/providers/platform`, {});
      setPlatformMsg('SET Cloud enabled and set as default provider.');
      load();
    } catch (e: any) {
      setPlatformMsg(e.message);
    }
  };

  const create = async () => {
    if (!form.name || !form.baseUrl) return;
    await api.post(`/spaces/${spaceId}/providers`, {
      ...form,
      apiKey: form.apiKey || null,
      chatModel: form.chatModel || null,
      embedModel: form.embedModel || null,
    });
    setForm({ name: '', baseUrl: '', apiKey: '', chatModel: '', embedModel: '', isDefault: false });
    load();
  };

  const test = async (id: string) => {
    setTestResults((t) => ({ ...t, [id]: 'testing…' }));
    const res = await api.post(`/providers/${id}/test`);
    setTestResults((t) => ({ ...t, [id]: res }));
  };

  const hasCloud = providers.some((p) => p.name === 'SET Cloud (managed)');
  const monthTokens = usage?.totals?.reduce((s: number, t: any) => s + t.total_tokens, 0) ?? 0;
  const monthCost = usage?.totals?.reduce((s: number, t: any) => s + Number(t.cost_usd ?? 0), 0) ?? 0;

  return (
    <div>
      <p className="text-sm text-set-dim mb-3">
        Bring Your Own LLM — any OpenAI-compatible endpoint works. Ollama users: start ollama and use <code className="text-violet-300">http://host.docker.internal:11434/v1</code>.
      </p>

      {/* usage & spend — metered by the LLM gateway (SET Cloud); caps are enforced per calendar month */}
      <div className="set-card p-4 mb-4">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h3 className="text-sm font-semibold text-white flex items-center gap-1.5"><Gauge size={14} /> Usage &amp; spend</h3>
          <span className="text-xs text-set-dim">{usage?.month ?? ''}</span>
          <span className="ml-auto text-xs text-set-dim">{monthTokens.toLocaleString()} tokens{monthCost > 0 ? ` · $${monthCost.toFixed(2)}` : ''} this month</span>
        </div>
        {usage?.totals?.length ? (
          <div className="space-y-1 mb-3">
            {usage.totals.map((t: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs border border-set-border rounded-lg px-2.5 py-1.5">
                <span className={`set-chip text-[10px] border ${t.kind === 'chat' ? 'border-set-accent/40 bg-set-accent/10 text-blue-200' : 'border-set-border bg-set-panel2 text-set-dim'}`}>{t.kind}</span>
                <span className="font-mono text-set-text truncate flex-1">{t.model || '—'}</span>
                <span className="text-set-dim">{t.requests} req · {t.prompt_tokens.toLocaleString()} in / {t.completion_tokens.toLocaleString()} out</span>
                {Number(t.cost_usd) > 0 && <span className="text-amber-300">${Number(t.cost_usd).toFixed(3)}</span>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-set-dim mb-3">No metered usage this month{gatewayEnabled ? '' : ' — usage is metered when the space uses the SET Cloud provider.'}</p>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-set-dim">
            <span className="block mb-1">Token cap / month</span>
            <input className="set-input w-36" type="number" min={0} placeholder="unlimited" value={caps.capTokens} onChange={(e) => setCaps({ ...caps, capTokens: e.target.value })} />
          </label>
          <label className="text-xs text-set-dim">
            <span className="block mb-1">Spend cap ($ / month)</span>
            <input className="set-input w-36" type="number" min={0} step="0.01" placeholder="unlimited" value={caps.capUsd} onChange={(e) => setCaps({ ...caps, capUsd: e.target.value })} />
          </label>
          <button className="set-btn text-xs" onClick={saveCaps}>{capsSaved ? 'Saved' : 'Save caps'}</button>
          <span className="text-[11px] text-set-dim">Caps apply to SET Cloud calls and cut off hard at the limit.</span>
        </div>
      </div>

      {/* managed platform provider — only offered when the server has a gateway configured */}
      {gatewayEnabled && !hasCloud && (
        <div className="set-card p-4 mb-4 flex flex-wrap items-center gap-3">
          <Cloud size={18} className="text-blue-300 shrink-0" />
          <div className="flex-1 min-w-[220px]">
            <div className="text-sm text-white">SET Cloud <span className="set-chip border-set-accent/40 bg-set-accent/10 text-blue-200">managed</span></div>
            <div className="text-xs text-set-dim">Models served by this deployment&apos;s gateway — metered per workspace, capped above, no keys to manage. Your own providers keep working and can take over as default any time.</div>
            {platformMsg && <p className="text-xs mt-1 text-amber-300">{platformMsg}</p>}
          </div>
          <button className="set-btn-primary text-xs" onClick={enablePlatform}>Enable SET Cloud</button>
        </div>
      )}

      <div className="set-card p-4 mb-4">
        <div className="flex flex-wrap gap-1.5 mb-3">
          {presets.map((p) => (
            <button key={p.name} className="set-chip border-set-border bg-set-panel2 hover:border-set-accent/50"
              onClick={() => setForm((f) => ({ ...f, name: p.name, baseUrl: p.baseUrl, chatModel: p.chatModel ?? '', embedModel: p.embedModel ?? '' }))}>
               {p.name}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input className="set-input" placeholder="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <input className="set-input" placeholder="Base URL (https://…/v1)" value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} />
          <input className="set-input" placeholder="API key (optional for local)" value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} />
          <input className="set-input" placeholder="Chat model (e.g. llama3.1)" value={form.chatModel} onChange={(e) => setForm((f) => ({ ...f, chatModel: e.target.value }))} />
          <input className="set-input" placeholder="Embedding model (e.g. nomic-embed-text)" value={form.embedModel} onChange={(e) => setForm((f) => ({ ...f, embedModel: e.target.value }))} />
          <label className="flex items-center gap-2 text-sm text-set-dim">
            <input type="checkbox" className="accent-set-accent" checked={form.isDefault} onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))} />
            Set as default
          </label>
        </div>
        <button className="set-btn-primary mt-3 flex items-center gap-1" onClick={create}><Plus size={14} /> Add provider</button>
      </div>

      <div className="space-y-2">
        {providers.map((p) => {
          const t = testResults[p.id];
          return (
            <div key={p.id} className="set-card p-3 flex items-center gap-3">
              <Cpu size={16} className="text-set-dim" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white flex items-center gap-2">
                  {p.name}
                  {p.is_default && <span className="set-chip border-green-500/40 bg-green-500/10 text-green-300">default</span>}
                </div>
                <div className="text-xs text-set-dim truncate">{p.base_url} · {p.chat_model ?? '—'} · embed: {p.embed_model ?? 'builtin hash'}</div>
                {t && (
                  <div className={`text-xs mt-1 ${t.ok ? 'text-green-400' : typeof t === 'string' ? 'text-amber-300' : 'text-red-400'}`}>
                    {typeof t === 'string' ? t : t.ok ? ` ${t.detail}` : ` ${t.detail}`}
                  </div>
                )}
              </div>
              <button className="set-btn text-xs flex items-center gap-1" onClick={() => test(p.id)}><Zap size={12} /> Test</button>
              {!p.is_default && (
                <button className="set-btn text-xs flex items-center gap-1" onClick={async () => { await api.patch(`/providers/${p.id}`, { isDefault: true }); load(); }}><Check size={12} /> Default</button>
              )}
              <button className="set-btn-ghost hover:text-red-400 text-xs" onClick={async () => { if (confirm('Remove provider?')) { await api.del(`/providers/${p.id}`); load(); } }}></button>
            </div>
          );
        })}
        {providers.length === 0 && <p className="text-sm text-set-dim">No providers — search and RAG embeddings run on built-in hashing (no LLM needed), but chat requires a provider.</p>}
      </div>
    </div>
  );
}

function MembersTab({ spaceId }: { spaceId: string }) {
  const [members, setMembers] = useState<any[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => setMembers((await api.get(`/spaces/${spaceId}/members`)).members);
  useEffect(() => {
    load();
  }, [spaceId]);

  const invite = async () => {
    setMsg(null);
    try {
      const res = await api.post(`/spaces/${spaceId}/invite`, { email, role });
      if (res.added) setMsg({ ok: true, text: `${email} was added to the workspace` });
      else if (res.emailed) setMsg({ ok: true, text: `Invite email sent to ${email}` });
      else setMsg({ ok: true, text: `Email isn't configured on this server — share this invite link: ${res.link}` });
      setEmail('');
      load();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
  };

  const [rosterBusy, setRosterBusy] = useState(false);
  const importRoster = async (file: File) => {
    setMsg(null);
    setRosterBusy(true);
    try {
      const csv = await file.text();
      const res = await api.post(`/spaces/${spaceId}/invite-bulk`, { csv, defaultRole: 'editor' });
      const s = res.summary;
      setMsg({
        ok: true,
        text: `Roster: ${s.added} added, ${s.invited} invited by email${s.already ? `, ${s.already} already members` : ''}${
          res.results.some((r: any) => r.result === 'invited' && !r.emailed) ? ' — email not configured on this server, invite links are in the server log' : ''
        }`,
      });
      load();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setRosterBusy(false);
    }
  };

  return (
    <div>
      <div className="set-card p-4 mb-4 flex flex-wrap gap-2">
        <input className="set-input flex-1 min-w-[220px]" placeholder="teammate@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select className="set-input w-32" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
        <button className="set-btn-primary" onClick={invite}>Invite</button>
      </div>
      <p className="text-xs text-set-dim mb-3 -mt-2 ml-1">Existing users are added instantly; anyone else gets an invite email with a sign-up link.</p>
      <div className="set-card p-4 mb-4 flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[200px]">
          <div className="text-sm text-white">Import a whole roster</div>
          <div className="text-xs text-set-dim">CSV with an email column (header row fine); an optional <code>editor</code>/<code>viewer</code> column sets the role.</div>
        </div>
        <label className="set-btn cursor-pointer text-sm flex items-center gap-1.5">
          <Upload size={13} /> {rosterBusy ? 'Importing…' : 'Upload CSV'}
          <input type="file" hidden accept=".csv,text/csv" disabled={rosterBusy} onChange={(e) => e.target.files?.[0] && importRoster(e.target.files[0])} />
        </label>
      </div>
      {msg && <p className={`text-xs mb-3 break-all ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>}
      <div className="space-y-2">
        {members.map((m) => (
          <div key={m.id} className="set-card p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-set-accent/30 flex items-center justify-center text-sm font-bold text-blue-100">{m.name[0]?.toUpperCase()}</div>
            <div className="flex-1">
              <div className="text-sm text-white">{m.name}</div>
              <div className="text-xs text-set-dim">{m.email}</div>
            </div>
            <select
              className="set-input w-28 text-xs"
              value={m.role}
              onChange={async (e) => { await api.patch(`/spaces/${spaceId}/members/${m.id}`, { role: e.target.value }); load(); }}
            >
              <option value="owner">Owner</option>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkspaceTab({ spaceId }: { spaceId: string }) {
  const { spaces, user, logout } = useApp();
  const [settings, setSettings] = useState<any>({});
  const [templates, setTemplates] = useState<any[]>([]);
  const [tplTitle, setTplTitle] = useState('');
  const [tplMd, setTplMd] = useState('');

  const load = async () => {
    setSettings((await api.get(`/spaces/${spaceId}/settings`)).settings);
    setTemplates((await api.get(`/spaces/${spaceId}/templates`)).templates);
  };
  useEffect(() => {
    load();
  }, [spaceId]);

  const patch = async (s: any) => {
    setSettings(s);
    await api.patch(`/spaces/${spaceId}/settings`, { settings: s });
  };

  const space = spaces.find((s) => s.id === spaceId);

  const exportZip = async () => {
    const res = await api.raw(`/spaces/${spaceId}/export.zip`);
    if (!res.ok) return alert('Export failed');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `set-export-${space?.name?.replace(/[^\w.-]+/g, '_') ?? 'workspace'}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const deleteAccount = async () => {
    if (prompt('This permanently deletes your account, and any workspace you are the sole owner of (all pages, notebooks, databases). Shared workspaces keep their content.\n\nType DELETE to confirm:') !== 'DELETE') return;
    await api.del('/users/me');
    logout();
    window.location.href = '/';
  };

  return (
    <div className="space-y-4">
      <div className="set-card p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <div className="text-sm font-medium text-white">Your data, anytime</div>
          <div className="text-xs text-set-dim">One zip: every page as Markdown (wiki links intact, re-importable), every database as CSV, every notebook's sources + a .bib.</div>
        </div>
        <button className="set-btn text-sm flex items-center gap-1.5" onClick={exportZip}><Download size={13} /> Export workspace (.zip)</button>
      </div>
      <div className="set-card p-4 flex flex-wrap items-center gap-3 border-red-500/20">
        <div className="flex-1 min-w-[220px]">
          <div className="text-sm font-medium text-white">Danger zone</div>
          <div className="text-xs text-set-dim">Deletes your account and every workspace you solely own. Shared workspaces keep their content.</div>
        </div>
        <button className="set-btn text-sm text-red-300 border-red-500/40 hover:border-red-500" onClick={deleteAccount}>Delete account…</button>
      </div>
      <div className="set-card p-4">
        <div className="text-sm font-medium text-white mb-2"> Agent behavior</div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-set-accent"
            checked={!!settings.agentApprovals}
            onChange={(e) => patch({ ...settings, agentApprovals: e.target.checked })}
          />
          Human-in-the-loop: require approval before the copilot writes to the workspace
        </label>
        <p className="text-xs text-set-dim mt-1">When enabled, write tools (create/update pages, generate decks) pause for your approval in the copilot panel.</p>
      </div>

      <div className="set-card p-4">
        <div className="text-sm font-medium text-white mb-2"> Page templates</div>
        <div className="space-y-1 mb-3">
          {templates.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-sm">
              <span></span>
              <span className="flex-1">{t.title}</span>
              <select
                className="set-input w-40 text-xs"
                value={settings.dailyTemplateId === t.id ? 'daily' : ''}
                onChange={(e) => patch(e.target.value ? { ...settings, dailyTemplateId: t.id } : { ...settings, dailyTemplateId: null })}
              >
                <option value="">—</option>
                <option value="daily">Use for daily notes</option>
              </select>
            </div>
          ))}
          {templates.length === 0 && <p className="text-xs text-set-dim">No templates yet.</p>}
        </div>
        <div className="space-y-2">
          <input className="set-input" placeholder="Template title (e.g. Template: Meeting notes)" value={tplTitle} onChange={(e) => setTplTitle(e.target.value)} />
          <textarea className="set-input h-24" placeholder="# Meeting notes\n\nAttendees:\n\n## Agenda" value={tplMd} onChange={(e) => setTplMd(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <button className="set-btn" onClick={async () => {
              if (!tplTitle.trim()) return;
              await api.post(`/spaces/${spaceId}/templates`, { title: tplTitle, markdown: tplMd });
              setTplTitle('');
              setTplMd('');
              load();
            }}>Save template</button>
            <button
              className="set-btn text-xs flex items-center gap-1.5"
              title="Download this space's templates as a shareable kit"
              onClick={async () => {
                const res = await api.raw(`/spaces/${spaceId}/templates/export`);
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'set-template-kit.json';
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <PackageMinus size={13} /> Export kit
            </button>
            <label className="set-btn text-xs flex items-center gap-1.5 cursor-pointer" title="Import templates from a kit file">
              <PackagePlus size={13} /> Import kit
              <input
                type="file"
                accept=".json"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    const kit = JSON.parse(await f.text());
                    const r = await api.post(`/spaces/${spaceId}/templates/import`, kit);
                    alert(`Imported ${r.created} template(s)`);
                    load();
                  } catch (err) {
                    alert('Invalid kit file: ' + (err as any).message);
                  }
                }}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="set-card p-4">
        <div className="text-sm font-medium text-white mb-1"> Data ownership</div>
        <p className="text-xs text-set-dim mb-2">
          {space?.icon} {space?.name} ({space?.kind}) — everything lives in your Postgres + local files.
        </p>
        <a className="set-btn inline-flex items-center gap-1 text-xs" href={`/api/spaces/${spaceId}/export.md`} download> Export all pages (Markdown)</a>
        <button className="set-btn-ghost ml-2 text-xs" onClick={logout}>Sign out ({user?.name})</button>
      </div>
    </div>
  );
}


function ResearchTab({ spaceId }: { spaceId: string }) {
  const [cfg, setCfg] = useState<{ chatModel?: string; visionModel?: string; firecrawlKey?: string; firecrawlUrl?: string; maxPages?: number; maxMinutes?: number; style?: string }>({});
  const [templates, setTemplates] = useState<any[]>([]);
  const [tplDraft, setTplDraft] = useState({ name: '', instructions: '' });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get(`/spaces/${spaceId}/settings`).then(({ settings }) => {
      const r = settings?.research ?? {};
      setTemplates(r.templates ?? []);
      setCfg({ chatModel: r.chatModel ?? '', visionModel: r.visionModel ?? '', style: r.style ?? 'ste', firecrawlKey: r.firecrawlKey ?? '', firecrawlUrl: r.firecrawlUrl ?? '', maxPages: r.maxPages ?? 40, maxMinutes: r.maxMinutes ?? 25 });
    }).catch(() => {});
  }, [spaceId]);

  const save = async () => {
    await api.patch(`/spaces/${spaceId}/settings`, { settings: { research: { ...cfg, templates } } });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div>
      <p className="text-sm text-set-dim mb-4">
        Deep research runs a CrewAI crew that plans, reads the live web and writes a cited
        report into a notebook. Search and page rendering are self-hosted in your stack
        (SearXNG + Playwright) — it works out of the box, no keys needed. The fields below
        optionally route scraping through a Firecrawl-compatible endpoint instead
        (self-hosted or cloud).
      </p>
      <div className="set-card p-4 space-y-3">
        <label className="block">
          <span className="text-xs text-set-dim uppercase tracking-wide">Research model (tool-calling capable)</span>
          <input
            className="set-input w-full mt-1" placeholder="space default"
            value={cfg.chatModel ?? ''}
            onChange={(e) => setCfg({ ...cfg, chatModel: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="text-xs text-set-dim uppercase tracking-wide">Vision model (reads unextractable pages by eye)</span>
          <input
            className="set-input w-full mt-1" placeholder="e.g. glm-5v-turbo"
            value={cfg.visionModel ?? ''}
            onChange={(e) => setCfg({ ...cfg, visionModel: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="text-xs text-set-dim uppercase tracking-wide">Firecrawl API key (optional override)</span>
          <input
            className="set-input w-full mt-1" type="password" placeholder="fc-…"
            value={cfg.firecrawlKey ?? ''}
            onChange={(e) => setCfg({ ...cfg, firecrawlKey: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="text-xs text-set-dim uppercase tracking-wide">Firecrawl URL (optional — e.g. http://firecrawl:3002)</span>
          <input
            className="set-input w-full mt-1" placeholder="https://api.firecrawl.dev"
            value={cfg.firecrawlUrl ?? ''}
            onChange={(e) => setCfg({ ...cfg, firecrawlUrl: e.target.value })}
          />
        </label>
        <div className="flex gap-3">
          <label className="flex-1">
            <span className="text-xs text-set-dim uppercase tracking-wide">Max pages / run</span>
            <input
              className="set-input w-full mt-1" type="number" min={1} max={120}
              value={cfg.maxPages ?? 40}
              onChange={(e) => setCfg({ ...cfg, maxPages: +e.target.value })}
            />
          </label>
          <label className="flex-1">
            <span className="text-xs text-set-dim uppercase tracking-wide">Time limit / run (5 min – 72 h)</span>
            <input
              className="set-input w-full mt-1" type="number" min={5} max={4320}
              value={cfg.maxMinutes ?? 25}
              onChange={(e) => setCfg({ ...cfg, maxMinutes: +e.target.value })}
            />
          </label>
        </div>
        <label className="block">
          <span className="text-xs text-set-dim uppercase tracking-wide">Default report style</span>
          <select
            className="set-input w-full mt-1" value={cfg.style ?? 'ste'}
            onChange={(e) => setCfg({ ...cfg, style: e.target.value })}
          >
            <option value="ste">Simplified Technical English</option>
            <option value="professional">Professional analysis</option>
            <option value="executive">Executive brief</option>
            <option value="study">Study notes</option>
          </select>
        </label>
        <button className="set-btn-primary text-sm" onClick={save}>{saved ? 'Saved' : 'Save research settings'}</button>
      </div>

      <div className="set-card p-4 mt-4">
        <h3 className="set-mono set-mono-dim mb-2">Report templates</h3>
        <p className="text-xs text-set-dim mb-3">
          Custom writing styles for this workspace — the instructions replace the built-in style
          when selected at launch. Keep them concrete: sentence length, voice, tone, structure.
        </p>
        <div className="space-y-2 mb-3">
          {templates.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-sm border border-set-border rounded-lg px-3 py-2">
              <span className="font-medium text-white flex items-center gap-1.5"><LayoutTemplate size={13} className="text-set-accent shrink-0" /> {t.name}</span>
              <span className="text-xs text-set-dim truncate flex-1">{(t.instructions || '').slice(0, 80)}</span>
              <button className="set-btn-ghost text-xs" onClick={() => setTemplates(templates.filter((x) => x.id !== t.id))}>Remove</button>
            </div>
          ))}
          {templates.length === 0 && <p className="text-xs text-set-dim">No templates yet.</p>}
        </div>
        <input
          className="set-input w-full mb-2" placeholder="Template name (e.g. Field-service handbook)"
          value={tplDraft.name}
          onChange={(e) => setTplDraft({ ...tplDraft, name: e.target.value })}
        />
        <textarea
          className="set-input w-full mb-2 min-h-[70px]" placeholder="Writing instructions — e.g. 'Numbered procedures. Present tense. Max 12 words per sentence. Every step starts with a verb. Include a safety note per section.'"
          value={tplDraft.instructions}
          onChange={(e) => setTplDraft({ ...tplDraft, instructions: e.target.value })}
        />
        <button
          className="set-btn text-xs"
          disabled={!tplDraft.name.trim() || !tplDraft.instructions.trim()}
          onClick={async () => {
            const next = [...templates, { id: crypto.randomUUID?.() ?? String(Math.random()).slice(2), ...tplDraft }];
            setTemplates(next);
            setTplDraft({ name: '', instructions: '' });
            await api.patch(`/spaces/${spaceId}/settings`, { settings: { research: { templates: next } } });
          }}
        >
          Add template
        </button>
      </div>
      <p className="text-[11px] text-set-dim mt-3">
        Polite-by-default: per-domain rate limits, robots.txt respected on direct fetches,
        hard page/time budgets. No detection evasion, ever (PLAN.md).
      </p>
    </div>
  );
}


function CompanionTab({ spaceId }: { spaceId: string }) {
  const [tokens, setTokens] = useState<any[]>([]);
  const [companions, setCompanions] = useState<any[] | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [retentionDays, setRetentionDays] = useState<number>(30);

  const load = () => {
    api.get(`/spaces/${spaceId}/companion/tokens`).then((r) => setTokens(r.tokens)).catch(() => {});
    api.get(`/spaces/${spaceId}/companion/health`).then((r) => setCompanions(r.companions)).catch(() => {});
    api.get(`/spaces/${spaceId}/settings`).then(({ settings }) => setRetentionDays(Number(settings?.captures?.retentionDays ?? 30))).catch(() => {});
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000); // live companion health refresh
    return () => clearInterval(t);
  }, [spaceId]);

  const setRetention = async (days: number) => {
    setRetentionDays(days);
    await api.patch(`/spaces/${spaceId}/settings`, { settings: { captures: { retentionDays: days } } });
  };

  const create = async () => {
    const { token } = await api.post(`/spaces/${spaceId}/companion/tokens`, { name: `companion-${new Date().toISOString().slice(0, 10)}` });
    setFresh(token.token);
    load();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <p className="text-sm text-set-dim flex-1 min-w-[260px]">
          The teaching companion runs <strong className="text-set-text">on your own machine</strong> and demonstrates SET
          live in your real browser — it opens pages, highlights elements and shows captions. Visible actions only:
          it never clicks, edits, or runs in the background, and you can stop it (Ctrl-C) or revoke its token at any time.
        </p>
        <a className="set-btn text-xs flex items-center gap-1" href={`/app/space/${spaceId}/captures`}>
          <Camera size={13} /> Capture history
        </a>
        <label className="text-xs text-set-dim flex items-center gap-1.5">
          Keep captures
          <select
            className="set-input w-28 py-1 text-xs"
            value={retentionDays}
            onChange={(e) => setRetention(Number(e.target.value))}
            title="Captures older than this are deleted automatically"
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
            <option value={0}>forever</option>
          </select>
        </label>
      </div>

      {/* live health — heartbeats from the companion every ~45s */}
      <div className="set-card p-4 mb-4">
        <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5"><HeartPulse size={14} /> Companion health</h3>
        {companions === null && <p className="text-xs text-set-dim">Loading…</p>}
        {companions?.filter((c) => !c.revoked_at).length === 0 && (
          <p className="text-xs text-set-dim">
            No companions connected. Create a pairing token below and start the companion — its diagnostics
            (daemon, accessibility, permissions) appear here live.
          </p>
        )}
        <div className="space-y-2">
          {companions?.filter((c) => !c.revoked_at).map((c) => {
            const h = c.health ?? {};
            const daemon = h.daemon ?? {};
            const atspi = h.atspi ?? {};
            return (
              <div key={c.id} className="border border-set-border rounded-lg px-3 py-2.5">
                <div className="flex items-center gap-2 text-sm">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${c.online ? 'bg-green-400 animate-pulse' : 'bg-set-dim'}`} />
                  <span className="text-white font-medium">{c.name}</span>
                  <span className="text-xs text-set-dim font-mono">{c.token_prefix}…</span>
                  <span className={`text-xs ml-auto shrink-0 ${c.online ? 'text-green-400' : 'text-set-dim'}`}>
                    {c.online ? 'online' : 'offline'}
                    {c.health_at ? ` · heartbeat ${new Date(c.health_at).toLocaleTimeString()}` : ' · never seen'}
                  </span>
                </div>
                {c.online && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <span className={`set-chip text-[10px] border ${daemon.running ? 'border-green-500/40 bg-green-500/10 text-green-300' : 'border-red-500/40 bg-red-500/10 text-red-300'}`}>
                      cua-driver {daemon.running ? 'running' : 'down'}
                    </span>
                    <span className={`set-chip text-[10px] border ${atspi.ok ? 'border-green-500/40 bg-green-500/10 text-green-300' : 'border-red-500/40 bg-red-500/10 text-red-300'}`}>
                      AT-SPI {atspi.ok ? `${atspi.windows} window(s)` : 'unavailable'}
                    </span>
                    <span className={`set-chip text-[10px] border ${h.allow_input ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-set-border bg-set-panel2 text-set-dim'}`}>
                      {h.allow_input ? 'input enabled' : 'observe-only'}
                    </span>
                    {h.host && <span className="set-chip text-[10px] border-set-border bg-set-panel2 text-set-dim">{h.host}</span>}
                  </div>
                )}
                {!c.online && c.health_at && (
                  <p className="text-[11px] text-set-dim mt-1.5">Last seen {new Date(c.health_at).toLocaleString()} — companion stopped or asleep.</p>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-set-dim mt-2">
          Full local check: <code className="text-violet-300">uv run companion.py --doctor</code> — pairing token, cua-driver daemon,
          AT-SPI accessibility, input permission and browser debugging in one command.
        </p>
      </div>

      <div className="set-card p-4 mb-4">
        <h3 className="set-mono set-mono-dim mb-2 flex items-center gap-1.5"><Terminal size={13} /> Setup</h3>
        <ol className="text-xs text-set-dim space-y-2 list-decimal pl-4">
          <li>Relaunch your browser with remote debugging:
            <code className="block mt-1 bg-set-panel2 rounded px-2 py-1">chrome --remote-debugging-port=9222</code>
            (or <code>brave --remote-debugging-port=9222</code>)
          </li>
          <li>Create a pairing token below.</li>
          <li>On your machine, inside the SET checkout:
            <code className="block mt-1 bg-set-panel2 rounded px-2 py-1">cd companion &amp;&amp; SET_URL={location.origin} COMPANION_TOKEN=… uv run companion.py</code>
          </li>
          <li>Verify the whole stack in one command:
            <code className="block mt-1 bg-set-panel2 rounded px-2 py-1">uv run companion.py --doctor</code>
            (token, daemon, accessibility, permissions, browser)
          </li>
          <li>Ask the copilot to <em>show</em> you something — e.g. "show me the knowledge graph".
            For <strong className="text-set-text">native desktop app demos</strong>, also install cua-driver
            (<code>curl -LsSf https://cua.driver/cli | sh</code>) and run <code>cua-driver serve</code> — the companion
            then points at real app elements (Linux AT-SPI today; macOS/Windows next).</li>
        </ol>
      </div>

      {fresh && (
        <div className="set-card p-3 mb-4 border-set-accent/40 flex items-center gap-2">
          <code className="text-xs flex-1 truncate">{fresh}</code>
          <button className="set-btn text-xs flex items-center gap-1" onClick={() => { navigator.clipboard?.writeText(fresh); }}>
            <Copy size={12} /> Copy
          </button>
        </div>
      )}

      <div className="set-card p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-white">Pairing tokens</h3>
          <button className="set-btn-primary text-xs" onClick={create}>Create token</button>
        </div>
        <div className="space-y-1.5">
          {tokens.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-xs border border-set-border rounded-lg px-3 py-2">
              <span className="text-set-text font-medium">{t.name}</span>
              <span className="text-set-dim font-mono">{t.token_prefix}…</span>
              <span className="text-set-dim flex-1">
                {t.revoked_at ? 'revoked' : t.last_used_at ? `last used ${new Date(t.last_used_at).toLocaleDateString()}` : 'never used'}
              </span>
              {!t.revoked_at && (
                <button className="set-btn-ghost text-xs" onClick={async () => { await api.del(`/companion/tokens/${t.id}`); load(); }}>Revoke</button>
              )}
            </div>
          ))}
          {tokens.length === 0 && <p className="text-xs text-set-dim">No tokens yet.</p>}
        </div>
      </div>
    </div>
  );
}

/** Bookmarklet source — keeps the token inline so it works from any page. */
function clipperBookmarklet(origin: string, token: string) {
  const code = `(function(){var s=String(window.getSelection()).trim();var t=s||document.body.innerText;if(!t||!t.trim()){alert('Nothing to clip on this page.');return;}fetch('${origin}/api/clip',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer ${token}'},body:JSON.stringify({url:location.href,title:document.title,text:t.slice(0,200000)})}).then(function(r){return r.json().then(function(j){return r.ok&&j.ok})}).then(function(ok){alert(ok?'Clipped to SET - check your Clips notebook':'Clip failed')}).catch(function(e){alert('Clip failed: '+e)});})()`;
  return 'javascript:' + encodeURIComponent(code);
}

function ClipperTab() {
  const [tokens, setTokens] = useState<any[]>([]);
  const [fresh, setFresh] = useState<string | null>(null); // plaintext, shown once
  const [copied, setCopied] = useState(false);

  const load = () => api.get('/users/clip-tokens').then((r) => setTokens(r.tokens)).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    const { token } = await api.post('/users/clip-tokens', { name: 'bookmarklet' });
    setFresh(token.plaintext);
    setCopied(false);
    load();
  };

  const revoke = async (id: string) => {
    if (!confirm('Revoke this clip token? The bookmarklet stops working immediately.')) return;
    await api.del(`/users/clip-tokens/${id}`);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="set-card p-4">
        <h3 className="font-semibold text-white mb-1 flex items-center gap-1.5"><Scissors size={14} /> Web clipper</h3>
        <p className="text-sm text-set-dim mb-3">
          Clip any web page (or just your selection) straight into this SET's <b>Clips</b> notebook, where it becomes a
          searchable, citable source. Create a token, then drag the link below onto your bookmarks bar.
        </p>
        <button className="set-btn-primary text-sm flex items-center gap-1.5" onClick={create}>
          <Plus size={14} /> Create clip token
        </button>
        {fresh && (
          <div className="mt-3 space-y-2">
            <div className="text-xs text-amber-300">Copy this token now — it is shown only once. Treat it like a password.</div>
            <div className="flex gap-2">
              <code className="set-input flex-1 text-xs overflow-x-auto whitespace-nowrap">{fresh}</code>
              <button
                className="set-btn text-xs flex items-center gap-1.5"
                onClick={async () => {
                  await navigator.clipboard.writeText(fresh);
                  setCopied(true);
                }}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <a
              href={clipperBookmarklet(window.location.origin, fresh)}
              onClick={(e) => e.preventDefault()}
              className="inline-flex items-center gap-1.5 set-btn-primary text-sm no-underline"
              title="Drag me to your bookmarks bar"
            >
              <Scissors size={14} /> ✂ Clip to SET — drag me to your bookmarks bar
            </a>
          </div>
        )}
      </div>
      <div className="set-card p-4">
        <h3 className="font-semibold text-white mb-2">Tokens</h3>
        {tokens.length === 0 && <p className="text-sm text-set-dim">No clip tokens yet.</p>}
        <div className="space-y-1">
          {tokens.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-sm py-1">
              <span className="flex-1 truncate">{t.name}</span>
              <span className="text-xs text-set-dim">
                created {new Date(t.created_at).toLocaleDateString()}
                {t.last_used_at ? ` · last used ${new Date(t.last_used_at).toLocaleDateString()}` : ' · never used'}
              </span>
              <button className="text-set-dim hover:text-red-400" onClick={() => revoke(t.id)} title="Revoke">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        {tokens.length > 0 && !fresh && (
          <p className="text-xs text-set-dim mt-2">Need the bookmarklet again? Create a new token — old ones keep working until revoked.</p>
        )}
      </div>
    </div>
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function NotificationsTab() {
  const [permission, setPermission] = useState<string>(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setSubscribed(false);
      return;
    }
    navigator.serviceWorker.getRegistration('/sw.js').then(async (reg) => {
      if (!reg) return setSubscribed(false);
      const sub = await reg.pushManager.getSubscription();
      setSubscribed(!!sub);
    });
  }, []);

  const enable = async () => {
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') return setMsg('Permission denied — allow notifications for this site in your browser settings.');
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const { publicKey } = await api.get('/push/vapid-key');
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }
      const json = sub.toJSON();
      await api.post('/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
      setSubscribed(true);
      setMsg('Push enabled — mentions, comments and assignments will reach this device.');
    } catch (e: any) {
      setMsg(`Couldn't enable push: ${e.message}`);
    }
  };

  const disable = async () => {
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await api.del(`/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`);
        await sub.unsubscribe();
      }
      setSubscribed(false);
      setMsg('Push disabled for this device.');
    } catch (e: any) {
      setMsg(`Couldn't disable: ${e.message}`);
    }
  };

  return (
    <div className="set-card p-4">
      <h3 className="font-semibold text-white mb-1 flex items-center gap-1.5"><Bell size={14} /> Push notifications</h3>
      <p className="text-sm text-set-dim mb-3">
        Get @mentions, comments and learning-path assignments on this device — even when SET isn't open.
        Works best with SET installed as an app (PWA).
      </p>
      <div className="text-xs text-set-dim mb-3">
        Browser permission: <span className={permission === 'granted' ? 'text-green-400' : 'text-amber-300'}>{permission}</span>
        {subscribed !== null && (
          <>
            {' · '}this device: <span className={subscribed ? 'text-green-400' : 'text-set-dim'}>{subscribed ? 'subscribed' : 'not subscribed'}</span>
          </>
        )}
      </div>
      <div className="flex gap-2">
        <button className="set-btn-primary text-sm" onClick={enable} disabled={permission === 'denied'}>
          {subscribed ? 'Re-enable / sync' : 'Enable push'}
        </button>
        {subscribed && (
          <button className="set-btn text-sm" onClick={disable}>Disable</button>
        )}
      </div>
      {permission === 'denied' && <p className="text-xs text-red-300 mt-2">Notifications are blocked for this site — unblock them in your browser's site settings, then retry.</p>}
      {msg && <p className="text-xs text-set-dim mt-2">{msg}</p>}

      <BriefSchedule />
    </div>
  );
}

/** Daily-brief scheduling: server stamps the brief into the daily note at your hour + pushes it. */
function BriefSchedule() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState<any>(null);
  const [hour, setHour] = useState('8');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';

  useEffect(() => {
    api.get('/users/preferences').then((r) => {
      setPrefs(r.preferences);
      if (typeof r.preferences?.briefHour === 'number') setHour(String(r.preferences.briefHour));
    }).catch(() => setPrefs({}));
  }, []);

  const save = async (enabled: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.put('/users/preferences', { briefEnabled: enabled, briefHour: Number(hour), briefTz: tz });
      setPrefs(r.preferences);
      setMsg(enabled ? `On — the brief lands at ${hour.padStart(2, '0')}:00 (${tz}) in every space you can edit.` : 'Brief scheduling off.');
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  const deliverNow = async () => {
    if (!spaceId || busy) return;
    setBusy(true);
    try {
      const r = await api.post(`/spaces/${spaceId}/brief/deliver`);
      if (r?.results?.[0]?.pageId || r?.delivered) {
        const pageId = r.results.find((x: any) => x.pageId)?.pageId;
        if (pageId) return navigate(`/app/space/${spaceId}/page/${pageId}`);
      }
      setMsg(r?.delivered ? 'Delivered.' : 'Nothing to deliver today — no reviews due, nothing decaying, no builds.');
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  const enabled = prefs?.briefEnabled === true;
  return (
    <div className="border-t border-set-border mt-4 pt-4">
      <h3 className="font-semibold text-white mb-1 flex items-center gap-1.5"><CloudSun size={14} /> Daily brief</h3>
      <p className="text-sm text-set-dim mb-3">
        Each morning SET writes your brief into the daily note — reviews due, pages going amber, ranked next steps, recent builds — and pushes it to this device.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select className="set-input w-24 text-sm" value={hour} onChange={(e) => setHour(e.target.value)}>
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
          ))}
        </select>
        <span className="text-xs text-set-dim">{tz}</span>
        <button className="set-btn-primary text-sm" disabled={busy || prefs === null} onClick={() => save(!enabled)}>
          {enabled ? 'Turn off' : 'Turn on'}
        </button>
        <button className="set-btn text-sm" disabled={busy || !spaceId} onClick={deliverNow}>Deliver now</button>
      </div>
      {enabled && <p className="text-xs text-green-400 mt-2">Scheduled at {String(prefs.briefHour ?? hour).padStart(2, '0')}:00 {prefs.briefTz ?? tz}</p>}
      {msg && <p className="text-xs text-set-dim mt-2">{msg}</p>}
    </div>
  );
}

function BillingTab({ spaceId }: { spaceId: string }) {
  const { spaces, currentSpaceId } = useApp();
  const role = spaces.find((s) => s.id === (currentSpaceId ?? spaceId))?.role ?? 'viewer';
  const isOwner = role === 'owner';
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const [searchParams] = useSearchParams();

  const load = () => api.get(`/spaces/${spaceId}/billing`).then((r) => setData(r)).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [spaceId]);
  useEffect(() => {
    if (searchParams.get('billing') === 'success') setBanner('Payment received — credits land within a few seconds of the webhook.');
    if (searchParams.get('billing') === 'cancel') setBanner('Checkout cancelled.');
  }, [searchParams]);

  const buy = async (cents: number) => {
    setBusy(cents);
    setError('');
    try {
      const { url } = await api.post(`/spaces/${spaceId}/billing/checkout`, { amountCents: cents });
      if (url) window.location.href = url;
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const [grantCents, setGrantCents] = useState('');
  const grant = async () => {
    const cents = Math.round(Number(grantCents) * 100);
    if (!cents || cents < 1) return;
    await api.post(`/spaces/${spaceId}/billing/grant`, { amountCents: cents, note: 'manual grant' });
    setGrantCents('');
    load();
  };

  if (error && !data) return <div className="set-card p-4 text-sm text-red-300">{error}</div>;
  if (!data) return <div className="text-set-dim text-sm p-2">Loading billing…</div>;
  const balance = (data.balanceCents / 100).toFixed(2);

  return (
    <div className="space-y-4">
      {banner && <div className="set-card p-3 text-sm text-green-300 border-green-500/30">{banner}</div>}
      <div className="set-card p-4">
        <div className="flex items-start justify-between mb-1">
          <h3 className="font-semibold text-white flex items-center gap-1.5"><Coins size={14} /> SET Cloud credit</h3>
          <div className="text-right">
            <div className="text-2xl font-bold text-white">${balance}</div>
            <div className="text-[10px] uppercase text-set-dim">balance</div>
          </div>
        </div>
        <p className="text-sm text-set-dim mb-4">
          Prepaid credit pays for SET Cloud model calls (Settings → AI Providers) as you use them — no subscription.
          Metered spend draws the balance down; existing spend caps still apply.
        </p>
        {!data.enabled ? (
          <p className="text-xs text-amber-300">
            Stripe isn't configured on this server yet (STRIPE_SECRET_KEY). Balances and grants still work for support use.
          </p>
        ) : isOwner ? (
          <div className="flex flex-wrap gap-2">
            {(data.packs ?? []).map((cents: number) => (
              <button key={cents} className="set-btn-primary text-sm" onClick={() => buy(cents)} disabled={busy !== null}>
                {busy === cents ? 'Opening Stripe…' : `Buy $${cents / 100} credit`}
              </button>
            ))}
            {error && <p className="text-xs text-red-400 w-full">{error}</p>}
          </div>
        ) : (
          <p className="text-xs text-set-dim">Only workspace owners can buy credit.</p>
        )}
      </div>

      {isOwner && (
        <div className="set-card p-4 flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[200px]">
            <div className="text-sm text-white">Grant credit (support)</div>
            <div className="text-xs text-set-dim">Manually add credit — refunds, comps, testing.</div>
          </div>
          <input
            className="set-input w-24"
            type="number"
            min="0.01"
            step="0.01"
            placeholder="$"
            value={grantCents}
            onChange={(e) => setGrantCents(e.target.value)}
          />
          <button className="set-btn text-sm" onClick={grant}>Grant</button>
        </div>
      )}

      <div className="set-card p-4">
        <h3 className="font-semibold text-white mb-2 text-sm">History</h3>
        {data.history?.length === 0 && <p className="text-sm text-set-dim">No credit activity yet.</p>}
        <div className="space-y-1">
          {data.history?.map((h: any) => (
            <div key={h.id} className="flex items-center gap-2 text-sm py-0.5">
              <span className="flex-1 truncate text-set-dim">{h.note || h.kind}{h.ref ? ` · ${h.ref.slice(0, 18)}…` : ''}</span>
              <span className={`font-mono ${Number(h.amount_cents) >= 0 ? 'text-green-400' : 'text-amber-300'}`}>
                {Number(h.amount_cents) >= 0 ? '+' : ''}{(Number(h.amount_cents) / 100).toFixed(4)}
              </span>
              <span className="text-[10px] text-set-dim w-32 text-right">{new Date(h.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
