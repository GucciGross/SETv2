import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../stores/app';
import { Database, FileText, Plus, Upload } from 'lucide-react';

/** Flat "all pages" list — the dashboard's Pages card lands here. */
export function PagesList() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const { pages, createPage, loadPages } = useApp();
  const [importing, setImporting] = useState(false);
  const sorted = [...pages].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));

  const importZip = async (file: File) => {
    if (!spaceId) return;
    setImporting(true);
    try {
      const res = await api.upload(`/spaces/${spaceId}/import-zip`, [file]);
      alert(`Imported ${res.pages} pages${res.databases ? `, ${res.databases} databases` : ''}${res.images ? `, ${res.images} images` : ''}.`);
      await loadPages(spaceId);
    } catch (e: any) {
      alert(`Import failed: ${e.message}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <h1 className="text-xl font-bold text-white">Pages</h1>
        <span className="text-sm text-set-dim">{pages.length}</span>
        <button
          className="set-btn ml-auto text-xs flex items-center gap-1.5"
          onClick={async () => {
            const page = await createPage({ spaceId: spaceId!, title: 'Untitled' });
            navigate(`/app/space/${spaceId}/page/${page.id}`);
          }}
        >
          <Plus size={13} /> New page
        </button>
        <label
          className="set-btn text-xs flex items-center gap-1.5 cursor-pointer"
          title="Import an Obsidian vault or Notion export (zip of .md files, images and CSVs)"
        >
          <Upload size={13} /> {importing ? 'Importing…' : 'Import ZIP'}
          <input type="file" hidden accept=".zip" disabled={importing} onChange={(e) => e.target.files?.[0] && importZip(e.target.files[0])} />
        </label>
      </div>
      {sorted.length === 0 && <p className="text-sm text-set-dim">No pages yet — create the first one.</p>}
      <div className="set-card divide-y divide-set-border/40">
        {sorted.map((p) => (
          <button
            key={p.id}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-set-panel2/40"
            onClick={() => navigate(`/app/space/${spaceId}/page/${p.id}`)}
          >
            <FileText size={14} className="text-set-dim shrink-0" />
            <span className="text-sm text-white truncate flex-1">{p.icon ? `${p.icon} ` : ''}{p.title}</span>
            {p.updated_at && (
              <span className="text-[11px] text-set-dim shrink-0">{new Date(p.updated_at).toLocaleDateString()}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** "All databases" list — the dashboard's Databases card lands here. */
export function DatabasesList() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const [dbs, setDbs] = useState<any[]>([]);

  useEffect(() => {
    if (!spaceId) return;
    api.get(`/spaces/${spaceId}/databases`).then((r) => setDbs(r.databases)).catch(() => {});
  }, [spaceId]);

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <h1 className="text-xl font-bold text-white">Databases</h1>
        <span className="text-sm text-set-dim">{dbs.length}</span>
      </div>
      {dbs.length === 0 && <p className="text-sm text-set-dim">No databases in this workspace yet.</p>}
      <div className="set-card divide-y divide-set-border/40">
        {dbs.map((d) => (
          <button
            key={d.id}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-set-panel2/40"
            onClick={() => navigate(`/app/space/${spaceId}/db/${d.id}`)}
          >
            <Database size={14} className="text-set-dim shrink-0" />
            <span className="text-sm text-white truncate flex-1">{d.name}</span>
            <span className="text-[11px] text-set-dim shrink-0">{d.row_count ?? 0} rows</span>
          </button>
        ))}
      </div>
    </div>
  );
}
