import type { CopilotVoiceResult } from './codexVoiceClient';

/** Use the same agent/core as typed chat, including tools, context and approvals. */
export async function runVoiceCopilot(agent: any, text: string, signal: AbortSignal,
  ask: (agent: any, text: string) => Promise<void>): Promise<CopilotVoiceResult> {
  if (signal.aborted) return { success: false, text: 'Voice was cancelled. No new request was sent.' };
  if (!agent || agent.isRunning) return { success: false, text: 'Copilot is already working. Review the current run in chat before sending another request.' };
  const previous = new Set((agent.messages ?? []).map((m: any) => m.id));
  let failed = false;
  const subscription = agent.subscribe({ onRunErrorEvent: () => { failed = true; } });
  const abort = () => {
    failed = true;
    // Abort only the run we own. Do not stop an unrelated text run on unmount.
    if (agent.isRunning) {
      try { void Promise.resolve(agent.abortRun()).catch(() => {}); } catch { /* closed agent */ }
    }
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    await ask(agent, text);
    const answer = (agent.messages ?? []).filter((m: any) => m.role === 'assistant' && !previous.has(m.id) && typeof m.content === 'string')
      .map((m: any) => m.content.trim()).filter(Boolean).join('\n\n');
    if (signal.aborted || failed) return { success: false, text: 'This Copilot run stopped or failed. Review the chat and any completed actions before retrying.' };
    return answer ? { success: true, text: answer.slice(0, 12_000) }
      : { success: false, text: 'Copilot has not provided a completed text answer. Review the chat for tool results or an approval request.' };
  } catch {
    return { success: false, text: 'Copilot could not finish. Review the visible chat before retrying; completed actions were not rolled back.' };
  } finally { signal.removeEventListener('abort', abort); subscription.unsubscribe(); }
}
