import { marked } from 'marked';

/** TipTap-style block doc JSON used across SET. */
export interface TNode {
  type: string;
  attrs?: Record<string, any>;
  content?: TNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, any> }[];
}

const WIKI_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const BLOCKREF_RE = /^\(\(([0-9a-fA-F-]{8,})\)\)$/;

export function extractWikiTargets(md: string): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(WIKI_RE)) out.push(m[1].trim());
  return out;
}

/** Split raw text into TipTap text nodes, marking [[wiki links]] with the `wikiLink` mark. */
function inlineText(text: string): TNode[] {
  const nodes: TNode[] = [];
  let last = 0;
  for (const m of text.matchAll(WIKI_RE)) {
    const idx = m.index!;
    if (idx > last) nodes.push({ type: 'text', text: text.slice(last, idx) });
    nodes.push({
      type: 'text',
      text: m[2]?.trim() || m[1].trim(),
      marks: [{ type: 'wikiLink', attrs: { target: m[1].trim() } }],
    });
    last = idx + m[0].length;
  }
  if (last < text.length) nodes.push({ type: 'text', text: text.slice(last) });
  return nodes.filter((n) => n.text);
}

/**
 * Inline tokenizer (longest-first): wiki links, images, links, bold, italic,
 * strike (~~x~~), highlight (==x==), inline code.
 */
const INLINE_RE =
  /(\[\[[^\]]+\]\])|(!\[[^\]]*\]\([^)]+\))|(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(__[^_]+__)|(~~[^~]+~~)|(==[^=\n]+==)|(`[^`]+`)|(\*[^*\n]+\*)|(_[^_\n]+_)/g;

function applyMark(nodes: TNode[], mark: { type: string; attrs?: Record<string, any> }): TNode[] {
  return nodes.map((n) => ({ ...n, marks: [...(n.marks ?? []), mark] }));
}

/** Inline tokenizer: [[wiki]], ![img](src), [text](url), **bold**, *italic*, ~~strike~~, ==highlight==, `code`. */
function markedInlineToNodes(raw: string): TNode[] {
  const out: TNode[] = [];
  let last = 0;
  for (const m of raw.matchAll(INLINE_RE)) {
    const idx = m.index!;
    if (idx > last) out.push(...inlineText(raw.slice(last, idx)));
    const tok = m[0];
    if (tok.startsWith('[[')) {
      const inner = tok.slice(2, -2);
      const [target, label] = inner.split('|');
      out.push({
        type: 'text',
        text: (label ?? target).trim(),
        marks: [{ type: 'wikiLink', attrs: { target: target.trim() } }],
      });
    } else if (tok.startsWith('![')) {
      const mm = tok.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/)!;
      out.push({ type: 'image', attrs: { src: mm[2], alt: mm[1] || null, title: null } });
    } else if (tok.startsWith('[')) {
      const mm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!;
      for (const n of inlineText(mm[1])) out.push({ ...n, marks: [...(n.marks ?? []), { type: 'link', attrs: { href: mm[2] } }] });
    } else if (tok.startsWith('**') || tok.startsWith('__')) {
      out.push(...applyMark(inlineText(tok.slice(2, -2)), { type: 'bold' }));
    } else if (tok.startsWith('~~')) {
      out.push(...applyMark(inlineText(tok.slice(2, -2)), { type: 'strike' }));
    } else if (tok.startsWith('==')) {
      out.push(...applyMark(inlineText(tok.slice(2, -2)), { type: 'highlight' }));
    } else if (tok.startsWith('`')) {
      out.push({ type: 'text', text: tok.slice(1, -1), marks: [{ type: 'code' }] });
    } else {
      out.push(...applyMark(inlineText(tok.slice(1, -1)), { type: 'italic' }));
    }
    last = idx + tok.length;
  }
  if (last < raw.length) out.push(...inlineText(raw.slice(last)));
  return out.filter((n) => n.text !== undefined && n.text !== '' || n.type === 'image');
}

