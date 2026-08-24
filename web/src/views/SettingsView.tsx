import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Plus, Zap, ShieldCheck, Users, Cpu, Check, LayoutGrid, Cat, Dices, PackagePlus, PackageMinus, Plug, Sparkles } from 'lucide-react';
import { useApp } from '../stores/app';
import Mascot, { DEFAULT_MASCOT, type MascotConfig } from '../components/Mascot';
import McpSettings from '../components/McpSettings';
import SkillsSettings from '../components/SkillsSettings';

export default function SettingsView() {
  const { spaceId } = useParams();
  const [tab, setTab] = useState<'surfaces' | 'skills' | 'mcp' | 'mascot' | 'providers' | 'members' | 'workspace'>('surfaces');

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-4">Settings</h1>
      <div className="flex flex-wrap gap-1 mb-4">
        {([
          ['surfaces', 'Work surfaces', <LayoutGrid key="z" size={14} />],
          ['skills', 'Skills', <Sparkles key="y" size={14} />],
          ['mcp', 'MCP', <Plug key="z" size={14} />],
          ['mascot', 'Mascot', <Cat key="m" size={14} />],
          ['providers', 'AI Providers', <Cpu key="a" size={14} />],
          ['members', 'Members', <Users key="b" size={14} />],
          ['workspace', 'Workspace', <ShieldCheck key="c" size={14} />],
        ] as const).map(([id, label, icon]) => (
          <button key={id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm ${tab === id ? 'bg-set-accent/20 text-blue-200' : 'text-set-dim hover:text-set-text'}`} onClick={() => setTab(id)}>
            {icon} {label}
          </button>
        ))}
      </div>
      {tab === 'surfaces' && <SurfacesTab spaceId={spaceId!} />}
      {tab === 'skills' && <SkillsSettings />}
      {tab === 'mcp' && <McpSettings />}
      {tab === 'mascot' && <MascotTab />}
      {tab === 'providers' && <ProvidersTab spaceId={spaceId!} />}
      {tab === 'members' && <MembersTab spaceId={spaceId!} />}
      {tab === 'workspace' && <WorkspaceTab spaceId={spaceId!} />}
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
];

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
    const hue = () => '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
    setCfg({
      name: pick(['Pixel', 'Maus', 'Bit', 'Nova', 'Gears', 'Sprout', 'Ziggy', 'Tinker', 'Ember', 'Waffle']),
      species: pick(['bot', 'cat', 'blob', 'mouse'] as const),
      bodyColor: hue(),
      accentColor: hue(),
      eyes: pick(['normal', 'happy', 'sleepy', 'visor'] as const),
      accessory: pick(['none', 'antenna', 'halo', 'headphones', 'hardhat', 'party'] as const),
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
      <div className="set-card p-5 flex flex-col sm:flex-row gap-6 items-center sm:items-start">
        <div className="flex flex-col items-center gap-3 shrink-0">
          <div className="rounded-2xl bg-set-panel2 border border-set-border p-5">
            <Mascot config={cfg} mood={mood} size={130} />
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
    </div>
  );
}

function ProvidersTab({ spaceId }: { spaceId: string }) {
  const [providers, setProviders] = useState<any[]>([]);
  const [presets, setPresets] = useState<any[]>([]);
  const [testResults, setTestResults] = useState<Record<string, any>>({});
  const [form, setForm] = useState({ name: '', baseUrl: '', apiKey: '', chatModel: '', embedModel: '', isDefault: false });

  const load = async () => {
    setProviders((await api.get(`/spaces/${spaceId}/providers`)).providers);
    setPresets((await api.get('/providers/presets')).presets);
  };
  useEffect(() => {
    load();
  }, [spaceId]);

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

  return (
    <div>
      <p className="text-sm text-set-dim mb-3">
        Bring Your Own LLM — any OpenAI-compatible endpoint works. Ollama users: start ollama and use <code className="text-violet-300">http://host.docker.internal:11434/v1</code>.
      </p>

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
          <input className="set-input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="set-input" placeholder="Base URL (https://…/v1)" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
          <input className="set-input" placeholder="API key (optional for local)" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
          <input className="set-input" placeholder="Chat model (e.g. llama3.1)" value={form.chatModel} onChange={(e) => setForm({ ...form, chatModel: e.target.value })} />
          <input className="set-input" placeholder="Embedding model (e.g. nomic-embed-text)" value={form.embedModel} onChange={(e) => setForm({ ...form, embedModel: e.target.value })} />
          <label className="flex items-center gap-2 text-sm text-set-dim">
            <input type="checkbox" className="accent-set-accent" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
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
  const [msg, setMsg] = useState('');

  const load = async () => setMembers((await api.get(`/spaces/${spaceId}/members`)).members);
  useEffect(() => {
    load();
  }, [spaceId]);

  const invite = async () => {
    setMsg('');
    try {
      await api.post(`/spaces/${spaceId}/invite`, { email, role });
      setEmail('');
      load();
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  return (
    <div>
      <div className="set-card p-4 mb-4 flex gap-2">
        <input className="set-input" placeholder="teammate@example.com (must have an account)" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select className="set-input w-32" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
        <button className="set-btn-primary" onClick={invite}>Invite</button>
      </div>
      {msg && <p className="text-xs text-red-400 mb-2">{msg}</p>}
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

  return (
    <div className="space-y-4">
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
