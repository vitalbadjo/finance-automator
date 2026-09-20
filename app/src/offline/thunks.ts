import { createAsyncThunk } from '@reduxjs/toolkit';
import { api } from '@/api/api';
import { NETWORK_ERROR } from '@/api/errors';
import type { AddTxnArgs } from '@/api/types';
import { queueStorage } from './db';
import { applyOutcome, nextToSend } from './queue';
import { pendingSet } from './state';
import type { QueuedTxn, SendOutcome } from './types';

interface OfflineRootState {
  offline: { pending: QueuedTxn[] };
}

// Ошибка мутации приходит либо от baseQuery (AppError — есть message),
// либо как SerializedError от самого RTK Query (message опционален).
const errorMessage = (error: unknown): string => {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim() !== '') return m;
  }
  return 'Неизвестная ошибка';
};

// Одна отправка за раз: две параллельные съели бы одну и ту же запись дважды.
let flushing = false;

const persist = (items: QueuedTxn[], removed: string[]): void => {
  void Promise.all([...items.map((i) => queueStorage.put(i)), ...removed.map((id) => queueStorage.remove(id))]);
};

// eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- стандартная сигнатура createAsyncThunk без аргументов
export const loadQueue = createAsyncThunk('offline/load', async (_: void, { dispatch }) => {
  const items = await queueStorage.all();
  dispatch(pendingSet(items));
});

// eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- стандартная сигнатура createAsyncThunk без аргументов
export const flushQueue = createAsyncThunk('offline/flush', async (_: void, { dispatch, getState }) => {
  if (flushing) return;
  flushing = true;
  try {
    let sentAny = false;
    for (;;) {
      const items = (getState() as OfflineRootState).offline.pending;
      const item = nextToSend(items);
      if (!item) break;

      const res = await dispatch(api.endpoints.addTxn.initiate({ ...item.args, id: item.id }));
      let outcome: SendOutcome;
      if (res.error) {
        const message = errorMessage(res.error);
        outcome = message === NETWORK_ERROR ? { kind: 'network' } : { kind: 'rejected', message };
      } else {
        outcome = { kind: 'ok' };
        sentAny = true;
      }

      const next = applyOutcome(items, item.id, outcome);
      dispatch(pendingSet(next));
      persist(
        next.filter((i) => i.id === item.id),
        outcome.kind === 'ok' ? [item.id] : [],
      );
      if (outcome.kind === 'network') break;
    }
    if (sentAny) dispatch(api.util.invalidateTags(['Txns']));
  } finally {
    flushing = false;
  }
});

export const enqueueTxn = createAsyncThunk('offline/enqueue', async (args: AddTxnArgs, { dispatch, getState }) => {
  const item: QueuedTxn = {
    id: crypto.randomUUID(),
    args,
    createdAt: new Date().toISOString(),
    attempts: 0,
    error: null,
  };
  const items = [...(getState() as OfflineRootState).offline.pending, item];
  dispatch(pendingSet(items));
  persist([item], []);
  await dispatch(flushQueue());
});

export const retryTxn = createAsyncThunk('offline/retry', async (id: string, { dispatch, getState }) => {
  const items = (getState() as OfflineRootState).offline.pending.map((i) =>
    i.id === id ? { ...i, error: null } : i,
  );
  dispatch(pendingSet(items));
  persist(
    items.filter((i) => i.id === id),
    [],
  );
  await dispatch(flushQueue());
});

export const removeTxn = createAsyncThunk('offline/remove', (id: string, { dispatch, getState }) => {
  const items = (getState() as OfflineRootState).offline.pending.filter((i) => i.id !== id);
  dispatch(pendingSet(items));
  persist([], [id]);
});
