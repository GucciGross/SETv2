/**
 * Small LCS-based line diff for the page version history panel.
 * Returns lines tagged added/removed/context so the panel can paint a
 * readable what-changed view between two markdown snapshots.
 */

export type DiffLine = { kind: 'add' | 'del' | 'ctx'; text: string };

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;
  // LCS table (pages are small; this is a settings panel, not a merge tool)
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'ctx', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'del', text: a[i] });
      i++;
    } else {
      out.push({ kind: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ kind: 'del', text: a[i++] });
  while (j < m) out.push({ kind: 'add', text: b[j++] });
  return out;
}

/** Collapse long runs of unchanged lines to `... (N unchanged)` for readability. */
export function collapseContext(lines: DiffLine[], keep = 2): (DiffLine | { kind: 'gap'; text: string })[] {
  const out: (DiffLine | { kind: 'gap'; text: string })[] = [];
  let run: DiffLine[] = [];
  const flush = () => {
    if (run.length <= keep * 2) out.push(...run);
    else {
      out.push(...run.slice(0, keep));
      out.push({ kind: 'gap', text: `⋯ ${run.length - keep * 2} unchanged lines` });
      out.push(...run.slice(-keep));
    }
    run = [];
  };
  for (const l of lines) {
    if (l.kind === 'ctx') run.push(l);
    else {
      flush();
      out.push(l);
    }
  }
  flush();
  return out;
}
