import type { CacheEntry, CacheStorage, QueueStorage, QueuedTxn } from './types';

// Реализации в памяти для тестов: в jsdom IndexedDB нет, а тащить
// fake-indexeddb в зависимости ради этого не стоит.
export const memoryQueueStorage = (initial: QueuedTxn[] = []): QueueStorage => {
  const items = new Map(initial.map((i) => [i.id, i] as const));
  return {
    all: () => Promise.resolve([...items.values()]),
    put: (item) => {
      items.set(item.id, item);
      return Promise.resolve();
    },
    remove: (id) => {
      items.delete(id);
      return Promise.resolve();
    },
  };
};

export const memoryCacheStorage = (): CacheStorage => {
  const rows = new Map<string, CacheEntry>();
  return {
    get: (key) => Promise.resolve(rows.get(key) ?? null),
    set: (key, value) => {
      rows.set(key, { value, at: new Date().toISOString() });
      return Promise.resolve();
    },
  };
};
