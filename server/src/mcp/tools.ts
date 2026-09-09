import { TOOLS as WORKSPACE_TOOLS } from './workspace-tools.js';
import type { ToolCtx } from './workspace-tools.js';
import { SKILL_LAB_TOOLS } from '../skills/lab-tools.js';
export type { ToolCtx } from './workspace-tools.js';

/** Preserve the existing catalog unchanged; new domains share the same transport. */
export const TOOLS = [...WORKSPACE_TOOLS, ...SKILL_LAB_TOOLS];
export function toolList() {
  return TOOLS.map(t => ({
    name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
    annotations: Object.assign({ title: t.title, readOnlyHint: t.scope === 'mcp:read' }, t.annotations ?? {}),
  }));
}
export async function callTool(name: string, args: any, ctx: ToolCtx) {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return { scope: tool.scope, result: await tool.run(args ?? {}, ctx) };
}
