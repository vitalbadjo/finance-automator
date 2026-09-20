import type { QueuedTxn } from './types';
import { cacheHit, freshHit, offlineReducer, onlineSet, pendingSet } from './state';

const item: QueuedTxn = {
  id: 'a',
  args: { date: '2026-09-20', amount: 1, currency: 'USD', code: 'каф', note: null },
  createdAt: '2026-09-20T09:00:00Z',
  attempts: 0,
  error: null,
};

describe('offline slice', () => {
  const initial = offlineReducer(undefined, { type: '@@init' });

  it('стартует пустым и онлайн по умолчанию', () => {
    expect(initial.pending).toEqual([]);
    expect(initial.fromCacheAt).toBeNull();
  });

  it('pendingSet заменяет очередь', () => {
    expect(offlineReducer(initial, pendingSet([item])).pending).toEqual([item]);
  });

  it('cacheHit ставит отметку, freshHit снимает', () => {
    const cached = offlineReducer(initial, cacheHit('2026-09-20T15:40:00Z'));
    expect(cached.fromCacheAt).toBe('2026-09-20T15:40:00Z');
    const fresh = offlineReducer(cached, freshHit('2026-09-20T16:00:00Z'));
    expect(fresh.fromCacheAt).toBeNull();
    expect(fresh.lastSyncAt).toBe('2026-09-20T16:00:00Z');
  });

  it('onlineSet', () => {
    expect(offlineReducer(initial, onlineSet(false)).online).toBe(false);
  });
});
