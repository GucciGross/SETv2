import { useEffect, useRef, useState } from 'react';
import { Mail } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, getToken } from '../lib/api';
import Mascot, { DEFAULT_MASCOT } from '../components/Mascot';

/** Redeem an emailed workspace invite. Requires being signed in as the invited email. */
export default function Join() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [state, setState] = useState<'working' | 'done' | 'error' | 'missing'>('working');
  const [error, setError] = useState('');
  const [spaceName, setSpaceName] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (!token) {
      setState('missing');
      return;
    }
    if (!getToken()) {
      // stash the invite so Login can route back here after auth
      sessionStorage.setItem('set_join_token', token);
      navigate('/login');
      return;
    }
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const res = await api.post('/spaces/join', { token });
        setSpaceName(res.spaceName ?? 'your workspace');
        setState('done');
        setTimeout(() => navigate(`/app/space/${res.spaceId}`), 1400);
      } catch (e: any) {
        setError(e.message);
        setState('error');
      }
    })();
  }, [token, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-set-bg via-[#101422] to-[#141126]">
      <div className="set-card p-8 max-w-md w-full text-center space-y-4">
        {state === 'working' && (
          <>
            <Mail size={36} className="text-set-accent animate-pulse" strokeWidth={1.5} />
            <h1 className="text-xl font-bold text-white">Accepting your invite…</h1>
            <p className="text-sm text-set-dim">Checking the invite link.</p>
          </>
        )}
        {state === 'done' && (
          <>
            <Mascot config={DEFAULT_MASCOT} mood="celebrating" size={90} />
            <h1 className="text-xl font-bold text-white">Welcome aboard!</h1>
            <p className="text-sm text-set-dim">
              You've joined <b className="text-set-text">{spaceName}</b>. Taking you there…
            </p>
          </>
        )}
        {(state === 'error' || state === 'missing') && (
          <>
            <Mascot config={{ ...DEFAULT_MASCOT, species: 'ghost' }} mood="idle" size={90} />
            <h1 className="text-xl font-bold text-white">{state === 'missing' ? 'Missing invite token' : 'Invite not accepted'}</h1>
            <p className="text-sm text-red-400">{state === 'missing' ? 'Open the invite link from your email, or ask the workspace owner to resend it.' : error}</p>
            <a href="/login" className="set-btn inline-block text-sm">Go to sign in</a>
          </>
        )}
      </div>
    </div>
  );
}
