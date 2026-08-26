import AdmZip from 'adm-zip';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.js';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

/**
 * Deck → H5P package export (.h5p) for LMS interop (Moodle, WordPress, Canvas…).
 *
 * H5P libraries are fetched once from the h5p GitHub org via jsDelivr tarballs
 * and cached under DATA_DIR/h5p-libs/<MachineName-major.minor>/; dependency
 * trees are resolved from each library.json. Everything is MIT/GPL-licensed
 * open content — same sources the H5P Hub distributes.
 */

type H5PLib = { machineName: string; majorVersion: number; minorVersion: number };

const cacheDir = () => join(config.dataDir, 'h5p-libs');

function libDir(l: H5PLib): string {
  return join(cacheDir(), `${l.machineName}-${l.majorVersion}.${l.minorVersion}`);
}

async function exists(p: string): Promise<boolean> {
  try {
    await readFile(p);
    return true;
  } catch {
    return false;
  }
}

async function fetchLib(l: H5PLib): Promise<boolean> {
  const dir = libDir(l);
  if (await exists(join(dir, 'library.json'))) return true;
  const repo = `h5p/h5p-${l.machineName.split('.')[1].replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`;
  const url = `https://codeload.github.com/${repo}/tar.gz/refs/heads/master`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`${res.status}`);
    const tmp = join(cacheDir(), `.tmp-${l.machineName}-${Date.now()}.tgz`);
    await mkdir(cacheDir(), { recursive: true });
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(tmp));
    const { execFile } = await import('node:child_process');
    const extractRoot = join(cacheDir(), `.tmp-${l.machineName}-x${Date.now()}`);
    await mkdir(extractRoot, { recursive: true });
    await new Promise<void>((resolve, reject) =>
      execFile('tar', ['-xzf', tmp, '-C', extractRoot], (e) => (e ? reject(e) : resolve()))
    );
    await rm(tmp, { force: true });
    // repo tarball extracts to <repo>-master/ — find its library.json
    const { readdir } = await import('node:fs/promises');
    const inner = (await readdir(extractRoot))[0];
    const src = join(extractRoot, inner);
    const meta = JSON.parse(await readFile(join(src, 'library.json'), 'utf8'));
    // normalize folder name to the version WE want (pin requested)
    const dest = libDir({ machineName: meta.machineName ?? l.machineName, majorVersion: l.majorVersion, minorVersion: l.minorVersion });
    await rm(dest, { recursive: true, force: true });
    const { cp } = await import('node:fs/promises');
    await cp(src, dest, { recursive: true });
    // rewrite folder's library.json versions to match our pinned folder name
    const lp = join(dest, 'library.json');
    const m = JSON.parse(await readFile(lp, 'utf8'));
    m.majorVersion = l.majorVersion;
    m.minorVersion = l.minorVersion;
    await writeFile(lp, JSON.stringify(m, null, 2));
    await rm(extractRoot, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function resolveTree(root: H5PLib, out = new Set<string>()): Promise<H5PLib[]> {
  const key = `${root.machineName}-${root.majorVersion}.${root.minorVersion}`;
  if (out.has(key)) return [];
  out.add(key);
  const ok = await fetchLib(root);
  if (!ok) return [root];
  const libs: H5PLib[] = [];
  try {
    const meta = JSON.parse(await readFile(join(libDir(root), 'library.json'), 'utf8'));
    for (const d of meta.dependencies ?? []) {
      const dep = { machineName: d.machineName, majorVersion: d.majorVersion, minorVersion: d.minorVersion };
      libs.push(...(await resolveTree(dep, out)));
    }
  } catch {
    /* unreadable meta — include what we have */
  }
  return [root, ...libs];
}

async function addDirToZip(zip: AdmZip, dir: string, zipRoot: string): Promise<void> {
  const { readdir } = await import('node:fs/promises');
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const zipPath = join(zipRoot, entry.name);
    if (entry.isDirectory()) await addDirToZip(zip, full, zipPath);
    else zip.addLocalFile(full, zipRoot);
  }
}

/** flashcards → H5P.Flashcards; quiz/studyguide → H5P.QuestionSet (multi-choice). */
export async function deckToH5P(deck: { kind: string; title: string; items: any }): Promise<Buffer> {
  const isFlash = deck.kind === 'flashcards';
  const main: H5PLib = isFlash
    ? { machineName: 'H5P.Flashcards', majorVersion: 1, minorVersion: 6 }
    : { machineName: 'H5P.QuestionSet', majorVersion: 1, minorVersion: 22 };

  let content: any;
  if (isFlash) {
    const cards = (deck.items?.cards ?? []).map((c: any) => ({ image: undefined, text: String(c.q ?? ''), answer: String(c.a ?? '') }));
    content = { cards, progress: true, counter: true, description: deck.title };
  } else {
    const questions = (deck.items?.items ?? deck.items?.cards ?? []).map((q: any) => {
      const opts = (q.options ?? q.choices ?? []).map((o: any, i: number) => ({
        text: String(typeof o === 'string' ? o : o.text ?? o.label ?? o),
        correct: i === (q.answerIndex ?? q.answer ?? 0),
      }));
      return {
        params: { media: {}, answers: opts, question: String(q.question ?? q.q ?? '') },
        library: 'H5P.MultiChoice 1.16',
        subContentId: crypto.randomUUID(),
      };
    });
    content = {
      intro: `Generated from SET — ${deck.title}`,
      title: deck.title,
      progressType: 'arithmetic',
      passPercentage: 50,
      questions,
      texts: { showSolution: 'Show solution', retry: 'Retry', checkAnswer: 'Check', score: 'Score' },
    };
  }

  const libs = await resolveTree(main);
  const zip = new AdmZip();
  zip.addFile(
    'h5p.json',
    Buffer.from(
      JSON.stringify({
        title: deck.title,
        language: 'en',
        mainLibrary: main.machineName,
        embedTypes: ['div'],
        license: 'MIT',
        preloadedDependencies: libs.map((l) => ({ machineName: l.machineName, majorVersion: l.majorVersion, minorVersion: l.minorVersion })),
      }, null, 2)
    )
  );
  zip.addFile('content/content.json', Buffer.from(JSON.stringify(content)));
  for (const l of libs) {
    const dir = libDir(l);
    if (await exists(join(dir, 'library.json'))) {
      await addDirToZip(zip, dir, `${l.machineName}-${l.majorVersion}.${l.minorVersion}`);
    }
  }
  return zip.toBuffer();
}
