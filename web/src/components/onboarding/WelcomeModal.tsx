import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApp } from '../../stores/app';
import Mascot, { DEFAULT_MASCOT, type MascotConfig } from '../Mascot';
import { Brain, Users, GraduationCap, Wrench, ArrowRight, Cloud, KeyRound, Laptop, Check } from 'lucide-react';

const PERSONAS = [
  {
    id: 'personal' as const,
    icon: <Brain size={20} />,
    title: 'Personal knowledge',
    blurb: 'Second brain: notes, reading, ideas, projects',
  },
  {
    id: 'team' as const,
    icon: <Users size={20} />,
    title: 'Team enablement',
    blurb: 'SOPs, onboarding paths, shared docs and tasks',
  },
  {
    id: 'study' as const,
    icon: <GraduationCap size={20} />,
    title: 'Study & research',
    blurb: 'Sources, citations, flashcards and quizzes',
  },
  {
    id: 'builder' as const,
    icon: <Wrench size={20} />,
    title: 'Engineering',
    blurb: 'Docs, runbooks, code surfaces, agents',
  },
];

/**
 * First-run flow, two steps: pick a persona (shapes starter content — a
 * linked starter neighborhood, so the map is alive on day one), then connect
 * a brain (local Ollama / LM Studio if detected, SET Cloud, or any API key).
 * Shown once (until the user picks or skips).
 */
export default function WelcomeModal({ onDone }: { onDone: (persona?: string) => void }) {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const { user } = useApp();
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'persona' | 'brain'>('persona');
  const mascot: MascotConfig = (user as any)?.mascot ?? DEFAULT_MASCOT;

  const leave = (persona?: string) => {
    onDone(persona);
    if (spaceId) navigate(`/app/space/${spaceId}`);
  };

  const finish = async (persona?: string) => {
    setBusy(true);
    try {
      await api.put('/users/onboarding', { welcomed: true, ...(persona ? { persona } : {}) });
      if (persona && spaceId) {
        await api.post(`/spaces/${spaceId}/onboarding/seed`, { persona }).catch(() => {});
        // persona picks the shell: learners and personal users get the Simple
        // nav (Home / Subjects / Ask), teams and builders get the full Studio.
        useApp.getState().setShellMode(persona === 'study' || persona === 'personal' ? 'simple' : 'studio');
        useApp.setState({ user: { ...(user as any), onboarding: { ...(user as any)?.onboarding, welcomed: true, persona } } });
        setPicked(persona);
        setStep('brain'); // one more door: connect the brain
        return;
      }
      useApp.setState({ user: { ...(user as any), onboarding: { ...(user as any)?.onboarding, welcomed: true } } });
      leave(undefined);
    } finally {
      setBusy(false);
    }
  };

  if (step === 'brain' && spaceId) {
    return (
      <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 safe-outer">
        <div className="set-card bg-set-panel w-full max-w-lg p-6 sm:p-8">
          <BrainStep spaceId={spaceId} persona={picked} mascot={mascot} onDone={() => leave(picked ?? undefined)} />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 safe-outer">
      <div className="set-card bg-set-panel w-full max-w-lg p-6 sm:p-8">
        <div className="flex items-start gap-4 mb-5">
          <Mascot config={mascot} mood="celebrating" size={64} />
          <div>
            <h2 className="text-xl font-bold text-white">
              Welcome to SET{(user as any)?.name ? `, ${(user as any).name.split(' ')[0]}` : ''}
            </h2>
            <p className="text-sm text-set-dim mt-1">
              What is this workspace for? We set up starter pages, a database and the right surfaces for it.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPicked(p.id)}
              className={`text-left p-3.5 rounded-xl border transition-colors ${
                picked === p.id
                  ? 'border-set-accent bg-set-accent/15'
                  : 'border-set-border bg-set-panel2/40 hover:border-set-accent/40'
              }`}
            >
              <div className="flex items-center gap-2 text-white text-sm font-medium mb-1">
                <span className={picked === p.id ? 'text-set-accent' : 'text-set-dim'}>{p.icon}</span>
                {p.title}
              </div>
              <div className="text-xs text-set-dim">{p.blurb}</div>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button className="set-btn-primary text-sm flex items-center gap-1.5" disabled={!picked || busy} onClick={() => picked && finish(picked)}>
            {busy ? 'Setting up…' : 'Set up my workspace'} {!busy && <ArrowRight size={14} />}
          </button>
          <button className="set-btn-ghost text-sm" disabled={busy} onClick={() => finish(undefined)}>
            Skip — I'll explore myself
          </button>
        </div>
        <p className="text-[11px] text-set-dim mt-3">You can redo this anytime from the dashboard checklist.</p>
      </div>
    </div>
  );
}

