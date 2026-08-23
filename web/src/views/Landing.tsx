import { Link } from 'react-router-dom';
import {
  BookOpen, Network, Database, Boxes, Terminal, Code2, Route as RouteIcon, PenLine, LibraryBig,
  Sparkles, ShieldCheck, Server, ArrowRight, Github, FileText, Zap, Users, MessageSquare, Check, Cloud,
} from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';

/**
 * Public landing page — what SET is, how to self-host it in one command,
 * the docs, the GitHub repo, and the hosted LLM option (llm.wandgx.com).
 */

const GITHUB_URL = 'https://github.com/GucciGross/SETv2';

const PILLARS = [
  {
    icon: <FileText size={20} />,
    name: 'Structured workspace',
    desc: 'Rich block editor with tables, images, highlights, slash menu and [[autocomplete]]. Relational databases with table, board, calendar and gallery views. Team spaces with roles.',
  },
  {
    icon: <Network size={20} />,
    name: 'Connected knowledge graph',
    desc: '[[Wiki links]] with bidirectional backlinks, unlinked mentions, block references with permanent IDs, a live force-directed graph, and full Markdown import/export — your data, plain files.',
  },
  {
    icon: <BookOpen size={20} />,
    name: 'Grounded AI research',
    desc: 'Multi-source notebooks (PDF, web, transcripts, datasets) with inspectable chunks, grounded chat that cites [1] [2], knowledge views, and generated flashcards, quizzes, study guides and audio overviews.',
  },
  {
    icon: <Sparkles size={20} />,
    name: 'An agent that acts',
    desc: 'The copilot searches and writes your pages, queries your notebooks with citations, generates study material and renders rich UI — with human-in-the-loop approvals and a mascot you design.',
  },
];

const SURFACES = [
  { icon: <Code2 size={16} />, name: 'Coding', desc: 'Editor + sandboxed JS runner' },
  { icon: <Terminal size={16} />, name: 'Terminal', desc: 'Workspace console & grounded search' },
  { icon: <Boxes size={16} />, name: '3D & CAD', desc: 'GLB/STL/OBJ, URDF robots, STEP import' },
  { icon: <LibraryBig size={16} />, name: 'Library', desc: 'Import open datasets (HuggingFace)' },
  { icon: <RouteIcon size={16} />, name: 'Learning Paths', desc: 'Assign curricula with deadlines' },
  { icon: <PenLine size={16} />, name: 'Canvas', desc: 'Infinite-canvas spatial view' },
];

