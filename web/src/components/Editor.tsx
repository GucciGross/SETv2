import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useEditor, EditorContent, Mark, markInputRule, mergeAttributes, Node, NodeViewWrapper,
  ReactNodeViewRenderer, Extension, type Extension as Ext,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Underline from '@tiptap/extension-underline';
import HighlightExt from '@tiptap/extension-highlight';
import ImageExt from '@tiptap/extension-image';
import Youtube from '@tiptap/extension-youtube';
import { Youtube as YoutubeIcon } from 'lucide-react';
import { mdToDoc, docToMd } from '../lib/markdown';
import { api, getToken } from '../lib/api';
import {
  Bold, Italic, Code, Heading1, Heading2, Heading3, List, ListOrdered, ListTodo,
  Quote, Minus, Undo2, Redo2, Table as TableIcon, ImagePlus, Highlighter,
  Strikethrough, Underline as UnderlineIcon, Link2, Copy, Braces,
} from 'lucide-react';

/* ------------------------- custom extensions ------------------------- */

export const WikiLink = Mark.create({
  name: 'wikiLink',
  addAttributes() {
    return { target: { default: null } };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-wikilink]',
        getAttrs: (el) => ({ target: (el as HTMLElement).getAttribute('data-target') }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes({ 'data-wikilink': '', 'data-target': HTMLAttributes.target ?? '', class: 'wikilink' }),
      0,
    ];
  },
  addInputRules() {
    return [
      markInputRule({
        find: /\[\[([^[\]\n]+)\]\]$/,
        type: this.type,
        getAttributes: (m) => ({ target: (m[1] ?? '').trim() }),
      }),
    ];
  },
});

/** Persistent block IDs on paragraphs/headings (block-level references). */
const BlockIdAttr = Extension.create({
  name: 'blockIdAttr',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          blockId: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-block-id') || null,
            renderHTML: (attrs) => (attrs.blockId ? { 'data-block-id': attrs.blockId } : {}),
          },
        },
      },
    ];
  },
});

