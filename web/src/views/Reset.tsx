import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';

/** Forgot / reset password flow (public). */
export default function Reset() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [loginPath, setLoginPath] = useState('/login');

  // Private preview: /login renders the public self-host page, so sign-in
  // handoffs use the unlinked private route instead.
  useEffect(() => {
    api.get('/meta').then((r) => {
      if (r.privatePreview) setLoginPath('/private/login');
    }).catch(() => {});
  }, []);

  const requestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    await api.post('/auth/forgot', { email }).catch(() => {});
    setMsg('If that account exists, a reset link has been sent (or check the server logs if email is not configured).');
    setBusy(false);
  };

  const doReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      await api.post('/auth/reset', { token, password });
      // Navigation waits for the async meta probe: in private preview /login is
      // the public self-host page, so the sign-in route is /private/login.
      // Navigating before meta resolves lands fresh teammates on the wrong page.
      api.get('/meta')
        .then((r) => (r.privatePreview ? '/private/login' : '/login'))
        .then((path) => navigate(path))
        .catch(() => navigate('/login'));
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] overflow-y-auto bg-gradient-to-br from-set-bg via-[#101422] to-[#141126]">
      <form onSubmit={token ? doReset : requestReset} className="w-full max-w-md set-card p-6 space-y-4">
        <h1 className="text-xl font-bold text-white">{token ? 'Choose a new password' : 'Reset your password'}</h1>
        {token ? (
          <>
            <input className="set-input" type="password" placeholder="New password (min 8 chars)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            <button className="set-btn-primary w-full py-2" disabled={busy}>{busy ? '…' : 'Set password'}</button>
          </>
        ) : (
          <>
            <input className="set-input" type="email" placeholder="Your account email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <button className="set-btn-primary w-full py-2" disabled={busy}>{busy ? '…' : 'Send reset link'}</button>
          </>
        )}
        {msg && <div className="text-sm text-set-dim">{msg}</div>}
        <Link to={loginPath} className="block text-center text-xs text-set-dim hover:text-set-text">&larr; back to sign in</Link>
      </form>
    </div>
  );
}
