// Local project storage in IndexedDB (REQ-PRJ-01/08). Projects are stored as `.midstudio` JSON
// text so the same validator protects both file loads and storage loads.
// The IDBFactory is injectable for tests (fake-indexeddb).

import { t } from '../i18n';

const DB_NAME = 'midi-studio';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const AUTOSAVE = 'autosave';
const AUTOSAVE_KEY = 'current';

export interface StoredProject {
  id: string;
  title: string;
  savedAt: string;
  json: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  savedAt: string;
  sizeChars: number;
}

export class StorageError extends Error {
  constructor(
    readonly kind: 'unavailable' | 'quota' | 'blocked' | 'failed',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

function wrap(e: unknown): StorageError {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'QuotaExceededError') {
    return new StorageError('quota', t('ブラウザの保存容量が不足しています。不要なプロジェクトを削除するか、ファイルとして保存してください。現在の編集内容はそのまま残っています。'), { cause: e });
  }
  return new StorageError('failed', t('ブラウザ内への保存・読込に失敗しました: {message}', { message: (e as Error)?.message ?? String(e) }), { cause: e });
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(wrap(r.error));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    // a failed request bubbles here before the transaction aborts: tx.error is still null then
    tx.onerror = (ev) => reject(wrap((ev.target as IDBRequest | null)?.error ?? tx.error));
    tx.onabort = () => reject(wrap(tx.error));
  });
}

export class ProjectStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory | null = globalThis.indexedDB ?? null) {}

  private db(): Promise<IDBDatabase> {
    if (!this.factory) return Promise.reject(new StorageError('unavailable', t('このブラウザでは IndexedDB を使えないため、ブラウザ内保存・自動保存は無効です。ファイルとして保存してください。')));
    if (!this.dbPromise) {
      const opened: Promise<IDBDatabase> = new Promise<IDBDatabase>((resolve, reject) => {
        const open = this.factory!.open(DB_NAME, DB_VERSION);
        open.onupgradeneeded = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(AUTOSAVE)) db.createObjectStore(AUTOSAVE);
        };
        let blocked = false;
        open.onsuccess = () => {
          const db = open.result;
          if (blocked) return db.close(); // already reported as blocked: the next call opens a new one
          // The browser can close the connection (site data cleared, a newer version opened in another
          // tab): drop it so the next call opens a new one instead of failing until a reload (ADR-087).
          const forget = () => {
            if (this.dbPromise === opened) this.dbPromise = null;
          };
          db.onclose = forget;
          db.onversionchange = () => {
            db.close();
            forget();
          };
          resolve(db);
        };
        open.onerror = () => reject(wrap(open.error));
        open.onblocked = () => {
          blocked = true;
          reject(new StorageError('blocked', t('別のタブがデータベースを使用中です。他の MIDI Studio のタブを閉じてください。')));
        };
      }).catch((e: unknown) => {
        this.dbPromise = null;
        throw e;
      });
      this.dbPromise = opened;
    }
    return this.dbPromise;
  }

  /**
   * Runs `fn` with the database; when the connection turned out to be closed (InvalidStateError on
   * transaction()), opens a new one and tries once more (ADR-087).
   */
  private async withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
    const db = await this.db();
    try {
      return await fn(db);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'InvalidStateError')) throw e;
      if (this.dbPromise && (await this.dbPromise.catch(() => null)) === db) this.dbPromise = null;
      return fn(await this.db());
    }
  }

  async saveProject(p: StoredProject): Promise<void> {
    try {
      await this.withDb((db) => {
        const tx = db.transaction(PROJECTS, 'readwrite');
        tx.objectStore(PROJECTS).put(p);
        return done(tx);
      });
    } catch (e) {
      throw e instanceof StorageError ? e : wrap(e);
    }
  }

  async loadProject(id: string): Promise<StoredProject | null> {
    const r = await this.withDb((db) => req(db.transaction(PROJECTS, 'readonly').objectStore(PROJECTS).get(id)));
    return (r as StoredProject | undefined) ?? null;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const all = (await this.withDb((db) => req(db.transaction(PROJECTS, 'readonly').objectStore(PROJECTS).getAll()))) as unknown[];
    // a damaged or foreign record is skipped, not allowed to break the whole list (ADR-087)
    return all
      .filter((p): p is StoredProject => typeof p === 'object' && p !== null && typeof (p as StoredProject).id === 'string' && typeof (p as StoredProject).json === 'string')
      .map((p) => ({ id: p.id, title: typeof p.title === 'string' ? p.title : p.id, savedAt: typeof p.savedAt === 'string' ? p.savedAt : '', sizeChars: p.json.length }))
      .sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));
  }

  async deleteProject(id: string): Promise<void> {
    await this.withDb((db) => {
      const tx = db.transaction(PROJECTS, 'readwrite');
      tx.objectStore(PROJECTS).delete(id);
      return done(tx);
    });
  }

  async saveAutosave(p: StoredProject): Promise<void> {
    try {
      await this.withDb((db) => {
        const tx = db.transaction(AUTOSAVE, 'readwrite');
        tx.objectStore(AUTOSAVE).put(p, AUTOSAVE_KEY);
        return done(tx);
      });
    } catch (e) {
      throw e instanceof StorageError ? e : wrap(e);
    }
  }

  async loadAutosave(): Promise<StoredProject | null> {
    const r = await this.withDb((db) => req(db.transaction(AUTOSAVE, 'readonly').objectStore(AUTOSAVE).get(AUTOSAVE_KEY)));
    return (r as StoredProject | undefined) ?? null;
  }

  async clearAutosave(): Promise<void> {
    await this.withDb((db) => {
      const tx = db.transaction(AUTOSAVE, 'readwrite');
      tx.objectStore(AUTOSAVE).delete(AUTOSAVE_KEY);
      return done(tx);
    });
  }

  close(): void {
    void this.dbPromise?.then((db) => db.close()).catch(() => undefined);
    this.dbPromise = null;
  }
}
