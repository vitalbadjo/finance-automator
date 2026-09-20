import { createApi } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn } from '@reduxjs/toolkit/query';
import type { PostgrestSingleResponse } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { NETWORK_ERROR, toAppError } from './errors';
import type { AddTxnWithId, AppError, CodeRef, CodeUpsertArgs, MonthlyStat, MonthRange, MonthTxn, RuleUpsertArgs, SetCodeArgs, Settings, UpdateTxnArgs } from './types';
import { withCache, type RpcCall } from '@/offline/cache';
import { cacheStorage } from '@/offline/db';

// Один baseQuery на все функции: supabase.rpc сам подставляет JWT сессии,
// поэтому в базе запрос идёт от роли authenticated.
// Без Database-типа в createClient сигнатура rpc() возвращает `any` —
// приводим к PostgrestSingleResponse<unknown>, чтобы не работать с `any`.
const rpcBaseQuery: BaseQueryFn<RpcCall, unknown, AppError> = async ({ fn, args }) => {
  try {
    const { data, error, status } = (await supabase.rpc(
      fn,
      args ?? {},
    )) as PostgrestSingleResponse<unknown>;
    if (error) {
      // supabase-js при обрыве связи не бросает: postgrest-js ловит fetch сам
      // и возвращает обычный ответ с status 0 и английским текстом. Поэтому
      // различаем по статусу, а не по тексту сообщения.
      if (status === 0) return { error: { message: NETWORK_ERROR, transient: true } };
      // 401 — протухшая сессия (её обновят), 5xx — сервер лежит: и то и другое
      // проходит, а значит запись нельзя считать отвергнутой.
      if (status === 401 || status >= 500) return { error: { ...toAppError(error), transient: true } };
      return { error: toAppError(error) };
    }
    return { data };
  } catch (e) {
    // Брошенное исключение тоже не приговор: чаще всего это тот же обрыв связи.
    return { error: { ...toAppError(e), transient: true } };
  }
};

export const api = createApi({
  reducerPath: 'api',
  baseQuery: withCache(rpcBaseQuery, cacheStorage),
  tagTypes: ['Codes', 'Txns', 'Settings'],
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
    getMonthlyStats: build.query<MonthlyStat[], MonthRange>({
      query: ({ from, to }) => ({ fn: 'app_monthly_stats', args: { p_from: from, p_to: to } }),
      providesTags: ['Txns'],
    }),
    addTxn: build.mutation<string, AddTxnWithId>({
      query: ({ id, date, amount, currency, code, note }) => ({
        fn: 'app_add_txn',
        args: {
          p_date: date, p_amount: amount, p_currency: currency,
          p_code: code, p_note: note, p_id: id,
        },
      }),
      invalidatesTags: ['Txns'],
    }),
    updateTxn: build.mutation<string, UpdateTxnArgs>({
      query: ({ id, date, amount, currency, code, note }) => ({
        fn: 'app_update_txn',
        args: { p_id: id, p_date: date, p_amount: amount, p_currency: currency, p_code: code, p_note: note },
      }),
      invalidatesTags: ['Txns'],
    }),
    deleteTxn: build.mutation<number, string>({
      query: (id) => ({ fn: 'app_delete_txn', args: { p_id: id } }),
      invalidatesTags: ['Txns'],
    }),
    setCode: build.mutation<null, SetCodeArgs>({
      query: ({ source, id, code }) => ({
        fn: 'app_set_code',
        args: { p_source: source, p_id: id, p_code: code },
      }),
      invalidatesTags: ['Txns'],
    }),
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- стандартная сигнатура RTK Query для запроса без аргументов
    getSettings: build.query<Settings, void>({
      query: () => ({ fn: 'app_settings' }),
      providesTags: ['Settings'],
    }),
    renameSource: build.mutation<null, { code: string; title: string }>({
      query: ({ code, title }) => ({ fn: 'app_source_rename', args: { p_code: code, p_title: title } }),
      invalidatesTags: ['Settings'],
    }),
    upsertCode: build.mutation<string, CodeUpsertArgs>({
      query: ({ code, title, section, sort_order, hidden }) => ({
        fn: 'app_code_upsert',
        args: { p_code: code, p_title: title, p_section: section, p_sort_order: sort_order, p_hidden: hidden },
      }),
      invalidatesTags: ['Settings', 'Codes'],
    }),
    deleteCode: build.mutation<number, string>({
      query: (code) => ({ fn: 'app_code_delete', args: { p_code: code } }),
      invalidatesTags: ['Settings', 'Codes'],
    }),
    upsertRule: build.mutation<number, RuleUpsertArgs>({
      query: ({ id, pattern, code, priority, note }) => ({
        fn: 'app_rule_upsert',
        args: { p_id: id, p_pattern: pattern, p_code: code, p_priority: priority, p_note: note },
      }),
      invalidatesTags: ['Settings', 'Txns'],
    }),
    deleteRule: build.mutation<number, number>({
      query: (id) => ({ fn: 'app_rule_delete', args: { p_id: id } }),
      invalidatesTags: ['Settings', 'Txns'],
    }),
  }),
});

export const {
  useGetCodesQuery, useGetMonthTxnsQuery, useGetMonthlyStatsQuery,
  useAddTxnMutation, useUpdateTxnMutation, useDeleteTxnMutation, useSetCodeMutation,
  useGetSettingsQuery, useRenameSourceMutation, useUpsertCodeMutation, useDeleteCodeMutation,
  useUpsertRuleMutation, useDeleteRuleMutation,
} = api;
