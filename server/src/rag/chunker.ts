/**
 * Structure-aware chunker: splits documents along markdown headings,
 * then packs sections into overlapping chunks under a size budget.
 * PDF page markers (\f or [[page:N]] from the pdf extractor) become page labels.
 */
export interface RawChunk {
  idx: number;
  heading: string;
  content: string;
  pageLabel: string | null;
}

const MAX_CHARS = 1600;
const OVERLAP_CHARS = 200;

interface Section {
  heading: string;
  text: string;
  page: string | null;
}

function splitSections(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { heading: '', text: '', page: null };
  let page = 1;
  for (const line of text.split(/\r?\n/)) {
    const pm = line.match(/^\[\[page:(\d+)\]\]\s*$/);
    if (pm) {
      page = parseInt(pm[1], 10);
      continue;
    }
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      if (current.text.trim()) sections.push(current);
      current = { heading: hm[2].trim(), text: line + '\n', page: `p.${page}` };
    } else {
      current.text += line + '\n';
      if (!current.page) current.page = `p.${page}`;
    }
  }
  if (current.text.trim()) sections.push(current);
  return sections;
}

export function chunkText(text: string): RawChunk[] {
  const chunks: RawChunk[] = [];
  let idx = 0;
  for (const section of splitSections(text)) {
    const clean = section.text.trim();
    if (!clean) continue;
    if (clean.length <= MAX_CHARS) {
      chunks.push({ idx: idx++, heading: section.heading, content: clean, pageLabel: section.page });
      continue;
    }
    // Pack paragraphs, then sentences, with overlap
    const paragraphs = clean.split(/\n\s*\n/);
    let buf = '';
    const flush = () => {
      if (buf.trim()) {
        chunks.push({ idx: idx++, heading: section.heading, content: buf.trim(), pageLabel: section.page });
        buf = buf.slice(-OVERLAP_CHARS);
      }
    };
    for (const para of paragraphs) {
      if (para.length > MAX_CHARS) {
        for (const sentence of para.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [para]) {
          if ((buf + sentence).length > MAX_CHARS) flush();
          buf += sentence;
        }
      } else {
        if ((buf + para).length > MAX_CHARS) flush();
        buf += para + '\n\n';
      }
    }
    flush();
  }
  return chunks;
}

/** Extract dates (for timeline views) from text. */
export function extractDates(text: string): { date: string; context: string }[] {
  const out: { date: string; context: string }[] = [];
  const patterns = [
    /\b(\d{4}-\d{2}-\d{2})\b/g,
    /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4})\b/g,
    /\b(\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4})\b/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const start = Math.max(0, m.index! - 60);
      out.push({ date: m[1], context: text.slice(start, m.index! + m[0].length + 60).replace(/\s+/g, ' ') });
    }
  }
  return out.slice(0, 200);
}
