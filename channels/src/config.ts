/** Channels listener configuration (env-driven, mirrors docker-compose). */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const channelsConfig = {
  /** CopilotKit Intelligence Channel code (must match the Intelligence dashboard). */
  channelCode: process.env.CHANNEL_CODE ?? '',
  /** Project-scoped Intelligence API key (same project as the Channel). */
  intelligenceApiKey: process.env.INTELLIGENCE_API_KEY ?? '',
  /** Optional self-hosted Intelligence overrides (pass both together). */
  intelligenceApiUrl: process.env.INTELLIGENCE_API_URL,
  intelligenceGatewayWsUrl: process.env.INTELLIGENCE_GATEWAY_WS_URL,
  /** SET server base URL (docker network name or host). */
  setApiUrl: (process.env.SET_API_URL ?? 'http://localhost:4000').replace(/\/$/, ''),
  /** Shared with the SET server — used to mint the service identity JWT. */
  jwtSecret: process.env.JWT_SECRET ?? required('JWT_SECRET'),
  /** Fallback space when the Slack workspace isn't in channel_links. */
  fallbackSpaceId: process.env.CHANNEL_SPACE_ID ?? '',
  port: Number(process.env.PORT ?? 3100),
};
