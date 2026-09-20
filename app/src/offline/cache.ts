import type { BaseQueryFn } from '@reduxjs/toolkit/query';
import type { AppError } from '@/api/types';
import { NETWORK_ERROR } from '@/api/errors';
import type { CacheStorage } from './types';
import { cacheHit, freshHit } from './state';

export interface RpcCall {
  fn: string;
  args?: Record<string, unknown>;
}

const keyOf = ({ fn, args }: RpcCall): string => `${fn}|${JSON.stringify(args ?? {})}`;

// Кэш только для чтения: api.type различает query и mutation, поэтому
// список функций перечислять не нужно. Мутации не кэшируются никогда —
// ответ «из кэша» на запись означал бы, что запись потерялась.
export function withCache(
  base: BaseQueryFn<RpcCall, unknown, AppError>,
  storage: CacheStorage,
): BaseQueryFn<RpcCall, unknown, AppError> {
  return async (args, api, extraOptions) => {
    const result = await base(args, api, extraOptions);

    if (api.type !== 'query') return result;

    if ('error' in result && result.error) {
      if (result.error.message !== NETWORK_ERROR) return result;
      const cached = await storage.get(keyOf(args));
      if (!cached) return result;
      api.dispatch(cacheHit(cached.at));
      return { data: cached.value };
    }

    if ('data' in result) {
      await storage.set(keyOf(args), result.data);
      api.dispatch(freshHit(new Date().toISOString()));
    }
    return result;
  };
}
