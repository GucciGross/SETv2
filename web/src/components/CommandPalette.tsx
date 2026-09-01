import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../stores/app';
import {
  Search, FileText, BookOpen, Database, CornerDownLeft, FilePlus, CalendarDays, ListTodo,
  Network, Settings, BookOpen as DocsIcon, CloudSun,
} from 'lucide-react';

/** Ctrl/Cmd+K command palette: jump to anything, run quick actions. */
export default function CommandPalette() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const { createPage } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any>(null);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selRef = useRef(0);
  selRef.current = sel;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setQ('');
        setResults(null);
        setSel(0);
      } else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setResults(null);
      return;
    }
    const t = setTimeout(async () => {
      if (!spaceId) return;
      setResults(await api.get(`/spaces/${spaceId}/search?q=${encodeURIComponent(q)}`).catch(() => null));
    }, 200);
    return () => clearTimeout(t);
  }, [q, open, spaceId]);

  const actions = useMemo(() => {
    const link = (sub: string) => (spaceId ? `/app/space/${spaceId}${sub}` : '/app');
    return [
      { icon: <FilePlus size={14} />, label: 'New page', run: async () => { const p = await createPage({ spaceId: spaceId!, title: 'Untitled' }); navigate(`/app/space/${spaceId}/page/${p.id}`); } },
      { icon: <CalendarDays size={14} />, label: "Today's note", run: async () => { const { page } = await api.post(`/spaces/${spaceId}/daily`); navigate(`/app/space/${spaceId}/page/${page.id}`); } },
      { icon: <CloudSun size={14} />, label: "Write today's brief", run: async () => { const r = await api.post(`/spaces/${spaceId}/brief/to-daily`).catch(() => null); if (r?.pageId) navigate(`/app/space/${spaceId}/page/${r.pageId}`); } },
      { icon: <ListTodo size={14} />, label: 'My Tasks', go: link('/tasks') },
      { icon: <Network size={14} />, label: 'Graph', go: link('/graph') },
      { icon: <BookOpen size={14} />, label: 'Notebooks', go: link('/notebooks') },
      { icon: <DocsIcon size={14} />, label: 'Docs', go: link('/docs') },
      { icon: <Settings size={14} />, label: 'Settings', go: link('/settings') },
    ].filter((a) => a.label.toLowerCase().includes(q.toLowerCase()));
  }, [q, spaceId, navigate, createPage]);

  const items = useMemo(() => {
    const out: any[] = [];
    for (const a of actions) out.push({ kind: 'action', ...a });
    if (results) {
      for (const p of results.pages ?? []) out.push({ kind: 'page', icon: <FileText size={14} />, label: p.title, go: `/app/space/${spaceId}/page/${p.id}` });
      for (const n of results.notebooks ?? []) out.push({ kind: 'notebook', icon: <BookOpen size={14} />, label: n.title, go: `/app/space/${spaceId}/notebook/${n.id}` });
      for (const d of results.databases ?? []) out.push({ kind: 'database', icon: <Database size={14} />, label: d.name, go: `/app/space/${spaceId}/db/${d.id}` });
    }
    return out.slice(0, 14);
  }, [actions, results, spaceId]);

  useEffect(() => setSel(0), [q]);

  if (!open) return null;

  const choose = async (item: any) => {
    setOpen(false);
    if (item.run) await item.run();
    else if (item.go) navigate(item.go);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-start justify-center pt-[12vh] px-4" onClick={() => setOpen(false)}>
      <div className="w-full max-w-lg set-card bg-set-panel overflow-hidden fadein shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3.5 py-3 border-b border-set-border">
          <Search size={15} className="text-set-dim shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent outline-none text-sm"
            placeholder="Search pages, notebooks, databases — or run a command…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === 'Enter' && items[selRef.current]) { e.preventDefault(); choose(items[selRef.current]); }
            }}
          />
          <kbd className="text-[10px] text-set-dim border border-set-border rounded px-1.5 py-0.5">esc</kbd>
        </div>
        {items.length === 0 && <div className="p-4 text-sm text-set-dim">No matches.</div>}
        <div className="max-h-80 overflow-y-auto p-1.5">
          {items.map((item, i) => (
            <button
              key={i}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left text-sm ${i === sel ? 'bg-set-accent/25' : 'hover:bg-set-panel2'}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => choose(item)}
            >
              <span className="text-set-dim shrink-0">{item.icon}</span>
              <span className="flex-1 truncate">{item.label}</span>
              <span className="text-[10px] text-set-dim uppercase">{item.kind}</span>
              {i === sel && <CornerDownLeft size={12} className="text-set-dim" />}
            </button>
          ))}
        </div>
        <div className="px-3 py-2 border-t border-set-border text-[10px] text-set-dim flex gap-3">
          <span>↑↓ navigate</span><span>↵ open</span><span>Ctrl+K toggle</span>
        </div>
      </div>
    </div>
  );
}
