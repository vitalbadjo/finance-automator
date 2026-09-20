import type { QueuedTxn, SendOutcome } from './types';

// Чистые функции над списком очереди: никакого IO, чтобы их можно было
// проверить без хранилища и без стора.

export const sortByCreated = (items: QueuedTxn[]): QueuedTxn[] =>
  [...items].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

// Отвергнутые пропускаем: их повторяют только вручную.
export const nextToSend = (items: QueuedTxn[]): QueuedTxn | null =>
  sortByCreated(items).find((i) => i.error === null) ?? null;

export function applyOutcome(items: QueuedTxn[], id: string, outcome: SendOutcome): QueuedTxn[] {
  if (outcome.kind === 'ok') return items.filter((i) => i.id !== id);
  return items.map((i) =>
    i.id === id
      ? { ...i, attempts: i.attempts + 1, error: outcome.kind === 'rejected' ? outcome.message : i.error }
      : i,
  );
}

export const pendingCount = (items: QueuedTxn[]): number => items.length;
export const hasErrors = (items: QueuedTxn[]): boolean => items.some((i) => i.error !== null);
