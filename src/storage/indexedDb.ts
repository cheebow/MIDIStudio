// Local project storage in IndexedDB (REQ-PRJ-01/08). Projects are stored as `.midstudio` JSON
// text so the same validator protects both file loads and storage loads.
// The IDBFactory is injectable for tests (fake-indexeddb).

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
    return new StorageError('quota', 'ブラウザの保存容量が不足しています。不要なプロジェクトを削除するか、ファイルとして保存してください。現在の編集内容はそのまま残っています。', { cause: e });
  }
  return new StorageError('failed', `ブラウザ内への保存・読込に失敗しました: ${(e as Error)?.message ?? String(e)}`, { cause: e });
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
    tx.onerror = () => reject(wrap(tx.error));
    tx.onabort = () => reject(wrap(tx.error));
  });
}

export class ProjectStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory | null = globalThis.indexedDB ?? null) {}

  private db(): Promise<IDBDatabase> {
    if (!this.factory) return Promise.reject(new StorageError('unavailable', 'このブラウザでは IndexedDB を使えないため、ブラウザ内保存・自動保存は無効です。ファイルとして保存してください。'));
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const open = this.factory!.open(DB_NAME, DB_VERSION);
        open.onupgradeneeded = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(AUTOSAVE)) db.createObjectStore(AUTOSAVE);
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(wrap(open.error));
        open.onblocked = () => reject(new StorageError('blocked', '別のタブがデータベースを使用中です。他の MIDI Studio のタブを閉じてください。'));
      }).catch((e: unknown) => {
        this.dbPromise = null;
        throw e;
      });
    }
    return this.dbPromise;
  }

  async saveProject(p: StoredProject): Promise<void> {
    try {
      const db = await this.db();
      const tx = db.transaction(PROJECTS, 'readwrite');
      tx.objectStore(PROJECTS).put(p);
      await done(tx);
    } catch (e) {
      throw e instanceof StorageError ? e : wrap(e);
    }
  }

  async loadProject(id: string): Promise<StoredProject | null> {
    const db = await this.db();
    const r = await req(db.transaction(PROJECTS, 'readonly').objectStore(PROJECTS).get(id));
    return (r as StoredProject | undefined) ?? null;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const db = await this.db();
    const all = (await req(db.transaction(PROJECTS, 'readonly').objectStore(PROJECTS).getAll())) as StoredProject[];
    return all
      .map((p) => ({ id: p.id, title: p.title, savedAt: p.savedAt, sizeChars: p.json.length }))
      .sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));
  }

  async deleteProject(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(PROJECTS, 'readwrite');
    tx.objectStore(PROJECTS).delete(id);
    await done(tx);
  }

  async saveAutosave(p: StoredProject): Promise<void> {
    try {
      const db = await this.db();
      const tx = db.transaction(AUTOSAVE, 'readwrite');
      tx.objectStore(AUTOSAVE).put(p, AUTOSAVE_KEY);
      await done(tx);
    } catch (e) {
      throw e instanceof StorageError ? e : wrap(e);
    }
  }

  async loadAutosave(): Promise<StoredProject | null> {
    const db = await this.db();
    const r = await req(db.transaction(AUTOSAVE, 'readonly').objectStore(AUTOSAVE).get(AUTOSAVE_KEY));
    return (r as StoredProject | undefined) ?? null;
  }

  async clearAutosave(): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(AUTOSAVE, 'readwrite');
    tx.objectStore(AUTOSAVE).delete(AUTOSAVE_KEY);
    await done(tx);
  }

  close(): void {
    void this.dbPromise?.then((db) => db.close()).catch(() => undefined);
    this.dbPromise = null;
  }
}
