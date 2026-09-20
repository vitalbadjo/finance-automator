import type { BaseQueryApi, BaseQueryFn } from '@reduxjs/toolkit/query';
import type { AppError } from '@/api/types';
import { NETWORK_ERROR } from '@/api/errors';
import { memoryCacheStorage } from './memoryStorage';
import { withCache, type RpcCall } from './cache';
import { cacheHit, freshHit } from './state';

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