/** ((blockId)) embed — renders the referenced block's text. */
const BlockRef = Node.create({
  name: 'blockRef',
  group: 'block',
  atom: true,
  addAttributes() {
    return { blockId: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'div[data-block-ref]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-block-ref': '', 'data-block-id': HTMLAttributes.blockId ?? '' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(BlockRefView);
  },
});

function BlockRefView({ node, editor }: any) {
  const [data, setData] = useState<{ pageId: string; pageTitle: string; text: string } | null>(null);
  const blockId = node.attrs.blockId;
  useEffect(() => {
    const spaceId = (editor.storage?.set?.spaceId as string) ?? new URLSearchParams(location.search).get('space');
    if (!blockId) return;
    const path = window.location.pathname.match(/space\/([0-9a-f-]{36})/);
    const sid = path?.[1];
    if (!sid) return;
    api.get(`/spaces/${sid}/blocks/${blockId}`).then((r) => setData(r)).catch(() => setData(null));
  }, [blockId, editor]);
  return (
    <NodeViewWrapper>
      <div
        className="border-l-2 border-violet-400/60 bg-violet-400/5 rounded-r-lg px-3 py-2 my-2 text-sm cursor-pointer hover:bg-violet-400/10"
        data-block-ref
        data-block-id={blockId}
        title={data ? `From: ${data.pageTitle}` : 'Block reference'}
        onClick={() => {
          if (data) {
            const path = window.location.pathname.match(/space\/([0-9a-f-]{36})/);
            if (path) window.location.hash = '';
            if (data && path) {
              window.history.pushState({}, '', `/app/space/${path[1]}/page/${data.pageId}`);
              window.dispatchEvent(new PopStateEvent('popstate'));
            }
          }
        }}
      >
        {data ? (
          <>
            <div className="text-[10px] text-violet-300 mb-0.5"> {data.pageTitle}</div>
            <div className="text-set-text/90 line-clamp-3">{data.text}</div>
          </>
        ) : (
          <span className="text-set-dim text-xs">block reference ({blockId?.slice(0, 8)}…)</span>
        )}
      </div>
    </NodeViewWrapper>
  );
}

/* ------------------------- editor ------------------------- */

export interface EditorHandle {
  getMarkdown: () => string;
}

interface EditorProps {
  markdown: string;
  onSave: (md: string) => void;
  onWikiClick?: (target: string) => void;
  debounceMs?: number;
}

interface MenuItem {
  title: string;
  desc: string;
  icon: string;
  action: () => void;
}

export default function Editor({ markdown, onSave, onWikiClick, debounceMs = 700 }: EditorProps) {
  const skipNext = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickRef = useRef(onWikiClick);
  clickRef.current = onWikiClick;
  const editorSelf = useRef<any>(null);
  const evaluateTriggersRef = useRef<() => void>(() => {});

  const [slash, setSlash] = useState<{ open: boolean; query: string; x: number; y: number }>({ open: false, query: '', x: 0, y: 0 });
  const [wiki, setWiki] = useState<{ open: boolean; query: string; x: number; y: number }>({ open: false, query: '', x: 0, y: 0 });
  const slashRef = useRef(slash);
  slashRef.current = slash;
  const wikiRef = useRef(wiki);
  wikiRef.current = wiki;
  const slashIndexRef = useRef(0);
  const wikiIndexRef = useRef(0);

  // page titles for [[ autocomplete
  const [pageTitles, setPageTitles] = useState<string[]>([]);
  useEffect(() => {
    const path = window.location.pathname.match(/space\/([0-9a-f-]{36})/);
    if (path) api.get(`/spaces/${path[1]}/pages`).then((r) => setPageTitles(r.pages.map((p: any) => p.title))).catch(() => {});
  }, []);

  const uploadImage = async (file: File): Promise<string | null> => {
    const path = window.location.pathname.match(/space\/([0-9a-f-]{36})/);
    if (!path) return null;
    try {
      const r = await api.upload(`/spaces/${path[1]}/files`, [file]);
      return `/api/files/${r.files[0].id}`;
    } catch {
      return null;
    }
  };

  const textBefore = () => {
    const ed = editorSelf.current;
    if (!ed) return '';
    const { $from } = ed.state.selection;
    const start = Math.max(0, $from.parentOffset - 64);
    return $from.parent.textBetween(start, $from.parentOffset, undefined, '￼');
  };

  const evaluateTriggers = () => {
    const before = textBefore();
    const wm = before.match(/\[\[([^\][\n]*)$/);
    const sm = !wm && before.match(/(?:^|\s|\n)\/([a-zA-Z]*)$/);
    if (wm) {
      const c = editorCoords();
      wikiIndexRef.current = 0;
      setWiki((st) => (st.open && st.query === wm[1] ? st : { open: true, query: wm[1], x: c.x, y: c.y }));
    } else if (wikiRef.current.open) {
      setWiki((st) => ({ ...st, open: false }));
    }
    if (sm) {
      const c = editorCoords();
      slashIndexRef.current = 0;
      setSlash((st) => (st.open && st.query === sm[1] ? st : { open: true, query: sm[1], x: c.x, y: c.y }));
    } else if (slashRef.current.open) {
      setSlash((st) => ({ ...st, open: false }));
    }
  };
  evaluateTriggersRef.current = evaluateTriggers;

  const editorCoords = () => {
    const ed = editorSelf.current;
    if (!ed) return { x: 300, y: 200 };
    try {
      const c = (ed.view as any).coordsAtPos(ed.state.selection.from);
      return { x: c.left, y: c.bottom + 6 };
    } catch {
      return { x: 300, y: 200 };
    }
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Link.configure({ openOnClick: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Start writing… type / for blocks, [[ to link pages' }),
      WikiLink,
      BlockIdAttr,
      BlockRef,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Underline,
      HighlightExt,
      ImageExt.configure({ inline: true, allowBase64: false }),
      Youtube.configure({ controls: true, nocookie: true, width: 640, height: 360 }),
    ] as Ext[],
    content: markdown ? mdToDoc(markdown) : { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: {
      handleKeyDown: (_view, event) => {
        // evaluate trigger menus shortly after any keypress (text will have landed)
        setTimeout(evaluateTriggersRef.current, 20);
        return false;
      },
      handleClick: (_view, pos, event) => {
        const target = (event.target as HTMLElement).closest('.wikilink');
        if (target) {
          clickRef.current?.(target.getAttribute('data-target') ?? '');
          return true;
        }
        return false;
      },
      handlePaste: (view, event) => {
        const image = Array.from(event.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
        if (image) {
          event.preventDefault();
          const pos = view.state.selection.from;
          uploadImage(image).then((src) => {
            if (src) editorSelf.current?.chain().insertContentAt(pos, { type: 'image', attrs: { src } }).run();
          });
          return true;
        }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const image = Array.from(event.dataTransfer?.files ?? []).find((f) => f.type.startsWith('image/'));
        if (image) {
          event.preventDefault();
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
          uploadImage(image).then((src) => {
            if (src) editorSelf.current?.chain().insertContentAt(pos, { type: 'image', attrs: { src } }).run();
          });
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      if (skipNext.current) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const md = docToMd(editor.getJSON() as any);
        lastSavedRef.current = md;
        onSave(md);
      }, debounceMs);
    },
  });

  // remote updates (collab refresh) — but never clobber with our own save echo
  const lastSavedRef = useRef<string>(markdown);
  useEffect(() => {
    if (!editor) return;
    const current = docToMd(editor.getJSON() as any);
    if (markdown === lastSavedRef.current) return; // echo of our own save
    if (markdown !== current) {
      skipNext.current = true;
      const sel = editor.state.selection;
      editor.commands.setContent(markdown ? (mdToDoc(markdown) as any) : '');
      editor.commands.setTextSelection(Math.min(sel.from, editor.state.doc.content.size));
      requestAnimationFrame(() => (skipNext.current = false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown]);

  useEffect(() => {
    if (!editor) return;
    const keyHandler = (e: KeyboardEvent) => {
      const s = slashRef.current;
      const w = wikiRef.current;
      const inMenu = s.open || w.open;
      if (!inMenu) return;
      if (e.key === 'Escape') {
        setSlash((st) => ({ ...st, open: false }));
        setWiki((st) => ({ ...st, open: false }));
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        const openMenu = s.open ? 'slash' : 'wiki';
        if (openMenu === 'slash') {
          const items = slashItems.filter((i) => i.title.toLowerCase().includes(s.query.toLowerCase()));
          const max = items.length - 1;
          if (e.key === 'ArrowDown') slashIndexRef.current = Math.min(max, slashIndexRef.current + 1);
          else if (e.key === 'ArrowUp') slashIndexRef.current = Math.max(0, slashIndexRef.current - 1);
          else {
            items[slashIndexRef.current]?.action();
            setSlash((st) => ({ ...st, open: false }));
            return;
          }
          setSlash((st) => ({ ...st })); // re-render with new index
        } else {
          const items = wikiMatches;
          const max = items.length - 1;
          if (e.key === 'ArrowDown') wikiIndexRef.current = Math.min(max, wikiIndexRef.current + 1);
          else if (e.key === 'ArrowUp') wikiIndexRef.current = Math.max(0, wikiIndexRef.current - 1);
          else {
            insertWikiLink(items[wikiIndexRef.current]);
            return;
          }
          setWiki((st) => ({ ...st }));
        }
      }
    };
    window.addEventListener('keydown', keyHandler, true);
    return () => window.removeEventListener('keydown', keyHandler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, slash.query, wiki.query, pageTitles]);

  if (!editor) return null;
  editorSelf.current = editor;

  const closeOverlays = () => {
    editor.commands.focus();
    setSlash((st) => ({ ...st, open: false }));
    setWiki((st) => ({ ...st, open: false }));
  };

  const deleteTrigger = (len: number) => {
    const { from } = editor.state.selection;
    editor.chain().focus().deleteRange({ from: from - len, to: from }).run();
  };

  const insertWikiLink = (title: string) => {
    const w = wikiRef.current;
    const triggerLen = 2 + w.query.length;
    const { from } = editor.state.selection;
    editor
      .chain()
      .focus()
      .deleteRange({ from: from - triggerLen, to: from })
      .insertContentAt(from - triggerLen, [
        { type: 'text', text: title, marks: [{ type: 'wikiLink', attrs: { target: title } }] },
        { type: 'text', text: ' ' },
      ])
      .run();
    setWiki((st) => ({ ...st, open: false }));
  };

  const slashItems: MenuItem[] = useMemo(
    () => [
      { title: 'Heading 1', desc: 'Big section heading', icon: 'H1', action: () => editor.chain().focus().setNode('heading', { level: 1 }).run() },
      { title: 'Heading 2', desc: 'Medium heading', icon: 'H2', action: () => editor.chain().focus().setNode('heading', { level: 2 }).run() },
      { title: 'Heading 3', desc: 'Small heading', icon: 'H3', action: () => editor.chain().focus().setNode('heading', { level: 3 }).run() },
      { title: 'Bullet list', desc: 'Simple bulleted list', icon: '•', action: () => editor.chain().focus().toggleBulletList().run() },
      { title: 'Numbered list', desc: 'Ordered list', icon: '1.', action: () => editor.chain().focus().toggleOrderedList().run() },
      { title: 'Task list', desc: 'Track to-dos', icon: '', action: () => editor.chain().focus().toggleTaskList().run() },
      { title: 'Table', desc: '3×3 markdown table', icon: '', action: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
      { title: 'Code block', desc: 'Fenced code', icon: '{}', action: () => editor.chain().focus().setCodeBlock().run() },
      { title: 'Quote', desc: 'Capture a quote', icon: '', action: () => editor.chain().focus().toggleBlockquote().run() },
      { title: 'Divider', desc: 'Horizontal rule', icon: '—', action: () => editor.chain().focus().setHorizontalRule().run() },
      { title: 'Image', desc: 'Upload an image file', icon: '', action: async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async () => {
          const f = input.files?.[0];
          if (f) {
            const src = await uploadImage(f);
            if (src) editor.chain().focus().insertContent({ type: 'image', attrs: { src } }).run();
          }
        };
        input.click();
      } },
      { title: 'Block reference', desc: 'Embed a block by its ID', icon: '', action: () => {
        const blockId = prompt('Block ID to embed (get one via "Copy block id" in the toolbar):');
        if (blockId) editor.chain().focus().insertContent({ type: 'blockRef', attrs: { blockId } }).run();
      } },
      { title: 'Wiki link', desc: 'Link to a page', icon: '[[', action: () => {
        editor.chain().focus().insertContent('[[').run();
        setTimeout(evaluateTriggersRef.current, 60);
      } },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor]
  );

  const filteredSlash = slashItems.filter((i) => i.title.toLowerCase().includes(slash.query.toLowerCase()));

  const wikiMatches = useMemo(() => {
    const q = wiki.query.trim().toLowerCase();
    const titles = q ? pageTitles.filter((t) => t.toLowerCase().includes(q)) : pageTitles;
    return titles.slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wiki.query, pageTitles]);

  const Btn = ({ icon: Icon, action, title, active }: any) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={action}
      title={title}
      className={`p-1.5 rounded hover:bg-set-panel2 ${active ? 'text-blue-300' : 'text-set-dim hover:text-set-text'}`}
    >
      <Icon size={15} />
    </button>
  );

  const copyBlockId = async () => {
    // assign (or reuse) a permanent id on the current block and copy it
    const { from, to } = editor.state.selection;
    let nodePos = editor.state.doc.resolve(from);
    while (nodePos.depth > 0 && !['paragraph', 'heading'].includes(nodePos.parent.type.name)) {
      nodePos = editor.state.doc.resolve(nodePos.before());
    }
    const target = nodePos.parent;
    if (!['paragraph', 'heading'].includes(target.type.name)) {
      alert('Place the cursor inside a paragraph or heading first.');
      return;
    }
    let blockId = target.attrs.blockId;
    if (!blockId) {
      blockId = crypto.randomUUID();
      editor.chain().focus().updateAttributes(target.type.name, { blockId }).setTextSelection({ from, to }).run();
      onSave(docToMd(editor.getJSON() as any));
    }
    await navigator.clipboard.writeText(blockId);
    editor.chain().focus().setTextSelection({ from, to }).run();
    alert(`Block ID copied: ${blockId}\n\nEmbed it anywhere with ((${blockId})) or the /Block reference menu.`);
  };

  const linkSelection = () => {
    const href = prompt('Link URL:');
    if (href) editor.chain().focus().setLink({ href }).run();
  };

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-2 px-2 py-1 bg-set-bg/90 backdrop-blur border-b border-set-border/60 flex items-center gap-0.5 flex-wrap">
        <Btn icon={Bold} title="Bold" active={editor.isActive('bold')} action={() => editor.chain().focus().toggleBold().run()} />
        <Btn icon={Italic} title="Italic" active={editor.isActive('italic')} action={() => editor.chain().focus().toggleItalic().run()} />
        <Btn icon={UnderlineIcon} title="Underline" active={editor.isActive('underline')} action={() => editor.chain().focus().toggleUnderline().run()} />
        <Btn icon={Strikethrough} title="Strikethrough" active={editor.isActive('strike')} action={() => editor.chain().focus().toggleStrike().run()} />
        <Btn icon={Highlighter} title="Highlight" active={editor.isActive('highlight')} action={() => editor.chain().focus().toggleHighlight().run()} />
        <Btn icon={Code} title="Inline code" active={editor.isActive('code')} action={() => editor.chain().focus().toggleCode().run()} />
        <Btn icon={Link2} title="Link" active={editor.isActive('link')} action={linkSelection} />
        <span className="w-px h-4 bg-set-border mx-1" />
        <Btn icon={Heading1} title="Heading 1" active={editor.isActive('heading', { level: 1 })} action={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
        <Btn icon={Heading2} title="Heading 2" active={editor.isActive('heading', { level: 2 })} action={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
        <Btn icon={Heading3} title="Heading 3" active={editor.isActive('heading', { level: 3 })} action={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
        <span className="w-px h-4 bg-set-border mx-1" />
        <Btn icon={List} title="Bullet list" active={editor.isActive('bulletList')} action={() => editor.chain().focus().toggleBulletList().run()} />
        <Btn icon={ListOrdered} title="Numbered list" active={editor.isActive('orderedList')} action={() => editor.chain().focus().toggleOrderedList().run()} />
        <Btn icon={ListTodo} title="Task list" active={editor.isActive('taskList')} action={() => editor.chain().focus().toggleTaskList().run()} />
        <Btn icon={Quote} title="Quote" active={editor.isActive('blockquote')} action={() => editor.chain().focus().toggleBlockquote().run()} />
        <Btn icon={TableIcon} title="Insert table" action={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
        <Btn icon={ImagePlus} title="Insert image" action={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = async () => {
            const f = input.files?.[0];
            if (f) {
              const src = await uploadImage(f);
              if (src) editor.chain().focus().insertContent({ type: 'image', attrs: { src } }).run();
            }
          };
          input.click();
        }} />
        <Btn icon={YoutubeIcon} title="Embed YouTube video" active={editor.isActive('youtube')} action={() => {
          const url = prompt('YouTube video URL:');
          if (url) editor.chain().focus().setYoutubeVideo({ src: url }).run();
        }} />
        <Btn icon={Braces} title="Code block" active={editor.isActive('codeBlock')} action={() => editor.chain().focus().toggleCodeBlock().run()} />
        <Btn icon={Minus} title="Divider" action={() => editor.chain().focus().setHorizontalRule().run()} />
        <Btn icon={Copy} title="Copy block id (for block references)" action={copyBlockId} />
        <span className="ml-auto flex gap-0.5">
          <Btn icon={Undo2} title="Undo" action={() => editor.chain().focus().undo().run()} />
          <Btn icon={Redo2} title="Redo" action={() => editor.chain().focus().redo().run()} />
        </span>
      </div>
      <EditorContent editor={editor} className="prose-set max-w-none pt-2" />

      {/* table context controls */}
      {editor.isActive('table') && (
        <div className="sticky bottom-2 z-10 mx-auto w-fit set-card px-2 py-1 flex gap-1 text-xs bg-set-panel/95 fadein">
          {[
            ['Add row ', () => editor.chain().focus().addRowAfter().run()],
            ['Add col ', () => editor.chain().focus().addColumnAfter().run()],
            ['Del row', () => editor.chain().focus().deleteRow().run()],
            ['Del col', () => editor.chain().focus().deleteColumn().run()],
            ['Toggle header', () => editor.chain().focus().toggleHeaderRow().run()],
            ['Delete table', () => editor.chain().focus().deleteTable().run()],
          ].map(([label, action]: any) => (
            <button key={label} className="set-btn-ghost text-xs" onMouseDown={(e) => e.preventDefault()} onClick={action}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* slash menu */}
      {slash.open && filteredSlash.length > 0 && (
        <div
          className="fixed z-50 w-64 set-card p-1.5 max-h-72 overflow-auto fadein shadow-2xl"
          style={{ left: Math.min(slash.x, window.innerWidth - 270), top: Math.min(slash.y, window.innerHeight - 290) }}
        >
          <div className="text-[10px] uppercase text-set-dim px-2 py-1">Blocks</div>
          {filteredSlash.map((item, i) => (
            <button
              key={item.title}
              className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left ${i === slashIndexRef.current ? 'bg-set-accent/25' : 'hover:bg-set-panel2'}`}
              onMouseDown={(e) => {
                e.preventDefault();
                deleteTrigger(1 + slash.query.length);
                item.action();
                setSlash((st) => ({ ...st, open: false }));
              }}
            >
              <span className="w-7 h-7 rounded bg-set-panel2 flex items-center justify-center text-xs font-mono text-blue-200">{item.icon}</span>
              <span className="flex-1">
                <span className="block text-sm text-set-text">{item.title}</span>
                <span className="block text-[10px] text-set-dim">{item.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* wiki link autocomplete */}
      {wiki.open && (
        <div
          className="fixed z-50 w-64 set-card p-1.5 max-h-64 overflow-auto fadein shadow-2xl"
          style={{ left: Math.min(wiki.x, window.innerWidth - 270), top: Math.min(wiki.y, window.innerHeight - 260) }}
        >
          <div className="text-[10px] uppercase text-set-dim px-2 py-1">Link to page</div>
          {wikiMatches.map((t, i) => (
            <button
              key={t}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm ${i === wikiIndexRef.current ? 'bg-set-accent/25' : 'hover:bg-set-panel2'}`}
              onMouseDown={(e) => {
                e.preventDefault();
                insertWikiLink(t);
              }}
            >
              <span className="text-violet-300"></span> {t}
            </button>
          ))}
          {wiki.query.trim() && (
            <button
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm hover:bg-set-panel2 text-set-dim"
              onMouseDown={(e) => {
                e.preventDefault();
                insertWikiLink(wiki.query.trim());
              }}
            >
              <span className="text-violet-300"></span> Create “{wiki.query.trim()}”
            </button>
          )}
          {wikiMatches.length === 0 && !wiki.query.trim() && <div className="text-xs text-set-dim px-2 py-1">Type a page title…</div>}
        </div>
      )}
    </div>
  );
}
