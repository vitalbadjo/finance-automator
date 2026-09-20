import { makeStore } from '@/app/store';
import { enqueueTxn, flushQueue, removeTxn, retryTxn } from './thunks';
import { pendingSet } from './state';
import type { QueuedTxn } from './types';

const rpc = vi.fn();
vi.mock('@/api/supabase', () => ({
  supabase: { rpc: (...a: unknown[]): unknown => rpc(...a), auth: { signOut: vi.fn() } },
}));

const args = { date: '2026-09-20', amount: 5, currency: 'USD', code: 'каф', note: null };
const queued = (id: string, error: string | null = null): QueuedTxn => ({
  id, args, createdAt: `2026-09-20T09:00:0${id}Z`, attempts: 0, error,
});

beforeEach(() => {
  rpc.mockReset();
});

describe('enqueueTxn', () => {
  it('отправляет сразу и очищает очередь при успехе', async () => {
    rpc.mockResolvedValue({ data: 'uuid', error: null });
    const store = makeStore();
    await store.dispatch(enqueueTxn(args));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any типизирован как any в vitest
    expect(rpc).toHaveBeenCalledWith('app_add_txn', expect.objectContaining({ p_amount: 5, p_id: expect.any(String) }));
    expect(store.getState().offline.pending).toHaveLength(0);
  });

  it('при отсутствии сети запись остаётся в очереди', async () => {
    rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    const store = makeStore();
    await store.dispatch(enqueueTxn(args));
    const pending = store.getState().offline.pending;
    expect(pending).toHaveLength(1);
    expect(pending[0]?.error).toBeNull();
    expect(pending[0]?.attempts).toBe(1);
  });
});

describe('flushQueue', () => {
  it('сетевая ошибка прерывает обработку целиком', async () => {
    rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    const store = makeStore();
    store.dispatch(pendingSet([queued('1'), queued('2')]));
    await store.dispatch(flushQueue());
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(store.getState().offline.pending).toHaveLength(2);
  });

  it('отказ базы помечает свою запись и не мешает следующей', async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'Неизвестная категория: ххх' } })
      .mockResolvedValueOnce({ data: 'uuid', error: null });
    const store = makeStore();
    store.dispatch(pendingSet([queued('1'), queued('2')]));
    await store.dispatch(flushQueue());
    const pending = store.getState().offline.pending;
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe('1');
    expect(pending[0]?.error).toBe('Неизвестная категория: ххх');
  });

  it('отвергнутые не отправляются повторно сами', async () => {
    rpc.mockResolvedValue({ data: 'uuid', error: null });
    const store = makeStore();
    store.dispatch(pendingSet([queued('1', 'отказ')]));
    await store.dispatch(flushQueue());
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('retryTxn и removeTxn', () => {
  it('retry снимает ошибку и отправляет', async () => {
    rpc.mockResolvedValue({ data: 'uuid', error: null });
    const store = makeStore();
    store.dispatch(pendingSet([queued('1', 'отказ')]));
    await store.dispatch(retryTxn('1'));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(store.getState().offline.pending).toHaveLength(0);
  });

  it('remove удаляет запись без отправки', async () => {
    const store = makeStore();
    store.dispatch(pendingSet([queued('1', 'отказ')]));
    await store.dispatch(removeTxn('1'));
    expect(rpc).not.toHaveBeenCalled();
    expect(store.getState().offline.pending).toHaveLength(0);
  });
});