interface LocalServer {
  kind: string;
  baseUrl: string;
  models: string[];
}

/** Step two: connect a brain. Auto-scans for local Ollama / LM Studio, offers
 *  SET Cloud when the gateway is configured, and any API key as the third
 *  door. Every path ends in an ordinary provider row, so Settings keeps
 *  working exactly as before. */
function BrainStep({
  spaceId,
  persona,
  mascot,
  onDone,
}: {
  spaceId: string;
  persona: string | null;
  mascot: MascotConfig;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<'scan' | 'choose'>('scan');
  const [servers, setServers] = useState<LocalServer[]>([]);
  const [providerName, setProviderName] = useState<string | null>(null);
  const [gatewayEnabled, setGatewayEnabled] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [presets, setPresets] = useState<{ name: string; baseUrl: string; chatModel: string | null; embedModel: string | null }[]>([]);
  const [presetIdx, setPresetIdx] = useState(0);
  const [keyVal, setKeyVal] = useState('');
  const [modelChoice, setModelChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [scan, list] = await Promise.all([
          api.get<{ servers: LocalServer[] }>(`/spaces/${spaceId}/ai/detect-local`),
          api.get<{ providers: { name: string }[]; gatewayEnabled: boolean }>(`/spaces/${spaceId}/providers`),
        ]);
        setServers(scan.servers ?? []);
        const existing = (list.providers ?? [])[0];
        if (existing) setProviderName(existing.name);
        setGatewayEnabled(list.gatewayEnabled);
      } catch {
        /* scan failed — the manual doors below still work */
      }
      try {
        const pr = await api.get<{ presets: { name: string; baseUrl: string; chatModel: string | null; embedModel: string | null }[] }>(`/providers/presets`);
        // local presets are covered by the scan; the key door is for cloud providers
        setPresets((pr.presets ?? []).filter((p) => !/local/i.test(p.name)));
      } catch {
        /* ignore */
      }
      setPhase('choose');
    })();
  }, [spaceId]);

  const connect = async (body: Record<string, any>, tag: string, name: string) => {
    setBusy(tag);
    setError('');
    try {
      await api.post(`/spaces/${spaceId}/providers`, { ...body, isDefault: true });
      setProviderName(name);
    } catch (e: any) {
      setError(e?.message ?? 'Could not connect');
    } finally {
      setBusy(null);
    }
  };

  const enableCloud = async () => {
    setBusy('cloud');
    setError('');
    try {
      await api.post(`/spaces/${spaceId}/providers/platform`, {});
      setProviderName('SET Cloud (managed)');
    } catch (e: any) {
      setError(e?.message ?? 'Could not enable SET Cloud');
    } finally {
      setBusy(null);
    }
  };

  const kindLabel = (kind: string) => (kind === 'ollama' ? 'Ollama' : 'LM Studio');

  return (
    <div>
      <div className="flex items-start gap-4 mb-5">
        <Mascot config={mascot} mood={providerName ? 'celebrating' : 'thinking'} size={64} />
        <div>
          <h2 className="text-xl font-bold text-white">How should SET think?</h2>
          <p className="text-sm text-set-dim mt-1">
            {providerName
              ? `Connected to ${providerName}. The copilot is live — you can change this anytime in Settings.`
              : 'Connect a brain and the copilot comes alive. Local is private and free; cloud is one click.'}
          </p>
        </div>
      </div>

      {providerName ? (
        <button className="set-btn-primary w-full text-sm" onClick={onDone}>
          <span className="inline-flex items-center gap-1.5">
            <Check size={14} /> Start using SET
          </span>
        </button>
      ) : phase === 'scan' ? (
        <div className="flex items-center gap-3 rounded-xl border border-set-border bg-set-panel2/40 px-4 py-4 text-sm text-set-dim">
          <Laptop size={16} className="animate-pulse" /> Looking for local brains (Ollama, LM Studio)…
        </div>
      ) : (
        <div className="space-y-2">
          {servers.map((s) => {
            const chosen = modelChoice[s.kind] ?? s.models[0];
            return (
              <div key={s.kind} className="rounded-xl border border-set-border bg-set-panel2/40 p-3.5">
                <div className="flex items-center gap-2 text-sm font-medium text-white mb-2">
                  <Laptop size={15} className="text-set-accent" /> {kindLabel(s.kind)} on this machine
                  <span className="text-xs font-normal text-set-dim">· private & free</span>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="set-input flex-1 text-xs"
                    value={chosen}
                    onChange={(e) => setModelChoice((m) => ({ ...m, [s.kind]: e.target.value }))}
                  >
                    {s.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <button
                    className="set-btn-primary shrink-0 text-xs"
                    disabled={busy === s.kind}
                    onClick={() =>
                      connect(
                        {
                          name: kindLabel(s.kind) + ' (local)',
                          baseUrl: `${s.baseUrl}/v1`,
                          chatModel: chosen,
                          embedModel: s.models.find((m) => /embed/i.test(m)) ?? null,
                        },
                        s.kind,
                        kindLabel(s.kind) + ' (local)'
                      )
                    }
                  >
                    {busy === s.kind ? '…' : 'Use it'}
                  </button>
                </div>
              </div>
            );
          })}

          {gatewayEnabled && (
            <div className="rounded-xl border border-set-border bg-set-panel2/40 p-3.5">
              <div className="flex items-center gap-2 text-sm font-medium text-white mb-1">
                <Cloud size={15} className="text-set-accent" /> SET Cloud <span className="text-xs font-normal text-set-dim">· managed, metered</span>
              </div>
              <p className="text-xs text-set-dim mb-2">No key juggling — enable and the copilot works from any device.</p>
              <button className="set-btn-primary text-xs" disabled={busy === 'cloud'} onClick={enableCloud}>
                {busy === 'cloud' ? '…' : 'Enable SET Cloud'}
              </button>
            </div>
          )}

          {showKey ? (
            <div className="rounded-xl border border-set-border bg-set-panel2/40 p-3.5">
              <div className="flex items-center gap-2 text-sm font-medium text-white mb-2">
                <KeyRound size={15} className="text-set-accent" /> Use an API key
              </div>
              <div className="flex flex-col gap-2">
                <select className="set-input text-xs" value={presetIdx} onChange={(e) => setPresetIdx(Number(e.target.value))}>
                  {presets.map((p, i) => (
                    <option key={p.name} value={i}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input
                  className="set-input text-xs"
                  type="password"
                  placeholder="Paste your API key"
                  value={keyVal}
                  onChange={(e) => setKeyVal(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <button
                    className="set-btn-primary text-xs"
                    disabled={!keyVal || busy === 'key'}
                    onClick={() => {
                      const p = presets[presetIdx];
                      connect({ name: p.name, baseUrl: p.baseUrl, apiKey: keyVal, chatModel: p.chatModel, embedModel: p.embedModel }, 'key', p.name);
                    }}
                  >
                    {busy === 'key' ? '…' : 'Connect'}
                  </button>
                  <button className="set-btn-ghost text-xs" onClick={() => setShowKey(false)}>
                    Cancel
                  </button>
                </div>
                <p className="text-[10px] text-set-dim">
                  Need a key?{' '}
                  <a href="https://llm.wandgx.com" target="_blank" rel="noreferrer" className="text-set-accent hover:underline">
                    llm.wandgx.com
                  </a>{' '}
                  has ready-to-use ones.
                </p>
              </div>
            </div>
          ) : (
            <button className="set-btn-ghost text-xs flex items-center gap-1.5" onClick={() => setShowKey(true)}>
              <KeyRound size={13} /> I have an API key
            </button>
          )}

          {error && <p className="text-xs text-red-300">{error}</p>}

          <button className="set-btn-ghost text-xs" onClick={onDone}>
            Later — I'll do it in Settings
          </button>
        </div>
      )}

      {providerName && persona && (
        <p className="text-[11px] text-set-dim mt-3">Your {persona} starter pages are already on the map — go look.</p>
      )}
    </div>
  );
}
