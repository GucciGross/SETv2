import { Layers } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate, useParams, Link, useLocation } from 'react-router-dom';
import {
  FilePlus, CalendarDays, Network, Database, BookOpen, Boxes, Route, Settings, Search, Plus,
  LogOut, ChevronRight, ChevronDown, Trash2, Import, PenLine,
  Code2, SquareTerminal, LibraryBig, Database as DatabaseIcon, Menu, X, ListTodo, Activity as ActivityIcon,
  ChevronsLeft, ChevronsRight, FileText, LayoutDashboard, Telescope,
  Mic, MessageCircle, Zap,
} from 'lucide-react';
import { useApp, type PageMeta } from '../stores/app';
import { api } from '../lib/api';
import { isRunNotebook } from '../lib/utils';
import { startTour } from '../lib/tour';
import { Toasts } from './Toast';
import { haptic } from '../lib/haptic';
import { syncThemeFromAccount } from '../lib/theme';
import { ConfirmHost, confirmDialog } from './Confirm';
import { SetCopilotProvider, useSetScreenContext } from '../lib/copilot';
import { openSetCopilot } from '../lib/copilotLauncher';
import { DitherAvatar } from './dither-kit';
import WelcomeModal from './onboarding/WelcomeModal';
import GuideFab from './GuideFab';
import CopilotDock from './copilot/CopilotDock';
import Notifications from './Notifications';
import CommandPalette from './CommandPalette';
import RecorderModal from './Recorder';

function NavList({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div>
      <button
        className="set-mono set-mono-dim flex w-full items-center gap-1 px-1 pt-2 pb-1 hover:text-set-text"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />} {title}
      </button>
      {open && <div className="space-y-0.5">{children}</div>}
    </div>
  );
}

interface NavItem {
  icon: React.ReactNode;
  label: string;
  to: string;
  surface: string | null;
  exact?: boolean;
}

function NavGroup({ label, items, surfaces, railMode, onNavigate }: { label: string | null; items: NavItem[]; surfaces: Record<string, boolean>; railMode: boolean; onNavigate: () => void }) {
  const location = useLocation();
  const storageKey = label ? `set_navgroup_${label}` : null;
  const [expanded, setExpanded] = useState(() => (storageKey ? localStorage.getItem(storageKey) !== '0' : true));
  const toggleGroup = () => {
    setExpanded((o) => {
      if (storageKey) localStorage.setItem(storageKey, o ? '0' : '1');
      return !o;
    });
  };
  const visible = items.filter((item) => !item.surface || surfaces[item.surface]);
  if (!visible.length) return null;
  return (
    <div>
      {label && !railMode && (
        <button className="set-mono set-mono-dim flex w-full items-center gap-1 px-1 pt-2 pb-1 hover:text-set-text" onClick={toggleGroup}>
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />} {label}
        </button>
      )}
      {(expanded || railMode || !label) && visible.map((item) => {
        const active = item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);
        return (
          <Link key={item.label} to={item.to} onClick={onNavigate}
            className={`relative flex items-center gap-2 px-2 py-1.5 rounded-md text-set-text transition-colors ${active ? 'bg-set-panel2 text-white' : 'hover:bg-set-panel2/70'}`}
            title={railMode ? item.label : undefined}>
            {active && <span className="absolute -left-2 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full bg-set-accent shadow-[0_0_8px_rgb(108_140_255/0.8)]" />}
            <span className={active ? 'text-set-accent' : 'text-set-dim'}>{item.icon}</span> {item.label}
          </Link>
        );
      })}
    </div>
  );
}

