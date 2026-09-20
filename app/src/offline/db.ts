import type { CacheEntry, CacheStorage, QueueStorage, QueuedTxn } from './types';

const DB_NAME = 'spend-offline';
const DB_VERSION = 1;
const QUEUE = 'queue';
const CACHE = 'cache';

let dbPromise: Promise<IDBDatabase> | null = null;

const openDb = (): Promise<IDBDatabase> => {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB недоступен'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE, { keyPath: 'key' });
    };
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('Не удалось открыть IndexedDB'));
    };
  });
  return dbPromise;
};

const request = <T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> =>
  openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = run(tx.objectStore(store));
        req.onsuccess = () => {
          resolve(req.result as T);
        };
        req.onerror = () => {
          reject(req.error ?? new Error('Ошибка IndexedDB'));
        };
      }),
  );

// Хранилище — удобство, а не обязательство: если его нет, приложение
// работает как раньше, просто без очереди и кэша.
const quiet = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await p;
  } catch {
    return fallback;
  }
};

export const queueStorage: QueueStorage = {
  all: () => quiet(request<QueuedTxn[]>(QUEUE, 'readonly', (s) => s.getAll()), []),
  put: (item) => quiet(request<IDBValidKey>(QUEUE, 'readwrite', (s) => s.put(item)).then(() => undefined), undefined),
  remove: (id) => quiet(request<undefined>(QUEUE, 'readwrite', (s) => s.delete(id)), undefined),
};

interface CacheRow extends CacheEntry {
  key: string;
}

export const cacheStorage: CacheStorage = {
  get: (key) =>
    quiet(
      request<CacheRow | undefined>(CACHE, 'readonly', (s) => s.get(key)).then((row) =>
        row ? { value: row.value, at: row.at } : null,
      ),
      null,
    ),
  set: (key, value) =>
    quiet(
      request<IDBValidKey>(CACHE, 'readwrite', (s) =>
        s.put({ key, value, at: new Date().toISOString() } satisfies CacheRow),
      ).then(() => undefined),
      undefined,
    ),
};
