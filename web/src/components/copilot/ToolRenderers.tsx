import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ArrowRight, BookOpen, FileText, Search, Sparkles, Wrench } from 'lucide-react';
import { useRenderTool, useDefaultRenderTool, useAgent } from '@copilotkit/react-core/v2';
import { A2UIRenderer, type A2UIComponent } from '../A2UI';
import { askAgent, GUIDE_AGENT } from '../../lib/copilot';
import { useApp } from '../../stores/app';

/**
 * CopilotKit tool-call rendering for the SET agent: rich A2UI cards inline in
 * chat instead of raw JSON tool output. The default renderer keeps other tools
 * as a compact status line.
 */

function parseResult(result: string | undefined): any {
  if (result === undefined || result === null) return undefined;
  if (typeof result !== 'string') return result;
  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
}

function RunState({ result, children }: { result?: any; children: React.ReactNode }) {
  const busy = result === undefined || result === null;
  return (
    <div className={`fadein my-1.5 border rounded-lg overflow-hidden ${busy ? 'border-set-border bg-set-panel2/60' : 'border-set-border bg-set-panel2'}`}>
      {children}
      {busy && (
        <div className="px-2.5 py-1.5 text-[10px] text-set-dim flex items-center gap-1.5 border-t border-set-border/60">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-300 animate-pulse" />
          working…
        </div>
      )}
    </div>
  );
}

export function SetToolRenderers() {
  const navigate = useNavigate();
  const spaceId = useApp((s) => s.currentSpaceId);
  const { agent } = useAgent({ agentId: GUIDE_AGENT });

  // render_ui → the agent explicitly asked for an A2UI component
  useRenderTool({
    name: 'render_ui',
    parameters: z.object({ component: z.string(), props: z.record(z.string(), z.any()) }),
    render: ({ parameters, result }) => (
      <RunState result={result}>
        <A2UIRenderer
          component={{ type: parameters.component, props: parameters.props } as A2UIComponent}
          onFormSubmit={(values) => askAgent(agent, `Form submitted: ${JSON.stringify(values)}`)}
        />
      </RunState>
    ),
  });

  // create_page → success card with an open action
  useRenderTool({
    name: 'create_page',
    parameters: z.object({ title: z.string(), markdown: z.string().optional(), parentId: z.string().optional() }),
    render: ({ parameters, result }) => {
      const res = parseResult(result);
      return (
      <RunState result={result}>
        <div className="p-2.5 flex items-center gap-2 text-sm">
          <FileText size={14} className="text-green-400 shrink-0" />
          <span className="truncate flex-1">
            Created <span className="font-medium">{parameters?.title}</span>
          </span>
          {res?.pageId && (
            <button
              className="set-btn-ghost text-xs flex items-center gap-1 shrink-0"
              onClick={() => spaceId && navigate(`/app/space/${spaceId}/page/${res.pageId}`)}
            >
              open <ArrowRight size={11} />
            </button>
          )}
        </div>
      </RunState>
      );
    },
  });

  // create_notebook → success card with an open action
  useRenderTool({
    name: 'create_notebook',
    parameters: z.object({ title: z.string(), description: z.string().optional() }),
    render: ({ parameters, result }) => {
      const res = parseResult(result);
      return (
        <RunState result={result}>
          <div className="p-2.5 flex items-center gap-2 text-sm">
            <BookOpen size={14} className="text-green-400 shrink-0" />
            <span className="truncate flex-1">
              Created notebook <span className="font-medium">{parameters?.title}</span>
            </span>
            {res?.notebookId && (
              <button
                className="set-btn-ghost text-xs flex items-center gap-1 shrink-0"
                onClick={() => spaceId && navigate(`/app/space/${spaceId}/notebook/${res.notebookId}`)}
              >
                open <ArrowRight size={11} />
              </button>
            )}
          </div>
        </RunState>
      );
    },
  });

  // search_workspace → results list
  useRenderTool({
    name: 'search_workspace',
    parameters: z.object({ query: z.string() }),
    render: ({ parameters, result }) => {
      const res = parseResult(result);
      return (
      <RunState result={result}>
        <div className="px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-set-dim mb-1.5">
            <Search size={11} /> results for <span className="font-mono">{parameters?.query}</span>
          </div>
          <div className="space-y-0.5">
            {(res?.pages ?? []).slice(0, 8).map((p: any) => (
              <button
                key={p.id}
                className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-set-panel text-left text-sm"
                onClick={() => spaceId && navigate(`/app/space/${spaceId}/page/${p.id}`)}
              >
                <FileText size={12} className="shrink-0" /> <span className="truncate">{p.title}</span>
              </button>
            ))}
            {!res?.pages?.length && <div className="text-xs text-set-dim px-1.5">no pages matched</div>}
          </div>
        </div>
      </RunState>
      );
    },
  });

  // search_knowledge → grounded excerpt list
  useRenderTool({
    name: 'search_knowledge',
    parameters: z.object({ query: z.string(), notebookId: z.string().optional() }),
    render: ({ parameters, result }) => {
      const res = parseResult(result);
      return (
      <RunState result={result}>
        <div className="px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-set-dim mb-1.5">
            <BookOpen size={11} /> knowledge · <span className="font-mono">{parameters?.query}</span>
          </div>
          <div className="space-y-1.5">
            {(res?.results ?? res?.hits ?? []).slice(0, 4).map((h: any, i: number) => (
              <div key={i} className="text-xs text-set-dim border-l-2 border-set-accent/40 pl-2">
                <span className="text-set-text/80">{(h.text ?? h.excerpt ?? '').slice(0, 220)}</span>
                {h.source_title && <span className="block text-[10px] mt-0.5">— {h.source_title}</span>}
              </div>
            ))}
          </div>
        </div>
      </RunState>
      );
    },
  });

  // generate_study_material → deck card
  useRenderTool({
    name: 'generate_study_material',
    parameters: z.object({ topic: z.string().optional(), kind: z.string().optional(), source: z.string().optional() }),
    render: ({ parameters, result }) => {
      const res = parseResult(result);
      return (
      <RunState result={result}>
        <div className="p-2.5 flex items-center gap-2 text-sm">
          <Sparkles size={14} className="text-amber-300 shrink-0" />
          <span className="flex-1 truncate">
            Study {parameters?.kind} ready{res?.deckId ? '' : '…'}
          </span>
          {res?.deckId && res?.notebookId && (
            <button
              className="set-btn-ghost text-xs flex items-center gap-1 shrink-0"
              onClick={() => spaceId && navigate(`/app/space/${spaceId}/notebook/${res.notebookId}/deck/${res.deckId}`)}
            >
              study <ArrowRight size={11} />
            </button>
          )}
        </div>
      </RunState>
      );
    },
  });

  // everything else → transparent activity line: what the agent ran, with
  // what inputs, and what came back (details expandable)
  useDefaultRenderTool({
    render: ({ name, parameters, result, status }) => {
      const args = summarizeArgs(parameters);
      const res = parseResult(result);
      return (
        <ToolActivity name={name} args={args} result={res} busy={status !== 'complete' && result === undefined} />
      );
    },
  });

  return null;
}

