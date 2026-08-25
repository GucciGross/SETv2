import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { driver } from 'driver.js';
import { useFrontendTool } from '@copilotkit/react-core/v2';
import { startTour } from '../../lib/tour';
import { editorAvailable, getSelectionText, insertMarkdown } from '../../lib/editorBridge';
import { useApp } from '../../stores/app';

/** Route shapes the app actually serves — anything else 40s as a full-page
 * error, so the guide's navigate tool must only ever land on these. */
const KNOWN_ROUTES = [
  /^\/app\/?$/,
  /^\/app\/space\/[^/]+\/?$/,
  /^\/app\/space\/[^/]+\/(pages|databases|notebooks|graph|models|paths|library|coding|terminal|docs|tasks|activity|canvas|settings)$/,
  /^\/app\/space\/[^/]+\/(page|db|notebook|model)\/[^/]+$/,
  /^\/app\/space\/[^/]+\/notebook\/[^/]+\/deck\/[^/]+$/,
];

/** Resolve the guide's path to a real route: accepts the shorthand the model
 * tends to produce ("/app/notebooks" without the space segment) and rejects
 * anything unknown with a helpful hint instead of navigating to a 404. */
function resolveRoute(path: string, spaceId?: string | null): { to?: string; error?: string } {
  if (!path.startsWith('/app')) return { error: 'path must start with /app' };
  let to = path.replace(/\/+$/, '') || '/app';
  // shorthand without the space segment: /app/notebooks → /app/space/<id>/notebooks
  const short = to.match(/^\/app\/(pages|databases|notebooks|graph|models|paths|library|coding|terminal|docs|tasks|activity|canvas|settings)$/);
  if (short) {
    if (!spaceId) return { error: 'no current workspace to resolve the route against' };
    to = `/app/space/${spaceId}/${short[1]}`;
  }
  if (!KNOWN_ROUTES.some((re) => re.test(to))) {
    return { error: `unknown route "${path}" — valid destinations are /app/space/<id>/… (pages, notebooks, databases, graph, tasks, settings, …) or /app/space/<id>/page/<pageId>` };
  }
  return { to };
}

/**
 * Frontend tools for the on-screen guide agent (set_guide). These execute in
 * the browser — the guide can write into the note being edited, spotlight UI,
 * start the product tour and navigate, while server tools handle workspace
 * knowledge.
 */

export function GuideTools() {
  const navigate = useNavigate();
  const spaceId = useApp((s) => s.currentSpaceId);

  useFrontendTool(
    {
      agentId: 'set_guide',
      name: 'insert_into_editor',
      description:
        'Insert drafted markdown into the note the user is editing, at their cursor. Use this whenever you draft content the user asked for — do not paste long text into chat. Returns false when no note is open.',
      parameters: z.object({
        markdown: z.string().describe('Markdown to insert (headings, lists, tasks, code fences supported)'),
      }),
      handler: async ({ markdown }) => ({ inserted: insertMarkdown(markdown) }),
      followUp: true,
    },
    []
  );

  useFrontendTool(
    {
      agentId: 'set_guide',
      name: 'highlight_element',
      description:
        'Spotlight a UI element on screen (CSS selector or [data-tour] name like "copilot", "new-page", "knowledge-core") while you explain it. Use when teaching what something is or where to click.',
      parameters: z.object({
        selector: z.string().describe('CSS selector, e.g. [data-tour="copilot"] or button[title="Trash"]'),
        note: z.string().optional().describe('Short caption shown next to the highlight'),
      }),
      handler: async ({ selector, note }) => {
        let el: Element | null = null;
        try {
          el = document.querySelector(selector);
        } catch {
          return { highlighted: false, error: 'invalid selector' };
        }
        if (!el) return { highlighted: false, error: 'element not found' };
        const d = driver({
          showProgress: false,
          overlayClickBehavior: 'close',
          popoverClass: 'set-guide-popover',
        });
        d.highlight({ element: el, popover: note ? { title: note, description: '' } : undefined } as any);
        setTimeout(() => d.destroy(), 6000);
        return { highlighted: true };
      },
    },
    []
  );

  useFrontendTool(
    {
      agentId: 'set_guide',
      name: 'start_tour',
      description: 'Start the full SET product walkthrough (spotlight tour of the workspace).',
      parameters: z.object({}),
      handler: async () => {
        startTour();
        return { started: true };
      },
    },
    []
  );

  useFrontendTool(
    {
      agentId: 'set_guide',
      name: 'navigate',
      description:
        'Navigate the app to a route, e.g. "/app/graph" (graph), "/app/paths" (learning paths), "/app/settings" (settings). Ask before navigating away from an unsaved note.',
      parameters: z.object({
        path: z.string().describe('App route beginning with /app'),
      }),
      handler: async ({ path }) => {
        const { to, error } = resolveRoute(path, spaceId);
        if (!to) return { navigated: false, error };
        navigate(to);
        return { navigated: true };
      },
    },
    [navigate, spaceId]
  );

  useFrontendTool(
    {
      agentId: 'set_guide',
      name: 'read_selection',
      description: 'Read the text the user currently has selected (in the note or anywhere), or empty text.',
      parameters: z.object({}),
      handler: async () => ({ selection: getSelectionText() || (window.getSelection()?.toString() ?? '') }),
    },
    []
  );

  return null;
}
