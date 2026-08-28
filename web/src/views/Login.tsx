import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, BookOpen } from 'lucide-react';
import { api, setToken } from '../lib/api';
import { useApp } from '../stores/app';
import ShaderBackground from '../components/ShaderBackground';
import FloatingIcons from '../components/FloatingIcons';
import Mascot, { DEFAULT_MASCOT, type MascotMood } from '../components/Mascot';
import { DitherButton } from '../components/dither-kit';

/**
 * Login — the orbit gate. The landing hero's nebula behind, SET's surfaces
 * as grabbable 3D glass tiles drifting around the room (FloatingIcons), and
 * the Pixel mascot in the portal. The mascot reacts to the form: it leans in
 * while you authenticate, kicks on a reject, celebrates the way in.
 */

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mood, setMood] = useState<MascotMood>('idle');
  const [rejected, setRejected] = useState(0); // bumps on each failed attempt
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMood('thinking');
    try {
      const res = mode === 'login'
        ? await api.post('/auth/login', { email, password })
        : await api.post('/auth/register', { email, name: name.trim() || undefined, password });
      setToken(res.token);
      useApp.setState({ user: res.user });
      setMood('celebrating');
      // one beat so the celebration reads, then through the gate
      await new Promise((r) => setTimeout(r, 750));
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
      setMood('idle');
      setRejected((n) => n + 1);
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center overflow-y-auto overflow-x-hidden bg-set-bg p-6 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <ShaderBackground />
      <FloatingIcons />

      {/* pointer-events-none so tiles stay grabbable underneath; interactive
          children opt back in. m-auto (not justify-center) so an overflowing
          page scrolls to its top instead of clipping it. */}
      <div className="pointer-events-none relative z-10 m-auto w-full max-w-md">
        <a
          href="/"
          className="login-rise set-mono set-mono-dim pointer-events-auto mx-auto mb-7 flex w-fit items-center gap-1.5 hover:text-set-text transition-colors"
          style={{ animationDelay: '0.05s' }}
        >
          <ArrowLeft size={12} /> BACK TO SET HOME
        </a>

        {/* the emblem — Pixel in a pulsing portal, satellite circling */}
        <div className="login-rise relative mx-auto mb-5 h-28 w-28" style={{ animationDelay: '0.12s' }}>
          <div className="absolute inset-2 rounded-full bg-set-accent/25 blur-2xl" aria-hidden />
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="login-ring absolute inset-0 rounded-full border border-set-accent/40"
              style={{ animationDelay: `${i * 1.13}s` }}
              aria-hidden
            />
          ))}
          <span className="login-orbit absolute inset-[-9px]" aria-hidden>
            <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-violet-300 shadow-[0_0_8px_rgb(139_92_246/0.9)]" />
          </span>
          <div key={rejected} className={`absolute inset-0 grid place-items-center ${rejected ? 'mascot-reject' : ''}`}>
            <Mascot config={DEFAULT_MASCOT} mood={mood} size={86} />
          </div>
        </div>

        <div className="login-rise text-center" style={{ animationDelay: '0.2s' }}>
          <h1 className="login-wordmark text-6xl font-black tracking-tight drop-shadow-[0_0_28px_rgb(108_140_255/0.35)]">SET</h1>
          <p className="set-mono set-mono-dim mt-2.5">
            MEET SET · KNOWLEDGE + LEARNING OS
            <span className="mt-1 block text-set-accent/80">SELF-HOSTED · YOUR DATA · YOUR LLM</span>
          </p>
        </div>

        {/* the gate */}
        <div className="login-rise set-card set-corners pointer-events-auto relative mt-8 overflow-hidden" style={{ animationDelay: '0.3s', background: 'rgb(15 20 35 / 0.72)', backdropFilter: 'blur(18px)' }}>
          <div className="tex-dither absolute inset-0 opacity-50" aria-hidden />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-set-accent/60 to-transparent" aria-hidden />
          <form onSubmit={submit} className="relative space-y-3.5 p-6">
            {/* sliding segmented control */}
            <div className="relative flex rounded-xl border border-set-border/60 bg-set-panel2/60 p-1">
              <span
                className={`absolute bottom-1 top-1 left-1 w-[calc(50%-4px)] rounded-lg bg-set-accent shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_2px_10px_-2px_rgb(108_140_255/0.7)] transition-transform duration-300 ease-out ${mode === 'register' ? 'translate-x-full' : ''}`}
                aria-hidden
              />
              {(['login', 'register'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setError(''); }}
                  className={`relative z-10 flex-1 rounded-lg py-2 text-sm transition-colors duration-200 ${mode === m ? 'font-semibold text-white' : 'text-set-dim hover:text-set-text'}`}
                >
                  {m === 'login' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>

            {mode === 'register' && (
              <input className="login-input fadein" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            )}
            <input className="login-input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            <input className="login-input" type="password" placeholder="Password (min 8 chars)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />

            {error && (
              <div key={error} className="login-shake flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                <AlertTriangle size={15} className="shrink-0" /> {error}
              </div>
            )}

            <DitherButton
              type="submit"
              color="blue"
              variant="gradient"
              bloom="low"
              disabled={busy}
              className="mt-1 w-full rounded-xl py-3.5 text-sm font-semibold text-white"
            >
              {busy ? 'OPENING THE GATE…' : mode === 'login' ? 'SIGN IN' : 'CREATE ACCOUNT'}
            </DitherButton>

            <div className="flex items-center justify-center pt-0.5">
              {mode === 'login' ? (
                <a href="/reset" className="text-xs text-set-dim hover:text-set-accent transition-colors">Forgot password?</a>
              ) : (
                <span className="text-xs text-set-dim">Spaces, graph and notebooks — all yours in a minute</span>
              )}
            </div>

            <div className="flex items-center justify-center gap-1.5 border-t border-set-border/40 pt-3 set-mono set-mono-dim">
              <span className="h-1.5 w-1.5 rounded-full bg-set-ok shadow-[0_0_6px_rgb(52_211_153/0.9)]" style={{ animation: 'mascot-pulse 2.2s ease-in-out infinite' }} />
              DATA STAYS IN YOUR POSTGRES · AGPL-3.0
            </div>
            <p className="text-center text-xs">
              <a href="/docs" className="inline-flex items-center gap-1 text-set-accent hover:underline">
                <BookOpen size={12} /> New to SET? Read the docs
              </a>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