/** One-line "title — value" summary of tool arguments, e.g. `ref: Green Bay`. */
function summarizeArgs(parameters: unknown): string {
  if (!parameters || typeof parameters !== 'object') return '';
  const entries = Object.entries(parameters as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
    .filter(([k, v]) => String(v).length > 0 && k !== 'notebookId' && k !== 'parentId' && k !== 'pageId')
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${String(v).length > 60 ? String(v).slice(0, 57) + '…' : String(v)}`);
  return entries.join(' · ');
}

/**
 * Generic tool activity card — keeps the agent transparent: shows the tool
 * name, its inputs, and (expandable) the raw result so users can see HOW
 * something was done, not just that it happened.
 */
function ToolActivity({ name, args, result, busy }: { name: string; args: string; result: any; busy: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`fadein my-1 border rounded-md text-[11px] ${busy ? 'border-set-border bg-set-panel2/60' : 'border-set-border/60 bg-set-panel2/40'}`}>
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <Wrench size={10} className="text-set-dim shrink-0" />
        <span className="font-mono text-set-text/90">{name}</span>
        {args && <span className="text-set-dim truncate flex-1">{args}</span>}
        {busy ? (
          <span className="text-violet-200 shrink-0 ml-auto flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-300 animate-pulse" /> running…
          </span>
        ) : (
          <button
            className="text-set-dim hover:text-set-text ml-auto shrink-0 underline underline-offset-2"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'hide result' : 'result'}
          </button>
        )}
      </div>
      {open && result !== undefined && (
        <pre className="max-h-40 overflow-auto border-t border-set-border/60 px-2 py-1.5 text-[10px] text-set-dim whitespace-pre-wrap break-all">
          {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
