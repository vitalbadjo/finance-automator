import type { QueuedTxn } from './types';
import {
  cacheHit,
  freshHit,
  offlineReducer,
  onlineSet,
  pendingPatch,
  pendingRemove,
  pendingSet,
  pendingUpsert,
} from './state';

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

  it('pendingUpsert добавляет новую запись и заменяет существующую', () => {
    const added = offlineReducer(initial, pendingUpsert(item));
    expect(added.pending).toEqual([item]);
    const other: QueuedTxn = { ...item, id: 'b' };
    const both = offlineReducer(added, pendingUpsert(other));
    expect(both.pending.map((i) => i.id)).toEqual(['a', 'b']);
    const replaced = offlineReducer(both, pendingUpsert({ ...item, attempts: 3 }));
    expect(replaced.pending).toHaveLength(2);
    expect(replaced.pending[0]?.attempts).toBe(3);
  });

  it('pendingRemove убирает только свою запись', () => {
    const both = offlineReducer(initial, pendingSet([item, { ...item, id: 'b' }]));
    expect(offlineReducer(both, pendingRemove('a')).pending.map((i) => i.id)).toEqual(['b']);
    expect(offlineReducer(both, pendingRemove('нет такой')).pending).toHaveLength(2);
  });

  it('pendingPatch правит поля и не воскрешает удалённую запись', () => {
    const one = offlineReducer(initial, pendingSet([item]));
    const tried = offlineReducer(one, pendingPatch({ id: 'a', patch: { attempts: 1 } }));
    expect(tried.pending[0]?.attempts).toBe(1);
    expect(tried.pending[0]?.error).toBeNull();
    const failed = offlineReducer(tried, pendingPatch({ id: 'a', patch: { attempts: 2, error: 'отказ' } }));
    expect(failed.pending[0]).toMatchObject({ attempts: 2, error: 'отказ' });
    const retried = offlineReducer(failed, pendingPatch({ id: 'a', patch: { error: null } }));
    expect(retried.pending[0]?.error).toBeNull();
    expect(retried.pending[0]?.attempts).toBe(2);
    expect(offlineReducer(initial, pendingPatch({ id: 'a', patch: { error: 'отказ' } })).pending).toHaveLength(0);
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
