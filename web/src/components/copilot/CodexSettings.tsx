import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useApp } from '../../stores/app';
import { AI_CONNECTION_CHANGED } from './voiceCapabilities';

interface Status {
  connected: boolean; selected: boolean; busy: boolean;
  account: { email: string; planType: string } | null;
  login: { userCode: string; verificationUrl: string } | null;
  error: string | null;
}

/** A personal Copilot backend, not a workspace-shared API provider. */
export default function CodexSettings() {
  const userId = useApp(s => s.user?.id);
  const [available, setAvailable] = useState(false);
  const [deploymentMode, setDeploymentMode] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);

  useEffect(() => {
    let active = true; mounted.current = true; generation.current++;
    setAvailable(false); setStatus(null); setBusy(false); setError(''); setLoading(true); setDeploymentMode('');
    void api.get('/codex/capabilities').then(async result => {
      if (!active) return;
      setDeploymentMode(result.deploymentMode ?? '');
      if (result.available !== true) return;
      setAvailable(true);
      const next = await api.get<Status>('/codex/account');
      if (active) setStatus(next);
    }).catch(() => { if (active) setError('The personal Codex connection could not be loaded. Check the server installation.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; mounted.current = false; generation.current++; };
  }, [userId, retry]);

  useEffect(() => {
    if (!available || !status?.login) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api.get<Status>('/codex/account');
        if (active) { setStatus(next); setError(''); }
        if (active && next.login) timer = setTimeout(poll, 2500);
      } catch {
        if (active) { setError('Could not refresh sign-in status. Retrying…'); timer = setTimeout(poll, 5000); }
      }
    };
    timer = setTimeout(poll, 2500);
    return () => { active = false; clearTimeout(timer); };
  }, [available, !!status?.login]);

  const action = async (fn: () => Promise<Partial<Status> | void>) => {
    const current = generation.current;
    const previous = status;
    setBusy(true); setError('');
    try {
      const next = await fn();
      if (mounted.current && current === generation.current) {
        if (next) setStatus(value => ({ connected: false, selected: false, busy: false, account: null, login: null, error: null, ...value, ...next }));
        window.dispatchEvent(new Event(AI_CONNECTION_CHANGED));
      }
    } catch (e: any) {
      if (mounted.current && current === generation.current) {
        setStatus(previous);
        setError(e?.message || 'The Codex account operation failed.');
      }
    } finally { if (mounted.current && current === generation.current) setBusy(false); }
  };

  if (!loading && !error && !available && !['self-hosted', 'unconfigured'].includes(deploymentMode)) return null;
  if (!available) return <section className="set-card p-4 mb-5" aria-labelledby="codex-setup-heading">
    <h2 id="codex-setup-heading" className="font-semibold">Personal Codex connection</h2>
    {loading ? <p role="status" className="mt-2 text-sm text-set-dim">Checking this deployment…</p> : <>
      {error ? <p role="alert" className="mt-2 text-sm text-red-300">{error}</p> : <>
        <p className="mt-2 text-sm text-set-dim">
          Codex is not enabled in the SET server that this app is currently using. Current Docker self-hosts include the official Codex CLI and personal ChatGPT sign-in by default after a rebuild.
        </p>
        <pre className="mt-3 rounded-lg bg-set-panel2 p-3 text-xs overflow-x-auto whitespace-pre-wrap break-words">git pull{`\n`}docker compose up -d --build</pre>
        <p className="mt-2 text-xs text-set-dim">
          Non-Docker: install the supported Codex CLI, set SET_DEPLOYMENT_MODE=self-hosted and SET_CODEX_OAUTH_ENABLED=1, then restart SET. This button only checks the server again; browser code cannot turn a server feature on.
        </p>
      </>}
      <button type="button" className="set-btn-primary mt-3 min-h-11" onClick={() => setRetry(v => v + 1)}>Recheck Codex</button>
    </>}
  </section>;

  return (
    <section className="set-card p-4 mb-5" aria-labelledby="personal-codex-heading" aria-busy={busy || loading}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="personal-codex-heading" className="font-semibold text-set-text">Codex · Sign in with ChatGPT</h2>
          <p className="text-xs text-set-dim mt-1">Personal connection · self-hosted only</p>
        </div>
        <span className="text-xs text-set-dim">{loading ? 'Checking connection…' : status?.connected ? 'Connected' : 'Not connected'}</span>
      </div>
      <p className="text-sm text-set-dim mt-3 mb-3">
        Run SET Copilot through the official Codex app server using your own ChatGPT account. Workspace permissions and approval prompts still apply.
      </p>
      {status?.account && <p className="text-sm text-set-text mb-3">{status.account.email}{status.account.planType ? ` · ${status.account.planType}` : ''}</p>}
      {status?.login ? (
        <div className="rounded-lg border border-set-border p-3 space-y-3">
          <p className="text-sm text-set-text">Open ChatGPT sign-in and enter this code:</p>
          <code className="block text-xl tracking-widest text-set-text select-all">{status.login.userCode}</code>
          <div className="flex flex-wrap gap-2">
            <a className="set-btn-primary text-sm min-h-11 inline-flex items-center" href={status.login.verificationUrl} target="_blank" rel="noopener noreferrer">Continue with ChatGPT</a>
            <button className="set-btn-ghost text-sm min-h-11" disabled={busy || loading} onClick={() => void action(() => api.post<Status>('/codex/login/cancel', {}))}>Cancel sign-in</button>
          </div>
          <p className="text-xs text-set-dim">SET never asks you to paste a subscription token or device code into a form.</p>
        </div>
      ) : status?.connected ? (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-set-text min-h-11">
            <input type="checkbox" checked={status.selected} disabled={busy || loading || status.busy}
              onChange={e => {
                const enabled = e.target.checked;
                setStatus(previous => previous ? { ...previous, selected: enabled } : previous);
                void action(() => api.put<{ selected: boolean }>('/codex/selection', { enabled }));
              }} />
            Use Codex for my Copilot
          </label>
          <p className="text-xs text-set-dim">This applies only to your account. Other members keep their own provider choices.</p>
          <button className="set-btn-ghost text-sm min-h-11" disabled={busy || loading} onClick={() => void action(async () => {
            await api.post('/codex/logout', {});
            return { connected: false, selected: false, busy: false, account: null, login: null, error: null };
          })}>Disconnect Codex</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button className="set-btn-primary text-sm min-h-11" disabled={busy || loading} onClick={() => void action(() => api.post<Status>('/codex/login', {}))}>Sign in with ChatGPT</button>
          {status?.selected && <button className="set-btn-ghost text-sm min-h-11" disabled={busy || loading} onClick={() => void action(() => api.put<{ selected: boolean }>('/codex/selection', { enabled: false }))}>Use workspace provider instead</button>}
        </div>
      )}
      {(error || status?.error) && <div><p role="alert" className="text-sm text-red-300 mt-3">{error || status?.error}</p><button type="button" className="set-btn mt-2 min-h-11" disabled={busy} onClick={() => setRetry(v => v + 1)}>Refresh connection</button></div>}
      {status?.busy && <p role="status" className="text-xs text-set-dim mt-3">A Codex run is in progress. Disconnecting stops that connection.</p>}
      <p className="text-xs text-set-dim mt-4">Credentials are stored in this self-hosted server’s private per-user Codex directory.</p>
    </section>
  );
}
