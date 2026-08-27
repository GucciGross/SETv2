import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../lib/api';
import { useApp } from '../stores/app';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = mode === 'login'
        ? await api.post('/auth/login', { email, password })
        : await api.post('/auth/register', { email, name: name.trim() || undefined, password });
      setToken(res.token);
      useApp.setState({ user: res.user });
      // return to a pending workspace invite if Login was reached from /join
      const pendingJoin = sessionStorage.getItem('set_join_token');
      if (pendingJoin) {
        sessionStorage.removeItem('set_join_token');
        navigate(`/join?token=${encodeURIComponent(pendingJoin)}`);
      } else {
        navigate('/app');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] overflow-y-auto bg-set-bg">
      {/* dither floor — brand texture instead of a flat gradient void */}
      <div className="pointer-events-none absolute inset-0 tex-grid opacity-70" aria-hidden />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[45vh] tex-dither dither-mask-t opacity-80"
        aria-hidden
        style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgb(108 140 255 / 0.14) 1px, transparent 1.15px), radial-gradient(circle at 1px 1px, rgb(139 92 246 / 0.1) 1px, transparent 1.15px)' }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-set-accent/40 to-transparent" aria-hidden />
      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <a href="/" className="text-xs text-set-dim hover:text-set-text">&larr; back to set home</a>

          <h1 className="text-3xl font-bold text-white mt-4 tracking-tight">SET</h1>
          <p className="set-mono set-mono-dim mt-2">KNOWLEDGE + LEARNING OS · SELF-HOSTED</p>
        </div>
        <form onSubmit={submit} className="set-card set-corners p-6 space-y-4">
          <div className="flex gap-2 p-1 bg-set-panel2 rounded-lg border border-set-border/60">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 py-1.5 rounded-md text-sm transition-colors ${mode === m ? 'bg-set-accent text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]' : 'text-set-dim hover:text-set-text'}`}
              >
                {m === 'login' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>
          {mode === 'register' && (
            <input className="set-input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          )}
          <input className="set-input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="set-input" type="password" placeholder="Password (min 8 chars)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          {error && <div className="text-red-400 text-sm">{error}</div>}
          <button className="set-btn-primary w-full py-2" disabled={busy}>
            {busy ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
          {mode === 'login' && (
            <a href="/reset" className="text-xs text-set-dim hover:text-set-accent text-center">Forgot password?</a>
          )}
          <p className="text-xs text-set-dim text-center">
            Self-hosted · your data stays in your Postgres · bring your own LLM
          </p>
          <p className="text-xs text-center mt-2">
            <a href="/docs" className="text-set-accent hover:underline">New to SET? Read the docs</a>
          </p>
        </form>
      </div>
    </div>
  );
}
