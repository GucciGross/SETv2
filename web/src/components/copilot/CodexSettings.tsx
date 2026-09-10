import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useApp } from '../../stores/app';

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
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);

  useEffect(() => {
    let active = true; mounted.current = true;
    setAvailable(false); setStatus(null); setError('');
    void api.get('/codex/capabilities').then(async result => {
      if (!active || result.available !== true) return;
      setAvailable(true);
      const next = await api.get<Status>('/codex/account');
      if (active) setStatus(next);
    }).catch(() => { if (active) setError('The personal Codex connection could not be loaded. Check the server installation.'); });
    return () => { active = false; mounted.current = false; };
  }, [userId]);

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
    setBusy(true); setError('');
    try { const next = await fn(); if (mounted.current && next) setStatus(previous => ({ connected: false, selected: false, busy: false, account: null, login: null, error: null, ...previous, ...next })); }
    catch (e: any) { if (mounted.current) setError(e?.message || 'The Codex account operation failed.'); }
    finally { if (mounted.current) setBusy(false); }
  };

  // Neither the card nor its controls are rendered for cloud deployments.
  if (!available) return null;
  return (
    <section className="set-card p-4 mb-5" aria-labelledby="personal-codex-heading" aria-busy={busy}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="personal-codex-heading" className="font-semibold text-set-text">Codex · Sign in with ChatGPT</h2>
          <p className="text-xs text-set-dim mt-1">Personal connection · self-hosted only</p>
        </div>
        <span className="text-xs text-set-dim">{status?.connected ? 'Connected' : 'Not connected'}</span>
      </div>
      <p className="text-sm text-set-dim mt-3 mb-3">
        Run your SET Copilot through the official Codex app server using your own ChatGPT account.
        Your workspace permissions and approval prompts still apply. This does not supply embeddings, transcription, or other API services.
      </p>
      {status?.account && <p className="text-sm text-set-text mb-3">{status.account.email}{status.account.planType ? ` · ${status.account.planType}` : ''}</p>}
      {status?.login ? (
        <div className="rounded-lg border border-set-border p-3 space-y-3">
          <p className="text-sm text-set-text">Open the sign-in page and enter this code:</p>
          <code className="block text-xl tracking-widest text-set-text select-all">{status.login.userCode}</code>
          <div className="flex flex-wrap gap-2">
            <a className="set-btn-primary text-sm" href={status.login.verificationUrl} target="_blank" rel="noopener noreferrer">Continue with ChatGPT</a>
            <button className="set-btn-ghost text-sm" disabled={busy} onClick={() => void action(() => api.post<Status>('/codex/login/cancel', {}))}>Cancel sign-in</button>
          </div>
          <p className="text-xs text-set-dim">Device-code sign-in may need to be enabled in your ChatGPT security settings or by your workspace administrator.</p>
        </div>
      ) : status?.connected ? (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-set-text min-h-11">
            <input type="checkbox" checked={status.selected} disabled={busy || status.busy}
              onChange={e => {
                const enabled = e.target.checked;
                // Optimistic: a controlled checkbox needs local state at click time,
                // or React snaps it back until the PUT round-trip lands (double-click
                // then silently un-selects). ponytail: no revert-on-error — the alert
                // below reports the failure; re-fetch /codex/account if that matters.
                setStatus(previous => previous ? { ...previous, selected: enabled } : previous);
                void action(() => api.put<{ selected: boolean }>('/codex/selection', { enabled }));
              }} />
            Use Codex for my Copilot
          </label>
          <p className="text-xs text-set-dim">This applies only to your account. Other members keep their provider choices. Subscription limits still apply; failures do not silently switch to a paid API.</p>
          <button className="set-btn-ghost text-sm" disabled={busy} onClick={() => void action(async () => {
            await api.post('/codex/logout', {});
            return { connected: false, selected: false, busy: false, account: null, login: null, error: null };
          })}>Disconnect Codex</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button className="set-btn-primary text-sm" disabled={busy} onClick={() => void action(() => api.post<Status>('/codex/login', {}))}>Sign in with ChatGPT</button>
          {status?.selected && <button className="set-btn-ghost text-sm" disabled={busy} onClick={() => void action(() => api.put<{ selected: boolean }>('/codex/selection', { enabled: false }))}>Use workspace provider instead</button>}
        </div>
      )}
      {(error || status?.error) && <p role="alert" className="text-sm text-red-300 mt-3">{error || status?.error}</p>}
      {status?.busy && <p role="status" className="text-xs text-set-dim mt-3">A Codex run is in progress. Disconnecting stops that connection.</p>}
      <p className="text-xs text-set-dim mt-4">Codex stores and refreshes credentials in this self-hosted server’s private per-user directory. The server operator must be trusted. Do not share your device code.</p>
    </section>
  );
}