function listToNodes(token: any, ordered: boolean): TNode {
  const type = ordered ? 'orderedList' : 'bulletList';
  const content: TNode[] = [];
  for (const item of token.items ?? []) {
    const children: TNode[] = [];
    const flat = item.tokens ?? [];
    let task: boolean | undefined;
    let checked: boolean | undefined;
    for (const t of flat) {
      if (t.type === 'text' && typeof t.task === 'boolean') {
        task = true;
        checked = !!t.checked;
        children.push({ type: 'paragraph', content: markedInlineToNodes(t.text ?? '') });
      } else if (t.type === 'paragraph') {
        children.push({ type: 'paragraph', content: markedInlineToNodes(t.raw?.replace(/\n$/, '') ?? '') });
      } else if (t.type === 'text') {
        children.push({ type: 'paragraph', content: markedInlineToNodes(t.text ?? '') });
      } else {
        const sub = blockToNode(t);
        if (sub) children.push(sub);
      }
    }
    if (task) {
      content.push({
        type: 'taskItem',
        attrs: { checked },
        content: children.length ? children : [{ type: 'paragraph' }],
      });
    } else {
      content.push({ type: 'listItem', content: children.length ? children : [{ type: 'paragraph' }] });
    }
  }
  return { type, content };
}

function tableToNode(token: any): TNode {
  const aligns: (string | null)[] = token.align ?? [];
  const headerCells: TNode[] = (token.header ?? []).map((c: any, i: number) => ({
    type: 'tableHeader',
    attrs: { colspan: 1, rowspan: 1, colwidth: null, alignment: aligns[i] ?? null },
    content: [{ type: 'paragraph', content: markedInlineToNodes(c.text ?? '') }],
  }));
  const rows: TNode[] = (token.rows ?? []).map(
    (row: any[]) =>
      ({
        type: 'tableRow',
        content: row.map((c: any, i: number) => ({
          type: 'tableCell',
          attrs: { colspan: 1, rowspan: 1, colwidth: null, alignment: aligns[i] ?? null },
          content: [{ type: 'paragraph', content: markedInlineToNodes(c.text ?? '') }],
        })),
      } as TNode)
  );
  return {
    type: 'table',
    content: [{ type: 'tableRow', content: headerCells }, ...rows],
  };
}

function blockToNode(token: any): TNode | null {
  switch (token.type) {
    case 'heading':
      return {
        type: 'heading',
        attrs: { level: Math.min(6, Math.max(1, token.depth ?? 2)) },
        content: markedInlineToNodes(token.text ?? ''),
      };
    case 'paragraph': {
      const raw = token.raw?.replace(/\n$/, '') ?? '';
      const br = raw.trim().match(BLOCKREF_RE);
      if (br) return { type: 'blockRef', attrs: { blockId: br[1] } };
      const vid = raw.trim().match(/^@\[video\]\((https?:\/\/[^)\s]+)\)$/);
      if (vid) return { type: 'youtube', attrs: { src: vid[1] } };
      return { type: 'paragraph', content: markedInlineToNodes(raw) };
    }
    case 'html': {
      // callout-style blocks arrive as raw html; keep text content
      const text = String(token.raw ?? '').replace(/<[^>]+>/g, ' ').trim();
      return text ? { type: 'paragraph', content: markedInlineToNodes(text) } : null;
    }
    case 'code':
      return {
        type: 'codeBlock',
        attrs: { language: token.lang ?? null },
        content: [{ type: 'text', text: token.text ?? '' }],
      };
    case 'blockquote': {
      const content = (token.tokens ?? []).map(blockToNode).filter(Boolean) as TNode[];
      return { type: 'blockquote', content };
    }
    case 'hr':
      return { type: 'horizontalRule' };
    case 'list':
      return listToNodes(token, !!token.ordered);
    case 'table':
      return tableToNode(token);
    case 'space':
      return null;
    default:
      if (token.raw?.trim()) return { type: 'paragraph', content: inlineText(token.raw.replace(/\n$/, '')) };
      return null;
  }
}

/** Markdown  TipTap doc JSON. */
export function mdToDoc(md: string): TNode {
  const tokens = marked.lexer(md);
  const content: TNode[] = [];
  for (const t of tokens) {
    const node = blockToNode(t);
    if (node) content.push(node);
  }
  return { type: 'doc', content };
}

