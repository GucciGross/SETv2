import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { activityApi, type H5PActivity } from './api';
import { mountNativeEditor, type EditorModel, type NativeEditor } from './native-editor';
import './native-editor.css';

/** Authoring lives in SET's document, with no outer or inner editor iframe. */
export default function H5PNativeEditor({ activity, onDirty, onSaved }: {
  activity: H5PActivity; onDirty?: (dirty: boolean) => void; onSaved?: (activity: H5PActivity) => void;
}) {
  const container = useRef<HTMLDivElement>(null), editor = useRef<NativeEditor>();
  const callbacks = useRef({ onDirty, onSaved }); callbacks.current = { onDirty, onSaved };
  const [error, setError] = useState(''), [ready, setReady] = useState(false), [saving, setSaving] = useState(false), [attempt, setAttempt] = useState(0);
  const sending = useRef(false), dirty = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setReady(false); setError(''); dirty.current = false;
    const setup = async () => {
      const launch = await api.post<{ url: string }>(activityApi(activity.id, '/launch'), { mode: 'edit' });
      if (controller.signal.aborted) return;
      const url = new URL(launch.url, location.href);
      if (url.origin !== location.origin || !/^\/api\/h5p\/runtime\/[^/]+\/editor$/.test(url.pathname)) throw new Error('Unexpected editor launch URL.');
      const response = await fetch(launch.url.replace(/\/editor$/, '/editor-model'), { signal: controller.signal, credentials: 'same-origin' });
      const model = await response.json();
      if (!response.ok) throw new Error(model.error ?? 'H5P editor could not load.');
      if (controller.signal.aborted || !container.current) return;
      const native = await mountNativeEditor(container.current, model as EditorModel, controller.signal, () => { dirty.current = true; callbacks.current.onDirty?.(true); }, setError);
      if (controller.signal.aborted) native.destroy(); else { editor.current = native; setReady(true); }
    };
    void setup().catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => { controller.abort(); editor.current?.destroy(); editor.current = undefined; };
  }, [activity.id, activity.draftRevision, attempt]);
  const save = async () => {
    if (sending.current || !editor.current) return;
    try {
      const content = editor.current.read();
      sending.current = true; setSaving(true); setError('');
      if (container.current) container.current.inert = true;
      // Normal authenticated SET API + explicit revision; long-lived drafts never silently
      // adopt a newer revision or mistake a media capability expiration for session logout.
      const result = await api.post<{ activity: H5PActivity }>(activityApi(activity.id, '/draft'), { ...content, expectedRevision: activity.draftRevision });
      dirty.current = false; callbacks.current.onDirty?.(false); callbacks.current.onSaved?.(result.activity);
    } catch (reason: any) { setError(reason.message); }
    finally { sending.current = false; setSaving(false); if (container.current) container.current.inert = false; }
  };
  return <section aria-label="Native H5P editor" className="min-w-0">
    <div className="flex flex-wrap gap-3 items-center mb-3">
      <button type="button" className="set-btn-primary min-h-11" disabled={!ready || saving} onClick={() => void save()}>{saving ? 'Saving draft…' : 'Save draft'}</button>
      <span role="status" className="text-sm text-set-dim">{ready ? 'All authoring fields are on this page. Drafts stay private until you publish.' : 'Loading authoring tools…'}</span>
    </div>
    {error && <div className="set-card p-3 mb-3 border-red-500/40 text-sm" role="alert"><p>{error}</p><button className="set-btn mt-2 min-h-11" onClick={() => { if (!dirty.current || confirm('Reload the editor and discard unsaved changes?')) { callbacks.current.onDirty?.(false); setAttempt(n => n + 1); } }}>Reload editor</button></div>}
    <div className="set-h5p-native"><div ref={container} /></div>
    {ready && <button type="button" className="set-btn-primary mt-4 min-h-11" disabled={saving} onClick={() => void save()}>Save draft</button>}
  </section>;
}
