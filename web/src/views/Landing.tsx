import { Link, useNavigate } from 'react-router-dom';
import {
  BookOpen, Network, Database, Boxes, Terminal, Code2, Route as RouteIcon, PenLine, LibraryBig,
  Sparkles, ShieldCheck, Server, ArrowRight, Github, FileText, Zap, Users, MessageSquare, Check, Cloud, Bot,
} from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import ShaderBackground from '../components/ShaderBackground';
import { DitherButton, DitherGradient, DitherAvatar } from '../components/dither-kit';

/**
 * Public landing page — what SET is, how to self-host it in one command,
 * the docs, the GitHub repo, and the hosted LLM option (llm.wandgx.com).
 */

const GITHUB_URL = 'https://github.com/GucciGross/SETv2';

const PILLARS = [
  {
    icon: <FileText size={18} />,
    name: 'Structured workspace',
    desc: 'Rich block editor with tables, images, highlights, slash menu and [[autocomplete]]. Relational databases with table, board, calendar and gallery views. Team spaces with roles.',
  },
  {
    icon: <Network size={18} />,
    name: 'Connected knowledge graph',
    desc: '[[Wiki links]] with bidirectional backlinks, unlinked mentions, block references with permanent IDs, a live force-directed graph, and full Markdown import/export — your data, plain files.',
  },
  {
    icon: <BookOpen size={18} />,
    name: 'Grounded AI research',
    desc: 'Multi-source notebooks (PDF, web, transcripts, datasets) with inspectable chunks, grounded chat that cites [1] [2], knowledge views, and generated flashcards, quizzes, study guides and audio overviews.',
  },
  {
    icon: <Sparkles size={18} />,
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

/* Section header — mono index, rule line, mono caption. The instrument voice. */
function SectionHead({ index, tag, title, sub }: { index: string; tag: string; title: string; sub?: string }) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-4">
        <span className="set-mono text-set-accent">{index}</span>
        <span className="h-px flex-1 bg-set-border/70" />
        <span className="set-mono set-mono-dim">{tag}</span>
      </div>
      <h2 className="text-2xl sm:text-3xl font-bold text-white max-w-2xl">{title}</h2>
      {sub && <p className="text-set-dim mt-2 max-w-2xl leading-relaxed">{sub}</p>}
    </div>
  );
}

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

