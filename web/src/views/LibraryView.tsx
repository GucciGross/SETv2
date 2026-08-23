import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../stores/app';
import {
  LibraryBig, Database as DatabaseIcon, Folder, FileText, FileJson, FileCode2,
  Boxes, FileDown, Download, ChevronRight, Loader2, BookOpen,
} from 'lucide-react';

const MESH = ['.glb', '.gltf', '.stl', '.obj', '.urdf', '.step', '.stp'];
const DOCS = ['.md', '.markdown', '.txt', '.json', '.pdf', '.parquet'];

const extOf = (p: string) => p.slice(p.lastIndexOf('.')).toLowerCase();
const fmtSize = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b > 1e3 ? `${(b / 1e3).toFixed(0)} KB` : `${b} B`);

function FileIcon({ path }: { path: string }) {
  const ext = extOf(path);
  if (MESH.includes(ext)) return <Boxes size={14} className="text-blue-300 shrink-0" />;
  if (ext === '.json') return <FileJson size={14} className="text-amber-300 shrink-0" />;
  if (ext === '.pdf') return <FileText size={14} className="text-red-300 shrink-0" />;
  if (ext === '.parquet') return <DatabaseIcon size={14} className="text-violet-300 shrink-0" />;
  if (DOCS.includes(ext)) return <FileText size={14} className="text-green-300 shrink-0" />;
  return <FileCode2 size={14} className="text-set-dim shrink-0" />;
}

/** Library surface: browse curated open datasets and import files into the workspace. */
export default function LibraryView() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const { loadSurfaces } = useApp();
  const [catalog, setCatalog] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notebooks, setNotebooks] = useState<any[]>([]);
  const [notebookId, setNotebookId] = useState('new');

  useEffect(() => {
    api.get('/library/catalog').then((r) => setCatalog(r.catalog)).catch(() => {});
    if (spaceId) api.get(`/spaces/${spaceId}/notebooks`).then((r) => setNotebooks(r.notebooks)).catch(() => {});
  }, [spaceId]);

  const browse = useCallback(
    async (ds: string, sub: string) => {
      setError('');
      setEntries(null);
      try {
        const r = await api.get(`/library/datasets/${encodeURIComponent(ds)}/browse?spaceId=${spaceId}&path=${encodeURIComponent(sub)}`);
        setEntries(r.entries);
      } catch (e: any) {
        setError(e.message);
        setEntries([]);
      }
    },
    [spaceId]
  );

  const openDataset = (entry: any) => {
    setSelected(entry);
    setPath('');
    browse(entry.id, '');
  };

  const drill = (p: string) => {
    setPath(p);
    browse(selected.id, p);
  };

  const importFile = async (p: string) => {
    if (!selected || !spaceId) return;
    setBusy(p);
    setError('');
    try {
      const r = await api.post('/library/import', {
        spaceId,
        datasetId: selected.id,
        path: p,
        notebookId: notebookId === 'new' ? undefined : notebookId,
      });
      if (r.model) navigate(`/app/space/${spaceId}/model/${r.model.id}`);
      else if (r.notebookId) navigate(`/app/space/${spaceId}/notebook/${r.notebookId}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const crumbs = path ? path.split('/') : [];

  return (
    <div className="h-full overflow-y-auto p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1 flex items-center gap-2"><LibraryBig size={22} /> Library</h1>
      <p className="text-set-dim text-sm mb-5">
        Leverage what's already out there — curated open datasets from the HuggingFace Hub, importable straight into your notebooks, 3D viewer and files.
      </p>

      {!selected && (
        <div className="grid md:grid-cols-2 gap-3">
          {catalog.map((c) => (
            <button key={c.id} className="set-card p-4 text-left hover:border-set-accent/40 transition-colors" onClick={() => openDataset(c)}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-semibold text-white">{c.name}</span>
                <span className="text-[10px] uppercase tracking-wide text-set-dim border border-set-border rounded-full px-2 py-0.5">{c.category}</span>
              </div>
              <p className="text-xs text-set-dim leading-relaxed">{c.description}</p>
              <div className="text-[11px] text-blue-300 mt-2 flex items-center gap-1">
                Browse files <ChevronRight size={12} />
              </div>
            </button>
          ))}
          {catalog.length === 0 && <p className="text-set-dim text-sm">Catalog unavailable.</p>}
        </div>
      )}

      {selected && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <button className="set-btn-ghost text-xs" onClick={() => { setSelected(null); setEntries(null); setPath(''); }}>&larr; Catalog</button>
            <span className="font-semibold text-white">{selected.name}</span>
            <code className="text-[11px] text-set-dim">{selected.id}</code>
          </div>
          <p className="text-xs text-set-dim mb-3">{selected.importHint}</p>

          {DOCS.length > 0 && (
            <div className="flex items-center gap-2 mb-3 text-xs">
              <span className="text-set-dim">Import documents into:</span>
              <select className="set-input w-56 text-xs" value={notebookId} onChange={(e) => setNotebookId(e.target.value)}>
                <option value="new">New notebook</option>
                {notebooks.map((n) => (
                  <option key={n.id} value={n.id}>{n.title}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-1 text-xs mb-2 flex-wrap">
            <button className={`px-2 py-1 rounded ${path === '' ? 'bg-set-accent/20 text-blue-200' : 'text-set-dim hover:text-set-text'}`} onClick={() => drill('')}>
              root
            </button>
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className="text-set-dim">/</span>
                <button
                  className={`px-2 py-1 rounded ${i === crumbs.length - 1 ? 'bg-set-accent/20 text-blue-200' : 'text-set-dim hover:text-set-text'}`}
                  onClick={() => drill(crumbs.slice(0, i + 1).join('/'))}
                >
                  {c}
                </button>
              </span>
            ))}
          </div>

          {error && <div className="text-xs text-red-400 border border-red-500/30 bg-red-500/10 rounded-lg p-2 mb-3">{error}</div>}

          <div className="set-card divide-y divide-set-border/50">
            {entries === null && (
              <div className="p-4 text-sm text-set-dim flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading files…</div>
            )}
            {entries?.map((e) => {
              const isDir = e.type === 'directory';
              const ext = extOf(e.path);
              const importable = !isDir && (MESH.includes(ext) || DOCS.includes(ext));
              return (
                <div key={e.path} className="flex items-center gap-2 px-3 py-2 hover:bg-set-panel2/50">
                  {isDir ? <Folder size={14} className="text-amber-300 shrink-0" /> : <FileIcon path={e.path} />}
                  <button className="text-sm text-left flex-1 truncate hover:text-set-accent" onClick={() => isDir && drill(e.path)} title={e.path}>
                    {e.path.split('/').pop()}
                  </button>
                  <span className="text-[11px] text-set-dim w-16 text-right">{isDir ? '' : fmtSize(e.size)}</span>
                  {importable && (
                    <button
                      className="set-btn text-xs flex items-center gap-1"
                      disabled={busy === e.path}
                      onClick={() => importFile(e.path)}
                    >
                      {busy === e.path ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                      {MESH.includes(ext) ? 'Model' : 'Notebook'}
                    </button>
                  )}
                </div>
              );
            })}
            {entries?.length === 0 && !error && <div className="p-4 text-sm text-set-dim">Empty folder.</div>}
          </div>
          <p className="text-[11px] text-set-dim mt-3 flex items-center gap-1.5">
            <BookOpen size={12} /> Documents (.md .txt .json .pdf .parquet) become indexed notebook sources; meshes (.glb .stl .obj .urdf .step) open in the 3D viewer; anything else is stored as a file.
          </p>
        </div>
      )}
    </div>
  );
}
