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
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().default('SET <noreply@set.local>'),
    // Optional HuggingFace token for the Library surface (higher rate limits / gated repos)
    HF_TOKEN: z.string().optional(),
    SEED_DEMO: z.string().optional(),
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
  smtp: { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.SMTP_FROM },
  hfToken: env.HF_TOKEN,
  seedDemo: env.SEED_DEMO === '1',
};

export const HASH_EMBED_DIM = 384;
