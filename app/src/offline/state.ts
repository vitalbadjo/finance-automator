import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { QueuedTxn } from './types';
import { hasErrors, pendingCount } from './queue';

export interface OfflineState {
  pending: QueuedTxn[];
  online: boolean;
  fromCacheAt: string | null;
  lastSyncAt: string | null;
}

export interface PendingPatch {
  id: string;
  patch: Partial<Pick<QueuedTxn, 'attempts' | 'error'>>;
}

const initialState: OfflineState = {
  pending: [],
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  fromCacheAt: null,
  lastSyncAt: null,
};

const slice = createSlice({
  name: 'offline',
  initialState,
  reducers: {
    // Замена всего списка — только для первичной загрузки из IndexedDB.
    // Все остальные писатели меняют одну запись: иначе отправка, начатая
    // до сохранения новой записи, затрёт её своим устаревшим снимком.
    pendingSet(state, action: PayloadAction<QueuedTxn[]>) {
      state.pending = action.payload;
    },
    pendingUpsert(state, action: PayloadAction<QueuedTxn>) {
      const i = state.pending.findIndex((x) => x.id === action.payload.id);
      if (i === -1) state.pending.push(action.payload);
      else state.pending[i] = action.payload;
    },
    pendingRemove(state, action: PayloadAction<string>) {
      state.pending = state.pending.filter((x) => x.id !== action.payload);
    },
    // Записи, которой уже нет (удалили, пока шла отправка), не воскрешаем.
    pendingPatch(state, action: PayloadAction<PendingPatch>) {
      const item = state.pending.find((x) => x.id === action.payload.id);
      if (!item) return;
      const { attempts, error } = action.payload.patch;
      if (attempts !== undefined) item.attempts = attempts;
      if ('error' in action.payload.patch) item.error = error ?? null;
    },
    onlineSet(state, action: PayloadAction<boolean>) {
      state.online = action.payload;
    },
    // Ответ пришёл из кэша: показываем, что данные несвежие.
    cacheHit(state, action: PayloadAction<string>) {
      state.fromCacheAt = action.payload;
    },
    // Любой свежий ответ снимает отметку: сеть вернулась.
    freshHit(state, action: PayloadAction<string>) {
      state.fromCacheAt = null;
      state.lastSyncAt = action.payload;
    },
  },
});

export const { pendingSet, pendingUpsert, pendingRemove, pendingPatch, onlineSet, cacheHit, freshHit } =
  slice.actions;
export const offlineReducer = slice.reducer;

interface WithOffline {
  offline: OfflineState;
}

export const selectPending = (s: WithOffline): QueuedTxn[] => s.offline.pending;
export const selectPendingCount = (s: WithOffline): number => pendingCount(s.offline.pending);
export const selectHasErrors = (s: WithOffline): boolean => hasErrors(s.offline.pending);
export const selectFromCacheAt = (s: WithOffline): string | null => s.offline.fromCacheAt;