/* The spec plate — the hero's right-hand instrument sheet. */
function SpecPlate() {
  const rows: Array<[string, string]> = [
    ['LICENSE', 'AGPL-3.0'],
    ['RUNTIME', 'Docker Compose'],
    ['STORAGE', 'Your Postgres'],
    ['AGENT I/O', 'MCP · 40 tools'],
    ['LLM', 'Bring your own'],
    ['TELEMETRY', 'Opt-out'],
  ];
  return (
    <div className="set-card set-corners relative overflow-hidden bg-set-panel/80 backdrop-blur-sm">
      <div className="tex-dither absolute inset-0 opacity-60" aria-hidden />
      <div className="relative">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-set-border/70">
          <span className="set-mono text-set-text">SPEC.SHEET</span>
          <span className="flex items-center gap-1.5 set-mono set-mono-dim">
            <span className="w-1.5 h-1.5 rounded-full bg-set-ok shadow-[0_0_6px_rgb(52_211_153/0.9)]" />
            LIVE
          </span>
        </div>
        {rows.map(([k, v], i) => (
          <div key={k} className={`flex items-center justify-between px-4 py-2 ${i > 0 ? 'border-t border-set-border/40' : ''}`}>
            <span className="set-mono set-mono-dim">{k}</span>
            <span className="set-mono-num text-sm text-set-text">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Terminal-chrome install block. */
function InstallBlock() {
  return (
    <div className="set-card overflow-hidden bg-[#0b0e15]/95">
      <div className="flex items-center gap-2 px-3.5 py-2 border-b border-set-border/70 bg-set-panel2/50">
        <span className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]/70" />
        </span>
        <span className="set-mono set-mono-dim ml-2">SELF-HOST.SH</span>
        <span className="set-mono set-mono-dim ml-auto hidden sm:inline">BASH · DOCKER</span>
      </div>
      <div className="p-4 font-mono text-[13px] leading-relaxed overflow-x-auto tex-grid">
        <div><span className="text-set-accent">$</span> <span className="text-green-300">git clone</span> <span className="text-set-text">github.com/GucciGross/SETv2 set</span> <span className="text-set-dim">&amp;&amp; cd set</span></div>
        <div><span className="text-set-accent">$</span> <span className="text-set-text">cp .env.example .env</span></div>
        <div><span className="text-set-accent">$</span> <span className="text-set-text">docker compose up -d</span></div>
        <div><span className="text-set-dim"># open</span> <span className="text-set-accent underline decoration-set-accent/40 underline-offset-4">http://localhost:8080</span> <span className="text-set-dim">— that's the whole install.</span></div>
      </div>
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-set-bg text-set-text overflow-x-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      {/* Nav */}
      <header className="border-b border-set-border/60 bg-set-bg/70 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <DitherAvatar name="SET" hue={222} size={18} bloom="low" className="rounded" />
            <span className="font-bold text-white tracking-tight">SET</span>
            <span className="set-mono set-mono-dim hidden md:inline border border-set-border rounded px-1.5 py-0.5">
              KNOWLEDGE + LEARNING OS
            </span>
          </Link>
          <nav className="ml-auto flex items-center gap-1 sm:gap-2 text-sm">
            <a href="/agents" className="set-btn-ghost flex items-center gap-1"><Bot size={14} /> Agents</a>
            <a href="/docs" className="set-btn-ghost">Docs</a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="set-btn-ghost flex items-center gap-1.5">
              <Github size={14} /> <span className="hidden sm:inline">GitHub</span>
            </a>
            <Link to="/login" className="set-btn-primary">Open SET</Link>
          </nav>
        </div>
      </header>

      {/* Hero — nebula field behind, instrument layout on top */}
      <section className="relative border-b border-set-border/40">
        <ShaderBackground />
        {/* dither dissolve: hero melts into the page instead of stopping dead */}
        <div className="absolute inset-x-0 bottom-0 h-40 tex-dither dither-mask-t opacity-70" aria-hidden
          style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgb(108 140 255 / 0.12) 1px, transparent 1.15px)' }} />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-16 pb-16 sm:pt-24 sm:pb-20">
          <div className="grid lg:grid-cols-[1fr_340px] gap-10 items-center">
            <div>
              <div className="set-mono text-set-accent mb-5 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-set-accent shadow-[0_0_8px_rgb(108_140_255/0.9)]" />
                OPEN SOURCE · SELF-HOSTED · ONE COMMAND
              </div>
              <h1 className="text-4xl sm:text-6xl font-bold text-white leading-[1.04] tracking-tight">
                The self-hosted<br />
                <span className="text-set-accent">Knowledge + Learning</span><br />
                OS.
              </h1>
              <p className="mt-6 text-set-dim text-base sm:text-lg max-w-xl leading-relaxed">
                Workspaces, a linked knowledge graph, source-grounded AI research with citations,
                and an agent copilot that acts — running on your own stack, with your own LLM.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <DitherButton
                  color="blue"
                  variant="gradient"
                  bloom="low"
                  className="px-6 py-2.5 text-base rounded-lg text-white"
                  onClick={() => navigate('/login')}
                >
                  <span className="flex items-center gap-2">Launch the app <ArrowRight size={16} /></span>
                </DitherButton>
                <a href="/docs" className="set-btn px-6 py-2.5 text-base flex items-center gap-2">
                  <BookOpen size={16} /> Read the docs
                </a>
                <a href="/agents" className="set-btn px-6 py-2.5 text-base flex items-center gap-2">
                  <Bot size={16} /> Agents &amp; MCP
                </a>
              </div>
            </div>
            <SpecPlate />
          </div>

          {/* One-command install */}
          <div className="mt-12 max-w-2xl">
            <div className="set-mono set-mono-dim mb-2 flex items-center gap-1.5">
              <Server size={13} /> SELF-HOST WITH DOCKER
            </div>
            <InstallBlock />
            <p className="text-[11px] text-set-dim mt-2">
              Postgres + Redis + API + UI, all in one compose file. Your data never leaves your machines.
            </p>
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="border-b border-set-border/40 bg-set-panel/20 tex-grid">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
          <SectionHead
            index="§01"
            tag="THE PRODUCT"
            title="One coherent product, not three stitched together"
            sub="Everything you already use — now owning your data."
          />
          <div className="grid sm:grid-cols-2 gap-4">
            {PILLARS.map((p, i) => (
              <div key={p.name} className="group relative set-card p-5 overflow-hidden hover:border-set-accent/40 transition-colors">
                <span className="set-mono set-mono-dim opacity-50 absolute top-4 right-4 group-hover:text-set-accent group-hover:opacity-100 transition-all">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="text-blue-300 mb-3">{p.icon}</div>
                <h3 className="font-semibold text-white mb-1.5">{p.name}</h3>
                <p className="text-sm text-set-dim leading-relaxed">{p.desc}</p>
                <span className="absolute bottom-0 left-0 h-px w-0 bg-set-accent group-hover:w-full transition-all duration-300" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Agent strip */}
      <section className="border-b border-set-border/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
          <a href="/agents" className="set-card relative overflow-hidden p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4 hover:border-set-accent/50 transition-colors group">
            <DitherGradient from="purple" direction="right" opacity={0.1} cell={3} />
            <div className="relative w-11 h-11 rounded-xl bg-set-accent2/15 border border-set-accent2/40 flex items-center justify-center text-violet-200 shrink-0">
              <Bot size={20} />
            </div>
            <div className="relative flex-1">
              <h3 className="text-lg font-bold text-white">Built for agents, not just humans</h3>
              <p className="text-sm text-set-dim mt-1">
                SET speaks the Model Context Protocol natively — 40 tools, grounded citations, OAuth 2.1 consent.
                Connect Claude, ChatGPT, Cursor or any MCP client in under a minute.
              </p>
            </div>
            <span className="relative set-btn-primary shrink-0 flex items-center gap-2">
              Connect an agent <ArrowRight size={14} />
            </span>
          </a>
        </div>
      </section>

      {/* Surfaces */}
      <section className="border-b border-set-border/40 bg-set-panel/20 tex-grid">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
          <SectionHead
            index="§02"
            tag="WORK SURFACES"
            title="Power features are opt-in work surfaces"
            sub="The core — pages, graph, databases, notebooks and copilot — is always on. Everything else is a toggle per workspace in Settings. Not a CAD person? You'll never see the 3D surface. Coding team? Terminal and editor are already there."
          />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {SURFACES.map((s) => (
              <div key={s.name} className="set-card p-4 flex items-start gap-3 hover:border-set-accent/40 transition-colors">
                <span className="text-blue-300 mt-0.5">{s.icon}</span>
                <span>
                  <span className="block text-sm font-medium text-white">{s.name}</span>
                  <span className="block text-xs text-set-dim mt-0.5">{s.desc}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Teams */}
      <section className="border-b border-set-border/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <SectionHead
              index="§03"
              tag="TEAMS"
              title="Built for teams that learn together"
            />
            <p className="text-set-dim mb-4 leading-relaxed -mt-2">
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
          <div className="set-card set-corners p-5 bg-set-panel/90">
            <div className="set-mono set-mono-dim mb-4">THE NEW-HIRE PLAYBOOK</div>
            <ol className="space-y-3 text-sm">
              {[
                'Boss uploads company docs & SOPs as sources',
                'Builds an onboarding path, assigns it with a deadline',
                'Employee gets notified, reads, comments, asks the copilot',
                'Boss watches progress hit 100%',
              ].map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="set-mono text-set-accent shrink-0 pt-0.5">{String(i + 1).padStart(2, '0')}</span>
                  <span className="text-set-text/90">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* Hosting: two ways to run SET */}
      <section className="border-b border-set-border/40 bg-set-panel/20 tex-grid">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
          <SectionHead
            index="§04"
            tag="HOSTING"
            title="Two ways to run SET"
            sub="Self-hosting is free forever — that's the promise. But if you'd rather not run servers at all, the hosted SET cloud does it for you, cheaply, with the same data-ownership guarantees (full Markdown export anytime)."
          />
          <div className="grid md:grid-cols-2 gap-4 mb-8">
            <div className="set-card p-6">
              <div className="flex items-center gap-2 mb-1">
                <Server size={16} className="text-blue-300" />
                <h3 className="font-semibold text-white">Self-hosted</h3>
                <span className="ml-auto set-mono text-green-300 border border-green-500/40 bg-green-500/10 rounded px-1.5 py-0.5">FREE FOREVER</span>
              </div>
              <p className="text-sm text-set-dim leading-relaxed mt-2">
                One Docker command. Your Postgres, your files, your network. AGPL-3.0 — no feature gates,
                no telemetry, no lock-in. Bring your own LLM key (or run models locally with Ollama).
              </p>
              <div className="mt-4 set-card bg-set-panel2/70 p-2.5 font-mono text-[11px] text-set-dim">$ docker compose up -d</div>
            </div>
            <div className="set-card p-6 border-set-accent/40 relative overflow-hidden">
              <DitherGradient from="blue" direction="up" opacity={0.08} cell={3} />
              <div className="relative">
                <div className="flex items-center gap-2 mb-1">
                  <Cloud size={16} className="text-violet-300" />
                  <h3 className="font-semibold text-white">SET Cloud (hosted)</h3>
                  <span className="ml-auto set-mono text-violet-300 border border-violet-500/40 bg-violet-500/10 rounded px-1.5 py-0.5">COMING SOON</span>
                </div>
                <p className="text-sm text-set-dim leading-relaxed mt-2">
                  We host everything — no setup, automatic updates and backups, invite your whole team in
                  minutes. Cheap flat pricing per workspace, and an optional bundled LLM API through
                  {' '}<a href="https://llm.wandgx.com" target="_blank" rel="noreferrer" className="text-blue-300 hover:underline">llm.wandgx.com</a>{' '}
                  so you can skip provider setup entirely. Same export-anytime guarantee.
                </p>
                <div className="mt-5">
                  <div className="set-mono set-mono-dim mb-2 flex items-center gap-1.5"><Zap size={12} /> EARLY-ACCESS WAITLIST</div>
                  <WaitlistForm />
                </div>
              </div>
            </div>
          </div>

          {/* Which one is for you */}
          <div className="set-card p-5 mb-6">
            <div className="text-sm font-semibold text-white mb-3">Which one is right for you?</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[540px]">
                <thead>
                  <tr className="text-left set-mono set-mono-dim">
                    <th className="py-2 pr-4 font-normal"></th>
                    <th className="py-2 pr-4 font-normal">SELF-HOSTED</th>
                    <th className="py-2 font-normal">SET CLOUD</th>
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
      <section className="border-b border-set-border/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
          <div className="set-card relative overflow-hidden p-6 sm:p-8">
            <DitherGradient from="purple" direction="right" opacity={0.09} cell={3} />
            <div className="relative flex flex-col sm:flex-row items-start sm:items-center gap-5">
              <div className="w-11 h-11 rounded-xl bg-set-accent2/15 border border-set-accent2/40 flex items-center justify-center text-violet-200 shrink-0">
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
      <section className="relative border-b border-set-border/40 bg-set-panel/20 tex-grid overflow-hidden">
        <DitherGradient from="blue" direction="up" opacity={0.07} cell={3} />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-16 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">Own your knowledge stack</h2>
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

      <footer className="tex-dither">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 text-xs text-set-dim flex flex-col sm:flex-row items-center justify-between gap-2">
          <span className="set-mono">SET · STRATEGIC ENABLEMENT TOOLKIT · AGPL-3.0 · SELF-HOSTED, ALWAYS</span>
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