function nodesToMd(nodes: TNode[] | undefined, listMarker = '- '): string {
  return (nodes ?? [])
    .map((n) => nodeToMd(n, listMarker))
    .filter((s) => s !== '')
    .join('\n\n');
}

const escapeCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function inlineToMd(nodes: TNode[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === 'text') {
        let text = n.text ?? '';
        for (const m of n.marks ?? []) {
          if (m.type === 'bold') text = `**${text}**`;
          else if (m.type === 'italic') text = `*${text}*`;
          else if (m.type === 'strike') text = `~~${text}~~`;
          else if (m.type === 'highlight') text = `==${text}==`;
          else if (m.type === 'code') text = `\`${text}\``;
          else if (m.type === 'link') text = `[${text}](${m.attrs?.href ?? ''})`;
          else if (m.type === 'wikiLink')
            text = `[[${m.attrs?.target ?? text}${m.attrs?.target && text && m.attrs.target !== text ? `|${text}` : ''}]]`;
        }
        return text;
      }
      if (n.type === 'image') return `![${n.attrs?.alt ?? ''}](${n.attrs?.src ?? ''})`;
      if (n.type === 'hard_break' || n.type === 'hardBreak') return '\n';
      return n.text ?? '';
    })
    .join('');
}

export function nodeToMd(node: TNode, listMarker = '- ', indent = ''): string {
  switch (node.type) {
    case 'doc':
      return nodesToMd(node.content);
    case 'heading':
      return `${'#'.repeat(node.attrs?.level ?? 2)} ${inlineToMd(node.content)}`;
    case 'paragraph':
      return inlineToMd(node.content);
    case 'image':
      return `![${node.attrs?.alt ?? ''}](${node.attrs?.src ?? ''})`;
    case 'blockRef':
      return `((${node.attrs?.blockId ?? ''}))`;
    case 'youtube':
      return `@[video](${node.attrs?.src ?? ''})`;
    case 'codeBlock': {
      const text = (node.content ?? []).map((c) => c.text ?? '').join('');
      return `\`\`\`${node.attrs?.language ?? ''}\n${text}\n\`\`\``;
    }
    case 'blockquote':
      return (node.content ?? [])
        .map((c) => nodeToMd(c, listMarker).split('\n').map((l) => `> ${l}`).join('\n'))
        .join('\n');
    case 'table': {
      const rows = node.content ?? [];
      if (!rows.length) return '';
      const cellText = (cell: TNode) =>
        escapeCell((cell.content ?? []).map((p) => inlineToMd(p.content)).join(' ') || inlineToMd(cell.content));
      const lines: string[] = [];
      rows.forEach((row, ri) => {
        const cells = (row.content ?? []).map(cellText);
        lines.push(`| ${cells.join(' | ')} |`);
        if (ri === 0) {
          const aligns = (row.content ?? []).map((c) =>
            c.attrs?.alignment === 'center' ? ':---:' : c.attrs?.alignment === 'right' ? '---:' : c.attrs?.alignment === 'left' ? ':---' : '---'
          );
          lines.push(`| ${aligns.join(' | ')} |`);
        }
      });
      return lines.join('\n');
    }
    case 'bulletList':
    case 'orderedList': {
      const marker = node.type === 'orderedList' ? '1. ' : listMarker;
      return (node.content ?? [])
        .map((item) => {
          const kids = (item.content ?? []).map((c) => nodeToMd(c, node.type === 'orderedList' ? '1. ' : '- ', indent + '  ')).join('\n');
          return `${indent}${marker}${kids.replace(/\n/g, `\n${indent}  `)}`;
        })
        .join('\n');
    }
    case 'taskList':
      return (node.content ?? [])
        .map(
          (item) =>
            `${indent}- [${item.attrs?.checked ? 'x' : ' '}] ${(item.content ?? [])
              .map((c) => nodeToMd(c, '- ', indent))
              .join(' ')}`
        )
        .join('\n');
    case 'horizontalRule':
      return '---';
    default:
      return node.text ?? inlineToMd(node.content);
  }
}

/** TipTap doc JSON  Markdown. */
export function docToMd(doc: TNode | null | undefined): string {
  if (!doc) return '';
  if (typeof (doc as any).markdown === 'string') return (doc as any).markdown;
  return nodeToMd(doc);
}