function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@') || state === 'busy') return;
    setState('busy');
    try {
      await api.post('/waitlist', { email });
      setState('done');
    } catch {
      setState('idle');
    }
  };
  if (state === 'done') {
    return (
      <div className="flex items-center gap-2 text-sm text-green-300">
        <Check size={16} /> You're on the list — we'll email you when your hosted workspace is ready.
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="flex w-full max-w-md gap-2">
      <input
        type="email"
        required
        className="set-input flex-1"
        placeholder="you@team.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button className="set-btn-primary shrink-0" disabled={state === 'busy'}>
        {state === 'busy' ? '…' : 'Join the waitlist'}
      </button>
    </form>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-set-bg text-set-text overflow-x-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      {/* Nav */}
      <header className="border-b border-set-border/60 bg-set-panel/40 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <span className="font-bold text-white text-lg tracking-tight">SET</span>
          <span className="text-[10px] uppercase tracking-widest text-set-dim border border-set-border rounded-full px-2 py-0.5 hidden sm:inline">
            Knowledge + Learning OS
          </span>
          <nav className="ml-auto flex items-center gap-1 sm:gap-2 text-sm">
            <a href="/docs" className="set-btn-ghost">Docs</a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="set-btn-ghost flex items-center gap-1.5">
              <Github size={14} /> <span className="hidden sm:inline">GitHub</span>
            </a>
            <Link to="/login" className="set-btn-primary">Open SET</Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative">
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(108,140,255,0.14),transparent)]" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-16 pb-14 sm:pt-24 sm:pb-20 text-center">
          <div className="set-chip border-set-accent/40 bg-set-accent/10 text-blue-200 mb-5">
            Open source · AGPL-3.0 · Self-host in one command
          </div>
          <h1 className="text-4xl sm:text-6xl font-bold text-white leading-[1.08] tracking-tight">
            The self-hosted<br />
            <span className="bg-gradient-to-r from-blue-300 via-violet-300 to-blue-300 bg-clip-text text-transparent">Knowledge + Learning OS</span>
          </h1>
          <p className="mt-5 text-set-dim text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
            SET is a Knowledge + Learning Operating System for individuals and teams: structured workspaces,
            a linked knowledge graph, source-grounded AI research with citations, and an agent copilot —
            running on your own stack, with your own LLM.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link to="/login" className="set-btn-primary px-6 py-2.5 text-base flex items-center gap-2">
              Launch the app <ArrowRight size={16} />
            </Link>
            <a href="/docs" className="set-btn px-6 py-2.5 text-base flex items-center gap-2">
              <BookOpen size={16} /> Read the docs
            </a>
          </div>

          {/* One-command install */}
          <div className="mt-10 max-w-xl mx-auto text-left">
            <div className="text-xs text-set-dim mb-2 flex items-center gap-1.5">
              <Server size={13} /> Self-host with Docker
            </div>
            <div className="set-card bg-set-panel/95 p-3.5 font-mono text-[13px] overflow-x-auto">
              <div className="text-set-dim">$ <span className="text-green-300">git clone</span> {GITHUB_URL.replace('https://', '')} set <span className="text-set-dim">&amp;&amp; cd set</span></div>
              <div className="text-set-dim">$ cp .env.example .env</div>
              <div className="text-set-dim">$ docker compose up -d</div>
              <div className="text-set-dim mt-1"># open http://localhost:8080</div>
            </div>
            <p className="text-[11px] text-set-dim mt-2">
              Postgres + Redis + API + UI, all in one compose file. Your data never leaves your machines.
            </p>
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="border-t border-set-border/60 bg-set-panel/20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
          <h2 className="text-2xl font-bold text-white mb-2">One coherent product, not three stitched together</h2>
          <p className="text-set-dim mb-8 max-w-2xl">Everything you already use — now owning your data.</p>
          <div className="grid sm:grid-cols-2 gap-4">
            {PILLARS.map((p) => (
              <div key={p.name} className="set-card p-5">
                <div className="text-blue-300 mb-2">{p.icon}</div>
                <h3 className="font-semibold text-white mb-1.5">{p.name}</h3>
                <p className="text-sm text-set-dim leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Surfaces */}
      <section className="border-t border-set-border/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
          <h2 className="text-2xl font-bold text-white mb-2">Power features are opt-in work surfaces</h2>
          <p className="text-set-dim mb-8 max-w-2xl">
            The core — pages, graph, databases, notebooks and copilot — is always on. Everything else is a toggle per workspace in Settings.
            Not a CAD person? You'll never see the 3D surface. Coding team? Terminal and editor are already there.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {SURFACES.map((s) => (
              <div key={s.name} className="set-card p-4 flex items-start gap-3">
                <span className="text-blue-300 mt-0.5">{s.icon}</span>
                <span>
                  <span className="block text-sm font-medium text-white">{s.name}</span>
                  <span className="block text-xs text-set-dim">{s.desc}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Teams */}
      <section className="border-t border-set-border/60 bg-set-panel/20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 grid md:grid-cols-2 gap-8 items-center">
          <div>
            <h2 className="text-2xl font-bold text-white mb-3">Built for teams that learn together</h2>
            <p className="text-set-dim mb-4 leading-relaxed">
              Two friends shipping their first game. A crew onboarding new hires. SET keeps the curriculum,
              the docs, the tasks and the Q&A in one place: assign learning paths with deadlines, comment on
              pages with @mentions, and let every member ask the grounded copilot about your own materials.
            </p>
            <ul className="space-y-2 text-sm text-set-dim">
              <li className="flex items-center gap-2"><Users size={14} className="text-blue-300 shrink-0" /> Spaces with owner / editor / viewer roles</li>
              <li className="flex items-center gap-2"><RouteIcon size={14} className="text-blue-300 shrink-0" /> Assignments with due dates and progress bars</li>
              <li className="flex items-center gap-2"><MessageSquare size={14} className="text-blue-300 shrink-0" /> Page comments with @mention notifications</li>
              <li className="flex items-center gap-2"><ShieldCheck size={14} className="text-blue-300 shrink-0" /> Agent write-actions gated behind approvals</li>
            </ul>
          </div>
          <div className="set-card p-5 bg-set-panel/90">
            <div className="text-xs uppercase tracking-widest text-set-dim mb-3">The new-hire playbook</div>
            <ol className="space-y-2.5 text-sm">
              <li className="flex gap-2.5"><span className="set-chip border-set-border bg-set-panel2 text-blue-200 shrink-0">1</span> Boss uploads company docs & SOPs as sources</li>
              <li className="flex gap-2.5"><span className="set-chip border-set-border bg-set-panel2 text-blue-200 shrink-0">2</span> Builds an onboarding path, assigns it with a deadline</li>
              <li className="flex gap-2.5"><span className="set-chip border-set-border bg-set-panel2 text-blue-200 shrink-0">3</span> Employee gets notified, reads, comments, asks the copilot</li>
              <li className="flex gap-2.5"><span className="set-chip border-set-border bg-set-panel2 text-blue-200 shrink-0">4</span> Boss watches progress hit 100%</li>
            </ol>
          </div>
        </div>
      </section>

      {/* Hosting: two ways to run SET */}
      <section className="border-t border-set-border/60 bg-set-panel/20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
          <h2 className="text-2xl font-bold text-white mb-2">Two ways to run SET</h2>
          <p className="text-set-dim mb-8 max-w-2xl">
            Self-hosting is free forever — that's the promise. But if you'd rather not run servers at all,
            the hosted SET cloud does it for you, cheaply, with the same data-ownership guarantees
            (full Markdown export anytime).
          </p>
          <div className="grid md:grid-cols-2 gap-4 mb-8">
            <div className="set-card p-6">
              <div className="flex items-center gap-2 mb-1">
                <Server size={16} className="text-blue-300" />
                <h3 className="font-semibold text-white">Self-hosted</h3>
                <span className="ml-auto text-xs text-green-300 border border-green-500/40 bg-green-500/10 rounded-full px-2 py-0.5">Free forever</span>
              </div>
              <p className="text-sm text-set-dim leading-relaxed mt-2">
                One Docker command. Your Postgres, your files, your network. AGPL-3.0 — no feature gates,
                no telemetry, no lock-in. Bring your own LLM key (or run models locally with Ollama).
              </p>
              <div className="mt-4 set-card bg-set-panel2/70 p-2.5 font-mono text-[11px] text-set-dim">$ docker compose up -d</div>
            </div>
            <div className="set-card p-6 border-set-accent/40">
              <div className="flex items-center gap-2 mb-1">
                <Cloud size={16} className="text-violet-300" />
                <h3 className="font-semibold text-white">SET Cloud (hosted)</h3>
                <span className="ml-auto text-xs text-violet-300 border border-violet-500/40 bg-violet-500/10 rounded-full px-2 py-0.5">Coming soon</span>
              </div>
              <p className="text-sm text-set-dim leading-relaxed mt-2">
                We host everything — no setup, automatic updates and backups, invite your whole team in
                minutes. Cheap flat pricing per workspace, and an optional bundled LLM API through
                {' '}<a href="https://llm.wandgx.com" target="_blank" rel="noreferrer" className="text-blue-300 hover:underline">llm.wandgx.com</a>{' '}
                so you can skip provider setup entirely. Same export-anytime guarantee.
              </p>
              <div className="mt-5">
                <div className="text-xs text-set-dim mb-2 flex items-center gap-1.5"><Zap size={12} /> Early-access waitlist</div>
                <WaitlistForm />
              </div>
            </div>
          </div>

          {/* Which one is for you */}
          <div className="set-card p-5 mb-6">
            <div className="text-sm font-semibold text-white mb-3">Which one is right for you?</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[540px]">
                <thead>
                  <tr className="text-left text-set-dim text-xs uppercase">
                    <th className="py-2 pr-4"></th>
                    <th className="py-2 pr-4">Self-hosted</th>
                    <th className="py-2">SET Cloud</th>
                  </tr>
                </thead>
                <tbody className="text-set-text/90">
                  {[
                    ['Setup', 'One Docker command on your machine or server', 'None — we run it for you'],
                    ['Cost', 'Free forever (AGPL-3.0)', 'Cheap flat monthly price per workspace'],
                    ['Where your data lives', 'Your Postgres, your disks, your network', 'Our managed servers, with full Markdown export anytime'],
                    ['Maintenance', 'You update, back up, and secure the stack', 'Automatic updates, backups, and TLS'],
                    ['Who can access', 'Only you — it can run fully offline', 'Your invited team members, over TLS'],
                    ['LLM', 'Bring any key: local models or any API', 'Bring your own key, or bundle one with llm.wandgx.com'],
                    ['Best for', 'Privacy-first users, homelabbers, companies with data policies', 'Teams that want to start in minutes with zero ops'],
                  ].map(([label, selfHost, cloud]) => (
                    <tr key={label} className="border-t border-set-border/50">
                      <td className="py-2 pr-4 text-set-dim whitespace-nowrap">{label}</td>
                      <td className="py-2 pr-4">{selfHost}</td>
                      <td className="py-2">{cloud}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-set-dim mt-3">
              Both run the same open-source core — the cloud is just our copy, operated for you. Start self-hosted and move to cloud (or back) anytime: export everything as Markdown, import it anywhere.
            </p>
          </div>
        </div>
      </section>

      {/* LLM */}
      <section className="border-t border-set-border/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
          <div className="set-card p-6 sm:p-8 bg-gradient-to-br from-set-panel to-[#161a2b]">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
              <div className="w-11 h-11 rounded-xl bg-set-accent/20 border border-set-accent/40 flex items-center justify-center text-blue-200 shrink-0">
                <Zap size={20} />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-white">Bring your own LLM — or use ours</h2>
                <p className="text-sm text-set-dim mt-1.5 leading-relaxed max-w-2xl">
                  SET works with any OpenAI-compatible endpoint: local Ollama or LM Studio, vLLM, OpenAI,
                  OpenRouter, Grok, Z.AI and more. Don't want to run models yourself?
                  {' '}<a href="https://llm.wandgx.com" target="_blank" rel="noreferrer" className="text-blue-300 hover:underline">llm.wandgx.com</a>{' '}
                  offers paid, ready-to-use LLM API access — sign up, grab a key, paste it into
                  Settings → AI Providers and you're running in seconds.
                </p>
              </div>
              <a href="https://llm.wandgx.com" target="_blank" rel="noreferrer" className="set-btn-primary shrink-0 flex items-center gap-2">
                Get an LLM API key <ArrowRight size={14} />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="border-t border-set-border/60 bg-set-panel/20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 text-center">
          <h2 className="text-2xl font-bold text-white mb-3">Own your knowledge stack</h2>
          <p className="text-set-dim mb-6">Free forever for self-hosting. AGPL-3.0. No lock-in — export everything as Markdown anytime.</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link to="/login" className="set-btn-primary px-6 py-2.5">Launch the app</Link>
            <a href="/docs" className="set-btn px-6 py-2.5">Full documentation</a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="set-btn px-6 py-2.5 flex items-center gap-2">
              <Github size={15} /> Star on GitHub
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-set-border/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 text-xs text-set-dim flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>SET — Strategic Enablement Toolkit · AGPL-3.0 · self-hosted, always</span>
          <span className="flex items-center gap-3">
            <a href="/docs" className="hover:text-set-text">Docs</a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hover:text-set-text">GitHub</a>
            <a href="https://llm.wandgx.com" target="_blank" rel="noreferrer" className="hover:text-set-text">Hosted LLM</a>
          </span>
        </div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-6 text-[10px] text-set-dim/70">
          Mascot concept inspired by the Apache-2.0 OpenMausBot project.
        </div>
      </footer>
    </div>
  );
}
