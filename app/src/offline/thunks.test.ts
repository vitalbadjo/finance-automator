import { makeStore } from '@/app/store';
import { enqueueTxn, flushQueue, newId, removeTxn, retryTxn, uuidFromRandomValues } from './thunks';
import { pendingSet } from './state';
import type { QueuedTxn } from './types';

const rpc = vi.fn();
vi.mock('@/api/supabase', () => ({
  supabase: { rpc: (...a: unknown[]): unknown => rpc(...a), auth: { signOut: vi.fn() } },
}));

// IndexedDB в jsdom нет, а проверять надо и то, что осело в хранилище.
const stored = vi.hoisted(() => new Map<string, unknown>());
vi.mock('./db', () => ({
  queueStorage: {
    all: () => Promise.resolve([...stored.values()]),
    put: (item: QueuedTxn) => {
      stored.set(item.id, item);
      return Promise.resolve();
    },
    remove: (id: string) => {
      stored.delete(id);
      return Promise.resolve();
    },
  },
  cacheStorage: { get: () => Promise.resolve(null), set: () => Promise.resolve() },
}));

const args = { date: '2026-09-20', amount: 5, currency: 'USD', code: 'каф', note: null };
const queued = (id: string, error: string | null = null): QueuedTxn => ({
  id, args, createdAt: `2026-09-20T09:00:0${id}Z`, attempts: 0, error,
});

// Реальный ответ supabase-js при обрыве связи: postgrest-js ловит fetch сам
// и резолвит обычный ответ со status 0, ничего не бросая.
const transportFailure = {
  data: null,
  error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' },
  status: 0,
};

const deferred = <T>(): { promise: Promise<T>; resolve: (v: T) => void } => {
  let resolve: (v: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

beforeEach(() => {
  rpc.mockReset();
  stored.clear();
});

describe('enqueueTxn', () => {
  it('отправляет сразу и очищает очередь при успехе', async () => {
    rpc.mockResolvedValue({ data: 'uuid', error: null, status: 200 });
    const store = makeStore();
    await store.dispatch(enqueueTxn(args));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any типизирован как any в vitest
    expect(rpc).toHaveBeenCalledWith('app_add_txn', expect.objectContaining({ p_amount: 5, p_id: expect.any(String) }));
    expect(store.getState().offline.pending).toHaveLength(0);
    expect([...stored.keys()]).toHaveLength(0);
  });

  it('при брошенной сетевой ошибке запись остаётся в очереди', async () => {
    rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    const store = makeStore();
    await store.dispatch(enqueueTxn(args));
    const pending = store.getState().offline.pending;
    expect(pending).toHaveLength(1);
    expect(pending[0]?.error).toBeNull();
    expect(pending[0]?.attempts).toBe(1);
  });

  it('при обрыве связи (status 0, ошибка без исключения) запись остаётся в очереди', async () => {
    rpc.mockResolvedValue(transportFailure);
    const store = makeStore();
    await store.dispatch(enqueueTxn(args));
    const pending = store.getState().offline.pending;
    expect(pending).toHaveLength(1);
    expect(pending[0]?.error).toBeNull();
    expect(pending[0]?.attempts).toBe(1);
    // И запись сохранена на диск до отправки, а не после.
    expect([...stored.keys()]).toHaveLength(1);
  });
});

describe('flushQueue', () => {
  it('брошенная сетевая ошибка прерывает обработку целиком', async () => {
    rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    const store = makeStore();
    store.dispatch(pendingSet([queued('1'), queued('2')]));
    await store.dispatch(flushQueue());
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(store.getState().offline.pending).toHaveLength(2);
  });

  it('обрыв связи со status 0 прерывает обработку целиком', async () => {
    rpc.mockResolvedValue(transportFailure);
    const store = makeStore();
    store.dispatch(pendingSet([queued('1'), queued('2')]));
    await store.dispatch(flushQueue());
    expect(rpc).toHaveBeenCalledTimes(1);
    const pending = store.getState().offline.pending;
    expect(pending).toHaveLength(2);
    expect(pending.every((i) => i.error === null)).toBe(true);
  });

  it('протухшая сессия (401) не отвергает запись', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'JWT expired', details: '', hint: '', code: 'PGRST301' },
      status: 401,
    });
    const store = makeStore();
    store.dispatch(pendingSet([queued('1'), queued('2')]));
    await store.dispatch(flushQueue());
    expect(rpc).toHaveBeenCalledTimes(1);
    const pending = store.getState().offline.pending;
    expect(pending).toHaveLength(2);
    expect(pending[0]?.error).toBeNull();
    expect(pending[0]?.attempts).toBe(1);
  });

  it('отказ базы помечает свою запись и не мешает следующей', async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'Неизвестная категория: ххх' }, status: 400 })
      .mockResolvedValueOnce({ data: 'uuid', error: null, status: 200 });
    const store = makeStore();
    store.dispatch(pendingSet([queued('1'), queued('2')]));
    await store.dispatch(flushQueue());
    const pending = store.getState().offline.pending;
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe('1');
    expect(pending[0]?.error).toBe('Неизвестная категория: ххх');
  });

  it('отвергнутые не отправляются повторно сами', async () => {
    rpc.mockResolvedValue({ data: 'uuid', error: null, status: 200 });
    const store = makeStore();
    store.dispatch(pendingSet([queued('1', 'отказ')]));
    await store.dispatch(flushQueue());
    expect(rpc).not.toHaveBeenCalled();
  });

  it('запись, сохранённая во время отправки, не теряется', async () => {
    const gate = deferred<{ data: string; error: null; status: number }>();
    rpc.mockImplementationOnce(() => gate.promise).mockResolvedValue({ data: 'uuid', error: null, status: 200 });
    const store = makeStore();
    store.dispatch(pendingSet([queued('1')]));

    const flush = store.dispatch(flushQueue());
    const enqueue = store.dispatch(enqueueTxn(args));
    gate.resolve({ data: 'uuid', error: null, status: 200 });
    await flush;
    await enqueue;

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(store.getState().offline.pending).toHaveLength(0);
    expect([...stored.keys()]).toHaveLength(0);
  });

  it('удаление во время отправки не воскрешает запись', async () => {
    const gate = deferred<{ data: null; error: { message: string }; status: number }>();
    rpc.mockImplementation(() => gate.promise);
    const store = makeStore();
    const item = queued('1');
    stored.set(item.id, item);
    store.dispatch(pendingSet([item]));

    const flush = store.dispatch(flushQueue());
    await store.dispatch(removeTxn('1'));
    gate.resolve({ data: null, error: { message: 'Неизвестная категория: ххх' }, status: 400 });
    await flush;

    expect(store.getState().offline.pending).toHaveLength(0);
    expect(stored.has('1')).toBe(false);
  });
});

describe('retryTxn и removeTxn', () => {
  it('retry снимает ошибку и отправляет', async () => {
    rpc.mockResolvedValue({ data: 'uuid', error: null, status: 200 });
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

describe('id записи', () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('запасной генератор даёт uuid v4, который примет база', () => {
    for (let i = 0; i < 50; i++) expect(uuidFromRandomValues()).toMatch(UUID_V4);
  });

  it('newId работает и без crypto.randomUUID', () => {
    const real = crypto.randomUUID.bind(crypto);
    try {
      // @ts-expect-error — проверяем окружение без randomUUID (не-secure context)
      crypto.randomUUID = undefined;
      expect(newId()).toMatch(UUID_V4);
    } finally {
      crypto.randomUUID = real;
    }
  });
});
