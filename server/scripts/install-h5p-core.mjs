/** Install the exact official core/editor pair used by the pinned Lumi release. */
import AdmZip from 'adm-zip';
import { mkdir, mkdtemp, readFile, rm, writeFile, rename } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'h5p-assets');
const pins = {
  core: { repository: 'h5p-php-library', commit: '829524eaf81fe3f3a295d0e843812be4735f51fc' },
  editor: { repository: 'h5p-editor-php-library', commit: '80b3b281ee9d064b563f242e8ee7a0026b5bf205' },
};
await mkdir(root, { recursive: true });
for (const [name, pin] of Object.entries(pins)) {
  const target = join(root, name);
  if (await readFile(join(target, '.revision'), 'utf8').catch(() => '') === pin.commit) continue;
  const response = await fetch(`https://codeload.github.com/h5p/${pin.repository}/zip/${pin.commit}`, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`H5P ${name} download failed: HTTP ${response.status}`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 64 * 1024 * 1024) throw new Error(`H5P ${name} archive exceeds 64 MB`);
    chunks.push(chunk);
  }
  const archive = new AdmZip(Buffer.concat(chunks));
  const stage = await mkdtemp(join(root, `.stage-${name}-`));
  try {
    let expanded = 0;
    for (const entry of archive.getEntries()) {
      const segments = entry.entryName.split('/'); segments.shift();
      const relative = segments.join('/');
      if (!relative || entry.isDirectory) continue;
      if (segments.some((part) => !part || part === '.' || part === '..') || relative.includes('\\') || ((entry.header.attr >>> 16) & 0o170000) === 0o120000) throw new Error('Unsafe core archive path');
      expanded += entry.header.size;
      if (expanded > 128 * 1024 * 1024) throw new Error('Core archive exceeds expanded size limit');
      const file = join(stage, relative);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, entry.getData());
    }
    await writeFile(join(stage, '.revision'), pin.commit);
    await rm(target, { recursive: true, force: true });
    await rename(stage, target);
    console.log(`Installed H5P ${name} ${pin.commit}`);
  } finally { await rm(stage, { recursive: true, force: true }); }
}
