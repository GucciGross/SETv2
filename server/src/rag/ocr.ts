import { one } from '../db.js';

/**
 * OCR fallback for scanned PDFs via Firecrawl AnyDoc (`POST /v2/parse`).
 * The pipeline's local pdf-parse only reads embedded text layers; when a PDF
 * has none (a scan), we send the bytes to Firecrawl — using the same
 * firecrawlKey the space already configures in Settings → Deep Research.
 */

export async function firecrawlConfig(spaceId: string): Promise<{ key: string | null; url: string | null }> {
  const settings = await one<{ data: any }>(`SELECT data FROM settings WHERE space_id = $1`, [spaceId]);
  const cfg = settings?.data?.research ?? {};
  return { key: cfg.firecrawlKey ?? null, url: cfg.firecrawlUrl ?? null };
}

export async function parseViaFirecrawl(
  buf: Buffer,
  filename: string,
  key: string,
  baseUrl?: string
): Promise<string | null> {
  try {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buf)], { type: 'application/pdf' }), filename || 'document.pdf');
    form.append('options', new Blob([JSON.stringify({ formats: ['markdown'] })], { type: 'application/json' }));
    const res = await fetch(`${baseUrl || 'https://api.firecrawl.dev'}/v2/parse`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const md = json?.data?.markdown;
    return typeof md === 'string' && md.trim().length > 0 ? md : null;
  } catch {
    return null;
  }
}

/** Below this many characters a PDF is treated as having no usable text layer. */
export const MIN_TEXT_LAYER_CHARS = 80;

export async function extractPdfWithOcr(
  spaceId: string,
  buf: Buffer,
  filename: string,
  localExtract: (b: Buffer) => Promise<string>
): Promise<{ text: string; ocr: boolean; scanned: boolean }> {
  let text = '';
  try {
    text = await localExtract(buf);
  } catch {
    text = '';
  }
  if (text.trim().length >= MIN_TEXT_LAYER_CHARS) return { text, ocr: false, scanned: false };
  const { key, url } = await firecrawlConfig(spaceId);
  if (key) {
    const ocrText = await parseViaFirecrawl(buf, filename, key, url ?? undefined);
    if (ocrText) return { text: ocrText, ocr: true, scanned: false };
  }
  return { text, ocr: false, scanned: text.trim().length === 0 };
}
