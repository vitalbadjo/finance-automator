import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { QueuedTxn } from './types';
import { hasErrors, pendingCount } from './queue';

export interface OfflineState {
  pending: QueuedTxn[];
  online: boolean;
  fromCacheAt: string | null;
  lastSyncAt: string | null;
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
    pendingSet(state, action: PayloadAction<QueuedTxn[]>) {
      state.pending = action.payload;
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

export const { pendingSet, onlineSet, cacheHit, freshHit } = slice.actions;
export const offlineReducer = slice.reducer;

interface WithOffline {
  offline: OfflineState;
}

export const selectPending = (s: WithOffline): QueuedTxn[] => s.offline.pending;
export const selectPendingCount = (s: WithOffline): number => pendingCount(s.offline.pending);
export const selectHasErrors = (s: WithOffline): boolean => hasErrors(s.offline.pending);
export const selectFromCacheAt = (s: WithOffline): string | null => s.offline.fromCacheAt;
