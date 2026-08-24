import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Github, Terminal, Plug, ShieldCheck, Wrench, Zap, Server } from 'lucide-react';
import { mcpEndpoint } from '../lib/mcpUrl';

const TOOLS = [
  { group: 'Read', items: ['search_workspace', 'list_pages', 'read_page', 'read_page_backlinks', 'list_databases', 'query_database', 'list_notebooks', 'list_sources', 'search_knowledge', 'list_study_decks', 'get_deck', 'list_my_tasks', 'list_activity', 'list_notifications', 'list_models_3d'] },
  { group: 'Write', items: ['create_page', 'append_to_page', 'update_page_properties', 'create_comment', 'create_database_row', 'update_database_row', 'create_notebook', 'add_notebook_source', 'generate_study_material', 'import_from_dataset', 'create_page_template'] },
];

/** Landing page for agentic visitors: connect any MCP client to a SET workspace in under a minute. */
export default function AgentsLanding() {
  const mcpUrl = mcpEndpoint();

  return (
    <div className="min-h-screen bg-set-bg text-set-text overflow-x-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <header className="border-b border-set-border/60 bg-set-panel/40 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <a href="/" className="font-bold text-white text-lg tracking-tight">SET</a>
          <span className="text-[10px] uppercase tracking-widest text-set-dim border border-set-border rounded-full px-2 py-0.5">MCP</span>
          <nav className="ml-auto flex items-center gap-1 sm:gap-2 text-sm">
            <a href="/docs" className="set-btn-ghost">Docs</a>
            <a href="https://github.com/GucciGross/SETv2" target="_blank" rel="noreferrer" className="set-btn-ghost flex items-center gap-1.5">
              <Github size={14} /> <span className="hidden sm:inline">GitHub</span>
            </a>
            <Link to="/login" className="set-btn-primary">Open SET</Link>
          </nav>
        </div>
      </header>

      <section className="relative">
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(108,140,255,0.14),transparent)]" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-14 pb-12 text-center">
          <div className="set-chip border-set-accent/40 bg-set-accent/10 text-blue-200 mb-5">
            <Plug size={11} /> Model Context Protocol · OAuth 2.1 · 26 tools
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white leading-[1.1] tracking-tight">
            Give your agents a workspace
          </h1>
          <p className="mt-4 text-set-dim text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
            Connect Claude, ChatGPT, Cursor, Claude Code or any MCP client to a SET workspace.
            Agents search your pages, run grounded research over your notebooks with citations,
            manage tasks and databases, and write results back — with your approval.
          </p>

          <div className="mt-8 max-w-xl mx-auto text-left">
            <div className="text-xs text-set-dim mb-2 flex items-center gap-1.5"><Server size={13} /> Your MCP endpoint</div>
            <div className="set-card bg-set-panel/95 p-3.5 font-mono text-[13px] overflow-x-auto flex items-center justify-between gap-3">
              <span className="truncate">{mcpUrl}</span>
              <button
                className="set-btn text-xs shrink-0"
                onClick={() => navigator.clipboard.writeText(mcpUrl)}
              >
                Copy
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-set-border/60 bg-set-panel/20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
          <h2 className="text-2xl font-bold text-white mb-2">Connect a client</h2>
          <p className="text-set-dim mb-6 text-sm">
            The first connection opens a consent screen — pick the workspace and access level, approve, and you are in.
            Authentication is OAuth 2.1 with PKCE; dynamic client registration is supported.
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="set-card p-4">
              <div className="text-sm font-semibold text-white mb-2">Claude Desktop / Claude.ai</div>
              <ol className="text-xs text-set-dim space-y-1.5 list-decimal pl-4">
                <li>Settings → Connectors → Add custom connector</li>
                <li>Paste the MCP URL above</li>
                <li>Sign in with your SET account and approve</li>
              </ol>
            </div>
            <div className="set-card p-4">
              <div className="text-sm font-semibold text-white mb-2">Cursor</div>
              <ol className="text-xs text-set-dim space-y-1.5 list-decimal pl-4">
                <li>Settings → MCP → Add server</li>
                <li>Type: Streamable HTTP, URL above</li>
                <li>Complete the OAuth consent in the browser</li>
              </ol>
            </div>
            <div className="set-card p-4">
              <div className="text-sm font-semibold text-white mb-2">Any OpenAI-compatible agent</div>
              <ol className="text-xs text-set-dim space-y-1.5 list-decimal pl-4">
                <li>Point your MCP client at the URL</li>
                <li>Use OAuth (discovery is published)</li>
                <li>Grant read or read+write scope</li>
              </ol>
            </div>
          </div>
          <div className="mt-4 set-card bg-set-panel2/60 p-3.5 font-mono text-xs overflow-x-auto text-set-dim">
            {`# Claude Code\nclaude mcp add --transport http set "${mcpUrl}"\n\n# Generic client config\n{ "mcpServers": { "set": { "type": "http", "url": "${mcpUrl}" } } }`}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href="/docs?section=mcp" className="set-btn text-xs flex items-center gap-1.5">
              <BookOpen size={13} /> Full tool documentation — all 26 tools with parameters and examples
            </a>
            <a href="/api/mcp/docs.json" target="_blank" rel="noreferrer" className="set-btn-ghost text-xs flex items-center gap-1.5">
              Machine-readable manifest
            </a>
          </div>
        </div>
      </section>

      <section className="border-t border-set-border/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
          <h2 className="text-2xl font-bold text-white mb-2">Full workspace, native tools</h2>
          <p className="text-set-dim mb-6 text-sm">
            Feature parity with the SET API: 15 read tools and 11 write tools, plus resources and prompts.
            Every write respects your role and workspace surface toggles.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            {TOOLS.map((g) => (
              <div key={g.group} className="set-card p-4">
                <div className="text-xs uppercase tracking-widest text-set-dim mb-3 flex items-center gap-1.5">
                  {g.group === 'Read' ? <BookOpen size={12} /> : <Wrench size={12} />} {g.group} tools ({g.items.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {g.items.map((t) => (
                    <span key={t} className="text-[11px] font-mono border border-set-border bg-set-panel2 rounded px-1.5 py-0.5 text-set-text/80">{t}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-set-border/60 bg-set-panel/20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 grid sm:grid-cols-3 gap-4">
          {[
            { icon: <ShieldCheck size={16} />, title: 'User-consented access', desc: 'OAuth 2.1 + PKCE, per-workspace grants, read or read-write scopes, revoke anytime from Settings.' },
            { icon: <Zap size={16} />, title: 'Citations built in', desc: 'search_knowledge returns grounded excerpts with source names and page labels — agents cite your documents correctly.' },
            { icon: <Terminal size={16} />, title: 'Operable', desc: 'Owners see every client, token, call, latency and error in Settings → MCP, with one-click revocation.' },
          ].map((f) => (
            <div key={f.title} className="set-card p-4">
              <div className="text-blue-300 mb-2">{f.icon}</div>
              <div className="font-semibold text-white text-sm mb-1">{f.title}</div>
              <div className="text-xs text-set-dim leading-relaxed">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-set-border/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 text-center">
          <h2 className="text-2xl font-bold text-white mb-3">Self-hosted or cloud — same MCP</h2>
          <p className="text-set-dim mb-6">Run SET yourself and point agents at your own URL, or use the hosted cloud when it opens.</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link to="/login" className="set-btn-primary px-6 py-2.5 flex items-center gap-2">Launch SET <ArrowRight size={14} /></Link>
            <a href="/docs?section=mcp" className="set-btn px-6 py-2.5">Full tool documentation</a>
          </div>
        </div>
      </section>

      <footer className="border-t border-set-border/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 text-xs text-set-dim flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>SET — Strategic Enablement Toolkit · AGPL-3.0</span>
          <span className="flex items-center gap-3">
            <a href="/docs" className="hover:text-set-text">Docs</a>
            <a href="https://github.com/GucciGross/SETv2" target="_blank" rel="noreferrer" className="hover:text-set-text">GitHub</a>
            <a href="https://llm.wandgx.com" target="_blank" rel="noreferrer" className="hover:text-set-text">Hosted LLM</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
