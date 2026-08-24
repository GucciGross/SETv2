import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { ShieldCheck, ArrowRight } from 'lucide-react';
import { useApp } from '../stores/app';

/**
 * OAuth 2.1 consent screen — mirrors the login/registration design exactly
 * (same gradient page, set-card panel, palette and typography).
 */
export default function Consent() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, spaces } = useApp();
  const clientId = params.get('client_id') ?? '';
  const clientName = params.get('client_name') ?? 'An MCP client';
  const redirectUri = params.get('redirect_uri') ?? '';
  const codeChallenge = params.get('code_challenge') ?? '';
  const state = params.get('state') ?? '';

  const [spaceId, setSpaceId] = useState('');
  const [scope, setScope] = useState<'mcp:read' | 'mcp:read mcp:write'>('mcp:read');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (spaces.length && !spaceId) setSpaceId(spaces[0].id);
  }, [spaces, spaceId]);

  useEffect(() => {
    if (!user) navigate(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const approve = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/oauth/consent', {
        clientId,
        spaceId,
        scope,
        redirectUri,
        codeChallenge,
        state,
      });
      window.location.href = r.redirect_to;
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] overflow-y-auto bg-gradient-to-br from-set-bg via-[#101422] to-[#141126]">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2 font-bold text-white">SET</div>
          <p className="text-set-dim text-sm flex items-center justify-center gap-1.5">
            <ShieldCheck size={14} className="text-green-400" /> Authorization request
          </p>
        </div>
        <div className="set-card p-6 space-y-5">
          <p className="text-sm text-set-text leading-relaxed">
            <span className="text-white font-semibold">{clientName}</span> wants to connect to your SET workspace as an
            MCP client. It will act with your permissions.
          </p>

          <div>
            <div className="text-xs text-set-dim mb-1.5">Workspace to grant</div>
            <select className="set-input" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>{s.icon} {s.name}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-xs text-set-dim mb-1.5">Access level</div>
            <div className="space-y-2">
              <label className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${scope === 'mcp:read' ? 'border-set-accent bg-set-accent/10' : 'border-set-border hover:border-set-dim'}`}>
                <input type="radio" className="accent-set-accent mt-0.5" checked={scope === 'mcp:read'} onChange={() => setScope('mcp:read')} />
                <span>
                  <span className="block text-sm text-white">Read-only</span>
                  <span className="block text-xs text-set-dim">Search, read pages, databases, notebooks, tasks and activity.</span>
                </span>
              </label>
              <label className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${scope === 'mcp:read mcp:write' ? 'border-set-accent bg-set-accent/10' : 'border-set-border hover:border-set-dim'}`}>
                <input type="radio" className="accent-set-accent mt-0.5" checked={scope === 'mcp:read mcp:write'} onChange={() => setScope('mcp:read mcp:write')} />
                <span>
                  <span className="block text-sm text-white">Read &amp; write</span>
                  <span className="block text-xs text-set-dim">Also create and edit pages, comments, database rows, sources and study material. Respects your role.</span>
                </span>
              </label>
            </div>
          </div>

          <div className="text-[11px] text-set-dim break-all">Redirects to: {redirectUri}</div>

          {error && <div className="text-red-400 text-sm">{error}</div>}

          <div className="flex gap-2">
            <button
              className="set-btn-primary flex-1 py-2.5 flex items-center justify-center gap-2"
              disabled={busy || !spaceId}
              onClick={approve}
            >
              {busy ? 'Connecting…' : 'Approve access'} {!busy && <ArrowRight size={14} />}
            </button>
            <button className="set-btn py-2.5 px-4" onClick={() => (window.location.href = '/')}>Deny</button>
          </div>

          <p className="text-[11px] text-set-dim text-center">
            You can revoke this client anytime in <Link to="/app" className="text-set-accent hover:underline">Settings → MCP</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
