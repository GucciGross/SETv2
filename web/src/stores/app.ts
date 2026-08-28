import { create } from 'zustand';
import { api } from '../lib/api';

export interface User {
  id: string;
  email: string;
  name: string;
}
export interface Space {
  id: string;
  name: string;
  kind: string;
  icon: string;
  role: string;
}
export interface PageMeta {
  id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  is_daily: boolean;
  is_template: boolean;
  updated_at: string;
}

interface AppState {
  user: User | null;
  spaces: Space[];
  pages: PageMeta[];
  currentSpaceId: string | null;
  ws: WebSocket | null;
  presence: { userId: string; name: string; pageId?: string }[];
  copilotOpen: boolean;
  surfaces: Record<string, boolean>;
  /** Shell density: 'simple' shows a task-shaped nav (Home/Subjects/Ask),
   *  'studio' exposes every surface. Persisted locally. */
  shellMode: 'simple' | 'studio';
  setShellMode: (m: 'simple' | 'studio') => void;
  loadSpaces: () => Promise<void>;
  loadPages: (spaceId: string) => Promise<void>;
  loadSurfaces: (spaceId: string) => Promise<void>;
  setCurrentSpace: (spaceId: string) => void;
  connectWs: (spaceId: string, pageId?: string) => void;
  createPage: (opts: { spaceId: string; parentId?: string | null; title?: string; markdown?: string; templateId?: string }) => Promise<any>;
  deletePage: (id: string) => Promise<void>;
  logout: () => void;
  setCopilotOpen: (v: boolean) => void;
}

const DEFAULT_SURFACES: Record<string, boolean> = {
  coding: true,
  terminal: true,
  paths: false,
  threeD: false,
  library: false,
  canvas: false,
};

export const useApp = create<AppState>((set, get) => ({
  user: null,
  spaces: [],
  pages: [],
  currentSpaceId: null,
  ws: null,
  presence: [],
  copilotOpen: typeof window !== 'undefined' ? window.innerWidth >= 1024 : true,
  surfaces: DEFAULT_SURFACES,
  shellMode: (typeof window !== 'undefined' && localStorage.getItem('set_shell_mode') === 'simple' ? 'simple' : 'studio'),

  setShellMode: (m) => {
    set({ shellMode: m });
    localStorage.setItem('set_shell_mode', m);
  },

  loadSpaces: async () => {
    const { spaces } = await api.get('/spaces');
    set({ spaces });
    const current = get().currentSpaceId;
    if (!current && spaces.length) get().setCurrentSpace(spaces[0].id);
  },

  loadSurfaces: async (spaceId) => {
    try {
      const { settings } = await api.get(`/spaces/${spaceId}/settings`);
      set({ surfaces: { ...DEFAULT_SURFACES, ...(settings?.surfaces ?? {}) } });
    } catch {
      set({ surfaces: DEFAULT_SURFACES });
    }
  },

  loadPages: async (spaceId) => {
    const { pages } = await api.get(`/spaces/${spaceId}/pages`);
    set({ pages: pages.filter((p: PageMeta) => !p.is_template) });
  },

  setCurrentSpace: (spaceId) => {
    set({ currentSpaceId: spaceId, pages: [], presence: [] });
    get().loadPages(spaceId);
    get().connectWs(spaceId);
  },

  connectWs: (spaceId, pageId) => {
    const old = get().ws;
    if (old) old.close();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(localStorage.getItem('set_token') ?? '')}`);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join', spaceId, pageId }));
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'event' && msg.event?.type === 'presence') {
          set({ presence: msg.event.payload.users ?? [] });
        } else if (msg.type === 'event' && msg.event?.type === 'page_updated') {
          if (msg.event.payload.by !== get().user?.id) {
            const { currentSpaceId } = get();
            if (currentSpaceId) get().loadPages(currentSpaceId);
            window.dispatchEvent(new CustomEvent('set:remote-page-update', { detail: msg.event.payload }));
          }
        } else if (msg.type === 'event' && ['page_created', 'page_deleted', 'db_updated'].includes(msg.event?.type)) {
          const { currentSpaceId } = get();
          if (currentSpaceId) get().loadPages(currentSpaceId);
        }
      } catch {
        /* ignore */
      }
    };
    set({ ws });
  },

  createPage: async (opts) => {
    const page = await api.post('/pages', opts);
    await get().loadPages(opts.spaceId);
    return page.page;
  },

  deletePage: async (id) => {
    await api.del(`/pages/${id}`);
    const { currentSpaceId } = get();
    if (currentSpaceId) await get().loadPages(currentSpaceId);
  },

  logout: () => {
    localStorage.removeItem('set_token');
    window.location.href = '/login';
  },

  setCopilotOpen: (v) => set({ copilotOpen: v }),
}));
