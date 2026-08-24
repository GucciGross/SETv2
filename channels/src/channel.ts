import { createServer } from 'node:http';
import { createChannel } from '@copilotkit/channels';
import { CopilotKitIntelligence, CopilotRuntime } from '@copilotkit/runtime/v2';
import { createCopilotNodeListener } from '@copilotkit/runtime/v2/node';
import { channelsConfig } from './config.js';
import { SetChannelAgent } from './agent.js';
import { heartbeat } from './setApi.js';

/**
 * SET Slack channel listener (CopilotKit Channels SDK).
 *
 * Slack mention/DM → Intelligence gateway → this long-running process →
 * SetChannelAgent → SET server agent engine (tools: pages, notebooks, decks)
 * → reply delivered back to Slack. The process heartbeats to the SET server so
 * Settings → Channels can show online status.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const channel = createChannel({
  name: required('CHANNEL_CODE'),
  identifyUser: 'platform',
  agent: (threadId: string) => new SetChannelAgent(threadId),
});

channel.onMessage(async ({ thread, message }) => {
  const prompt = message.contentParts?.length
    ? [
        ...(message.text ? [{ type: 'text' as const, text: message.text }] : []),
        ...message.contentParts,
      ]
    : message.text;
  await thread.runAgent({
    prompt,
    context: [
      { description: 'Originating platform', value: message.platform },
      { description: 'Message author', value: message.actor?.name ?? message.actor?.id ?? 'unknown' },
    ],
  });
});

const intelligence = new CopilotKitIntelligence({
  apiKey: required('INTELLIGENCE_API_KEY'),
  ...(channelsConfig.intelligenceApiUrl ? { apiUrl: channelsConfig.intelligenceApiUrl } : {}),
  ...(channelsConfig.intelligenceGatewayWsUrl ? { wsUrl: channelsConfig.intelligenceGatewayWsUrl } : {}),
});

const runtime = new CopilotRuntime({
  agents: () => ({ set: new SetChannelAgent('slack') }),
  intelligence,
  channels: [channel],
});

let teardown: (() => Promise<void>) | undefined;
const shutdown = async () => {
  await heartbeat(false).catch(() => {});
  await teardown?.();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

const listener = createCopilotNodeListener({
  runtime,
  basePath: '/api/copilotkit',
});
const channelsControl = listener.channels;
const server = createServer(listener);
teardown = async () => {
  await channelsControl.stop();
  if (server.listening) server.close();
};

await channelsControl.ready({ timeoutMs: 30_000 });
const status = channelsControl.status();
if (status.overall !== 'online') {
  throw new Error(`Slack Channel is not online: ${JSON.stringify(status)}`);
}
console.log(`[channels] online — channel "${channelsConfig.channelCode}", SET at ${channelsConfig.setApiUrl}`);

// liveness heartbeat for Settings → Channels
await heartbeat(true);
const hb = setInterval(() => void heartbeat(true), 30_000);
hb.unref();

server.listen(channelsConfig.port, () => {
  console.log(`[channels] lifecycle server listening on :${channelsConfig.port}`);
});
