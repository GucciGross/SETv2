/** Explicit maintainer command; never downloads code at app runtime or normal build time. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const upstream = 'https://github.com/LerSent001/orb';
export const revision = '047c58cc93587c21dac12183fc0fb1e4101c8e1a';
export const files = {
  'LICENSE': '58572f20e18b109e062b6401f0c2d1cef6b3d5d0',
  'effect.wgsl': 'ad432053f4cd9bc2cda06965279e9ebe5e05cb15',
  'poster.png': '0943362a7a8e50d9330fee70093a80a4285a250d',
  'src/orb-renderer.ts': '80e8621ee76a53713e0d99770b8199cd5e2a2c55',
  'src/orb-states.ts': '71583072304f9b056ce49e18ea1a2d2df1d2b01a',
  'src/orb-uniforms.ts': '1491e7457cc876733ac237af5cec0d7c810cb241',
  'src/particle-ribbon.ts': '95c79b6fe9515c08f774268f41e48c1c298b399d',
  'src/presets.ts': 'd3b78876f41d930a0bcb1d0e8abafd79268365de',
  'src/shader-source.ts': 'fa19e96fc073af214ee716a37b8f7df7df3b81e4',
};
const root = fileURLToPath(new URL('../src/vendor/lersent-orb/', import.meta.url));
const write = process.argv.includes('--write');
const verified = [];
for (const [name, expected] of Object.entries(files)) {
  let bytes;
  if (write) {
    const response = await fetch(`https://raw.githubusercontent.com/LerSent001/orb/${revision}/${name}`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Orb import failed: ${name} (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
  } else bytes = await readFile(path.join(root, name));
  const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (actual !== expected) throw new Error(`Orb source checksum mismatch: ${name}`);
  verified.push([name, bytes]);
}
// Validate the whole import before writing any file. No upstream scripts are executed.
if (write) for (const [name, bytes] of verified) {
  const destination = path.join(root, name);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
}
const publicNotice = fileURLToPath(new URL('../public/third-party/lersent-orb-LICENSE.txt', import.meta.url));
const license = verified.find(([name]) => name === 'LICENSE')[1];
if (write) {
  await mkdir(path.dirname(publicNotice), { recursive: true });
  await writeFile(publicNotice, license);
} else if (!(await readFile(publicNotice)).equals(license)) {
  throw new Error('Distributed Orb MIT notice does not match the vendored license');
}
console.log(`${write ? 'Imported' : 'Verified'} ${verified.length} pinned Orb files from ${revision}`);
