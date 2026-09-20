import { createAsyncThunk } from '@reduxjs/toolkit';
import { api } from '@/api/api';
import { isTransient } from '@/api/errors';
import type { AddTxnArgs, AppError } from '@/api/types';
import { queueStorage } from './db';
import { nextToSend } from './queue';
import { pendingPatch, pendingRemove, pendingSet, pendingUpsert } from './state';
import type { QueuedTxn, SendOutcome } from './types';

interface OfflineRootState {
  offline: { pending: QueuedTxn[] };
}

// Ошибка мутации приходит либо от baseQuery (AppError — есть message,
// может быть отметка transient), либо как SerializedError от самого
// RTK Query (message опционален).
const errorMessage = (error: unknown): string => {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim() !== '') return m;
  }
  return 'Неизвестная ошибка';
};

const asAppError = (error: unknown): AppError => {
  const message = errorMessage(error);
  if (typeof error === 'object' && error !== null && 'transient' in error && error.transient === true) {
    return { message, transient: true };
  }
  return { message };
};

// crypto.randomUUID есть не везде (не-secure context, старые webview),
// а id записи нужен до отправки — собираем uuid v4 из случайных байт сами.
export const uuidFromRandomValues = (): string => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const newId = (): string =>
  typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : uuidFromRandomValues();

// Одна отправка за раз: две параллельные съели бы одну и ту же запись дважды.
let flushing = false;

// eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- стандартная сигнатура createAsyncThunk без аргументов
export const loadQueue = createAsyncThunk('offline/load', async (_: void, { dispatch, getState }) => {
  const stored = await queueStorage.all();
  // Пока читали IndexedDB, пользователь мог что-то сохранить: объединяем
  // по id, состояние в сторе новее хранилища и побеждает.
  const byId = new Map(stored.map((i) => [i.id, i] as const));
  for (const i of (getState() as OfflineRootState).offline.pending) byId.set(i.id, i);
  dispatch(pendingSet([...byId.values()]));
});

// eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- стандартная сигнатура createAsyncThunk без аргументов
export const flushQueue = createAsyncThunk('offline/flush', async (_: void, { dispatch, getState }) => {
  if (flushing) return;
  flushing = true;
  let sentAny = false;
  try {
    for (;;) {
      const item = nextToSend((getState() as OfflineRootState).offline.pending);
      if (!item) break;

      const handle = dispatch(api.endpoints.addTxn.initiate({ ...item.args, id: item.id }));
      let outcome: SendOutcome;
      try {
        const res = await handle;
        if (res.error) {
          const appError = asAppError(res.error);
          outcome = isTransient(appError) ? { kind: 'network' } : { kind: 'rejected', message: appError.message };
        } else {
          outcome = { kind: 'ok' };
          sentAny = true;
        }
      } finally {
        // Результат мутации в кэше RTK Query больше не нужен: подписчиков
        // у неё нет, а без reset запись висит до истечения grace period.
        handle.reset();
      }

      // Пока шла отправка, список мог измениться: запись могли удалить,
      // а рядом могли появиться новые. Поэтому правим одну запись, а не
      // подменяем весь список снимком, сделанным до await.
      if (outcome.kind === 'ok') {
        dispatch(pendingRemove(item.id));
        void queueStorage.remove(item.id);
      } else {
        dispatch(
          pendingPatch({
            id: item.id,
            patch: { attempts: item.attempts + 1, ...(outcome.kind === 'rejected' ? { error: outcome.message } : {}) },
          }),
        );
        // В хранилище пишем то, что осталось в очереди: если запись успели
        // удалить, воскрешать её нельзя.
        const after = (getState() as OfflineRootState).offline.pending.find((i) => i.id === item.id);
        if (after) void queueStorage.put(after);
      }
      if (outcome.kind === 'network') break;
    }
  } finally {
    flushing = false;
  }
  if (!sentAny) return;

  // Инвалидация откладывается, пока есть запросы в полёте
  // (invalidationBehavior: 'delayed'), а перезапрос запроса, который ещё не
  // ответил, RTK Query отбрасывает условием queryThunk — отложенная метка
  // при этом уже потрачена, и списка обновления не будет. На старте месяц и
  // справочник как раз в полёте, поэтому сначала дожидаемся их, а потом
  // инвалидируем: к этому моменту перезапрашивать уже есть что.
  await Promise.all(dispatch(api.util.getRunningQueriesThunk()));
  dispatch(api.util.invalidateTags(['Txns']));
});

export const enqueueTxn = createAsyncThunk('offline/enqueue', async (args: AddTxnArgs, { dispatch }) => {
  const item: QueuedTxn = {
    id: newId(),
    args,
    createdAt: new Date().toISOString(),
    attempts: 0,
    error: null,
  };
  dispatch(pendingUpsert(item));
  // Сначала UI, потом диск: но отправку начинаем только после записи в
  // IndexedDB, иначе приложение, закрытое сразу после сохранения, потеряет
  // запись вместе с неотправленным запросом.
  await queueStorage.put(item);
  await dispatch(flushQueue());
  return item.id;
});

export const retryTxn = createAsyncThunk('offline/retry', async (id: string, { dispatch, getState }) => {
  dispatch(pendingPatch({ id, patch: { error: null } }));
  const item = (getState() as OfflineRootState).offline.pending.find((i) => i.id === id);
  if (item) void queueStorage.put(item);
  await dispatch(flushQueue());
});

export const removeTxn = createAsyncThunk('offline/remove', (id: string, { dispatch }) => {
  dispatch(pendingRemove(id));
  void queueStorage.remove(id);
});
