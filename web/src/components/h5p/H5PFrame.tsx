import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { activityApi, type H5PActivity } from './api';

type Launch = { url: string; nonce: string; expiresAt: string };
/** Each instance has its own document, scoped launch grant and message source. */
export default function H5PFrame({ activity, mode, onSaved, onDirty, onProgress }: {
  activity: H5PActivity; mode: 'edit' | 'preview' | 'play';
  onSaved?: (activity: H5PActivity) => void; onDirty?: (dirty: boolean) => void; onProgress?: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const handlers = useRef({ onSaved, onDirty, onProgress });
  handlers.current = { onSaved, onDirty, onProgress };
  useEffect(() => {
    let active = true;
    setLaunch(null); setError(''); setReady(false);
    api.post<Launch>(activityApi(activity.id, '/launch'), { mode }).then((result) => {
      if (active) setLaunch(result);
    }).catch((reason) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [activity.id, activity.draftRevision, activity.publishedRevision, mode, retry]);
  useEffect(() => {
    if (!launch) return;
    const origin = new URL(launch.url, location.href).origin;
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin || event.data?.source !== 'set-h5p' || event.data?.nonce !== launch.nonce) return;
      if (event.data.type === 'ready') setReady(true);
      if (event.data.type === 'error') setError(typeof event.data.message === 'string' ? event.data.message : 'The activity could not load.');
      if (event.data.type === 'dirty') handlers.current.onDirty?.(true);
      if (event.data.type === 'saved' && event.data.activity?.id === activity.id) {
        setError(''); handlers.current.onDirty?.(false); handlers.current.onSaved?.(event.data.activity);
      }
      if (event.data.type === 'progress') handlers.current.onProgress?.();
    };
    window.addEventListener('message', receive);
    const timeout = setTimeout(() => setError('This launch has expired. Reopen the activity to continue. Unsaved editor changes should be copied before reopening.'), Math.max(0, Date.parse(launch.expiresAt) - Date.now()));
    return () => { window.removeEventListener('message', receive); clearTimeout(timeout); };
  }, [launch, activity.id]);
  useEffect(() => {
    if (!launch || ready || error) return;
    const timeout = setTimeout(() => setError('H5P did not finish loading. Check the server connection and installed content libraries, then reopen the activity.'), 30_000);
    return () => clearTimeout(timeout);
  }, [launch, ready, error]);
  const inspectDocument = () => {
    // A revoked grant or failed reverse proxy can return JSON/HTML instead of our
    // bridge document. Such a response cannot post a ready/error message itself.
    try {
      const document = frame.current?.contentDocument;
      if (!document || document.URL === 'about:blank') return;
      if (document.documentElement.dataset.setH5p === 'true') return;
      if (document.contentType.includes('json')) {
        const result = JSON.parse(document.body.textContent ?? '{}');
        setError(typeof result.error === 'string' ? result.error : 'The H5P server rejected this launch. Reopen the activity.');
      } else {
        setError('The H5P server returned an unexpected page. Check that the web and server deployments are up to date, then reopen the activity.');
      }
    } catch {
      // Cross-origin deployments may not expose their document; the verified
      // message handshake and bounded loading timeout remain authoritative.
    }
  };
  return <div className="min-w-0 w-full">
    {error && <div role="alert" className="set-card p-3 mb-3 border-red-500/40 text-sm">
      <p>{error}</p><button className="set-btn mt-2" onClick={() => {
        if (mode !== 'edit' || confirm('Reopen the editor? Unsaved changes will be discarded.')) { handlers.current.onDirty?.(false); setRetry((n) => n + 1); }
      }}>Reopen activity</button>
    </div>}
    {!ready && !error && <p role="status" className="p-4 text-sm text-set-dim">Loading {mode === 'edit' ? 'the H5P editor' : 'interactive content'}…</p>}
    {launch && <iframe ref={frame} src={launch.url} onLoad={inspectDocument} title={`${mode === 'edit' ? 'Edit' : 'Play'} ${activity.title}`}
      className="w-full rounded-lg border border-set-border bg-white" style={{ height: mode === 'edit' ? 'min(80vh, 1000px)' : 'min(72vh, 850px)', minHeight: 420 }}
      sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" allow="fullscreen" allowFullScreen referrerPolicy="no-referrer" />}
  </div>;
}
