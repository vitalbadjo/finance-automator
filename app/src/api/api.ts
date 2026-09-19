import { createApi } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn } from '@reduxjs/toolkit/query';
import type { PostgrestSingleResponse } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { toAppError } from './errors';
import type { AddTxnArgs, AppError, CodeRef, MonthRange, MonthTxn } from './types';

interface RpcCall {
  fn: string;
  args?: Record<string, unknown>;
}

// Один baseQuery на все функции: supabase.rpc сам подставляет JWT сессии,
// поэтому в базе запрос идёт от роли authenticated.
// Без Database-типа в createClient сигнатура rpc() возвращает `any` —
// приводим к PostgrestSingleResponse<unknown>, чтобы не работать с `any`.
const rpcBaseQuery: BaseQueryFn<RpcCall, unknown, AppError> = async ({ fn, args }) => {
  try {
    const { data, error } = (await supabase.rpc(
      fn,
      args ?? {},
    )) as PostgrestSingleResponse<unknown>;
    if (error) return { error: toAppError(error) };
    return { data };
  } catch (e) {
    return { error: toAppError(e) };
  }
};

export const api = createApi({
  reducerPath: 'api',
  baseQuery: rpcBaseQuery,
  tagTypes: ['Codes', 'Txns'],
  endpoints: (build) => ({
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- стандартная сигнатура RTK Query для запроса без аргументов
    getCodes: build.query<CodeRef[], void>({
      query: () => ({ fn: 'app_codes' }),
      providesTags: ['Codes'],
    }),
    getMonthTxns: build.query<MonthTxn[], MonthRange>({
      query: ({ from, to }) => ({ fn: 'app_month_txns', args: { p_from: from, p_to: to } }),
      providesTags: ['Txns'],
    }),
    addTxn: build.mutation<string, AddTxnArgs>({
      query: ({ date, amount, currency, code, note }) => ({
        fn: 'app_add_txn',
        args: { p_date: date, p_amount: amount, p_currency: currency, p_code: code, p_note: note },
      }),
      invalidatesTags: ['Txns'],
    }),
  }),
});

export const { useGetCodesQuery, useGetMonthTxnsQuery, useAddTxnMutation } = api;
