import { useEffect, useState } from 'react';
import { PullToRefresh } from '../components/PullToRefresh';
import { toast } from '../components/Toast';
import { confirmDialog } from '../components/Confirm';
import { useLongPress } from '../lib/useLongPress';
import { haptic } from '../lib/haptic';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../stores/app';
import { Copy, Database, FileText, GitBranch, Plus, Share2, Trash2, Upload } from 'lucide-react';

/** Long-press / right-click actions for a page: duplicate, public link, trash. */
function PageActionsSheet({ page, spaceId, onDone, reload }: { page: any; spaceId: string; onDone: () => void; reload: () => void }) {
  const [busy, setBusy] = useState(false);

  const duplicate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const src = await api.get(`/pages/${page.id}`);
      await api.post('/pages', { spaceId, title: `${page.title} (copy)`, markdown: src.page?.markdown ?? '' });
      toast(`Duplicated as “${page.title} (copy)”`, 'ok');
      await reload();
      onDone();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.post(`/pages/${page.id}/share`);
      await navigator.clipboard.writeText(`${window.location.origin}/share/${r.share.token}`);
      toast('Public link copied to clipboard', 'ok');
      onDone();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const trash = async () => {
    if (busy) return;
    onDone();
    if (!(await confirmDialog({ title: `Move “${page.title}” to trash?`, body: 'It stays in Trash and can be restored.', confirmLabel: 'Trash', danger: true }))) return;
    await api.del(`/pages/${page.id}`);
    haptic(18);
    toast('Moved to trash', 'ok');
    reload();
  };

  const items = [
    { icon: <Copy size={15} />, label: 'Duplicate page', run: duplicate },
    { icon: <Share2 size={15} />, label: 'Copy public link', run: share },
    { icon: <Trash2 size={15} />, label: 'Move to trash', run: trash, danger: true },
  ];

  const body = (
    <>
      <div className="text-sm text-white truncate mb-1 px-0.5">{page.icon ? `${page.icon} ` : ''}{page.title}</div>
      <div className="space-y-1">
        {items.map((it) => (
          <button
            key={it.label}
            disabled={busy}
            onClick={it.run}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm active:scale-[0.98] transition-transform ${
              (it as any).danger ? 'text-red-300 hover:bg-red-500/10' : 'text-set-text hover:bg-set-panel2'
            }`}
          >
            {it.icon} {it.label}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/55" onClick={onDone} />
      <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-[71] set-card p-3 rounded-2xl shadow-2xl sheet-in md:hidden">
        {body}
      </div>
      <div className="hidden md:flex fixed inset-0 z-[71] items-center justify-center p-4 pointer-events-none">
        <div className="set-card bg-set-panel w-full max-w-xs p-4 shadow-2xl sheet-in pointer-events-auto">{body}</div>
      </div>
    </>
  );
}

/** Import a graphify codebase-graph vault as a page tree that mirrors the repo. */
function CodeGraphModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const loadSpaces = useApp((s) => s.loadSpaces);
  const [name, setName] = useState('');
  const [newSpace, setNewSpace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const pick = (f: File | null) => {
    setFile(f);
    if (f && !name.trim()) setName(f.name.replace(/\.zip$/i, '').replace(/[-_]+/g, ' ').trim());
  };

  const run = async () => {
    if (!file || busy) return;
    setBusy(true);
    try {
      const current = useApp.getState().currentSpaceId;
      const res = await api.upload(`/spaces/${current}/import-codegraph`, [file], {
        name: name.trim() || 'Codebase graph',
        newSpace: newSpace ? '1' : '0',
      });
      toast(`Imported ${res.pages} notes across ${res.directories} directories`, 'ok');
      if (newSpace) await loadSpaces();
      onClose();
      navigate(`/app/space/${res.spaceId}`);
    } catch (e: any) {
      toast(`Import failed: ${e.message}`, 'error');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="set-card bg-set-panel w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-white mb-1">Import codebase graph</h3>
        <p className="text-sm text-set-dim mb-4">
          Turn a repo into a living wiki: build the graph with graphify, export its Obsidian vault, upload it here.
          Pages mirror the repo tree; backlinks and the Graph work immediately.
        </p>
        <pre className="set-mono text-[11px] text-set-dim bg-set-panel2/60 border border-set-border rounded-lg p-2.5 mb-4 overflow-x-auto">{`uv tool install graphifyy
graphify extract <repo> --code-only
graphify export obsidian --dir vault
zip -r vault.zip vault`}</pre>
        <input
          className="set-input mb-2"
          placeholder="Graph name (e.g. SETv2 codebase)"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-set-dim mb-4 cursor-pointer select-none">
          <input type="checkbox" checked={newSpace} onChange={(e) => setNewSpace(e.target.checked)} />
          Create a new workspace for it
        </label>
        <label
          className={`set-btn w-full flex items-center justify-center gap-1.5 mb-4 cursor-pointer ${file ? 'text-set-accent' : ''}`}
        >
          <Upload size={13} /> {file ? file.name : 'Choose vault zip…'}
          <input type="file" hidden accept=".zip" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        </label>
        <div className="flex gap-2">
          <button className="set-btn-primary text-sm flex-1" disabled={!file || busy} onClick={run}>
            {busy ? 'Importing…' : 'Import'}
          </button>
          <button className="set-btn-ghost text-sm" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/** Flat "all pages" list — the dashboard's Pages card lands here. */
export function PagesList() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const { pages, createPage, loadPages } = useApp();
  const [importing, setImporting] = useState(false);
  const [codegraphOpen, setCodegraphOpen] = useState(false);
  const [actionsFor, setActionsFor] = useState<any | null>(null);
  const sorted = [...pages].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));

  const openActions = (p: any) => {
    haptic(14);
    setActionsFor(p);
  };

  const newPage = async () => {
    haptic(10);
    const page = await createPage({ spaceId: spaceId!, title: 'Untitled' });
    navigate(`/app/space/${spaceId}/page/${page.id}`);
  };

  const importZip = async (file: File) => {
    if (!spaceId) return;
    setImporting(true);
    try {
      const res = await api.upload(`/spaces/${spaceId}/import-zip`, [file]);
      toast(`Imported ${res.pages} pages${res.databases ? `, ${res.databases} databases` : ''}${res.images ? `, ${res.images} images` : ''}`, 'ok');
      await loadPages(spaceId);
    } catch (e: any) {
      toast(`Import failed: ${e.message}`, 'error');
    } finally {
      setImporting(false);
    }
  };

  return (
    <PullToRefresh onRefresh={() => loadPages(spaceId!)}>
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <h1 className="text-xl font-bold text-white">Pages</h1>
        <span className="text-sm text-set-dim">{pages.length}</span>
        <button
          className="set-btn ml-auto text-xs flex items-center gap-1.5"
          onClick={newPage}
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
        <button
          className="set-btn text-xs flex items-center gap-1.5"
          title="Import a graphify codebase graph — the repo as a linked page tree"
          onClick={() => setCodegraphOpen(true)}
        >
          <GitBranch size={13} /> Code graph
        </button>
      </div>
      {sorted.length === 0 && <p className="text-sm text-set-dim">No pages yet — create the first one.</p>}
      <div className="set-card divide-y divide-set-border/40">
        {sorted.map((p) => (
          <PageRow key={p.id} page={p} spaceId={spaceId!} onLongPress={openActions} />
        ))}
      </div>
    </div>

      {/* mobile FAB — new page, one thumb-tap above the tab bar */}
      <button
        onClick={newPage}
        aria-label="New page"
        className="md:hidden fixed right-4 bottom-[calc(62px+env(safe-area-inset-bottom))] z-30 w-12 h-12 rounded-full bg-set-accent text-white flex items-center justify-center shadow-lg active:scale-90 transition-transform"
      >
        <Plus size={20} />
      </button>

      {actionsFor && (
        <PageActionsSheet page={actionsFor} spaceId={spaceId!} onDone={() => setActionsFor(null)} reload={() => loadPages(spaceId!)} />
      )}

      {codegraphOpen && <CodeGraphModal onClose={() => setCodegraphOpen(false)} />}
    </PullToRefresh>
  );
}

/** A page row with native long-press (touch) / right-click (desktop) actions. */
function PageRow({ page, spaceId, onLongPress }: { page: any; spaceId: string; onLongPress: (p: any) => void }) {
  const navigate = useNavigate();
  const press = useLongPress(() => onLongPress(page));
  return (
    <button
      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-set-panel2/40 active:bg-set-panel2/60 transition-colors"
      onClick={() => navigate(`/app/space/${spaceId}/page/${page.id}`)}
      {...press}
    >
      <FileText size={14} className="text-set-dim shrink-0" />
      <span className="text-sm text-white truncate flex-1">{page.icon ? `${page.icon} ` : ''}{page.title}</span>
      {page.updated_at && (
        <span className="text-[11px] text-set-dim shrink-0">{new Date(page.updated_at).toLocaleDateString()}</span>
      )}
    </button>
  );
}

/** "All databases" list — the dashboard's Databases card lands here. */
export function DatabasesList() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const [dbs, setDbs] = useState<any[]>([]);

  const load = () => api.get(`/spaces/${spaceId}/databases`).then((r) => setDbs(r.dbs)).catch(() => {});

  useEffect(() => {
    if (!spaceId) return;
    load();
  }, [spaceId]);

  return (
    <PullToRefresh onRefresh={load}>
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
    </PullToRefresh>
  );
}
