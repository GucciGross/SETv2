import { one, q } from '../db.js';
import { config } from '../config.js';
import { savePageContent } from '../pages/routes.js';
import { recordActivity } from '../team/activity.js';
import { bus } from '../lib/events.js';

/**
 * WandGx creation connector — shared core used by the REST routes, the
 * copilot agent tool and the MCP tool. SET owns the build row; the remote
 * WandGx instance owns generation (repo, Docker, deploy). Results arrive
 * back on POST /api/wandgx/events (HMAC-signed) and land on the linked
 * page's Build log.
 */

export function wandgxConfigured(): boolean {
  return !!config.wandgx.token;
}

async function wandgxFetch(path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${config.wandgx.url}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.wandgx.token}`, ...(init.headers ?? {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Ping the WandGx instance for connection status cards. */
export async function wandgxHealth(): Promise<{ reachable: boolean; detail?: string }> {
  if (!wandgxConfigured()) return { reachable: false, detail: 'WANDGX_TOKEN is not configured' };
  try {
    const res = await wandgxFetch('/health', {}, 3000);
    return { reachable: res.ok, detail: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err: any) {
    return { reachable: false, detail: err?.name === 'AbortError' ? 'timeout' : String(err?.message ?? err) };
  }
}

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 16);

/** Append a dated line under the page's "## Build log" section (created on first use). */
async function appendBuildLog(spaceId: string, pageId: string, userId: string, line: string) {
  const page = await one<{ markdown: string | null }>(`SELECT markdown FROM pages WHERE id = $1`, [pageId]);
  if (!page) return;
  const md = page.markdown ?? '';
  const entry = `- ${stamp()} — ${line}`;
  const next = /^## Build log.*$/m.test(md)
    ? md.replace(/^## Build log.*$/m, (heading) => `${heading}\n${entry}`)
    : `${md}${md.endsWith('\n') || !md ? '' : '\n'}\n## Build log\n\n${entry}`;
  await savePageContent(pageId, spaceId, { markdown: next }, userId);
}

export interface StartWandgxBuildInput {
  spaceId: string;
  userId: string;
  prompt: string;
  title?: string;
  /** Page whose Build log should track this build (validated against the space). */
  pageId?: string | null;
}

export interface StartWandgxBuildResult {
  build: any;
  remote: { projectId?: string; buildId?: string; status?: string } | null;
  error?: string;
}

export async function startWandgxBuild(input: StartWandgxBuildInput): Promise<StartWandgxBuildResult> {
  if (!wandgxConfigured()) throw new Error('WandGx is not configured — set WANDGX_URL and WANDGX_TOKEN on the server');
  const title = (input.title?.trim() || input.prompt.split(/[.\n]/)[0].slice(0, 60) || 'WandGx build').trim();
  let pageId: string | null = null;
  if (input.pageId) {
    const page = await one<{ id: string }>(
      `SELECT id FROM pages WHERE id::text = $1 AND space_id = $2 AND deleted_at IS NULL`,
      [input.pageId, input.spaceId]
    );
    pageId = page?.id ?? null;
  }

  const row = await one<any>(
    `INSERT INTO wandgx_builds (space_id, created_by, page_id, title, prompt) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [input.spaceId, input.userId, pageId, title, input.prompt]
  );

  try {
    const res = await wandgxFetch('/set/builds', {
      method: 'POST',
      body: JSON.stringify({ title, prompt: input.prompt, source: { app: 'set', spaceId: input.spaceId, pageId, buildRowId: row!.id } }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? `WandGx responded ${res.status}`);
    const build = await one<any>(
      `UPDATE wandgx_builds SET wandgx_project_id = $2, wandgx_build_id = $3, status = 'building', raw = $4, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [row!.id, data.projectId ?? null, data.buildId ?? null, JSON.stringify(data)]
    );
    if (pageId) {
      await appendBuildLog(input.spaceId, pageId, input.userId, `🚀 **Build started** — ${title}${data.buildId ? ` (WandGx build \`${data.buildId}\`)` : ''}`);
    }
    void recordActivity(input.spaceId, input.userId, 'wandgx_build_started', { buildId: build!.id, title, wandgxBuildId: data.buildId ?? null });
    return { build, remote: data };
  } catch (err: any) {
    const message = err?.name === 'AbortError' ? 'WandGx did not answer in 10s' : String(err?.message ?? err);
    const build = await one<any>(
      `UPDATE wandgx_builds SET status = 'error', error = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [row!.id, message]
    );
    return { build, remote: null, error: message };
  }
}

export interface WandgxEvent {
  buildRowId?: string;      // our wandgx_builds.id (preferred)
  buildId?: string;         // WandGx-side build id
  spaceId: string;
  type: string;             // build.started | build.completed | build.deployed | build.failed …
  status?: 'queued' | 'building' | 'deployed' | 'error';
  repoUrl?: string;
  liveUrl?: string;
  error?: string;
}

/** Apply an inbound WandGx build event: update the row, log to the page, notify the UI. */
export async function applyWandgxEvent(event: WandgxEvent): Promise<{ applied: boolean; build?: any }> {
  const existing = event.buildRowId
    ? await one<any>(`SELECT * FROM wandgx_builds WHERE id::text = $1 AND space_id = $2`, [event.buildRowId, event.spaceId])
    : await one<any>(`SELECT * FROM wandgx_builds WHERE space_id = $1 AND wandgx_build_id = $2`, [event.spaceId, event.buildId ?? '']);
  if (!existing) return { applied: false };

  const status = event.status ?? (event.type === 'build.failed' ? 'error' : event.type === 'build.deployed' ? 'deployed' : 'building');
  const build = await one<any>(
    `UPDATE wandgx_builds
     SET status = $2, repo_url = COALESCE($3, repo_url), live_url = COALESCE($4, live_url),
         error = $5, raw = COALESCE($6, raw), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [existing.id, status, event.repoUrl ?? null, event.liveUrl ?? null, event.error ?? null, event.repoUrl || event.liveUrl ? JSON.stringify(event) : null]
  );

  if (build!.page_id) {
    const line =
      status === 'error'
        ? `❌ **Build failed** — ${event.error ?? 'no detail provided'}`
        : status === 'deployed'
          ? `✅ **Deployed** — ${event.liveUrl ? `[live](${event.liveUrl})` : ''}${event.liveUrl && event.repoUrl ? ' · ' : ''}${event.repoUrl ? `[repo](${event.repoUrl})` : ''}`
          : `⚙️ Build update — ${event.type}`;
    await appendBuildLog(event.spaceId, build!.page_id, build!.created_by ?? existing.created_by, line);
  }
  void recordActivity(event.spaceId, existing.created_by, status === 'error' ? 'wandgx_build_failed' : 'wandgx_build_completed', {
    buildId: existing.id,
    title: existing.title,
    status,
    liveUrl: event.liveUrl ?? null,
  });
  bus.publish({ spaceId: event.spaceId, type: 'page_updated', payload: { pageId: build!.page_id } });
  return { applied: true, build };
}
