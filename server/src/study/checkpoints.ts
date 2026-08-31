import { one, q } from '../db.js';
import { runJs } from '../code/routes.js';

/**
 * Project checkpoints — runnable, auto-graded milestones inside a page.
 *
 * A checkpoint is a ```js fenced block whose first line is a marker comment
 * (comments survive any editor round-trip, unlike fence info strings):
 *
 *   ```js
 *   // checkpoint: Reverse a string | expect: "olleh"
 *   return 'hello'.split('').reverse().join('');
 *   ```
 *
 * The block runs in the same sandbox as the Coding surface (3s timeout);
 * `expect:` takes a JSON literal — objects are compared as whitespace-free
 * JSON. Omit `expect:` for run-without-error checkpoints. Passes feed the
 * mastery map, and passing every checkpoint on a page auto-ticks its items
 * in learning paths.
 */

export interface Checkpoint {
  index: number;
  title: string;
  /** Raw expectation as written (display); null = just run without error. */
  expect: string | null;
  code: string;
}

const MARKER = /^\/\/\s*checkpoint:\s*(.+)$/m;

export function parseCheckpoints(markdown: string): Checkpoint[] {
  const checkpoints: Checkpoint[] = [];
  for (const match of markdown.matchAll(/```(?:js|javascript)\r?\n([\s\S]*?)```/g)) {
    const body = match[1];
    const marker = body.match(MARKER);
    if (!marker) continue;
    let title = marker[1].trim();
    let expect: string | null = null;
    const splitAt = title.lastIndexOf('| expect:');
    if (splitAt >= 0) {
      expect = title.slice(splitAt + '| expect:'.length).trim();
      title = title.slice(0, splitAt).trim();
    }
    checkpoints.push({
      index: checkpoints.length,
      title: title.replace(/\|$/, '').trim(),
      expect,
      code: body,
    });
  }
  return checkpoints;
}

/** Whitespace-free comparison basis: objects are JSON, primitives String(). */
const display = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

const normalize = (s: string): string => s.replace(/\s+/g, '');

export interface CheckpointRun {
  index: number;
  title: string;
  passed: boolean;
  expected: string | null;
  actual: string;
  logs: string[];
  ok: boolean;
}

export function gradeCheckpoint(checkpoint: Checkpoint): CheckpointRun {
  const expectedValue = checkpoint.expect !== null ? tryParseJson(checkpoint.expect) : undefined;
  const expectedDisplay = checkpoint.expect === null ? null : display(expectedValue ?? checkpoint.expect);
  // the sandbox runs plain scripts; tolerate `return`-style solutions via IIFE wrap
  const source = /\breturn\b/.test(checkpoint.code) ? `(function () {\n${checkpoint.code}\n})()` : checkpoint.code;
  const run = runJs(source);
  let passed: boolean;
  if (!run.ok) passed = false;
  else if (checkpoint.expect === null) passed = true;
  else passed = normalize(run.result) === normalize(expectedDisplay ?? '');
  return {
    index: checkpoint.index,
    title: checkpoint.title,
    passed,
    expected: expectedDisplay,
    actual: run.result,
    logs: run.logs,
    ok: run.ok,
  };
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null; // unparseable expectation → compared literally as text
  }
}

export interface CheckpointState extends Checkpoint {
  passed: boolean;
  attempts: number;
  actual: string | null;
}

/** Checkpoints from the page's current markdown joined with the user's results. */
export async function getCheckpointStates(pageId: string, userId: string): Promise<CheckpointState[]> {
  const page = await one<{ markdown: string | null }>(`SELECT markdown FROM pages WHERE id = $1`, [pageId]);
  if (!page) return [];
  const checkpoints = parseCheckpoints(page.markdown ?? '');
  const rows = await q<{ checkpoint_index: number; passed: boolean; attempts: number; actual: string | null }>(
    `SELECT checkpoint_index, passed, attempts, actual FROM checkpoint_results WHERE page_id = $1 AND user_id = $2`,
    [pageId, userId]
  );
  return checkpoints.map((c) => {
    const row = rows.find((r) => r.checkpoint_index === c.index);
    return { ...c, passed: row?.passed ?? false, attempts: row?.attempts ?? 0, actual: row?.actual ?? null };
  });
}

export async function recordCheckpointRun(pageId: string, userId: string, run: CheckpointRun): Promise<void> {
  await q(
    `INSERT INTO checkpoint_results (page_id, user_id, checkpoint_index, passed, attempts, actual, passed_at)
     VALUES ($1, $2, $3, $4, 1, $5, CASE WHEN $4 THEN now() ELSE NULL END)
     ON CONFLICT (page_id, user_id, checkpoint_index) DO UPDATE SET
       passed = EXCLUDED.passed,
       attempts = checkpoint_results.attempts + 1,
       actual = EXCLUDED.actual,
       passed_at = COALESCE(checkpoint_results.passed_at, EXCLUDED.passed_at),
       updated_at = now()`,
    [pageId, userId, run.index, run.passed, run.actual.slice(0, 2000)]
  );
}

/** True when the page has checkpoints and this user has passed every one. */
export async function allCheckpointsPassed(pageId: string, userId: string): Promise<boolean> {
  const states = await getCheckpointStates(pageId, userId);
  return states.length > 0 && states.every((s) => s.passed);
}

/**
 * Auto-tick: when every checkpoint on a page is passed, mark the page done in
 * every path that contains it (for this user). Returns the paths ticked.
 */
export async function autoTickPathsForPage(spaceId: string, pageId: string, userId: string): Promise<string[]> {
  const paths = await q<{ id: string; items: { pageId?: string }[] }>(
    `SELECT id, items FROM learning_paths WHERE space_id = $1`,
    [spaceId]
  );
  const ticked: string[] = [];
  for (const path of paths) {
    (path.items ?? []).forEach((item, index) => {
      if (item?.pageId !== pageId) return;
      void q(
        `INSERT INTO path_progress (user_id, path_id, item_index, done) VALUES ($1, $2, $3, true)
         ON CONFLICT (user_id, path_id, item_index) DO UPDATE SET done = true, updated_at = now()`,
        [userId, path.id, index]
      );
      ticked.push(path.id);
    });
  }
  return ticked;
}
