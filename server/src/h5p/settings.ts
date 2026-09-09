import { fsImplementations } from '@lumieducation/h5p-server';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/** One shared store, not one shared H5PConfig: launch URLs and permissions stay request-local.
 * Lumi saves registration settings a key at a time. Readers must never see a truncated file,
 * and simultaneous saves must not overwrite another request's keys with a stale snapshot.
 * Like SET's library lock provider, this adapter targets a single server process.
 */
export class StudioSettings extends fsImplementations.InMemoryStorage {
  private pending: Promise<void> = Promise.resolve();
  private constructor(private readonly file: string) { super(); }

  static async open(file: string): Promise<StudioSettings> {
    const store = new StudioSettings(file);
    await mkdir(dirname(file), { recursive: true });
    try {
      const data: unknown = JSON.parse(await readFile(file, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('H5P settings must be a JSON object.');
      store.storage = data;
    } catch (error: any) {
      // A corrupt or inaccessible existing file needs operator attention, not silent data loss.
      if (error.code !== 'ENOENT') throw error;
    }
    return store;
  }

  override async save(key: string, value: any): Promise<void> {
    const operation = this.pending.then(async () => {
      const previous = structuredClone(this.storage);
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await super.save(key, value);
        await writeFile(temporary, JSON.stringify(this.storage), { mode: 0o600, flag: 'wx' });
        await rename(temporary, this.file);
      } catch (error) {
        this.storage = previous;
        throw error;
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
      }
    });
    // A failed write rejects its caller but must not poison every future save.
    this.pending = operation.catch(() => {});
    return operation;
  }
}

const stores = new Map<string, Promise<StudioSettings>>();
export function studioSettings(file: string): Promise<StudioSettings> {
  let store = stores.get(file);
  if (!store) {
    store = StudioSettings.open(file);
    stores.set(file, store);
    void store.catch(() => { if (stores.get(file) === store) stores.delete(file); });
  }
  return store;
}
