import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

// Postgres restarts (docker compose restart db, failover, admin termination)
// emit 'error' on idle pool clients. Unhandled, that crashes the whole server —
// log it instead; in-flight queries still reject and callers handle those.
pool.on('error', (err) => {
  console.error('[db] idle client error (connection likely restarted):', err.message);
});

// jsonb columns come back as parsed objects already; arrays of numbers arrive as {…} only for
// `real[]` which node-postgres parses natively. No custom parsers needed.

export async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function one<T = any>(text: string, params: any[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}
