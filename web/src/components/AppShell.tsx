import { useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate, useParams, Link, useLocation } from 'react-router-dom';
import {
  FilePlus, CalendarDays, Network, Database, BookOpen, Boxes, Route, Settings, Search, Plus,
  PanelRightClose, PanelRightOpen, LogOut, ChevronRight, ChevronDown, Trash2, Import, Sparkles, PenLine,
  Code2, SquareTerminal, LibraryBig, Database as DatabaseIcon, Menu, X, ListTodo, Activity as ActivityIcon,
  ChevronsLeft, ChevronsRight, FileText, LayoutDashboard,
} from 'lucide-react';
import { useApp, type PageMeta } from '../stores/app';
import { api } from '../lib/api';
import { startTour } from '../lib/tour';
import WelcomeModal from './onboarding/WelcomeModal';
import CopilotPanel from './CopilotPanel';
import Notifications from './Notifications';
import CommandPalette from './CommandPalette';

function PageTree() {
  const { spaceId: routeSpaceId, pageId } = useParams();
  const { pages, createPage, deletePage, currentSpaceId } = useApp();
  const navigate = useNavigate();
  const spaceId = routeSpaceId ?? currentSpaceId ?? '';
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const roots = useMemo(() => pages.filter((p) => !p.parent_id), [pages]);
  const childrenOf = (id: string) => pages.filter((p) => p.parent_id === id);

  const renderNode = (p: PageMeta, depth: number) => {
    const kids = childrenOf(p.id);
    const isCollapsed = collapsed[p.id];
    const active = p.id === pageId;
    return (
      <div key={p.id}>
        <div
          className={`group flex items-center gap-1 rounded-md pr-1 cursor-pointer text-sm ${active ? 'bg-set-accent/15 text-blue-200' : 'hover:bg-set-panel2 text-set-text'}`}
          style={{ paddingLeft: depth * 14 + 4 }}
          onClick={() => navigate(`/app/space/${spaceId}/page/${p.id}`)}
        >
          {kids.length ? (
            <button
              className="p-0.5 text-set-dim hover:text-set-text"
              onClick={(e) => { e.stopPropagation(); setCollapsed((c) => ({ ...c, [p.id]: !c[p.id] })); }}
            >
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
          ) : (
            <span className="w-[18px] text-center text-[10px] text-set-dim">•</span>
          )}
          <span className="truncate py-1 flex-1 flex items-center gap-1.5">
            <span>{p.icon ?? ''}</span>
            <span className={`truncate ${p.is_daily ? 'text-amber-200/80' : ''}`}>{p.title}</span>
          </span>
          <button
            className="opacity-0 group-hover:opacity-100 p-1 text-set-dim hover:text-blue-300"
            title="Add subpage"
            onClick={async (e) => {
              e.stopPropagation();
              const page = await createPage({ spaceId: currentSpaceId!, parentId: p.id, title: 'Untitled' });
              setCollapsed((c) => ({ ...c, [p.id]: false }));
              navigate(`/app/space/${spaceId}/page/${page.id}`);
            }}
          >
            <FilePlus size={13} />
          </button>
          <button
            className="opacity-0 group-hover:opacity-100 p-1 text-set-dim hover:text-red-400"
            title="Delete"
            onClick={async (e) => {
              e.stopPropagation();
              if (confirm(`Move "${p.title}" to trash?`)) {
                await deletePage(p.id);
                if (active) navigate(`/app/space/${spaceId}`);
              }
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
        {!isCollapsed && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };

  return <div className="space-y-0.5">{roots.map((r) => renderNode(r, 0))}</div>;
}

function SearchBox() {
  const { currentSpaceId } = useApp();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (q.trim().length < 2 || !currentSpaceId) return setResults(null);
    const t = setTimeout(async () => {
      setResults(await api.get(`/spaces/${currentSpaceId}/search?q=${encodeURIComponent(q)}`));
    }, 250);
    return () => clearTimeout(t);
  }, [q, currentSpaceId]);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 bg-set-panel2 border border-set-border rounded-lg px-2.5 py-1.5">
        <Search size={14} className="text-set-dim" />
        <input
          className="bg-transparent outline-none text-sm w-full"
          placeholder="Search workspace…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {results && (results.pages.length || results.notebooks.length || results.databases.length) && (
        <div className="absolute z-50 mt-1 w-full set-card p-2 max-h-80 overflow-auto fadein shadow-xl">
          {results.pages.map((p: any) => (
            <button key={p.id} className="flex w-full items-center gap-2 px-2 py-1.5 rounded hover:bg-set-panel2 text-sm text-left"
              onClick={() => { setQ(''); navigate(`/app/space/${currentSpaceId}/page/${p.id}`); }}>
              <span>{p.icon ?? ''}</span> {p.title}
            </button>
          ))}
          {results.notebooks.map((n: any) => (
            <button key={n.id} className="flex w-full items-center gap-2 px-2 py-1.5 rounded hover:bg-set-panel2 text-sm text-left"
              onClick={() => { setQ(''); navigate(`/app/space/${currentSpaceId}/notebook/${n.id}`); }}>
              <BookOpen size={13} className="text-set-dim shrink-0" /> {n.title}
            </button>
          ))}
          {results.databases.map((d: any) => (
            <button key={d.id} className="flex w-full items-center gap-2 px-2 py-1.5 rounded hover:bg-set-panel2 text-sm text-left"
              onClick={() => { setQ(''); navigate(`/app/space/${currentSpaceId}/db/${d.id}`); }}>
              <DatabaseIcon size={13} className="text-set-dim shrink-0" /> {d.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AppShell() {
  const { spaceId } = useParams();
  const location = useLocation();
  const { spaces, currentSpaceId, setCurrentSpace, user, presence, copilotOpen, setCopilotOpen, logout, createPage, surfaces, loadSurfaces, pages } = useApp();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dbs, setDbs] = useState<any[]>([]);
  const [nbs, setNbs] = useState<any[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trash, setTrash] = useState<any[]>([]);
  const [mobileNav, setMobileNav] = useState(false);
  const [railMode, setRailMode] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(true);
  const [newSpaceOpen, setNewSpaceOpen] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const onboarding = (user as any)?.onboarding;

  useEffect(() => {
    if (spaceId && spaceId !== currentSpaceId) setCurrentSpace(spaceId);
    if (spaceId) loadSurfaces(spaceId);
  }, [spaceId, currentSpaceId, setCurrentSpace, loadSurfaces]);

  // /app  /app/space/:id so route params are always defined
  useEffect(() => {
    if (location.pathname === '/app' && currentSpaceId) {
      navigate(`/app/space/${currentSpaceId}`, { replace: true });
    }
  }, [location.pathname, currentSpaceId, navigate]);

  useEffect(() => {
    if (!currentSpaceId) return;
    api.get(`/spaces/${currentSpaceId}/databases`).then((r) => setDbs(r.databases)).catch(() => {});
    api.get(`/spaces/${currentSpaceId}/notebooks`).then((r) => setNbs(r.notebooks)).catch(() => {});
  }, [currentSpaceId, spaceId]);

  // first run: welcome + persona + tour (once per user, re-openable from the checklist)
  useEffect(() => {
    if (user && currentSpaceId && onboarding && !onboarding.welcomed) setWelcomeOpen(true);
  }, [user, currentSpaceId, onboarding]);
  useEffect(() => {
    const open = () => setWelcomeOpen(true);
    window.addEventListener('set:open-welcome', open);
    return () => window.removeEventListener('set:open-welcome', open);
  }, []);

  const createWorkspace = async () => {
    if (!newSpaceName.trim()) return;
    const { space } = await api.post('/spaces', { name: newSpaceName.trim() });
    const { loadSpaces } = useApp.getState();
    await loadSpaces();
    setNewSpaceOpen(false);
    setNewSpaceName('');
    navigate(`/app/space/${space.id}`);
  };

  const openTrash = async () => {
    if (!currentSpaceId) return;
    setTrashOpen(true);
    setTrash((await api.get(`/spaces/${currentSpaceId}/trash`)).pages);
  };

  const importMd = async (files: FileList | null) => {
    if (!files?.length || !currentSpaceId) return;
    await api.upload(`/spaces/${currentSpaceId}/import-md`, Array.from(files));
    useApp.getState().loadPages(currentSpaceId);
  };

  const link = (sub: string) => `/app/space/${currentSpaceId}${sub}`;

  return (
    <div className="app-shell flex overflow-hidden">
      {/* Sidebar */}
      {mobileNav && (
        <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setMobileNav(false)} />
      )}
      <aside
        className={`${railMode ? 'w-14' : 'w-64'} shrink-0 bg-set-panel border-r border-set-border flex flex-col transition-all max-md:w-64 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:transition-transform max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)] ${mobileNav ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'}`}
      >
        <div className="p-3 border-b border-set-border" data-tour="space-switcher">
          <div className="flex gap-1.5">
            <select
              className="set-input font-medium flex-1 min-w-0"
              value={currentSpaceId ?? ''}
              onChange={(e) => navigate(`/app/space/${e.target.value}`)}
            >
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>{s.icon} {s.name}</option>
              ))}
            </select>
            {!railMode && (
              <button
                className="set-btn shrink-0 px-2.5"
                title="Create a new workspace"
                aria-label="Create a new workspace"
                onClick={() => { setNewSpaceName(''); setNewSpaceOpen(true); }}
              >
                <Plus size={14} />
              </button>
            )}
          </div>
          <button
            className="hidden md:flex w-full items-center gap-2 text-xs text-set-dim hover:text-set-text mt-2"
            onClick={() => setRailMode((r) => !r)}
          >
            {railMode ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
            {!railMode && <span>Collapse</span>}
          </button>
          {presence.length > 1 && (
            <div className="mt-2 flex items-center gap-1 text-xs text-set-dim">
              <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
              {presence.map((p) => p.name).join(', ')} online
            </div>
          )}
        </div>

        <div className={`${railMode ? 'px-1' : 'p-3'} space-y-3 overflow-y-auto flex-1`}>
          {!railMode && <SearchBox />}

          <div className="grid grid-cols-2 gap-1.5">
            <button className="set-btn flex items-center gap-1.5 justify-center" title="New page" data-tour="new-page"
              onClick={async () => {
                const page = await createPage({ spaceId: currentSpaceId!, title: 'Untitled' });
                navigate(`/app/space/${currentSpaceId}/page/${page.id}`);
              }}>
              <FilePlus size={14} /> {!railMode && 'Page'}
            </button>
            <button className="set-btn flex items-center gap-1.5 justify-center" title="Today's daily note"
              onClick={async () => {
                const { page } = await api.post(`/spaces/${currentSpaceId}/daily`);
                useApp.getState().loadPages(currentSpaceId!);
                navigate(`/app/space/${currentSpaceId}/page/${page.id}`);
              }}>
              <CalendarDays size={14} /> {!railMode && 'Today'}
            </button>
          </div>

          <div className="text-[11px] uppercase tracking-wider text-set-dim font-semibold px-1">Workspace</div>
          <nav className="space-y-0.5 text-sm" data-tour="nav">
            {[
              { icon: <LayoutDashboard size={15} />, label: 'Dashboard', to: link(''), surface: null, exact: true },
              { icon: <ListTodo size={15} />, label: 'My Tasks', to: link('/tasks'), surface: null },
              { icon: <ActivityIcon size={15} />, label: 'Activity', to: link('/activity'), surface: null },
              { icon: <Network size={15} />, label: 'Graph', to: link('/graph'), surface: null },
              { icon: <BookOpen size={15} />, label: 'Notebooks', to: link('/notebooks'), surface: null },
              { icon: <Code2 size={15} />, label: 'Coding', to: link('/coding'), surface: 'coding' },
              { icon: <SquareTerminal size={15} />, label: 'Terminal', to: link('/terminal'), surface: 'terminal' },
              { icon: <Route size={15} />, label: 'Learning Paths', to: link('/paths'), surface: 'paths' },
              { icon: <Boxes size={15} />, label: '3D & CAD', to: link('/models'), surface: 'threeD' },
              { icon: <LibraryBig size={15} />, label: 'Library', to: link('/library'), surface: 'library' },
              { icon: <PenLine size={15} />, label: 'Canvas (beta)', to: link('/canvas'), surface: 'canvas' },
              { icon: <BookOpen size={15} />, label: 'Docs', to: link('/docs'), surface: null },
              { icon: <Settings size={15} />, label: 'Settings', to: link('/settings'), surface: null },
            ]
              .filter((item) => !item.surface || surfaces[item.surface])
              .map((item) => {
                const active = item.exact
                  ? location.pathname === item.to
                  : location.pathname.startsWith(item.to);
                return (
                  <Link
                    key={item.label}
                    to={item.to}
                    onClick={() => setMobileNav(false)}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-set-panel2 text-set-text ${active ? 'bg-set-panel2 text-white' : ''}`}
                    title={railMode ? item.label : undefined}
                  >
                    <span className={active ? 'text-set-accent' : 'text-set-dim'}>{item.icon}</span> {item.label}
                  </Link>
                );
              })}
          </nav>

          {dbs.length > 0 && !railMode && (
            <>
              <div className="text-[11px] uppercase tracking-wider text-set-dim font-semibold px-1">Databases</div>
              <nav className="space-y-0.5 text-sm">
                {dbs.map((d) => (
                  <Link key={d.id} to={link(`/db/${d.id}`)} className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-set-panel2">
                    <DatabaseIcon size={13} className="text-set-dim shrink-0" /> <span className="truncate">{d.name}</span>
                    <span className="ml-auto text-xs text-set-dim">{d.row_count}</span>
                  </Link>
                ))}
              </nav>
            </>
          )}

          {nbs.length > 0 && !railMode && (
            <>
              <div className="text-[11px] uppercase tracking-wider text-set-dim font-semibold px-1">Notebooks</div>
              <nav className="space-y-0.5 text-sm">
                {nbs.map((n) => (
                  <Link key={n.id} to={link(`/notebook/${n.id}`)} className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-set-panel2">
                    <BookOpen size={13} className="text-set-dim shrink-0" /><span className="truncate">{n.title}</span>
                    <span className="ml-auto text-xs text-set-dim">{n.source_count}</span>
                  </Link>
                ))}
              </nav>
            </>
          )}

          {!railMode && (
            <button
              className="flex w-full items-center gap-1 px-1 py-1 text-[11px] uppercase tracking-wider text-set-dim font-semibold hover:text-set-text"
              onClick={() => setPagesOpen((o) => !o)}
            >
              {pagesOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Pages ({pages.length})
            </button>
          )}
          {railMode && (
            <div className="flex justify-center py-2 text-set-dim" title={`Pages (${pages.length})`}>
              <FileText size={15} />
            </div>
          )}
          {pagesOpen && !railMode && (
            <div onClick={() => mobileNav && setMobileNav(false)}>
              <PageTree />
            </div>
          )}

          <div className="flex items-center gap-2 pt-2 text-xs text-set-dim">
            <button className="set-btn-ghost flex items-center gap-1" onClick={() => fileRef.current?.click()}>
              <Import size={13} /> {!railMode && 'Import .md'}
            </button>
            <input ref={fileRef} type="file" accept=".md,.markdown" multiple hidden onChange={(e) => importMd(e.target.files)} />
            <button className="set-btn-ghost flex items-center gap-1" onClick={openTrash}>
              <Trash2 size={13} /> {!railMode && 'Trash'}
            </button>
          </div>
        </div>

        <div className="p-3 border-t border-set-border flex items-center justify-between text-sm">
          {!railMode && <span className="truncate text-set-dim">{user?.name}</span>}
          <div className="flex items-center gap-1">
            <button className="md:hidden set-btn-ghost" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={15} /></button>
            <button className="set-btn-ghost" title="Sign out" onClick={logout}><LogOut size={15} /></button>
          </div>
        </div>
      </aside>

      {/* Trash modal */}
      {trashOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setTrashOpen(false)}>
          <div className="set-card p-5 w-[420px] max-h-[60vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-white mb-3"> Trash</h3>
            {trash.length === 0 && <p className="text-set-dim text-sm">Trash is empty.</p>}
            {trash.map((p) => (
              <div key={p.id} className="flex items-center gap-2 py-1.5 text-sm">
                <span>{p.icon ?? ''}</span>
                <span className="flex-1 truncate">{p.title}</span>
                <button className="set-btn-ghost" onClick={async () => {
                  await api.post(`/pages/${p.id}/restore`);
                  openTrash();
                  useApp.getState().loadPages(currentSpaceId!);
                }}>Restore</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main */}
      <main className="flex-1 overflow-hidden flex flex-col min-w-0">
        <div className="h-12 border-b border-set-border flex items-center px-3 gap-2 bg-set-panel/50">
          <button className="md:hidden set-btn-ghost p-1.5" onClick={() => setMobileNav(true)} aria-label="Open navigation">
            <Menu size={18} />
          </button>
          <Notifications />
          <button
            className="set-btn-ghost flex items-center gap-1.5"
            data-tour="copilot"
            data-copilot-open
            onClick={() => setCopilotOpen(!copilotOpen)}
          >
            {copilotOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
            <Sparkles size={14} className="text-violet-300" /> Copilot
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>

      {/* Copilot */}
      <CommandPalette />
      {copilotOpen && <div className="max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:w-full"><CopilotPanel /></div>}

      {/* New workspace modal */}
      {newSpaceOpen && (
        <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setNewSpaceOpen(false)}>
          <div className="set-card bg-set-panel w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-1">New workspace</h3>
            <p className="text-sm text-set-dim mb-4">
              A separate space with its own pages, members and settings — one per team, client or project.
            </p>
            <input
              className="set-input mb-4"
              autoFocus
              placeholder="Workspace name (e.g. Marketing, Research Lab)"
              value={newSpaceName}
              maxLength={120}
              onChange={(e) => setNewSpaceName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && newSpaceName.trim()) await createWorkspace();
              }}
            />
            <div className="flex gap-2">
              <button className="set-btn-primary text-sm" disabled={!newSpaceName.trim()} onClick={createWorkspace}>Create workspace</button>
              <button className="set-btn-ghost text-sm" onClick={() => setNewSpaceOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* First-run welcome */}
      {welcomeOpen && (
        <WelcomeModal
          onDone={() => {
            setWelcomeOpen(false);
            setTimeout(() => startTour(), 350);
          }}
        />
      )}
    </div>
  );
}
