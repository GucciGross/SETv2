import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, lstat, chmod, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexRpc } from './rpc.js';
import { CodexBridge } from './bridge.js';
import { CodexError, codexOAuthEnabled, requireCodexOAuth, validateDeviceLogin } from './policy.js';

export const PRIVATE_CONFIG = [
  'cli_auth_credentials_store="file"', 'forced_login_method="chatgpt"',
  'features.shell_tool=false', 'features.unified_exec=false', 'features.shell_snapshot=false',
  'features.js_repl=false', 'features.multi_agent=false', 'features.apps=false',
  'features.skill_mcp_dependency_install=false', 'web_search="disabled"',
  'mcp_servers={}', 'memories.generate_memories=false', 'approval_policy="never"', 'sandbox_mode="read-only"',
];

export function userDirectory(dataDir: string, userId: string): string {
  if (!userId || userId.length > 256) throw new CodexError(400, 'Invalid user identity.');
  return join(resolve(dataDir), 'codex-users', createHash('sha256').update(userId).digest('hex'));
}

/** Never inherit SET's database, JWT, API, gateway, or service credentials. */
export function codexEnvironment(home: string, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { HOME: home, CODEX_HOME: join(home, 'credentials'), XDG_CONFIG_HOME: join(home, 'config') };
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'SYSTEMROOT', 'SystemRoot', 'WINDIR']) {
    if (source[key]) out[key] = source[key];
  }
  return out;
}

async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const st = await lstat(path);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new CodexError(500, 'Unsafe Codex storage directory.');
  await chmod(path, 0o700);
}

interface Session {
  rpc: CodexRpc; home: string; workDir: string; touched: number; busy: boolean; locked: boolean;
  bridge?: CodexBridge; lastLogin: number;
  login?: ReturnType<typeof validateDeviceLogin> & { startedAt: number };
  completedLogin?: { id: string; success: boolean };
  loginError?: string;
}

/** Personal, bounded process pool. Workspace provider records never contain subscription credentials. */
export class CodexSessions {
  private sessions = new Map<string, Promise<Session>>();
  private disconnecting = new Set<string>();
  private mutations = new Set<string>();
  private sweepTimer: NodeJS.Timeout;
  private shuttingDown = false;
  constructor(private readonly dataDir: string, private readonly executable = process.env.SET_CODEX_BIN || 'codex') {
    this.sweepTimer = setInterval(() => void this.sweep().catch(() => {}), 30_000);
    this.sweepTimer.unref();
  }

  private async storage(userId: string) {
    const home = userDirectory(this.dataDir, userId);
    await privateDirectory(join(resolve(this.dataDir), 'codex-users'));
    await privateDirectory(home);
    return home;
  }

