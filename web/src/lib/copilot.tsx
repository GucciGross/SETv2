import { useEffect } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { CopilotKit } from '@copilotkit/react-core/v2';
import { useAgentContext } from '@copilotkit/react-core/v2';
import { getToken } from './api';
import { uuid } from './utils';
import { useApp } from '../stores/app';

/**
 * CopilotKit wiring for SET: provider (auth header + space routing) and the
 * screen-context hook. The backend runtime mounts at /api/copilotkit (see
 * server/src/copilotkit/); agents "set" and "set_guide" live there.
 */

export const COPILOTKIT_RUNTIME_URL = '/api/copilotkit';
export const SET_AGENT = 'set';
export const GUIDE_AGENT = 'set_guide';

export function SetCopilotProvider({ children }: { children: React.ReactNode }) {
  const currentSpaceId = useApp((s) => s.currentSpaceId);

  return (
    <CopilotKit
      runtimeUrl={COPILOTKIT_RUNTIME_URL}
      headers={() => {
        const token = getToken();
        const h: Record<string, string> = {};
        if (token) h.authorization = `Bearer ${token}`;
        return h;
      }}
      // forwardedProps on the AG-UI run: the server-side SetAgent reads these.
      properties={{ spaceId: currentSpaceId ?? undefined }}
      useSingleEndpoint={false}
      // The dev Inspector overlay auto-enables on localhost and its element
      // covers the whole page — it ate every tap (dead guide button on mobile).
      // Dev tooling only: never in production builds, and only on localhost.
      enableInspector={import.meta.env.DEV && window.location.hostname === 'localhost'}
    >
      {children}
    </CopilotKit>
  );
}

const VIEW_NAMES: [RegExp, string][] = [
  [/\/page\//, 'Page editor'],
  [/\/pages/, 'Pages list'],
  [/\/databases/, 'Databases list'],
  [/\/graph/, 'Graph view'],
  [/\/db\//, 'Database'],
  [/\/notebook\/[^/]+\/deck\//, 'Study deck'],
  [/\/notebook\//, 'Research notebook'],
  [/\/notebooks/, 'Notebooks list'],
  [/\/research\/[^/]+/, 'Research run'],
  [/\/research/, 'Deep research'],
  [/\/models/, '3D models library'],
  [/\/model\//, '3D model viewer'],
  [/\/paths/, 'Learning paths'],
  [/\/library/, 'Dataset library'],
  [/\/coding/, 'Coding surface'],
  [/\/terminal/, 'Terminal'],
  [/\/tasks/, 'My tasks'],
  [/\/activity/, 'Activity feed'],
  [/\/captures/, 'Capture history'],
  [/\/canvas/, 'Canvas'],
  [/\/settings/, 'Settings'],
  [/\/space\//, 'Dashboard'],
];

/** Register what the user is looking at so the agent can explain the screen. */
export function useSetScreenContext() {
  const location = useLocation();
  const params = useParams();
  const spaces = useApp((s) => s.spaces);
  const currentSpaceId = params.spaceId ?? useApp.getState().currentSpaceId;
  const space = spaces.find((s) => s.id === currentSpaceId);

  const view = VIEW_NAMES.find(([re]) => re.test(location.pathname))?.[1] ?? 'Workspace';
  const value = JSON.stringify({
    workspace: space?.name ?? currentSpaceId,
    view,
    route: location.pathname,
    pageId: params.pageId ?? null,
    notebookId: params.nbId ?? null,
    databaseId: params.dbId ?? null,
    modelId: params.modelId ?? null,
  });

  useAgentContext({
    description: 'The screen the user is currently viewing in SET',
    value,
  });
}

/** Fire-and-forget message into an agent's chat (external triggers). */
export async function askAgent(agent: any, text: string) {
  if (!agent) return;
  await agent.runAgent({
    messages: [...agent.messages, { id: uuid(), role: 'user', content: text }],
  });
}
