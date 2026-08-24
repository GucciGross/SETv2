import { z } from 'zod';

const env = z
  .object({
    PORT: z.coerce.number().default(4000),
    HOST: z.string().default('0.0.0.0'),
    DATABASE_URL: z.string().default('postgres://set:set@localhost:5432/set'),
    REDIS_URL: z.string().optional(),
    JWT_SECRET: z.string().default('set-dev-secret-change-me'),
    DATA_DIR: z.string().default('./data'),
    WEB_ORIGIN: z.string().default('*'),
    // Bootstrap LLM provider (BYOK). Leave empty to configure in the UI.
    LLM_BASE_URL: z.string().optional(),
    LLM_API_KEY: z.string().optional(),
    LLM_CHAT_MODEL: z.string().optional(),
    LLM_EMBED_MODEL: z.string().optional(),
    // Optional RAGFlow integration (retrieval routed through a RAGFlow instance)
    RAGFLOW_URL: z.string().optional(),
    RAGFLOW_API_KEY: z.string().optional(),
    APP_URL: z.string().default('http://localhost:5173'),
    // ForwardEmail REST API (primary mail transport). Domain must be verified in the ForwardEmail account.
    FORWARDEMAIL_API_KEY: z.string().optional(),
    FORWARDEMAIL_DOMAIN: z.string().default('trainwithset.com'),
    FORWARDEMAIL_FROM: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().default('SET <noreply@set.local>'),
    // Optional HuggingFace token for the Library surface (higher rate limits / gated repos)
    HF_TOKEN: z.string().optional(),
    SEED_DEMO: z.string().optional(),
    REGISTRATION_OPEN: z.string().default('1'),
    MCP_ENABLED: z.string().default('1'),
    // Voice: server-side speech-to-text via any OpenAI-compatible /audio/transcriptions
    // endpoint. Falls back to the bootstrap LLM env when only that is set. When
    // neither is configured the runtime omits /transcribe and the web client
    // falls back to the browser's Web Speech API.
    TRANSCRIBE_BASE_URL: z.string().optional(),
    TRANSCRIBE_API_KEY: z.string().optional(),
    TRANSCRIBE_MODEL: z.string().default('whisper-1'),
    // SET anonymous usage telemetry — aggregated feature counters only, no
    // content or PII. Opt out with TELEMETRY_ENABLED=0.
    TELEMETRY_ENABLED: z.string().default('1'),
    TELEMETRY_URL: z.string().optional(),
    TELEMETRY_FLUSH_MINUTES: z.coerce.number().default(360), // 6h
  })
  .passthrough()
  .parse(process.env);

export const config = {
  port: env.PORT,
  host: env.HOST,
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  jwtSecret: env.JWT_SECRET,
  dataDir: env.DATA_DIR,
  webOrigin: env.WEB_ORIGIN,
  bootstrapLlm: {
    baseUrl: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
    chatModel: env.LLM_CHAT_MODEL,
    embedModel: env.LLM_EMBED_MODEL,
  },
  ragflowUrl: env.RAGFLOW_URL,
  ragflowApiKey: env.RAGFLOW_API_KEY,
  appUrl: env.APP_URL,
  forwardEmail: {
    apiKey: env.FORWARDEMAIL_API_KEY,
    domain: env.FORWARDEMAIL_DOMAIN,
    // bare address — ForwardEmail's send API can't parse "Name <addr>" envelope senders.
    // `||` (not ??): docker-compose passes unset vars as empty strings.
    from: env.FORWARDEMAIL_FROM || `noreply@${env.FORWARDEMAIL_DOMAIN}`,
  },
  smtp: { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.SMTP_FROM },
  hfToken: env.HF_TOKEN,
  seedDemo: env.SEED_DEMO === '1',
  registrationOpen: env.REGISTRATION_OPEN !== '0',
  mcpEnabled: env.MCP_ENABLED !== '0',
  transcribe: {
    baseUrl: env.TRANSCRIBE_BASE_URL || env.LLM_BASE_URL,
    apiKey: env.TRANSCRIBE_API_KEY || env.LLM_API_KEY,
    model: env.TRANSCRIBE_MODEL,
  },
  telemetry: {
    enabled: env.TELEMETRY_ENABLED !== '0',
    url: env.TELEMETRY_URL || 'https://telemetry.trainwithset.com/v1/ingest',
    flushMinutes: env.TELEMETRY_FLUSH_MINUTES,
  },
};

export const HASH_EMBED_DIM = 384;
