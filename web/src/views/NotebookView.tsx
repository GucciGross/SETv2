import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { marked } from 'marked';
import { api, sse } from '../lib/api';
import { useAgentContext } from '@copilotkit/react-core/v2';
import {
  Upload, Link as LinkIcon, ClipboardPaste, RefreshCw, Trash2, Layers, MessageSquare,
  Network, Clock, BookOpen, GraduationCap, ChevronDown,
} from 'lucide-react';

const md = (s: string) => ({ __html: marked.parse(s ?? '', { async: false }) as string });

interface Citation {
  marker: number;
  chunkId: string;
  sourceName: string;
  pageLabel: string | null;
  heading: string;
  quote: string;
}
interface ChatMsg { role: 'user' | 'assistant'; text: string; citations?: Citation[] }

export default function NotebookView() {
  const { spaceId, nbId } = useParams();
  const navigate = useNavigate();
  const [notebook, setNotebook] = useState<any>(null);
  const [sources, setSources] = useState<any[]>([]);
  const [tab, setTab] = useState<'sources' | 'chunks' | 'chat' | 'views' | 'study'>('sources');
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [busy, setBusy] = useState(false);

  useAgentContext({
    description: 'The research notebook on screen',
    value: notebook ? JSON.stringify({ id: notebook.id, title: notebook.title, sources: sources.map((x: any) => x.title ?? x.name ?? x.id) }) : '(no notebook open)',
  });

  const load = useCallback(async () => {
    if (!nbId) return;
    const r = await api.get(`/notebooks/${nbId}`);
    setNotebook(r.notebook);
    setSources(r.sources);
    if (!selectedSource && r.sources[0]) setSelectedSource(r.sources[0].id);
  }, [nbId, selectedSource]);

  useEffect(() => {
    load();
    // poll ingestion status while anything is pending
    const t = setInterval(() => {
      if (sources.some((s) => ['pending', 'chunking', 'embedding'].includes(s.status))) load();
    }, 1500);
    return () => clearInterval(t);
  }, [load, sources]);

  if (!notebook) return <div className="p-8 text-set-dim">Loading notebook…</div>;

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length || !nbId) return;
    setBusy(true);
    try {
      await api.upload(`/notebooks/${nbId}/sources`, Array.from(files));
      load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const addUrl = async () => {
    if (!urlInput.trim() || !nbId) return;
    setBusy(true);
    try {
      await api.post(`/notebooks/${nbId}/sources`, { url: urlInput.trim() });
      setUrlInput('');
      load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const addText = async () => {
    if (!textInput.trim() || !nbId) return;
    setBusy(true);
    try {
      await api.post(`/notebooks/${nbId}/sources`, { text: textInput, kind: 'transcript' });
      setTextInput('');
      setShowPaste(false);
      load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const tabs = [
    { id: 'sources', label: 'Sources', icon: <BookOpen size={14} /> },
    { id: 'chunks', label: 'Chunks', icon: <Layers size={14} /> },
    { id: 'chat', label: 'Chat', icon: <MessageSquare size={14} /> },
    { id: 'views', label: 'Knowledge views', icon: <Network size={14} /> },
    { id: 'study', label: 'Study', icon: <GraduationCap size={14} /> },
  ] as const;

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 sm:p-4 border-b border-set-border">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span className="text-2xl"></span>
          <div className="flex-1">
            <input
              className="text-xl font-semibold bg-transparent outline-none text-white w-full"
              value={notebook.title}
              onChange={(e) => setNotebook({ ...notebook, title: e.target.value })}
              onBlur={() => api.patch(`/notebooks/${nbId}`, { title: notebook.title }).catch(() => {})}
            />
            <div className="text-xs text-set-dim">{sources.length} sources · citation-grade grounded research</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 mt-3">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm ${tab === t.id ? 'bg-set-accent/20 text-blue-200' : 'text-set-dim hover:text-set-text'}`}
              onClick={() => setTab(t.id)}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === 'sources' && (
          <div className="h-full overflow-y-auto p-5 max-w-3xl mx-auto w-full">
            <div className="set-card p-4 mb-4">
              <div className="text-sm font-medium text-white mb-3">Add sources</div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="set-btn cursor-pointer flex items-center gap-1.5">
                  <Upload size={14} /> Upload files
                  <input type="file" multiple hidden accept=".pdf,.md,.markdown,.txt" onChange={(e) => uploadFiles(e.target.files)} disabled={busy} />
                </label>
                <div className="flex items-center gap-1.5 flex-1 min-w-52">
                  <LinkIcon size={14} className="text-set-dim" />
                  <input className="set-input" placeholder="https://example.com/article" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} />
                  <button className="set-btn" onClick={addUrl} disabled={busy}>Fetch</button>
                </div>
                <button className="set-btn flex items-center gap-1.5" onClick={() => setShowPaste((s) => !s)}>
                  <ClipboardPaste size={14} /> Paste text
                </button>
              </div>
              {showPaste && (
                <div className="mt-3">
                  <textarea className="set-input h-32" placeholder="Paste notes or a transcript…" value={textInput} onChange={(e) => setTextInput(e.target.value)} />
                  <button className="set-btn-primary mt-2" onClick={addText} disabled={busy}>Add as source</button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              {sources.map((s) => (
                <div key={s.id} className="set-card p-3 flex items-center gap-3">
                  <span className="text-lg">{s.kind === 'pdf' ? '' : s.kind === 'web' ? '' : s.kind === 'md' ? '' : ''}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{s.name}</div>
                    <div className="text-xs text-set-dim">
                      {s.chunk_count} chunks · {s.status === 'ready' ? <span className="text-green-400">ready</span> : s.status === 'error' ? <span className="text-red-400" title={s.error}>error</span> : <span className="text-amber-300 animate-pulse">{s.status}…</span>}
                    </div>
                  </div>
                  {s.status === 'ready' && (
                    <button className="set-btn-ghost" title="Re-ingest" onClick={async () => {
                      await api.post(`/chunks/${(await api.get(`/sources/${s.id}/chunks`)).chunks[0]?.id}/reembed`).catch(() => {});
                      alert('First chunk re-embedded. Full re-ingest: delete and re-add the source.');
                    }}><RefreshCw size={13} /></button>
                  )}
                  <button className="set-btn-ghost hover:text-red-400" onClick={async () => {
                    if (!confirm(`Remove source "${s.name}"?`)) return;
                    await api.del(`/sources/${s.id}`);
                    load();
                  }}><Trash2 size={13} /></button>
                </div>
              ))}
              {sources.length === 0 && <p className="text-sm text-set-dim">Add PDFs, Markdown files, web pages or pasted text above. Chunks are indexed automatically (layout-aware headings + pages) and searchable immediately — even without an LLM provider.</p>}
            </div>
          </div>
        )}

        {tab === 'chunks' && <ChunkInspector notebookId={nbId!} sources={sources} selectedSource={selectedSource} setSelectedSource={setSelectedSource} />}
        {tab === 'chat' && <NotebookChat notebookId={nbId!} spaceId={spaceId!} />}
        {tab === 'views' && <KnowledgeViews notebookId={nbId!} spaceId={spaceId!} />}
        {tab === 'study' && <StudyGenerator notebookId={nbId!} spaceId={spaceId!} />}
      </div>
    </div>
  );
}

/** Visual chunk inspection + human-in-the-loop correction. */
function ChunkInspector({ notebookId, sources, selectedSource, setSelectedSource }: any) {
  const [chunks, setChunks] = useState<any[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  useEffect(() => {
    if (!selectedSource) return;
    api.get(`/sources/${selectedSource}/chunks`).then((r) => setChunks(r.chunks)).catch(() => setChunks([]));
  }, [selectedSource, notebookId]);

  return (
    <div className="h-full flex">
      <div className="w-56 border-r border-set-border overflow-y-auto p-2">
        {sources.map((s: any) => (
          <button
            key={s.id}
            className={`w-full text-left px-2 py-1.5 rounded-md text-sm truncate ${selectedSource === s.id ? 'bg-set-accent/15 text-blue-200' : 'hover:bg-set-panel2 text-set-text'}`}
            onClick={() => setSelectedSource(s.id)}
          >
            {s.kind === 'pdf' ? '' : s.kind === 'web' ? '' : ''} {s.name}
          </button>
        ))}
        {sources.length === 0 && <p className="text-xs text-set-dim p-2">No sources yet.</p>}
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        <div className="text-xs text-set-dim mb-2">Inspect and correct chunks — edits clear the stale embedding; re-embed after editing.</div>
        {chunks.map((c) => (
          <div key={c.id} className="set-card p-3">
            <div className="flex items-center gap-2 text-xs text-set-dim mb-1">
              <span className="set-chip border-set-border">#{c.idx}</span>
              {c.heading && <span className="font-medium text-set-text">{c.heading}</span>}
              {c.page_label && <span>{c.page_label}</span>}
              <button className="ml-auto set-btn-ghost" onClick={() => {
                if (editing === c.id) {
                  api.patch(`/chunks/${c.id}`, { content: editText }).then(() => {
                    setChunks((cs) => cs.map((x) => (x.id === c.id ? { ...x, content: editText } : x)));
                    setEditing(null);
                  });
                } else {
                  setEditing(c.id);
                  setEditText(c.content);
                }
              }}>{editing === c.id ? 'Save' : 'Edit'}</button>
              {editing !== c.id && (
                <button className="set-btn-ghost" title="Re-embed" onClick={() => api.post(`/chunks/${c.id}/reembed`)}></button>
              )}
            </div>
            {editing === c.id ? (
              <textarea className="set-input h-40 text-xs" value={editText} onChange={(e) => setEditText(e.target.value)} />
            ) : (
              <pre className="text-xs whitespace-pre-wrap text-set-text/90">{c.content}</pre>
            )}
          </div>
        ))}
        {chunks.length === 0 && <p className="text-sm text-set-dim">No chunks (source may still be indexing).</p>}
      </div>
    </div>
  );
}

/** Grounded chat with precise citations + source highlighting. */
function NotebookChat({ notebookId, spaceId }: { notebookId: string; spaceId: string }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [openCite, setOpenCite] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  const send = async () => {
    if (!input.trim() || streaming) return;
    const msg = input;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: msg }, { role: 'assistant', text: '' }]);
    setStreaming(true);
    try {
      await sse(
        `/spaces/${spaceId}/chat`,
        { sessionId, notebookId, message: msg },
        {
          meta: (d) => !sessionId && setSessionId(d.sessionId),
          text: (d) =>
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = { ...copy[copy.length - 1], text: copy[copy.length - 1].text + d.delta };
              return copy;
            }),
          error: (d) =>
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = { ...copy[copy.length - 1], text: ` ${d.message}` };
              return copy;
            }),
          done: (d) =>
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = { ...copy[copy.length - 1], citations: d.citations ?? [] };
              return copy;
            }),
        }
      );
    } catch (e: any) {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { ...copy[copy.length - 1], text: ` ${e.message}` };
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto p-5 max-w-3xl w-full mx-auto space-y-4">
        {messages.length === 0 && (
          <div className="text-sm text-set-dim">
            <p className="mb-2"> Ask anything about your sources. Answers are grounded with inline citations [1], [2] — click a citation to see the exact chunk.</p>
            <p className="text-xs">No LLM configured? Add one in Settings  AI Providers (Ollama works great locally).</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i}>
            {m.role === 'user' ? (
              <div className="flex justify-end">
                <div className="bg-set-accent/25 border border-set-accent/40 rounded-xl rounded-br-sm px-3 py-2 text-sm max-w-[85%]">{m.text}</div>
              </div>
            ) : (
              <>
                <div className="prose-set text-sm max-w-none" dangerouslySetInnerHTML={md(m.text || (streaming ? '' : ''))} />
                {m.citations && m.citations.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {m.citations.map((c) => (
                      <button
                        key={c.marker}
                        className="set-chip border-set-border bg-set-panel2 hover:border-set-accent/50 text-set-dim"
                        onClick={() => setOpenCite(openCite === `${i}-${c.marker}` ? null : `${i}-${c.marker}`)}
                      >
                        [{c.marker}] {c.sourceName}{c.pageLabel ? ` · ${c.pageLabel}` : ''}
                      </button>
                    ))}
                  </div>
                )}
                {m.citations?.map((c) =>
                  openCite === `${i}-${c.marker}` ? (
                    <div key={c.marker} className="set-card p-3 mt-2 fadein text-xs">
                      <div className="text-set-dim mb-1">{c.sourceName}{c.pageLabel ? ` · ${c.pageLabel}` : ''}{c.heading ? ` — ${c.heading}` : ''}</div>
                      <blockquote className="border-l-2 border-set-accent pl-2 text-set-text/90 whitespace-pre-wrap">{c.quote}</blockquote>
                    </div>
                  ) : null
                )}
              </>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form className="p-4 border-t border-set-border flex gap-2 max-w-3xl w-full mx-auto" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input
          className="set-input"
          placeholder="Ask about your sources…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={streaming}
        />
        <button className="set-btn-primary" disabled={streaming || !input.trim()}>{streaming ? '…' : 'Ask'}</button>
      </form>
    </div>
  );
}

/** Wiki / mind map / timeline / page index knowledge organization. */
function KnowledgeViews({ notebookId }: { notebookId: string; spaceId: string }) {
  const [views, setViews] = useState<any>(null);
  const [mode, setMode] = useState<'tree' | 'timeline' | 'index'>('tree');

  useEffect(() => {
    api.get(`/notebooks/${notebookId}/views`).then(setViews).catch(() => {});
  }, [notebookId]);

  if (!views) return <div className="p-8 text-set-dim">Compiling knowledge views…</div>;

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="flex gap-1 mb-4">
        {([['tree', ' Mind map / tree'], ['timeline', ' Timeline'], ['index', ' Page index']] as const).map(([id, label]) => (
          <button key={id} className={`px-3 py-1.5 rounded-lg text-sm ${mode === id ? 'bg-set-accent/20 text-blue-200' : 'text-set-dim hover:text-set-text'}`} onClick={() => setMode(id)}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'tree' && (
        <div className="max-w-3xl">
          {views.tree.map((src: any) => (
            <details key={src.id} className="set-card p-3 mb-2" open>
              <summary className="cursor-pointer text-sm font-medium text-white flex items-center gap-2">
                <ChevronDown size={14} className="text-set-dim" />
                {src.kind === 'pdf' ? '' : src.kind === 'web' ? '' : ''} {src.name}
                <span className="text-xs text-set-dim font-normal">{src.children.length} sections</span>
              </summary>
              <div className="ml-5 mt-1 border-l border-set-border pl-3">
                {src.children.map((sec: any, i: number) => (
                  <details key={i} className="my-1">
                    <summary className="cursor-pointer text-sm text-blue-200"> {sec.heading}</summary>
                    <ul className="ml-4 my-1 space-y-0.5">
                      {sec.items.map((it: any, j: number) => (
                        <li key={j} className="text-xs text-set-dim">• {it.text}</li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}

      {mode === 'timeline' && (
        <div className="max-w-2xl">
          {views.timeline.length === 0 && <p className="text-sm text-set-dim">No dates detected in sources.</p>}
          {views.timeline.map((t: any, i: number) => (
            <div key={i} className="flex gap-3 mb-3">
              <div className="w-24 shrink-0 text-right text-xs text-blue-200 pt-1">{t.date}</div>
              <div className="w-px bg-set-border" />
              <div className="set-card p-2.5 flex-1">
                <div className="text-xs text-set-dim mb-0.5">{t.sourceName}</div>
                <div className="text-sm">{t.context}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {mode === 'index' && (
        <div className="max-w-3xl space-y-3">
          {views.index.map((src: any) => (
            <div key={src.source.id} className="set-card p-3">
              <div className="text-sm font-medium text-white mb-1">{src.source.name}</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
                {src.entries.map((e: any, i: number) => (
                  <div key={i} className="text-xs text-set-dim py-0.5 border-b border-set-border/40">
                    <span className="text-blue-200">{e.heading}</span> {e.page ? <span className="text-[10px]">({e.page})</span> : ''} — {e.preview}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StudyGenerator({ notebookId, spaceId }: { notebookId: string; spaceId: string }) {
  const navigate = useNavigate();
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [decks, setDecks] = useState<any[]>([]);

  const load = useCallback(async () => {
    setDecks((await api.get(`/spaces/${spaceId}/decks?notebookId=${notebookId}`)).decks);
  }, [spaceId, notebookId]);
  useEffect(() => {
    load();
  }, [load]);

  const generate = async (kind: string) => {
    setBusy(kind);
    try {
      const { deck } = await api.post(`/notebooks/${notebookId}/generate`, { kind, topic: topic || undefined });
      navigate(`/app/space/${spaceId}/notebook/${notebookId}/deck/${deck.id}`);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };

  const kinds = [
    ['flashcards', ' Flashcards', 'Spaced-repetition cards'],
    ['quiz', ' Quiz', 'Multiple choice with explanations'],
    ['studyguide', ' Study guide', 'Structured markdown guide'],
    ['audio', ' Audio overview', 'Two-host script, playable'],
  ];

  return (
    <div className="p-5 max-w-2xl mx-auto">
      <div className="set-card p-4 mb-4">
        <div className="text-sm font-medium text-white mb-2">Generate study material from this notebook</div>
        <input className="set-input mb-3" placeholder="Optional topic focus (e.g. 'actuator torque limits')" value={topic} onChange={(e) => setTopic(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          {kinds.map(([kind, label, desc]) => (
            <button key={kind} className="set-card p-3 text-left hover:border-set-accent/50" onClick={() => generate(kind)} disabled={!!busy}>
              <div className="text-sm text-white">{label}</div>
              <div className="text-xs text-set-dim">{desc}</div>
              {busy === kind && <div className="text-xs text-amber-300 mt-1 animate-pulse">generating…</div>}
            </button>
          ))}
        </div>
      </div>
      <div className="text-[11px] uppercase text-set-dim font-semibold mb-2">Existing decks</div>
      {decks.map((d) => (
        <button key={d.id} className="set-card p-3 w-full text-left mb-2 hover:border-set-accent/40 flex items-center justify-between"
          onClick={() => navigate(`/app/space/${spaceId}/notebook/${notebookId}/deck/${d.id}`)}>
          <span className="text-sm text-white">{d.title}</span>
          <span className="text-xs text-set-dim">{d.kind} · {d.item_count} items</span>
        </button>
      ))}
      {decks.length === 0 && <p className="text-sm text-set-dim">Nothing generated yet.</p>}
    </div>
  );
}
