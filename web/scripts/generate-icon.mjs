import { chromium } from 'playwright-core';
import fs from 'node:fs';

/**
 * Regenerate the dithered SET icon set into web/public.
 * Renders generate-icon.html (Inter Black "S" sampled to a dither grid,
 * painted with the dither-kit Bayer language) at every PWA/favicon size.
 *
 *   cd web && npm i -D playwright-core   (or run anywhere with it installed)
 *   CHROME_EXE=/path/to/chrome node scripts/generate-icon.mjs
 */
// chromium headless shell path (playwright cache); override via CHROME_EXE env
const EXE = process.env.CHROME_EXE || `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`;
const OUT = new URL('../public', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: EXE, args: ['--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
await page.goto(new URL('./generate-icon.html', import.meta.url).href, { waitUntil: 'load' });
await page.waitForFunction(() => document.title === 'ready');
await page.waitForTimeout(300);

// spec list: [file, N, grid, dither, margin]
const specs = [
  ['icon-512.png',           512, 26, true,  0.13],
  ['icon-192.png',           192, 26, true,  0.13],
  ['apple-touch-icon.png',   180, 26, true,  0.13],
  ['icon-maskable-512.png',  512, 26, true,  0.24],
  ['icon-maskable-192.png',  192, 26, true,  0.24],
  ['favicon-32.png',          32, 14, false, 0.10],
  ['favicon-16.png',          16, 12, false, 0.08],
];
for (const [file, N, grid, dither, margin] of specs) {
  const url = await page.evaluate(([n,g,d,m]) => window.renderSet(n,'font',g,d,m), [N,grid,dither,margin]);
  const buf = Buffer.from(url.split(',')[1], 'base64');
  fs.writeFileSync(`${OUT}/${file}`, buf);
  // keep review copies
  fs.writeFileSync(`/tmp/setshots/final-${file}`, buf);
  console.log(file, buf.length, 'bytes');
}
await browser.close();
console.log('all written');
