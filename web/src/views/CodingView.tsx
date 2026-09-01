import { useCallback, useEffect, useRef, useState } from 'react';
import { confirmDialog } from '../components/Confirm';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { Play, Save, FilePlus, Trash2, Loader2 } from 'lucide-react';

/** Coding surface: code files per space + sandboxed JavaScript runner. */
export default function CodingView() {
  const { spaceId } = useParams();
  const [files, setFiles] = useState<any[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<{ logs: string[]; result: string; ok: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    if (!spaceId) return;
    try {
      const r = await api.get(`/spaces/${spaceId}/code/files`);
      setFiles(r.files);
    } catch {
      setFiles([]);
    }
  }, [spaceId]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const open = async (p: string) => {
    if (!spaceId) return;
    const r = await api.get(`/spaces/${spaceId}/code/file?path=${encodeURIComponent(p)}`);
    setPath(p);
    setContent(r.content);
    setDirty(false);
    setOutput(null);
  };

  const save = async () => {
    if (!spaceId || !path) return;
    await api.put(`/spaces/${spaceId}/code/file`, { path, content });
    setDirty(false);
    loadFiles();
  };

  const run = async () => {
    if (!spaceId || (!content.trim() && !path)) return;
    setRunning(true);
    setOutput(null);
    try {
      const r = await api.post(`/spaces/${spaceId}/code/run`, path && !dirty ? { path } : { code: content });
      setOutput(r);
    } catch (e: any) {
      setOutput({ logs: [], result: e.message, ok: false });
    } finally {
      setRunning(false);
    }
  };

  const newFile = async () => {
    const name = prompt('File path (e.g. notes/solver.js):');
    if (!name || !spaceId) return;
    await api.put(`/spaces/${spaceId}/code/file`, { path: name, content: '// new file\n' });
    loadFiles();
    open(name);
  };

  return (
    <div className="h-full flex">
      <div className="w-56 shrink-0 border-r border-set-border bg-set-panel/60 overflow-y-auto p-2">
        <div className="flex items-center justify-between px-1 mb-2">
          <span className="text-[11px] uppercase tracking-wider text-set-dim font-semibold">Code files</span>
          <button className="set-btn-ghost p-1" title="New file" onClick={newFile}><FilePlus size={14} /></button>
        </div>
        {files.map((f) => (
          <div key={f.path} className="group flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-set-panel2 text-sm">
            <button className={`flex-1 text-left truncate ${path === f.path ? 'text-blue-200' : 'text-set-text'}`} onClick={() => open(f.path)}>
              {f.path}
            </button>
            <button
              className="opacity-0 group-hover:opacity-100 text-set-dim hover:text-red-400"
              onClick={async () => {
                if (!(await confirmDialog({ title: `Delete ${f.path}?`, danger: true, confirmLabel: 'Delete' }))) return;
                await api.del(`/spaces/${spaceId}/code/file?path=${encodeURIComponent(f.path)}`);
                if (path === f.path) { setPath(null); setContent(''); }
                loadFiles();
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {files.length === 0 && <p className="text-xs text-set-dim p-2">No files yet — create one with +.</p>}
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-11 border-b border-set-border flex items-center gap-2 px-3">
          <span className="text-sm font-mono text-set-dim truncate">{path ?? 'no file selected'}</span>
          {dirty && <span className="text-[10px] text-amber-300">unsaved</span>}
          <div className="ml-auto flex gap-2">
            <button className="set-btn text-xs flex items-center gap-1" onClick={save} disabled={!path || !dirty}>Save</button>
            <button className="set-btn-primary text-xs flex items-center gap-1" onClick={run} disabled={running || (!path && !content)}>
              {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Run
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden text-sm">
          {path ? (
            <CodeMirror
              value={content}
              height="100%"
              theme="dark"
              extensions={[javascript()]}
              onChange={(v: string) => {
                setContent(v);
                setDirty(true);
              }}
              basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
            />
          ) : (
            <div className="p-8 text-set-dim text-sm">Select or create a file. Code runs server-side in an isolated JavaScript sandbox (no filesystem or network access, 3s timeout).</div>
          )}
        </div>
        {output && (
          <div className="h-44 border-t border-set-border bg-set-panel/60 p-3 overflow-y-auto">
            <div className="text-[10px] uppercase text-set-dim mb-1 flex items-center gap-2">
              Output {!output.ok && <span className="text-red-400">error</span>}
            </div>
            {output.logs.map((l, i) => (
              <pre key={i} className="text-xs text-set-text/90 whitespace-pre-wrap font-mono">{l}</pre>
            ))}
            {output.result && (
              <pre className={`text-xs whitespace-pre-wrap font-mono ${output.ok ? 'text-green-300' : 'text-red-400'}`}>
                {output.ok ? `=> ${output.result}` : output.result}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
