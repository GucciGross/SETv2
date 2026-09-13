import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_DIR = path.resolve(__dirname, '../sql');

/** Hold one session-level advisory lock across discovery and all migrations.
 * Each migration remains transactional. All statements use the same checked-out
 * connection, so a second startup cannot apply the same file concurrently.
 */
export async function migrate(database: Pick<Pool, 'connect'> = pool, sqlDir = SQL_DIR) {
  const client = await database.connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock(193602877, 2)');
    locked = true;
    await client.query(`CREATE TABLE IF NOT EXISTS _migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Set(
      (await client.query('SELECT name FROM _migrations')).rows.map((r: any) => r.name)
    );
    const files = fs.readdirSync(sqlDir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (applied.has(f)) continue;
      const sql = fs.readFileSync(path.join(sqlDir, f), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _migrations(name) VALUES ($1)', [f]);
        await client.query('COMMIT');
        console.log(`[migrate] applied ${f}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock(193602877, 2)');
    } finally {
      client.release();
    }
  }
}

// The migration command works both from tsx and from the built runtime image.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate()
    .then(async () => {
      console.log('[migrate] done');
      await pool.end();
    })
    .catch(async (e) => {
      console.error(e);
      await pool.end();
      process.exitCode = 1;
    });
}
