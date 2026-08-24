/**
 * Tiny bridge between the on-screen guide agent and the TipTap editor on the
 * current page view. PageView registers the live editor instance; the guide's
 * insert_into_editor frontend tool writes through it (inserts markdown at the
 * cursor as a paragraph chain).
 */

type EditorLike = {
  chain: () => { focus: () => any; insertContent: (c: any) => any; run: () => void };
  state: { selection: { from: number; to: number } };
  view: { state: any; dispatch: (tr: any) => void };
  getText: () => string;
};

let editor: EditorLike | null = null;

export function registerEditor(e: EditorLike | null) {
  editor = e;
}

export function editorAvailable(): boolean {
  return !!editor;
}

export function getSelectionText(): string {
  if (!editor) return '';
  const { from, to } = editor.state.selection;
  if (from === to) return '';
  try {
    return editor.view.state.doc.textBetween(from, to, '\n');
  } catch {
    return '';
  }
}

function blocksFromMarkdown(md: string): any[] {
  // Minimal markdown → TipTap nodes (paragraphs with inline marks, headings,
  // bullet/task lists, code fences). Enough for agent-drafted notes.
  const nodes: any[] = [];
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const heading = line.match(/^(#{1,3})\s+(.*)/);
    if (heading) {
      nodes.push({ type: 'heading', attrs: { level: heading[1].length }, content: inlineNodes(heading[2]) });
      i++;
      continue;
    }
    if (/^```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++; // closing fence
      nodes.push({ type: 'codeBlock', content: code.length ? [{ type: 'text', text: code.join('\n') }] : undefined });
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)/) || line.match(/^\s*[-*]\s+(.*)/);
    if (bullet) {
      const items: any[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)/);
        if (m) {
          items.push({ type: 'taskItem', attrs: { checked: m[1] !== ' ' }, content: [{ type: 'paragraph', content: inlineNodes(m[2]) }] });
          i++;
          continue;
        }
        const b = lines[i].match(/^\s*[-*]\s+(.*)/);
        if (b) {
          items.push({ type: 'listItem', content: [{ type: 'paragraph', content: inlineNodes(b[1]) }] });
          i++;
          continue;
        }
        break;
      }
      const isTask = /^\s*[-*]\s+\[/.test(line);
      nodes.push({ type: isTask ? 'taskList' : 'bulletList', content: items });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    nodes.push({ type: 'paragraph', content: inlineNodes(line) });
    i++;
  }
  return nodes;
}

function inlineNodes(text: string): any[] {
  // split on **bold**, *italic*, `code`, [text](href), [[wiki]]
  const parts: any[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\[\[[^\]]+\]\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ type: 'text', text: text.slice(last, m.index) });
    const t = m[0];
    if (t.startsWith('**')) parts.push({ type: 'text', marks: [{ type: 'bold' }], text: t.slice(2, -2) });
    else if (t.startsWith('`')) parts.push({ type: 'text', marks: [{ type: 'code' }], text: t.slice(1, -1) });
    else if (t.startsWith('[[')) parts.push({ type: 'text', marks: [{ type: 'link', attrs: { href: `wiki:${t.slice(2, -2)}` } }], text: t });
    else if (t.startsWith('*')) parts.push({ type: 'text', marks: [{ type: 'italic' }], text: t.slice(1, -1) });
    else {
      const lm = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!;
      parts.push({ type: 'text', marks: [{ type: 'link', attrs: { href: lm[2] } }], text: lm[1] });
    }
    last = m.index + t.length;
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
  return parts.length ? parts : [{ type: 'text', text: '' }];
}

/** Insert markdown at the cursor. Returns true when an editor was available. */
export function insertMarkdown(md: string): boolean {
  if (!editor) return false;
  const nodes = blocksFromMarkdown(md);
  editor.chain().focus().insertContent(nodes).run();
  return true;
}