function PageTree() {
  const { spaceId: routeSpaceId, pageId } = useParams();
  const pages = useApp((s) => s.pages);
  const createPage = useApp((s) => s.createPage);
  const deletePage = useApp((s) => s.deletePage);
  const currentSpaceId = useApp((s) => s.currentSpaceId);
  const navigate = useNavigate();
  const spaceId = routeSpaceId ?? currentSpaceId ?? '';
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const roots = useMemo(() => pages.filter((p) => !p.parent_id), [pages]);
  const childrenOf = (id: string) => pages.filter((p) => p.parent_id === id);
  const renderNode = (p: PageMeta, depth: number) => {
    const kids = childrenOf(p.id);
    const isCollapsed = collapsed[p.id];
    const active = p.id === pageId;
    return (
      <div key={p.id}>
        <div className={`group flex items-center gap-1 rounded-md pr-1 cursor-pointer text-sm ${active ? 'bg-set-accent/15 text-blue-200' : 'hover:bg-set-panel2 text-set-text'}`}
          style={{ paddingLeft: depth * 14 + 4 }} onClick={() => navigate(`/app/space/${spaceId}/page/${p.id}`)}>
          {kids.length ? (
            <button className="p-0.5 text-set-dim hover:text-set-text" onClick={(e) => { e.stopPropagation(); setCollapsed((c) => ({ ...c, [p.id]: !c[p.id] })); }}>
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
          ) : <span className="w-[18px] text-center text-[10px] text-set-dim">•</span>}
          <span className="truncate py-1 flex-1 flex items-center gap-1.5"><span>{p.icon ?? ''}</span><span className={`truncate ${p.is_daily ? 'text-amber-200/80' : ''}`}>{p.title}</span></span>
          <button className="opacity-0 group-hover:opacity-100 p-1 text-set-dim hover:text-blue-300" title="Add subpage"
            onClick={async (e) => { e.stopPropagation(); const page = await createPage({ spaceId: currentSpaceId!, parentId: p.id, title: 'Untitled' }); setCollapsed((c) => ({ ...c, [p.id]: false })); navigate(`/app/space/${spaceId}/page/${page.id}`); }}><FilePlus size={13} /></button>
          <button className="opacity-0 group-hover:opacity-100 p-1 text-set-dim hover:text-red-400" title="Delete"
            onClick={async (e) => { e.stopPropagation(); if (await confirmDialog({ title: `Move "${p.title}" to trash?`, body: 'It stays in Trash and can be restored.', confirmLabel: 'Trash', danger: true })) { await deletePage(p.id); if (active) navigate(`/app/space/${spaceId}`); } }}><Trash2 size={13} /></button>
        </div>
        {!isCollapsed && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };
  return <div className="space-y-0.5">{roots.map((r) => renderNode(r, 0))}</div>;
}

function SearchBox() {
  const currentSpaceId = useApp((s) => s.currentSpaceId);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (q.trim().length < 2 || !currentSpaceId) return setResults(null);
    const t = setTimeout(async () => setResults(await api.get(`/spaces/${currentSpaceId}/search?q=${encodeURIComponent(q)}`)), 250);
    return () => clearTimeout(t);
  }, [q, currentSpaceId]);
  return (
    <div className="relative">
      <div className="flex items-center gap-2 bg-set-panel2 border border-set-border rounded-lg px-2.5 py-1.5"><Search size={14} className="text-set-dim" /><input className="bg-transparent outline-none text-sm w-full" placeholder="Search workspace…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {results && (results.pages.length || results.notebooks.length || results.databases.length) && (
        <div className="absolute z-50 mt-1 w-full set-card p-2 max-h-80 overflow-auto fadein shadow-xl">
          {results.pages.map((p: any) => <button key={p.id} className="flex w-full items-center gap-2 px-2 py-1.5 rounded hover:bg-set-panel2 text-sm text-left" onClick={() => { setQ(''); navigate(`/app/space/${currentSpaceId}/page/${p.id}`); }}><span>{p.icon ?? ''}</span> {p.title}</button>)}
          {results.notebooks.map((n: any) => <button key={n.id} className="flex w-full items-center gap-2 px-2 py-1.5 rounded hover:bg-set-panel2 text-sm text-left" onClick={() => { setQ(''); navigate(`/app/space/${currentSpaceId}/notebook/${n.id}`); }}><BookOpen size={13} className="text-set-dim shrink-0" /> {n.title}</button>)}
          {results.databases.map((d: any) => <button key={d.id} className="flex w-full items-center gap-2 px-2 py-1.5 rounded hover:bg-set-panel2 text-sm text-left" onClick={() => { setQ(''); navigate(`/app/space/${currentSpaceId}/db/${d.id}`); }}><DatabaseIcon size={13} className="text-set-dim shrink-0" /> {d.name}</button>)}
        </div>
      )}
    </div>
  );
}

