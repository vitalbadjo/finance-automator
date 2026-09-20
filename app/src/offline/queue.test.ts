import type { QueuedTxn } from './types';
import { applyOutcome, hasErrors, nextToSend, pendingCount, sortByCreated } from './queue';

const q = (id: string, createdAt: string, error: string | null = null): QueuedTxn => ({
  id,
  args: { date: '2026-09-20', amount: 1, currency: 'USD', code: 'каф', note: null },
  createdAt,
  attempts: 0,
  error,
});

describe('nextToSend', () => {
  it('берёт самую старую запись без ошибки', () => {
    const items = [q('b', '2026-09-20T10:00:00Z'), q('a', '2026-09-20T09:00:00Z')];
    expect(nextToSend(items)?.id).toBe('a');
  });
  it('пропускает отвергнутые', () => {
    const items = [q('a', '2026-09-20T09:00:00Z', 'Неизвестная категория'), q('b', '2026-09-20T10:00:00Z')];
    expect(nextToSend(items)?.id).toBe('b');
  });
  it('null, когда отправлять нечего', () => {
    expect(nextToSend([])).toBeNull();
    expect(nextToSend([q('a', '2026-09-20T09:00:00Z', 'отказ')])).toBeNull();
  });
});

describe('applyOutcome', () => {
  const items = [q('a', '2026-09-20T09:00:00Z'), q('b', '2026-09-20T10:00:00Z')];

  it('успех убирает запись', () => {
    expect(applyOutcome(items, 'a', { kind: 'ok' }).map((i) => i.id)).toEqual(['b']);
  });
  it('сетевая ошибка оставляет запись и считает попытку', () => {
    const next = applyOutcome(items, 'a', { kind: 'network' });
    expect(next).toHaveLength(2);
    expect(next[0]?.attempts).toBe(1);
    expect(next[0]?.error).toBeNull();
  });
  it('отказ помечает запись текстом ошибки', () => {
    const next = applyOutcome(items, 'a', { kind: 'rejected', message: 'Неизвестная категория: ххх' });
    expect(next[0]?.error).toBe('Неизвестная категория: ххх');
    expect(next[0]?.attempts).toBe(1);
  });
  it('неизвестный id ничего не меняет', () => {
    expect(applyOutcome(items, 'нет', { kind: 'ok' })).toEqual(items);
  });
});

describe('счётчики', () => {
  it('pendingCount и hasErrors', () => {
    const items = [q('a', '2026-09-20T09:00:00Z'), q('b', '2026-09-20T10:00:00Z', 'отказ')];
    expect(pendingCount(items)).toBe(2);
    expect(hasErrors(items)).toBe(true);
    expect(hasErrors([q('a', '2026-09-20T09:00:00Z')])).toBe(false);
  });
  it('sortByCreated не меняет исходный массив', () => {
    const items = [q('b', '2026-09-20T10:00:00Z'), q('a', '2026-09-20T09:00:00Z')];
    expect(sortByCreated(items).map((i) => i.id)).toEqual(['a', 'b']);
    expect(items.map((i) => i.id)).toEqual(['b', 'a']);
  });
});
