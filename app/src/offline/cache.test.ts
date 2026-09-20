import type { BaseQueryApi, BaseQueryFn } from '@reduxjs/toolkit/query';
import type { AppError } from '@/api/types';
import { NETWORK_ERROR } from '@/api/errors';
import { api } from '@/api/api';
import { makeStore } from '@/app/store';
import { memoryCacheStorage } from './memoryStorage';
import { withCache, type RpcCall } from './cache';
import { cacheHit, freshHit } from './state';

const rpc = vi.fn();
vi.mock('@/api/supabase', () => ({
  supabase: { rpc: (...a: unknown[]): unknown => rpc(...a), auth: { signOut: vi.fn() } },
}));

// В jsdom нет IndexedDB — подменяем хранилище, которое зашито в api.ts.
const rows = vi.hoisted(() => new Map<string, { value: unknown; at: string }>());
vi.mock('@/offline/db', () => ({
  cacheStorage: {
    get: (key: string) => Promise.resolve(rows.get(key) ?? null),
    set: (key: string, value: unknown) => {
      rows.set(key, { value, at: '2026-09-20T15:40:00Z' });
      return Promise.resolve();
    },
  },
  queueStorage: { all: () => Promise.resolve([]), put: () => Promise.resolve(), remove: () => Promise.resolve() },
}));

const apiFor = (type: 'query' | 'mutation', dispatch = vi.fn()): BaseQueryApi =>
  ({ type, dispatch, getState: () => ({}), signal: new AbortController().signal, abort: vi.fn(), extra: undefined, endpoint: 'x' });

const call: RpcCall = { fn: 'app_codes' };

describe('withCache', () => {
  it('успешный ответ запроса пишется в кэш и снимает отметку', async () => {
    const storage = memoryCacheStorage();
    const dispatch = vi.fn();
    const base: BaseQueryFn<RpcCall, unknown, AppError> = () => Promise.resolve({ data: [1, 2] });
    const wrapped = withCache(base, storage);

    await wrapped(call, apiFor('query', dispatch), {});

    expect(await storage.get('app_codes|{}')).not.toBeNull();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: freshHit.type }));
  });

  it('при сетевой ошибке отдаёт кэш и ставит отметку', async () => {
    const storage = memoryCacheStorage();
    await storage.set('app_codes|{}', [1, 2]);
    const dispatch = vi.fn();
    const base: BaseQueryFn<RpcCall, unknown, AppError> = () => Promise.resolve({ error: { message: NETWORK_ERROR } });
    const wrapped = withCache(base, storage);

    const res = await wrapped(call, apiFor('query', dispatch), {});

    expect(res).toEqual({ data: [1, 2] });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: cacheHit.type }));
  });

  it('при протухшей сессии (transient) тоже отдаёт кэш', async () => {
    const storage = memoryCacheStorage();
    await storage.set('app_codes|{}', [1, 2]);
    const dispatch = vi.fn();
    // Так выглядит ошибка 401 после rpcBaseQuery: текст свой, но временная.
    const base: BaseQueryFn<RpcCall, unknown, AppError> = () =>
      Promise.resolve({ error: { message: 'JWT expired', transient: true } });

    const res = await withCache(base, storage)(call, apiFor('query', dispatch), {});

    expect(res).toEqual({ data: [1, 2] });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: cacheHit.type }));
  });

  it('без кэша отдаёт исходную ошибку', async () => {
    const base: BaseQueryFn<RpcCall, unknown, AppError> = () => Promise.resolve({ error: { message: NETWORK_ERROR } });
    const res = await withCache(base, memoryCacheStorage())(call, apiFor('query'), {});
    expect(res).toEqual({ error: { message: NETWORK_ERROR } });
  });

  it('ошибка базы кэш не трогает', async () => {
    const storage = memoryCacheStorage();
    await storage.set('app_codes|{}', [1, 2]);
    const base: BaseQueryFn<RpcCall, unknown, AppError> = () => Promise.resolve({ error: { message: 'Неизвестная категория' } });
    const res = await withCache(base, storage)(call, apiFor('query'), {});
    expect(res).toEqual({ error: { message: 'Неизвестная категория' } });
  });

  it('мутации не кэшируются и из кэша не отвечают', async () => {
    const storage = memoryCacheStorage();
    await storage.set('app_add_txn|{}', 'старое');
    const base: BaseQueryFn<RpcCall, unknown, AppError> = () => Promise.resolve({ error: { message: NETWORK_ERROR } });
    const res = await withCache(base, storage)({ fn: 'app_add_txn' }, apiFor('mutation'), {});
    expect(res).toEqual({ error: { message: NETWORK_ERROR } });
  });
});

describe('withCache поверх настоящего rpcBaseQuery', () => {
  beforeEach(() => {
    rpc.mockReset();
    rows.clear();
  });

  it('обрыв связи (status 0) отдаёт последний успешный ответ', async () => {
    const store = makeStore();
    rpc.mockResolvedValueOnce({ data: [{ code: 'каф', title: 'Кафе', section: 'Комфорт', sort_order: 1 }], error: null, status: 200 });
    await store.dispatch(api.endpoints.getCodes.initiate());

    // Настоящий ответ supabase-js при обрыве связи: исключения нет, status 0.
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' },
      status: 0,
    });
    const res = await store.dispatch(api.endpoints.getCodes.initiate(undefined, { forceRefetch: true }));

    expect(res.data).toEqual([{ code: 'каф', title: 'Кафе', section: 'Комфорт', sort_order: 1 }]);
    expect(store.getState().offline.fromCacheAt).toBe('2026-09-20T15:40:00Z');
  });
});