export default function AppShell() {
  return <SetCopilotProvider><AppShellInner /></SetCopilotProvider>;
}

function AppShellInner() {
  useSetScreenContext();
  const { spaceId } = useParams();
  const location = useLocation();
  const spaces = useApp((s) => s.spaces);
  const currentSpaceId = useApp((s) => s.currentSpaceId);
  const setCurrentSpace = useApp((s) => s.setCurrentSpace);
  const user = useApp((s) => s.user);
  const presence = useApp((s) => s.presence);
  const logout = useApp((s) => s.logout);
  const createPage = useApp((s) => s.createPage);
  const surfaces = useApp((s) => s.surfaces);
  const loadSurfaces = useApp((s) => s.loadSurfaces);
  const pages = useApp((s) => s.pages);
  const shellMode = useApp((s) => s.shellMode);
  const setShellMode = useApp((s) => s.setShellMode);
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dbs, setDbs] = useState<any[]>([]);
  const [nbs, setNbs] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [recordOpen, setRecordOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trash, setTrash] = useState<any[]>([]);
  useEffect(() => { void syncThemeFromAccount(); }, []);
  const [mobileNav, setMobileNav] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [railMode, setRailMode] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(true);
  const [newSpaceOpen, setNewSpaceOpen] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const onboarding = (user as any)?.onboarding;
  const simple = shellMode === 'simple';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); setCaptureOpen((o) => !o); return; }
      if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault(); setHelpOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { if (spaceId && spaceId !== currentSpaceId) setCurrentSpace(spaceId); if (spaceId) loadSurfaces(spaceId); }, [spaceId, currentSpaceId, setCurrentSpace, loadSurfaces]);
  useEffect(() => { if (location.pathname === '/app' && currentSpaceId) navigate(`/app/space/${currentSpaceId}`, { replace: true }); }, [location.pathname, currentSpaceId, navigate]);

  const loadMeta = useCallback(() => {
    if (!currentSpaceId) return;
    api.get(`/spaces/${currentSpaceId}/databases`).then((r) => setDbs(r.databases)).catch(() => {});
    api.get(`/spaces/${currentSpaceId}/notebooks`).then((r) => setNbs(r.notebooks.filter((n: any) => !isRunNotebook(n)))).catch(() => {});
    api.get(`/spaces/${currentSpaceId}/subjects`).then((r) => setSubjects(r.subjects)).catch(() => {});
  }, [currentSpaceId]);
  useEffect(() => { loadMeta(); }, [loadMeta, spaceId]);
  useEffect(() => { window.addEventListener('set:space-meta-changed', loadMeta); return () => window.removeEventListener('set:space-meta-changed', loadMeta); }, [loadMeta]);

  const nbsBySubject = useMemo(() => {
    const bySubject = new Map<string, any[]>(); const unfiled: any[] = [];
    for (const n of nbs) { const sid = typeof n.subject_id === 'string' ? n.subject_id : null; if (sid && subjects.some((s) => s.id === sid)) { if (!bySubject.has(sid)) bySubject.set(sid, []); bySubject.get(sid)!.push(n); } else unfiled.push(n); }
    return { bySubject, unfiled };
  }, [nbs, subjects]);

  useEffect(() => { if (user && currentSpaceId && onboarding && !onboarding.welcomed) setWelcomeOpen(true); }, [user, currentSpaceId, onboarding]);
  useEffect(() => { const open = () => setWelcomeOpen(true); window.addEventListener('set:open-welcome', open); return () => window.removeEventListener('set:open-welcome', open); }, []);

  const tourSidebarPrev = useRef<{ rail: boolean; nav: boolean } | null>(null);
  useEffect(() => {
    const onTourSidebar = (e: Event) => { const { open, restore } = (e as CustomEvent).detail ?? {}; if (restore) { const prev = tourSidebarPrev.current; tourSidebarPrev.current = null; if (prev) { setRailMode(prev.rail); setMobileNav(prev.nav); } } else if (open) { tourSidebarPrev.current ??= { rail: railMode, nav: mobileNav }; setRailMode(false); setMobileNav(true); } else setMobileNav(false); };
    window.addEventListener('set:tour-sidebar', onTourSidebar); return () => window.removeEventListener('set:tour-sidebar', onTourSidebar);
  }, [railMode, mobileNav]);

  const createWorkspace = async () => { if (!newSpaceName.trim()) return; const { space } = await api.post('/spaces', { name: newSpaceName.trim() }); const { loadSpaces } = useApp.getState(); await loadSpaces(); setNewSpaceOpen(false); setNewSpaceName(''); navigate(`/app/space/${space.id}`); };
  const openTrash = async () => { if (!currentSpaceId) return; setTrashOpen(true); setTrash((await api.get(`/spaces/${currentSpaceId}/trash`)).pages); };
  const importMd = async (files: FileList | null) => { if (!files?.length || !currentSpaceId) return; await api.upload(`/spaces/${currentSpaceId}/import-md`, Array.from(files)); useApp.getState().loadPages(currentSpaceId); };
  const link = (sub: string) => `/app/space/${currentSpaceId}${sub}`;
  const subPath = location.pathname.replace(/^\/app\/space\/[^/]+\/?/, '');
  const openCopilot = () => openSetCopilot();

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = scrollRef.current; if (!el) return; const onScroll = () => setScrolled(el.scrollTop > 72); el.addEventListener('scroll', onScroll, { passive: true }); return () => el.removeEventListener('scroll', onScroll); }, []);
  const pageIdInPath = location.pathname.match(/\/page\/([0-9a-f-]{36})/)?.[1];
  const headerTitle = (pageIdInPath && pages.find((pg) => pg.id === pageIdInPath)?.title) || ({ '': spaces.find((sp) => sp.id === currentSpaceId)?.name ?? '', pages: 'Pages', graph: 'Graph', databases: 'Databases', notebooks: 'Notebooks', tasks: 'My Tasks', settings: 'Settings', coding: 'Coding', research: 'Research' } as Record<string, string>)[subPath.split('/')[0]] || '';

  const DRAWER_W = 256;
  const drag = useRef<{ startX: number; startY: number; lastX: number; startT: number; candidate: 'opening' | 'closing'; mode: 'undecided' | 'horizontal' | 'vertical'; } | null>(null);
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const isPhone = () => window.matchMedia('(max-width: 767px)').matches;
  const onTouchStart = (e: React.TouchEvent) => { if (e.touches.length !== 1 || !isPhone()) return; const t = e.touches[0]; const candidate = mobileNav ? 'closing' : t.clientX < 32 ? 'opening' : null; if (!candidate) return; drag.current = { startX: t.clientX, startY: t.clientY, lastX: t.clientX, startT: performance.now(), candidate, mode: 'undecided' }; };
  const onTouchMove = (e: React.TouchEvent) => { const d = drag.current; if (!d || d.mode === 'vertical') return; const t = e.touches[0]; const dx = t.clientX - d.startX; const dy = t.clientY - d.startY; if (d.mode === 'undecided') { if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return; if (Math.abs(dy) > Math.abs(dx) * 1.2) { drag.current = null; return; } d.mode = 'horizontal'; } setDragOffset(d.candidate === 'opening' ? Math.min(0, Math.max(-DRAWER_W, -DRAWER_W + dx)) : Math.min(0, Math.max(-DRAWER_W, dx))); };
  const onTouchEnd = (e: React.TouchEvent) => { const d = drag.current; drag.current = null; if (!d || d.mode !== 'horizontal') { setDragOffset(null); return; } const t = e.changedTouches[0]; const dx = t.clientX - d.startX; const dt = performance.now() - d.startT; const flick = dt < 240 && Math.abs(dx) > 40; if (d.candidate === 'opening') { const commit = dragOffset != null && dragOffset > -DRAWER_W * 0.55; if (commit || (flick && dx > 0)) { haptic(8); setMobileNav(true); } else setMobileNav(false); } else { const commit = dragOffset != null && dragOffset < -DRAWER_W * 0.45; if (commit || (flick && dx < 0)) { haptic(8); setMobileNav(false); } else setMobileNav(true); } setDragOffset(null); };
  const drawerOpenPx = dragOffset ?? (mobileNav ? 0 : -DRAWER_W);

  const nbLink = (n: any) => <Link key={n.id} to={link(`/notebook/${n.id}`)} className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-set-panel2" onClick={() => setMobileNav(false)}><BookOpen size={13} className="text-set-dim shrink-0" /><span className="truncate">{n.title}</span><span className="ml-auto text-xs text-set-dim">{n.source_count}</span></Link>;

  return (
    <div className="app-shell flex overflow-hidden" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={() => { drag.current = null; setDragOffset(null); }}>
      {(mobileNav || dragOffset != null) && <div className="fixed inset-0 z-40 bg-black/60 md:hidden" style={dragOffset != null ? { opacity: Math.max(0, (drawerOpenPx + DRAWER_W) / DRAWER_W), transition: 'none' } : undefined} onClick={() => setMobileNav(false)} />}
      <aside data-tour-sidebar className={`${railMode ? 'w-14' : 'w-64'} shrink-0 bg-set-panel border-r border-set-border flex flex-col transition-all max-md:w-64 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:transition-transform max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)] ${mobileNav ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'}`} style={dragOffset != null ? { transform: `translateX(${drawerOpenPx}px)`, transition: 'none' } : undefined}>
        <div className={`${railMode ? 'p-2' : 'p-3'} border-b border-set-border`}>
          <div className="flex items-center gap-2 mb-2"><DitherAvatar seed={user?.id ?? 'set'} size={32} /><div className={`${railMode ? 'hidden' : 'min-w-0 flex-1'}`}><div className="text-sm font-semibold truncate">SET</div><div className="text-[10px] set-mono set-mono-dim truncate">KNOWLEDGE + LEARNING OS</div></div><button className="md:hidden set-btn-ghost p-1.5" onClick={() => setMobileNav(false)}><X size={16} /></button></div>
          {!railMode && <div className="flex gap-1.5"><select className="set-input font-medium flex-1 min-w-0" value={currentSpaceId ?? ''} onChange={(e) => navigate(`/app/space/${e.target.value}`)}>{spaces.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}</select><button className="set-btn shrink-0 px-2.5" onClick={() => { setNewSpaceName(''); setNewSpaceOpen(true); }}><Plus size={14} /></button></div>}
          {!railMode && <div className="flex rounded-lg border border-set-border bg-set-panel2/40 p-0.5 mt-2"><button className={`flex-1 rounded-md px-2 py-1 text-[11px] ${simple ? 'bg-set-panel text-set-text shadow-sm' : 'text-set-dim'}`} onClick={() => setShellMode('simple')}>Simple</button><button className={`flex-1 rounded-md px-2 py-1 text-[11px] ${!simple ? 'bg-set-panel text-set-text shadow-sm' : 'text-set-dim'}`} onClick={() => setShellMode('studio')}>Studio</button></div>}
          <button className="hidden md:flex w-full items-center gap-2 text-xs text-set-dim hover:text-set-text mt-2" onClick={() => setRailMode((r) => !r)}>{railMode ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}{!railMode && <span>Collapse</span>}</button>
          {presence.length > 1 && <div className="mt-2 flex items-center gap-1 text-xs text-set-dim"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" />{presence.map((p) => p.name).join(', ')} online</div>}
        </div>
        <div className={`${railMode ? 'px-1' : 'p-3'} space-y-3 overflow-y-auto flex-1`}>
          {!railMode && <SearchBox />}
          <div className="grid grid-cols-2 gap-1.5"><button className="set-btn flex items-center gap-1.5 justify-center" onClick={async () => { const page = await createPage({ spaceId: currentSpaceId!, title: 'Untitled' }); navigate(`/app/space/${currentSpaceId}/page/${page.id}`); }}><FilePlus size={14} /> {!railMode && 'Page'}</button><button className="set-btn flex items-center gap-1.5 justify-center" onClick={async () => { const { page } = await api.post(`/spaces/${currentSpaceId}/daily`); useApp.getState().loadPages(currentSpaceId!); navigate(`/app/space/${currentSpaceId}/page/${page.id}`); }}><CalendarDays size={14} /> {!railMode && 'Today'}</button></div>
          <button className="set-btn w-full flex items-center gap-1.5 justify-center" onClick={() => setRecordOpen(true)}><Mic size={14} className="text-set-accent" /> {!railMode && 'Record'}</button>
          {simple && <button className="set-btn-primary w-full flex items-center gap-2 justify-center py-2.5" onClick={openCopilot}><MessageCircle size={15} /> Ask SET</button>}
          <nav className="space-y-0.5" data-tour="nav">
            {[
              { label: null, items: simple ? [{ icon: <LayoutDashboard size={15} />, label: 'Home', to: link(''), surface: null, exact: true }, { icon: <BookOpen size={15} />, label: 'Notebooks', to: link('/notebooks'), surface: null }, { icon: <Layers size={15} />, label: 'H5P Studio', to: link('/h5p'), surface: null }, { icon: <ListTodo size={15} />, label: 'My Tasks', to: link('/tasks'), surface: null }] : [{ icon: <LayoutDashboard size={15} />, label: 'Home', to: link(''), surface: null, exact: true }, { icon: <FileText size={15} />, label: 'Pages', to: link('/pages'), surface: null }, { icon: <BookOpen size={15} />, label: 'Notebooks', to: link('/notebooks'), surface: null }, { icon: <Layers size={15} />, label: 'H5P Studio', to: link('/h5p'), surface: null }, { icon: <Telescope size={15} />, label: 'Deep Research', to: link('/research'), surface: null }] },
              ...(!simple ? [{ label: 'Knowledge', items: [{ icon: <Network size={15} />, label: 'Graph', to: link('/graph'), surface: null }, { icon: <Database size={15} />, label: 'Databases', to: link('/databases'), surface: null }, { icon: <ListTodo size={15} />, label: 'My Tasks', to: link('/tasks'), surface: null }, { icon: <ActivityIcon size={15} />, label: 'Activity', to: link('/activity'), surface: null }] }, { label: 'Surfaces', items: [{ icon: <Code2 size={15} />, label: 'Coding', to: link('/coding'), surface: 'coding' }, { icon: <SquareTerminal size={15} />, label: 'Terminal', to: link('/terminal'), surface: 'terminal' }, { icon: <Route size={15} />, label: 'Learning Paths', to: link('/paths'), surface: 'paths' }, { icon: <Boxes size={15} />, label: '3D & CAD', to: link('/models'), surface: 'threeD' }, { icon: <LibraryBig size={15} />, label: 'Library', to: link('/library'), surface: 'library' }, { icon: <PenLine size={15} />, label: 'Canvas', to: link('/canvas'), surface: 'canvas' }] }] : []),
            ].map((group: any) => <NavGroup key={group.label ?? 'main'} label={group.label} items={group.items} surfaces={surfaces} railMode={railMode} onNavigate={() => setMobileNav(false)} />)}
          </nav>
          {!railMode && !simple && dbs.length > 0 && <NavList title="Databases" defaultOpen={false}>{dbs.map((d) => <Link key={d.id} to={link(`/db/${d.id}`)} className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-set-panel2"><DatabaseIcon size={13} className="text-set-dim shrink-0" /> <span className="truncate">{d.name}</span><span className="ml-auto text-xs text-set-dim">{d.row_count}</span></Link>)}</NavList>}
          {!railMode && (nbs.length > 0 || subjects.length > 0) && <NavList title="Notebooks" defaultOpen={simple}>{subjects.map((s) => <div key={s.id}><div className="flex items-center gap-1.5 px-2 pt-1.5 pb-0.5 text-[11px] font-medium text-set-dim"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} /><span className="truncate">{s.title}</span></div>{(nbsBySubject.bySubject.get(s.id) ?? []).map(nbLink)}</div>)}{subjects.length > 0 && nbsBySubject.unfiled.length > 0 && <div className="px-2 pt-2 pb-0.5 text-[11px] set-mono text-set-dim/60">unfiled</div>}{nbsBySubject.unfiled.map(nbLink)}</NavList>}
          {!railMode && !simple && <button className="set-mono set-mono-dim flex w-full items-center gap-1 px-1 py-1 hover:text-set-text" onClick={() => setPagesOpen((o) => !o)}>{pagesOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Pages ({pages.length})</button>}
          {pagesOpen && !railMode && !simple && <div onClick={() => mobileNav && setMobileNav(false)}><PageTree /></div>}
          {!simple && <div className="flex items-center gap-2 pt-2 text-xs text-set-dim"><button className="set-btn-ghost flex items-center gap-1" onClick={() => fileRef.current?.click()}><Import size={13} /> {!railMode && 'Import .md'}</button><input ref={fileRef} type="file" accept=".md,.markdown" multiple hidden onChange={(e) => importMd(e.target.files)} /><button className="set-btn-ghost flex items-center gap-1" onClick={openTrash}><Trash2 size={13} /> {!railMode && 'Trash'}</button></div>}
        </div>
        <div className="p-3 border-t border-set-border flex items-center justify-between text-sm">{!railMode && <span className="truncate text-set-dim">{user?.name}</span>}<div className="flex items-center gap-1"><button className="set-btn-ghost" onClick={() => navigate(`/app/space/${currentSpaceId}/settings`)}><Settings size={15} /></button><button className="set-btn-ghost" onClick={logout}><LogOut size={15} /></button></div></div>
      </aside>

      <main className="flex-1 overflow-hidden flex flex-col min-w-0">
        <div className="h-12 border-b border-set-border flex items-center px-3 gap-2 bg-set-panel/50 backdrop-blur-sm"><button className="md:hidden set-btn-ghost p-1.5" onClick={() => setMobileNav(true)}><Menu size={18} /></button><div className="set-mono set-mono-dim truncate hidden sm:flex items-center gap-1.5 select-none"><span className="text-set-accent/90">SET://</span><span className="text-set-text/80">{spaces.find((s) => s.id === currentSpaceId)?.name ?? 'space'}</span><span className="text-set-border">/</span><span>{location.pathname.replace(/^\/app\/space\/[^/]+\/?/, '').replace(/-/g, ' ') || 'home'}</span></div><span className={`md:hidden flex-1 text-center truncate text-sm text-set-text/90 min-w-0 transition-opacity ${scrolled && headerTitle ? 'opacity-100' : 'opacity-0'}`}>{headerTitle}</span><div className="ml-auto"><Notifications /></div></div>
        <div ref={scrollRef} data-scroll-root className="flex-1 overflow-y-auto"><Outlet /></div>
        <CopilotDock />
        <nav className="md:hidden border-t border-set-border bg-set-panel/95 backdrop-blur flex pb-[env(safe-area-inset-bottom)]">
          {([{ icon: <LayoutDashboard size={18} />, label: 'Home', to: link(''), active: subPath === '' }, ...(simple ? [{ icon: <BookOpen size={18} />, label: 'Notebooks', to: link('/notebooks'), active: subPath.startsWith('/notebook') }, { icon: <ListTodo size={18} />, label: 'Tasks', to: link('/tasks'), active: subPath.startsWith('/tasks') }] : [{ icon: <FileText size={18} />, label: 'Pages', to: link('/pages'), active: subPath.startsWith('/pages') || subPath.startsWith('/page/') }, { icon: <Network size={18} />, label: 'Graph', to: link('/graph'), active: subPath.startsWith('/graph') }])] as const).map((t) => <Link key={t.label} to={t.to} onClick={() => haptic(8)} className={`flex-1 flex flex-col items-center gap-0.5 py-1 text-[9px] active:scale-95 transition-transform ${t.active ? 'text-set-accent' : 'text-set-dim'}`}>{t.icon}{t.label}</Link>)}
        </nav>
      </main>

      <Toasts /><ConfirmHost /><CommandPalette />
      {captureOpen && <QuickCapture onClose={() => setCaptureOpen(false)} spaceId={spaceId ?? currentSpaceId} />}
      {helpOpen && <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setHelpOpen(false)}><div className="set-card bg-set-panel w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}><h3 className="text-lg font-bold text-white mb-3">Keyboard</h3><div className="space-y-2 text-sm">{([['Ctrl / ⌘ K', 'Command palette — jump to any page, notebook or action'], ['Ctrl / ⌘ ⇧ N', 'Quick capture — save a thought to the Inbox page'], ['?', 'This cheat sheet'], ['Esc', 'Close dialogs and overlays']] as const).map(([keys, what]) => <div key={keys} className="flex items-baseline gap-3"><kbd className="set-mono text-xs bg-set-panel2 border border-set-border rounded px-1.5 py-0.5 whitespace-nowrap">{keys}</kbd><span className="text-set-dim">{what}</span></div>)}</div></div></div>}
      <GuideFab />
      {newSpaceOpen && <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setNewSpaceOpen(false)}><div className="set-card bg-set-panel w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}><h3 className="text-lg font-bold text-white mb-1">New workspace</h3><input className="set-input mb-4" autoFocus placeholder="Workspace name" value={newSpaceName} onChange={(e) => setNewSpaceName(e.target.value)} /><div className="flex gap-2"><button className="set-btn-primary text-sm" disabled={!newSpaceName.trim()} onClick={createWorkspace}>Create workspace</button><button className="set-btn-ghost text-sm" onClick={() => setNewSpaceOpen(false)}>Cancel</button></div></div></div>}
      {recordOpen && currentSpaceId && <RecorderModal spaceId={currentSpaceId} onClose={() => setRecordOpen(false)} onSaved={(nbId) => { setRecordOpen(false); navigate(`/app/space/${currentSpaceId}/notebook/${nbId}`); }} />}
      {welcomeOpen && <WelcomeModal onDone={() => { setWelcomeOpen(false); setTimeout(() => startTour(), 350); }} />}
      {trashOpen && <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setTrashOpen(false)}><div className="set-card bg-set-panel w-full max-w-xl p-5" onClick={(e) => e.stopPropagation()}><h3 className="text-lg font-bold mb-3">Trash</h3><div className="space-y-2">{trash.map((p) => <div key={p.id} className="text-sm text-set-dim">{p.title}</div>)}</div></div></div>}
    </div>
  );
}

function QuickCapture({ onClose, spaceId }: { onClose: () => void; spaceId: string | null }) {
  const [text, setText] = useState(''); const [saving, setSaving] = useState(false); const pages = useApp((s) => s.pages); const loadPages = useApp((s) => s.loadPages);
  const save = async () => { if (!text.trim() || !spaceId || saving) return; setSaving(true); try { const inbox = pages.find((p) => p.title.toLowerCase() === 'inbox'); if (inbox) { const { page } = await api.get(`/pages/${inbox.id}`); await api.patch(`/pages/${inbox.id}`, { markdown: `${page.markdown ?? ''}\n\n- ${new Date().toLocaleString()} — ${text.trim()}\n` }); } else { await api.post('/pages', { spaceId, title: 'Inbox', markdown: `# Inbox\n\n- ${new Date().toLocaleString()} — ${text.trim()}\n` }); await loadPages(spaceId); } onClose(); } finally { setSaving(false); } };
  return <div className="fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm flex items-start justify-center pt-[15vh] p-4" onClick={onClose}><div className="set-card bg-set-panel w-full max-w-lg p-4" onClick={(e) => e.stopPropagation()}><div className="flex items-center gap-2 mb-2"><Zap size={14} className="text-set-accent" /><span className="text-sm font-semibold text-white">Quick capture</span></div><textarea autoFocus className="set-input text-sm w-full" rows={3} value={text} onChange={(e) => setText(e.target.value)} /><div className="flex justify-end mt-2"><button className="set-btn-primary text-sm" onClick={save} disabled={!text.trim() || saving}>{saving ? 'Saving…' : 'Save to Inbox'}</button></div></div></div>;
}
