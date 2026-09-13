import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { migrate } from '../src/migrate.js';

for (const fail of [false, true]) test(`migration lock and connection cleanup on ${fail ? 'failure' : 'success'}`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'set-migration-'));
  await writeFile(join(dir, '001.sql'), 'SELECT 42;');
  const calls: string[] = [];
  const client = {
    async query(sql: string) {
      calls.push(sql);
      if (sql === 'SELECT 42;' && fail) throw new Error('intentional migration failure');
      return { rows: [] };
    },
    release() { calls.push('release'); },
  };
  const database = { connect: async () => client } as unknown as Pick<Pool, 'connect'>;
  try {
    if (fail) await assert.rejects(migrate(database, dir), /intentional migration failure/);
    else await migrate(database, dir);
    assert.equal(calls[0], 'SELECT pg_advisory_lock(193602877, 2)');
    assert.ok(calls[1].startsWith('CREATE TABLE'));
    assert.ok(calls.includes(fail ? 'ROLLBACK' : 'COMMIT'));
    assert.deepEqual(calls.slice(-2), ['SELECT pg_advisory_unlock(193602877, 2)', 'release']);
    assert.equal(calls.filter(s => s === 'BEGIN').length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
