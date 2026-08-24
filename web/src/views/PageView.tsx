import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Link2, ArrowUpRight, Download, MailQuestion } from 'lucide-react';
import Editor from '../components/Editor';
import { useAgentContext } from '@copilotkit/react-core/v2';
import { registerEditor } from '../lib/editorBridge';
import { MessageSquare, Send } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../stores/app';

interface PageData {
  id: string;
  title: string;
  icon: string | null;
  markdown: string;
  updated_at: string;
  is_daily: boolean;
}

/** highlight @mentions inside comment bodies */
function renderBody(body: string) {
  const parts = body.split(/(@\[[^\]]+\]|@[A-Za-z][A-Za-z0-9_-]*)/g);
  return parts.map((part, i) =>
    part.startsWith('@') ? (
      <span key={i} className="text-blue-300 bg-set-accent/15 rounded px-1">{part}</span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function Comments({ pageId }: { pageId: string }) {
  const [comments, setComments] = useState<any[]>([]);
  const [body, setBody] = useState('');
  const [open, setOpen] = useState(false);
  const { user } = useApp();

  const load = () => api.get(`/pages/${pageId}/comments`).then((r) => setComments(r.comments)).catch(() => {});
  useEffect(() => {
    load();
  }, [pageId]);

  const submit = async () => {
    if (!body.trim()) return;
    await api.post(`/pages/${pageId}/comments`, { body });
    setBody('');
    load();
  };

  return (
    <div className="mt-8 border-t border-set-border pt-4">
      <button className="flex items-center gap-1.5 text-sm text-set-dim hover:text-set-text mb-3" onClick={() => setOpen((o) => !o)}>
        <MessageSquare size={14} /> Comments {comments.length > 0 && <span className="text-xs">({comments.length})</span>}
      </button>
      {open && (
        <>
          <div className="space-y-3 mb-3">
            {comments.map((c) => (
              <div key={c.id} className="flex gap-2.5">
                <div className="w-7 h-7 rounded-full bg-set-accent/30 flex items-center justify-center text-xs font-bold text-blue-100 shrink-0">
                  {c.author_name?.[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-set-dim">
                    {c.author_name} · {new Date(c.created_at).toLocaleString()}
                    {c.author_id === user?.id && (
                      <button
                        className="ml-2 hover:text-red-400"
                        onClick={async () => {
                          await api.del(`/comments/${c.id}`);
                          load();
                        }}
                      >
                        delete
                      </button>
                    )}
                  </div>
                  <div className="text-sm text-set-text whitespace-pre-wrap">{renderBody(c.body)}</div>
                </div>
              </div>
            ))}
            {comments.length === 0 && <p className="text-xs text-set-dim">No comments yet.</p>}
          </div>
          <div className="flex gap-2">
            <textarea
              className="set-input resize-none"
              rows={2}
              placeholder="Add a comment…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
              }}
            />
            <button className="set-btn-primary h-9 w-9 flex items-center justify-center shrink-0 self-end" onClick={submit} disabled={!body.trim()}>
              <Send size={14} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function PageView() {
  const { spaceId, pageId } = useParams();
  const navigate = useNavigate();
  const { pages, createPage, loadPages } = useApp();
  const [page, setPage] = useState<PageData | null>(null);
  const [title, setTitle] = useState('');
  const [tab, setTab] = useState<'backlinks' | 'mentions'>('backlinks');
  const [backlinks, setBacklinks] = useState<any[]>([]);
  const [outgoing, setOutgoing] = useState<any[]>([]);
  const [mentions, setMentions] = useState<any[]>([]);

  // give the guide/copilot agents the note being edited (outline for context)
  useAgentContext({
    description: 'The note currently open in the editor',
    value: page ? JSON.stringify({ title: page.title, markdown: page.markdown.slice(0, 3000) }) : '(no note open)',
  });

  const load = useCallback(async () => {
    if (!pageId) return;
    const { page } = await api.get(`/pages/${pageId}`);
    setPage(page);
    setTitle(page.title);
  }, [pageId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!pageId) return;
    api.get(`/pages/${pageId}/backlinks`).then((r) => {
      setBacklinks(r.backlinks);
      setOutgoing(r.outgoing);
    }).catch(() => {});
    api.get(`/pages/${pageId}/mentions`).then((r) => setMentions(r.mentions)).catch(() => {});
  }, [pageId, page?.markdown]);

  // live collab refresh
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.pageId === pageId) load();
    };
    window.addEventListener('set:remote-page-update', handler);
    return () => window.removeEventListener('set:remote-page-update', handler);
  }, [pageId, load]);

  if (!page) return <div className="p-8 text-set-dim">Loading page…</div>;

  const saveTitle = async () => {
    if (!title.trim() || title === page.title) return;
    await api.patch(`/pages/${page.id}`, { title: title.trim() });
    if (spaceId) loadPages(spaceId);
  };

  const saveMarkdown = async (md: string) => {
    setPage((p) => (p ? { ...p, markdown: md } : p));
    await api.patch(`/pages/${page.id}`, { markdown: md });
  };

  const openWikiLink = async (target: string) => {
    if (!spaceId || !target) return;
    const existing = pages.find((p) => p.title.toLowerCase() === target.trim().toLowerCase());
    if (existing) return navigate(`/app/space/${spaceId}/page/${existing.id}`);
    const created = await createPage({ spaceId, title: target.trim() });
    navigate(`/app/space/${spaceId}/page/${created.id}`);
  };

  const linkify = (pageId: string) => () => navigate(`/app/space/${spaceId}/page/${pageId}`);

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-8 py-6">
          <div className="flex items-start gap-3 group">
            <span className="text-4xl mt-1">{page.icon ?? ''}</span>
            <div className="flex-1">
              <input
                className="text-3xl font-bold bg-transparent outline-none w-full text-white placeholder:text-set-dim"
                value={title}
                placeholder="Untitled"
                onChange={(e) => setTitle(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
              <div className="text-xs text-set-dim mt-1 flex items-center gap-3">
                {page.is_daily && <span className="text-amber-300">daily note</span>}
                updated {new Date(page.updated_at).toLocaleString()}
                <button
                  className="set-btn-ghost inline-flex items-center gap-1"
                  onClick={async () => {
                    // JS download keeps iOS standalone in-app (direct links can kick to Safari)
                    const res = await api.raw(`/pages/${page.id}/export.md`);
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${page.title || 'page'}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download size={12} /> export .md
                </button>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <Editor markdown={page.markdown} onSave={saveMarkdown} onWikiClick={openWikiLink} onReady={registerEditor} />
          </div>
          <Comments pageId={page.id} />
        </div>
      </div>

      {/* Linked mentions side panel */}
      <div className="w-64 shrink-0 border-l border-set-border bg-set-panel/60 overflow-y-auto hidden xl:block">
        <div className="flex border-b border-set-border text-sm">
          {(['backlinks', 'mentions'] as const).map((t) => (
            <button
              key={t}
              className={`flex-1 py-2.5 px-2 capitalize ${tab === t ? 'text-white border-b-2 border-set-accent' : 'text-set-dim hover:text-set-text'}`}
              onClick={() => setTab(t)}
            >
              {t === 'backlinks' ? <span className="flex items-center justify-center gap-1"><Link2 size={12} /> {backlinks.length}</span> : <span className="flex items-center justify-center gap-1"><MailQuestion size={12} /> {mentions.length}</span>}
            </button>
          ))}
        </div>
        <div className="p-2 space-y-1">
          {tab === 'backlinks' ? (
            <>
              {backlinks.map((b) => (
                <button key={b.id} onClick={linkify(b.id)} className="w-full text-left px-2 py-1.5 rounded hover:bg-set-panel2 text-sm flex items-center gap-1.5">
                  <span>{b.icon ?? ''}</span>
                  <span className="truncate flex-1">{b.title}</span>
                  <ArrowUpRight size={12} className="text-set-dim" />
                </button>
              ))}
              {backlinks.length === 0 && <p className="text-xs text-set-dim p-2">No backlinks yet. Add [[links]] in other pages.</p>}
              {outgoing.length > 0 && (
                <>
                  <div className="text-[10px] uppercase text-set-dim px-2 pt-3 pb-1">Outgoing</div>
                  {outgoing.map((b) => (
                    <button key={b.id} onClick={linkify(b.id)} className="w-full text-left px-2 py-1.5 rounded hover:bg-set-panel2 text-sm flex items-center gap-1.5 opacity-70">
                      <span>{b.icon ?? ''}</span>
                      <span className="truncate flex-1">{b.title}</span>
                    </button>
                  ))}
                </>
              )}
            </>
          ) : (
            <>
              {mentions.map((m) => (
                <button key={m.id} onClick={linkify(m.id)} className="w-full text-left px-2 py-1.5 rounded hover:bg-set-panel2 text-sm flex items-center gap-1.5">
                  <span>{m.icon ?? ''}</span>
                  <span className="truncate flex-1">{m.title}</span>
                  <span className="text-[10px] text-set-dim">unlinked</span>
                </button>
              ))}
              {mentions.length === 0 && <p className="text-xs text-set-dim p-2">No unlinked mentions found.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
