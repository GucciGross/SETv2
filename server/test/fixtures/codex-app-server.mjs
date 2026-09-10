#!/usr/bin/env node
// Deterministic protocol fixture. No provider traffic, credentials or live account.
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const auth = join(process.env.CODEX_HOME, 'fixture-account');
const home = process.env.HOME;
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
let thread = '', tool = 'search_workspace';
for await (const line of createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  if (!m.method) {
    if (m.id === 'fixture-tool') {
      send({ method: 'item/agentMessage/delta', params: { threadId: thread, delta: m.result?.success ? 'Verified tool result.' : 'Action stopped.' } });
      send({ method: 'turn/completed', params: { threadId: thread, turn: { id: 'turn', status: 'completed' } } });
    }
    continue;
  }
  const reply = result => send({ id: m.id, result });
  if (m.method === 'initialize') reply({ userAgent: 'fixture' });
  else if (m.method === 'initialized') continue;
  else if (m.method === 'account/read') reply({ account: existsSync(auth) ? { type: 'chatgpt', email: 'tester@example.invalid', planType: 'plus', ignoredSecret: 'NEVER-RETURN' } : null });
  else if (m.method === 'account/login/start') {
    const result = { type: 'chatgptDeviceCode', loginId: 'login', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'TEST-1234' };
    if (existsSync(join(home, 'pause-login'))) reply(result);
    else {
      writeFileSync(auth, 'synthetic');
      // Same data chunk tests the login response/notification continuation race.
      process.stdout.write(JSON.stringify({ id: m.id, result }) + '\n' + JSON.stringify({ method: 'account/login/completed', params: { loginId: 'login', success: true } }) + '\n');
    }
  } else if (m.method === 'account/logout') { rmSync(auth, { force: true }); reply({}); }
  else if (m.method === 'account/login/cancel') reply({ status: 'cancelled' });
  else if (m.method === 'thread/start') {
    thread = 'thread'; tool = m.params.dynamicTools[0]?.name;
    writeFileSync(join(home, 'fixture-thread.json'), JSON.stringify(m.params));
    reply({ thread: { id: thread } });
  } else if (m.method === 'turn/start') {
    writeFileSync(join(home, 'fixture-turn.json'), JSON.stringify(m.params));
    reply({ turn: { id: 'turn', status: 'inProgress' } });
    send({ method: 'item/agentMessage/delta', params: { threadId: thread, delta: 'Checking…' } });
    if (m.params.input[0].text.includes('NATIVE_ESCAPE')) {
      send({ method: 'item/started', params: { threadId: thread, item: { type: 'commandExecution' } } });
    } else {
      send({ id: 'fixture-tool', method: 'item/tool/call', params: { threadId: thread, turnId: 'turn', tool, arguments: { query: 'lesson' } } });
    }
  } else if (m.method === 'turn/interrupt' || m.method === 'thread/unsubscribe') reply({});
  else reply({});
}