  private async create(userId: string): Promise<Session> {
    requireCodexOAuth();
    const home = await this.storage(userId);
    await privateDirectory(join(home, 'credentials'));
    await privateDirectory(join(home, 'config'));
    const workDir = await mkdtemp(join(tmpdir(), 'set-codex-'));
    await chmod(workDir, 0o700);
    const child = spawn(this.executable, ['app-server', ...PRIVATE_CONFIG.flatMap(c => ['-c', c])], {
      cwd: workDir, env: codexEnvironment(home), shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    const rpc = new CodexRpc(child);
    const s: Session = { rpc, home, workDir, touched: Date.now(), busy: false, locked: false, lastLogin: 0 };
    rpc.events.on('notification', msg => {
      if (msg.method !== 'account/login/completed' || typeof msg.params?.loginId !== 'string') return;
      // The response and notification may arrive in the same NDJSON chunk, before
      // the awaiting login() continuation has assigned s.login.
      s.completedLogin = { id: msg.params.loginId, success: msg.params.success === true };
      this.finishLogin(s);
    });
    try { await rpc.initialize(); return s; }
    catch (error) { rpc.stop(); await rpc.terminated; await rm(workDir, { recursive: true, force: true }); throw error; }
  }

  private finishLogin(s: Session) {
    if (!s.login || s.completedLogin?.id !== s.login.loginId) return;
    s.loginError = s.completedLogin.success ? undefined : 'Sign-in did not complete. Retry, or check whether device-code sign-in is enabled for your account.';
    s.login = undefined; s.completedLogin = undefined;
  }

  private async dispose(s: Session) {
    await s.bridge?.close();
    s.rpc.stop();
    // Wait until the process can no longer write credential files before cleanup.
    await s.rpc.terminated;
    await rm(s.workDir, { recursive: true, force: true });
  }

  private async get(userId: string): Promise<Session> {
    requireCodexOAuth();
    if (this.shuttingDown) throw new CodexError(503, 'SET is shutting down.');
    if (this.disconnecting.has(userId)) throw new CodexError(409, 'Codex is disconnecting. Try again shortly.');
    const existing = this.sessions.get(userId);
    if (existing) {
      const s = await existing;
      if (!s.rpc.isClosed || s.locked) { s.touched = Date.now(); return s; }
      if (this.sessions.get(userId) !== existing) return this.get(userId);
      // Publish a shared replacement immediately, but wait for the old process
      // to exit before another process can write this account's credentials.
      const replacement = this.dispose(s).then(() => this.create(userId));
      this.sessions.set(userId, replacement);
      try { return await replacement; }
      catch (error) { if (this.sessions.get(userId) === replacement) this.sessions.delete(userId); throw error; }
    }
    if (this.sessions.size >= 8) throw new CodexError(503, 'The self-hosted Codex session limit is reached. Close an idle session and retry.');
    const promise = this.create(userId);
    this.sessions.set(userId, promise);
    try { return await promise; }
    catch (error) { if (this.sessions.get(userId) === promise) this.sessions.delete(userId); throw error; }
  }

  private async exclusive<T>(s: Session, action: () => Promise<T>, touch = true): Promise<T> {
    if (s.locked) throw new CodexError(409, 'Another Codex account operation is in progress.');
    s.locked = true;
    try { return await action(); } finally { s.locked = false; if (touch) s.touched = Date.now(); }
  }

  private async mutate<T>(userId: string, action: () => Promise<T>): Promise<T> {
    requireCodexOAuth();
    if (this.mutations.has(userId) || this.disconnecting.has(userId)) throw new CodexError(409, 'Another Codex account operation is in progress.');
    this.mutations.add(userId);
    try { return await action(); } finally { this.mutations.delete(userId); }
  }

  async selected(userId: string): Promise<boolean> {
    if (!codexOAuthEnabled()) return false;
    try {
      const file = join(userDirectory(this.dataDir, userId), 'selection.json');
      const st = await lstat(file);
      if (!st.isFile() || st.isSymbolicLink() || st.size > 1024) throw new Error('Unsafe selection file');
      return JSON.parse(await readFile(file, 'utf8')).enabled === true;
    } catch (error: any) {
      if (error?.code === 'ENOENT') return false;
      throw new CodexError(500, 'Could not read the personal Codex preference. No provider fallback was attempted.');
    }
  }

  private async saveSelection(home: string, enabled: boolean) {
    const file = join(home, `selection-${randomUUID()}.tmp`);
    try {
      await writeFile(file, JSON.stringify({ enabled }), { mode: 0o600, flag: 'wx' });
      await rename(file, join(home, 'selection.json'));
    } finally { await rm(file, { force: true }); }
  }

  async status(userId: string) {
    const s = await this.get(userId);
    const info = await s.rpc.request('account/read', { refreshToken: false });
    const a = info?.account;
    return {
      available: true, connected: a?.type === 'chatgpt', selected: await this.selected(userId), busy: s.busy,
      account: a?.type === 'chatgpt' ? {
        email: typeof a.email === 'string' ? a.email.slice(0, 254) : '',
        planType: typeof a.planType === 'string' ? a.planType.slice(0, 60) : '',
      } : null,
      login: s.login ? { userCode: s.login.userCode, verificationUrl: s.login.verificationUrl, expiresAt: s.login.startedAt + 600_000 } : null,
      error: s.loginError ?? null,
    };
  }

  async login(userId: string) {
    return this.mutate(userId, () => this.loginImpl(userId));
  }

  private async loginImpl(userId: string) {
    const s = await this.get(userId);
    await this.exclusive(s, async () => {
      if (s.busy) throw new CodexError(409, 'Stop the current Copilot run before changing accounts.');
      if (s.login || (await s.rpc.request('account/read'))?.account?.type === 'chatgpt') return;
      if (Date.now() - s.lastLogin < 30_000) throw new CodexError(429, 'Wait 30 seconds before starting another sign-in.');
      s.lastLogin = Date.now(); s.loginError = undefined; s.completedLogin = undefined;
      const login = validateDeviceLogin(await s.rpc.request('account/login/start', { type: 'chatgptDeviceCode' }));
      s.login = { ...login, startedAt: Date.now() };
      this.finishLogin(s);
    });
    return this.status(userId);
  }

  async cancelLogin(userId: string) {
    return this.mutate(userId, () => this.cancelLoginImpl(userId));
  }

  private async cancelLoginImpl(userId: string) {
    const s = await this.get(userId);
    await this.exclusive(s, async () => {
      if (s.login) await s.rpc.request('account/login/cancel', { loginId: s.login.loginId });
      s.login = undefined; s.loginError = undefined;
    });
    return this.status(userId);
  }

  async select(userId: string, enabled: boolean) {
    return this.mutate(userId, () => this.selectImpl(userId, enabled));
  }

  private async selectImpl(userId: string, enabled: boolean) {
    // Turning off a preference must also work when the CLI is missing/broken.
    if (!enabled) {
      requireCodexOAuth();
      const current = await this.sessions.get(userId);
      if (current?.busy || current?.locked || this.disconnecting.has(userId)) throw new CodexError(409, 'Stop the current Codex operation before switching providers.');
      await this.saveSelection(await this.storage(userId), false);
      return { selected: false };
    }
    const s = await this.get(userId);
    await this.exclusive(s, async () => {
      if (s.busy || s.login) throw new CodexError(409, 'Finish the current Codex operation before switching providers.');
      if ((await s.rpc.request('account/read', { refreshToken: false }))?.account?.type !== 'chatgpt') {
        throw new CodexError(409, 'Sign in with ChatGPT before selecting Codex for Copilot.');
      }
      await this.saveSelection(s.home, true);
    });
    return { selected: true };
  }

  async disconnect(userId: string) {
    requireCodexOAuth();
    if (this.disconnecting.has(userId) || this.mutations.has(userId)) throw new CodexError(409, 'Another Codex account operation is in progress.');
    this.disconnecting.add(userId);
    try {
      const home = await this.storage(userId);
      await this.saveSelection(home, false);
      const promise = this.sessions.get(userId);
      const s = await promise?.catch(() => null);
      if (s) {
        // Do not let login/selection and logout race while credentials are removed.
        if (s.locked) throw new CodexError(409, 'Another Codex account operation is in progress. Retry disconnect.');
        s.locked = true;
        try {
          await s.bridge?.close();
          if (!s.rpc.isClosed) {
            if (s.login) await s.rpc.request('account/login/cancel', { loginId: s.login.loginId }, 2000).catch(() => {});
            await s.rpc.request('account/logout', {}, 2000).catch(() => {});
          }
        } finally { await this.dispose(s); this.sessions.delete(userId); }
      }
      await rm(join(home, 'credentials'), { recursive: true, force: true });
      return { disconnected: true };
    } finally { this.disconnecting.delete(userId); }
  }

  async acquire(userId: string): Promise<CodexBridge | null> {
    if (this.mutations.has(userId) || this.disconnecting.has(userId)) throw new CodexError(409, 'Finish the Codex account operation before starting Copilot.');
    if (!(await this.selected(userId))) return null;
    const s = await this.get(userId);
    return this.exclusive(s, async () => {
      if (this.mutations.has(userId) || this.disconnecting.has(userId)) throw new CodexError(409, 'Finish the Codex account operation before starting Copilot.');
      if (!(await this.selected(userId))) return null;
      if (s.busy || s.login) throw new CodexError(409, 'Your Codex account already has a SET operation in progress. Finish or stop it first.');
      if ((await s.rpc.request('account/read', { refreshToken: false }))?.account?.type !== 'chatgpt') {
        throw new CodexError(409, 'Your selected Codex account needs sign-in. Reconnect in Settings.');
      }
      s.busy = true;
      const bridge = new CodexBridge(s.rpc, s.workDir, healthy => {
        s.busy = false; s.bridge = undefined; s.touched = Date.now();
        if (!healthy) s.rpc.stop();
      });
      s.bridge = bridge;
      return bridge;
    });
  }

  private async sweep() {
    for (const [id, promise] of this.sessions) {
      const s = await promise.catch(() => null);
      if (!s || s.busy || s.locked || this.disconnecting.has(id) || this.mutations.has(id)) continue;
      await this.exclusive(s, async () => {
        if (s.login && Date.now() - s.login.startedAt > 600_000) {
          await s.rpc.request('account/login/cancel', { loginId: s.login.loginId }).catch(() => {});
          s.login = undefined; s.loginError = 'The SET sign-in window expired. Start again.';
        }
        if (!codexOAuthEnabled() || (!s.login && (s.rpc.isClosed || Date.now() - s.touched > 300_000))) {
          await this.dispose(s);
          if (this.sessions.get(id) === promise) this.sessions.delete(id);
        }
      }, false);
    }
  }

  async close() {
    this.shuttingDown = true; clearInterval(this.sweepTimer);
    await Promise.all([...this.sessions.values()].map(async promise => {
      const s = await promise.catch(() => null); if (s) await this.dispose(s);
    }));
    this.sessions.clear();
  }
}
