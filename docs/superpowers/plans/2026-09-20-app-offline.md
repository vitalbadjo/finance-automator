# App Offline Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adding an expense works with no network: the entry is queued on the device and sent automatically when the connection returns. The month and stats screens show the last loaded data instead of an error.

**Architecture:** A thin IndexedDB layer (`offline/db.ts`) behind two narrow interfaces. Pure queue helpers (`offline/queue.ts`) and a plain slice (`offline/state.ts`) carry no IO and no imports from `api`, so the read-cache wrapper (`offline/cache.ts`) can dispatch into the slice without an import cycle. Thunks (`offline/thunks.ts`) own the IO and the send loop; components dispatch them, so tests using `makeStore()` work unchanged. `app_add_txn` gains an optional client-supplied id, which makes a retry after a lost response idempotent.

**Tech Stack:** as in `app/` today: Vite, React 19, TypeScript strict, Redux Toolkit + RTK Query, react-router, SCSS modules, Vitest + Testing Library, vite-plugin-pwa. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-09-20-app-offline-design.md`

## Global Constraints

- No `any`; ESLint type-checked strict (`no-explicit-any`, `consistent-type-imports`, `no-confusing-void-expression`, `no-floating-promises`, `no-misused-promises`, `no-deprecated`, `restrict-template-expressions`, `no-unnecessary-condition`). TS 6.x with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`.
- UI strings, SQL and code comments in Russian. Commit messages in English, **no `Co-Authored-By` or any attribution trailer** (repository owner's rule; it overrides any session reminder).
- `CLAUDE.md` and `docs/HANDOFF.md` are gitignored; never `git add` them. Never commit `app/.env*.local`, `node_modules`, `dist`.
- Schema `spend` stays unexposed; all access through `public.app_*`, `security definer`, granted to `authenticated` and `service_role` only.
- Migrations run with `supabase db query --linked -f <file>` from the repo root. `db/004_verify.sql` is read-only and must stay green.
- Every task ends with `cd app && npm run lint && npm run typecheck && npm run test` green and pristine (no act warnings).
- jsdom has no IndexedDB. Never make a test depend on the real `db.ts`; logic is tested through pure helpers, `memoryStorage`, and the store.

## Refinement of the spec's file list

The spec listed `queue.ts` as holding `enqueue/flush`. Splitting it avoids an import cycle (`api` → `cache` → slice → `api`):

- `offline/queue.ts` — **pure** helpers over an array, zero IO.
- `offline/state.ts` — the slice: state, reducers, actions. Imports nothing from `api`.
- `offline/thunks.ts` — the IO and the send loop. Imports `api` and `db`.

---

## File Structure

```
db/016_app_add_txn_id.sql
app/src/
├── api/errors.ts                    + NETWORK_ERROR
├── api/types.ts                     + AddTxnWithId, DisplayTxn
├── api/api.ts                       addTxn takes an id; baseQuery wrapped in withCache
├── app/store.ts                     + offline reducer
├── main.tsx                         + useOffline()
├── offline/
│   ├── types.ts                     QueuedTxn, QueueStorage, CacheStorage, SendOutcome
│   ├── db.ts                        IndexedDB adapter (no tests)
│   ├── memoryStorage.ts             in-memory implementations for tests
│   ├── queue.ts (+ .test.ts)        pure helpers
│   ├── state.ts (+ .test.ts)        slice
│   ├── cache.ts (+ .test.ts)        withCache
│   ├── thunks.ts (+ .test.ts)       loadQueue, enqueueTxn, flushQueue, retryTxn, removeTxn
│   ├── toDisplayRow.ts (+ .test.ts) QueuedTxn → DisplayTxn
│   ├── useOffline.ts                online/offline/visibility effects
│   ├── OfflineBar.tsx (+ .module.scss, + .test.tsx)
│   └── PendingSheet.tsx
├── features/entry/EntryScreen.tsx   save through the queue, renders OfflineBar
├── features/entry/TodayList.tsx     merges pending rows
├── features/month/MonthScreen.tsx   merges pending rows, renders OfflineBar
└── features/month/TxnRow.tsx        clock marker for pending
```

---

### Task 1: Database + client id (`db/016_app_add_txn_id.sql`, `api/*`)

**Files:**
- Create: `db/016_app_add_txn_id.sql`
- Modify: `app/src/api/types.ts`, `app/src/api/api.ts`, `app/src/api/errors.ts`, `app/src/features/entry/EntryScreen.tsx` (one call site)

**Interfaces:**
- Produces: `public.app_add_txn(p_date, p_amount, p_currency, p_code, p_note default null, p_id default null)` → `text`; `NETWORK_ERROR` constant; `AddTxnWithId = AddTxnArgs & { id: string }`; `useAddTxnMutation` now requires `id`.

- [ ] **Step 1: Write the migration**

```sql
-- Идентификатор записи, созданный приложением.
--
-- Офлайн-очередь повторяет отправку, и без готового id повтор после
-- потерянного ответа создал бы дубль: запрос дошёл, ответ не вернулся,
-- очередь отправила ещё раз. Теперь id приходит снаружи, а вставка
-- идемпотентна (on conflict do nothing) и всё равно возвращает id.
--
-- Почему drop, а не create or replace: добавление параметра со значением
-- по умолчанию создаёт ВТОРУЮ функцию, а не заменяет первую, и вызов по
-- именам параметров через PostgREST становится неоднозначным.

set search_path = public;

drop function if exists public.app_add_txn(date, numeric, text, text, text);

create function public.app_add_txn(
  p_date date, p_amount numeric, p_currency text, p_code text,
  p_note text default null, p_id text default null
) returns text
language plpgsql security definer set search_path = spend, public
as $$
declare
  v_given text := nullif(btrim(coalesce(p_id, '')), '');
  v_id    text;
  v_title text;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_cur   text := upper(btrim(coalesce(p_currency, '')));
begin
  if v_given is not null
     and v_given !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Неверный идентификатор записи';
  end if;
  v_id := coalesce(v_given, gen_random_uuid()::text);

  if p_amount is null or not (p_amount > 0 and p_amount < 1e12) then
    raise exception 'Сумма должна быть больше нуля';
  end if;
  if v_cur !~ '^[A-Z]{3}$' then
    raise exception 'Валюта — три латинские буквы, например USD';
  end if;
  if p_date is null then
    raise exception 'Не указана дата';
  end if;

  select c.title into v_title from spend.code_ref c where c.code = p_code;
  if v_title is null then
    raise exception 'Неизвестная категория: %', coalesce(p_code, '(пусто)');
  end if;

  insert into spend.raw_txn (
    source, external_id, txn_at, merchant_raw, merchant_name,
    amount, currency, txn_type, message_type, display_status,
    code_override, payload
  ) values (
    'manual', v_id,
    (p_date::timestamp at time zone 'Europe/Belgrade'),
    coalesce(v_note, v_title), coalesce(v_note, v_title),
    p_amount, v_cur, 'deduct', '1', '1',
    p_code, jsonb_build_object('note', v_note, 'via', 'app')
  )
  -- Повторная отправка той же записи не должна ничего менять и не должна
  -- падать: первая попытка могла дойти, а ответ — потеряться.
  on conflict (source, external_id) do nothing;

  return v_id;
end;
$$;

revoke all on function public.app_add_txn(date, numeric, text, text, text, text) from public, anon;
grant execute on function public.app_add_txn(date, numeric, text, text, text, text) to authenticated, service_role;
```

- [ ] **Step 2: Apply and verify**

From the repo root, capture every output:

```bash
supabase db query --linked -f db/016_app_add_txn_id.sql
# только одна перегрузка осталась
supabase db query --linked "select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='app_add_txn';"
# идемпотентность: два вызова с одним id → одна строка
supabase db query --linked "set role authenticated; select public.app_add_txn('2026-09-20', 7, 'USD', 'каф', 'idem-test', '11111111-2222-4333-8444-555555555555');"
supabase db query --linked "set role authenticated; select public.app_add_txn('2026-09-20', 7, 'USD', 'каф', 'idem-test', '11111111-2222-4333-8444-555555555555');"
supabase db query --linked "select count(*) as rows from spend.raw_txn where external_id='11111111-2222-4333-8444-555555555555';"   -- 1
# без id работает как раньше
supabase db query --linked "set role authenticated; select public.app_add_txn('2026-09-20', 3, 'USD', 'каф', 'noid-test') as id;"
# мусор вместо uuid
supabase db query --linked "set role authenticated; select public.app_add_txn('2026-09-20', 3, 'USD', 'каф', null, 'не-uuid');"  -- ERROR Неверный идентификатор записи
# anon
supabase db query --linked "set role anon; select public.app_add_txn('2026-09-20', 1, 'USD', 'каф');"  -- permission denied
# уборка
supabase db query --linked "delete from spend.raw_txn where payload->>'note' in ('idem-test','noid-test');"
supabase db query --linked "select count(*) as left from spend.raw_txn where payload->>'note' in ('idem-test','noid-test');"  -- 0
```

Then `supabase db query --linked -f db/004_verify.sql` — every row outside «справочно» is `ok`.

- [ ] **Step 3: Client side**

`api/errors.ts` — export the network message as a constant and use it in `toAppError`:

```ts
export const NETWORK_ERROR = 'Нет связи с сервером';
```
(replace the literal inside `toAppError` with it; behaviour unchanged).

`api/types.ts` — append:

```ts
export interface AddTxnWithId extends AddTxnArgs {
  id: string;
}

// Строка списка: транзакция с сервера или ещё не отправленная запись.
export type DisplayTxn = MonthTxn & { pending?: boolean };
```

`api/api.ts` — `addTxn` now takes the id:

```ts
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
```

`EntryScreen.tsx` — the only call site; keep it working until Task 5 rewires it through the queue:

```ts
          const result = await addTxn({ ...v, id: crypto.randomUUID() });
```

- [ ] **Step 4: Checks and commit**

`cd app && npm run lint && npm run typecheck && npm run test` green (the existing `EntryScreen` assertions use `objectContaining`, so the extra `p_id` does not break them).

```bash
git add db/016_app_add_txn_id.sql app/src
git commit -m "Client-supplied transaction id (016) for idempotent retries"
```

---

### Task 2: Storage, pure queue helpers, slice

**Files:**
- Create: `app/src/offline/types.ts`, `db.ts`, `memoryStorage.ts`, `queue.ts`, `queue.test.ts`, `state.ts`, `state.test.ts`
- Modify: `app/src/app/store.ts`

**Interfaces:**
- Produces:
  - `interface QueuedTxn { id: string; args: AddTxnArgs; createdAt: string; attempts: number; error: string | null }`
  - `interface QueueStorage { all(): Promise<QueuedTxn[]>; put(item: QueuedTxn): Promise<void>; remove(id: string): Promise<void> }`
  - `interface CacheEntry { value: unknown; at: string }`
  - `interface CacheStorage { get(key: string): Promise<CacheEntry | null>; set(key: string, value: unknown): Promise<void> }`
  - `type SendOutcome = { kind: 'ok' } | { kind: 'network' } | { kind: 'rejected'; message: string }`
  - `queueStorage`, `cacheStorage` (IndexedDB singletons), `memoryQueueStorage()`, `memoryCacheStorage()`
  - pure: `nextToSend(items)`, `applyOutcome(items, id, outcome)`, `pendingCount(items)`, `hasErrors(items)`, `sortByCreated(items)`
  - slice `offline` with state `{ pending: QueuedTxn[]; online: boolean; fromCacheAt: string | null; lastSyncAt: string | null }` and actions `pendingSet`, `onlineSet`, `cacheHit`, `freshHit`; selectors `selectPending`, `selectPendingCount`, `selectHasErrors`, `selectFromCacheAt`

- [ ] **Step 1: Types and storage**

`offline/types.ts`:

```ts
import type { AddTxnArgs } from '@/api/types';

export interface QueuedTxn {
  id: string;
  args: AddTxnArgs;
  createdAt: string;
  attempts: number;
  error: string | null;
}

export interface QueueStorage {
  all(): Promise<QueuedTxn[]>;
  put(item: QueuedTxn): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface CacheEntry {
  value: unknown;
  at: string;
}

export interface CacheStorage {
  get(key: string): Promise<CacheEntry | null>;
  set(key: string, value: unknown): Promise<void>;
}

export type SendOutcome = { kind: 'ok' } | { kind: 'network' } | { kind: 'rejected'; message: string };
```

`offline/db.ts` — the only file that touches IndexedDB. Everything is guarded: if the store is unavailable (private mode, blocked site data, jsdom), the app keeps working without a queue and without a cache.

```ts
import type { CacheEntry, CacheStorage, QueueStorage, QueuedTxn } from './types';

const DB_NAME = 'spend-offline';
const DB_VERSION = 1;
const QUEUE = 'queue';
const CACHE = 'cache';

let dbPromise: Promise<IDBDatabase> | null = null;

const openDb = (): Promise<IDBDatabase> => {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB недоступен'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE, { keyPath: 'key' });
    };
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('Не удалось открыть IndexedDB'));
    };
  });
  return dbPromise;
};

const request = <T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> =>
  openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = run(tx.objectStore(store));
        req.onsuccess = () => {
          resolve(req.result as T);
        };
        req.onerror = () => {
          reject(req.error ?? new Error('Ошибка IndexedDB'));
        };
      }),
  );

// Хранилище — удобство, а не обязательство: если его нет, приложение
// работает как раньше, просто без очереди и кэша.
const quiet = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await p;
  } catch {
    return fallback;
  }
};

export const queueStorage: QueueStorage = {
  all: () => quiet(request<QueuedTxn[]>(QUEUE, 'readonly', (s) => s.getAll()), []),
  put: (item) => quiet(request<IDBValidKey>(QUEUE, 'readwrite', (s) => s.put(item)).then(() => undefined), undefined),
  remove: (id) => quiet(request<undefined>(QUEUE, 'readwrite', (s) => s.delete(id)), undefined),
};

interface CacheRow extends CacheEntry {
  key: string;
}

export const cacheStorage: CacheStorage = {
  get: (key) =>
    quiet(
      request<CacheRow | undefined>(CACHE, 'readonly', (s) => s.get(key)).then((row) =>
        row ? { value: row.value, at: row.at } : null,
      ),
      null,
    ),
  set: (key, value) =>
    quiet(
      request<IDBValidKey>(CACHE, 'readwrite', (s) =>
        s.put({ key, value, at: new Date().toISOString() } satisfies CacheRow),
      ).then(() => undefined),
      undefined,
    ),
};
```

`offline/memoryStorage.ts`:

```ts
import type { CacheEntry, CacheStorage, QueueStorage, QueuedTxn } from './types';

// Реализации в памяти для тестов: в jsdom IndexedDB нет, а тащить
// fake-indexeddb в зависимости ради этого не стоит.
export const memoryQueueStorage = (initial: QueuedTxn[] = []): QueueStorage => {
  const items = new Map(initial.map((i) => [i.id, i] as const));
  return {
    all: () => Promise.resolve([...items.values()]),
    put: (item) => {
      items.set(item.id, item);
      return Promise.resolve();
    },
    remove: (id) => {
      items.delete(id);
      return Promise.resolve();
    },
  };
};

export const memoryCacheStorage = (): CacheStorage => {
  const rows = new Map<string, CacheEntry>();
  return {
    get: (key) => Promise.resolve(rows.get(key) ?? null),
    set: (key, value) => {
      rows.set(key, { value, at: new Date().toISOString() });
      return Promise.resolve();
    },
  };
};
```

- [ ] **Step 2: Failing tests for the pure helpers and the slice**

`offline/queue.test.ts`:

```ts
import type { QueuedTxn } from './types';
import { applyOutcome, hasErrors, nextToSend, pendingCount, sortByCreated } from './queue';

const q = (id: string, createdAt: string, error: string | null = null): QueuedTxn => ({
  id,
  args: { date: '2026-09-20', amount: 1, currency: 'USD', code: 'каф', note: null },
  createdAt,
  attempts: 0,
  error,
});

describe('nextToSend', () => {
  it('берёт самую старую запись без ошибки', () => {
    const items = [q('b', '2026-09-20T10:00:00Z'), q('a', '2026-09-20T09:00:00Z')];
    expect(nextToSend(items)?.id).toBe('a');
  });
  it('пропускает отвергнутые', () => {
    const items = [q('a', '2026-09-20T09:00:00Z', 'Неизвестная категория'), q('b', '2026-09-20T10:00:00Z')];
    expect(nextToSend(items)?.id).toBe('b');
  });
  it('null, когда отправлять нечего', () => {
    expect(nextToSend([])).toBeNull();
    expect(nextToSend([q('a', '2026-09-20T09:00:00Z', 'отказ')])).toBeNull();
  });
});

describe('applyOutcome', () => {
  const items = [q('a', '2026-09-20T09:00:00Z'), q('b', '2026-09-20T10:00:00Z')];

  it('успех убирает запись', () => {
    expect(applyOutcome(items, 'a', { kind: 'ok' }).map((i) => i.id)).toEqual(['b']);
  });
  it('сетевая ошибка оставляет запись и считает попытку', () => {
    const next = applyOutcome(items, 'a', { kind: 'network' });
    expect(next).toHaveLength(2);
    expect(next[0]?.attempts).toBe(1);
    expect(next[0]?.error).toBeNull();
  });
  it('отказ помечает запись текстом ошибки', () => {
    const next = applyOutcome(items, 'a', { kind: 'rejected', message: 'Неизвестная категория: ххх' });
    expect(next[0]?.error).toBe('Неизвестная категория: ххх');
    expect(next[0]?.attempts).toBe(1);
  });
  it('неизвестный id ничего не меняет', () => {
    expect(applyOutcome(items, 'нет', { kind: 'ok' })).toEqual(items);
  });
});

describe('счётчики', () => {
  it('pendingCount и hasErrors', () => {
    const items = [q('a', '2026-09-20T09:00:00Z'), q('b', '2026-09-20T10:00:00Z', 'отказ')];
    expect(pendingCount(items)).toBe(2);
    expect(hasErrors(items)).toBe(true);
    expect(hasErrors([q('a', '2026-09-20T09:00:00Z')])).toBe(false);
  });
  it('sortByCreated не меняет исходный массив', () => {
    const items = [q('b', '2026-09-20T10:00:00Z'), q('a', '2026-09-20T09:00:00Z')];
    expect(sortByCreated(items).map((i) => i.id)).toEqual(['a', 'b']);
    expect(items.map((i) => i.id)).toEqual(['b', 'a']);
  });
});
```

`offline/state.test.ts`:

```ts
import type { QueuedTxn } from './types';
import { cacheHit, freshHit, offlineReducer, onlineSet, pendingSet } from './state';

const item: QueuedTxn = {
  id: 'a',
  args: { date: '2026-09-20', amount: 1, currency: 'USD', code: 'каф', note: null },
  createdAt: '2026-09-20T09:00:00Z',
  attempts: 0,
  error: null,
};

describe('offline slice', () => {
  const initial = offlineReducer(undefined, { type: '@@init' });

  it('стартует пустым и онлайн по умолчанию', () => {
    expect(initial.pending).toEqual([]);
    expect(initial.fromCacheAt).toBeNull();
  });

  it('pendingSet заменяет очередь', () => {
    expect(offlineReducer(initial, pendingSet([item])).pending).toEqual([item]);
  });

  it('cacheHit ставит отметку, freshHit снимает', () => {
    const cached = offlineReducer(initial, cacheHit('2026-09-20T15:40:00Z'));
    expect(cached.fromCacheAt).toBe('2026-09-20T15:40:00Z');
    const fresh = offlineReducer(cached, freshHit('2026-09-20T16:00:00Z'));
    expect(fresh.fromCacheAt).toBeNull();
    expect(fresh.lastSyncAt).toBe('2026-09-20T16:00:00Z');
  });

  it('onlineSet', () => {
    expect(offlineReducer(initial, onlineSet(false)).online).toBe(false);
  });
});
```

Run `cd app && npx vitest run src/offline` → FAIL.

- [ ] **Step 3: Implement**

`offline/queue.ts`:

```ts
import type { QueuedTxn, SendOutcome } from './types';

// Чистые функции над списком очереди: никакого IO, чтобы их можно было
// проверить без хранилища и без стора.

export const sortByCreated = (items: QueuedTxn[]): QueuedTxn[] =>
  [...items].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

// Отвергнутые пропускаем: их повторяют только вручную.
export const nextToSend = (items: QueuedTxn[]): QueuedTxn | null =>
  sortByCreated(items).find((i) => i.error === null) ?? null;

export function applyOutcome(items: QueuedTxn[], id: string, outcome: SendOutcome): QueuedTxn[] {
  if (outcome.kind === 'ok') return items.filter((i) => i.id !== id);
  return items.map((i) =>
    i.id === id
      ? { ...i, attempts: i.attempts + 1, error: outcome.kind === 'rejected' ? outcome.message : i.error }
      : i,
  );
}

export const pendingCount = (items: QueuedTxn[]): number => items.length;
export const hasErrors = (items: QueuedTxn[]): boolean => items.some((i) => i.error !== null);
```

`offline/state.ts` — plain slice, **imports nothing from `@/api/api`** (that is what keeps `api → cache → state` acyclic):

```ts
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
```

`app/store.ts` — add `offline: offlineReducer` to the reducer map.

- [ ] **Step 4: Pass, checks, commit**

`npx vitest run src/offline` → PASS; full checks green.

```bash
git add app/src
git commit -m "Offline foundation: IndexedDB adapter, pure queue helpers, offline slice"
```

---

### Task 3: Read cache around the base query

**Files:**
- Create: `app/src/offline/cache.ts`, `cache.test.ts`
- Modify: `app/src/api/api.ts`

**Interfaces:**
- Produces: `withCache(base: BaseQueryFn<RpcCall, unknown, AppError>, storage: CacheStorage): BaseQueryFn<RpcCall, unknown, AppError>`; `api.ts` uses `withCache(rpcBaseQuery, cacheStorage)`; `RpcCall` is exported from `api/api.ts` (or moved to `api/types.ts` — pick one and keep imports consistent).

- [ ] **Step 1: Failing test**

`offline/cache.test.ts`:

```ts
import type { BaseQueryApi, BaseQueryFn } from '@reduxjs/toolkit/query';
import type { AppError } from '@/api/types';
import { NETWORK_ERROR } from '@/api/errors';
import { memoryCacheStorage } from './memoryStorage';
import { withCache, type RpcCall } from './cache';
import { cacheHit, freshHit } from './state';

const apiFor = (type: 'query' | 'mutation', dispatch = vi.fn()): BaseQueryApi =>
  ({ type, dispatch, getState: () => ({}), signal: new AbortController().signal, abort: vi.fn(), extra: undefined, endpoint: 'x' }) as unknown as BaseQueryApi;

const call: RpcCall = { fn: 'app_codes' };

describe('withCache', () => {
  it('успешный ответ запроса пишется в кэш и снимает отметку', async () => {
    const storage = memoryCacheStorage();
    const dispatch = vi.fn();
    const base: BaseQueryFn<RpcCall, unknown, AppError> = () => Promise.resolve({ data: [1, 2] });
    const wrapped = withCache(base, storage);

    await wrapped(call, apiFor('query', dispatch), undefined);

    expect(await storage.get('app_codes|{}')).not.toBeNull();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: freshHit.type }));
  });

  it('при сетевой ошибке отдаёт кэш и ставит отметку', async () => {
    const storage = memoryCacheStorage();
    await storage.set('app_codes|{}', [1, 2]);
    const dispatch = vi.fn();
    const base: BaseQueryFn<RpcCall, unknown, AppError> = () => Promise.resolve({ error: { message: NETWORK_ERROR } });
    const wrapped = withCache(base, storage);

    const res = await wrapped(call, apiFor('query', dispatch), undefined);

    expect(res).toEqual({ data: [1, 2] });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: cacheHit.type }));
  });

  it('без кэша отдаёт исходную ошибку', async () => {
    const base: BaseQueryFn<RpcCall, unknown, AppError> = () => Promise.resolve({ error: { message: NETWORK_ERROR } });
    const res = await withCache(base, memoryCacheStorage())(call, apiFor('query'), undefined);
    expect(res).toEqual({ error: { message: NETWORK_ERROR } });
  });

  it('ошибка базы кэш не трогает', async () => {
    const storage = memoryCacheStorage();
    await storage.set('app_codes|{}', [1, 2]);
    const base: BaseQueryFn<RpcCall, unknown, AppError> = () => Promise.resolve({ error: { message: 'Неизвестная категория' } });
    const res = await withCache(base, storage)(call, apiFor('query'), undefined);
    expect(res).toEqual({ error: { message: 'Неизвестная категория' } });
  });

  it('мутации не кэшируются и из кэша не отвечают', async () => {
    const storage = memoryCacheStorage();
    await storage.set('app_add_txn|{}', 'старое');
    const base: BaseQueryFn<RpcCall, unknown, AppError> = () => Promise.resolve({ error: { message: NETWORK_ERROR } });
    const res = await withCache(base, storage)({ fn: 'app_add_txn' }, apiFor('mutation'), undefined);
    expect(res).toEqual({ error: { message: NETWORK_ERROR } });
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement**

`offline/cache.ts`:

```ts
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
```

`api/api.ts` — import `withCache` and `cacheStorage`, move the `RpcCall` interface to `offline/cache.ts` (import it back), and pass `baseQuery: withCache(rpcBaseQuery, cacheStorage)`.

- [ ] **Step 3: Pass, checks, commit**

```bash
git add app/src
git commit -m "Offline read cache: serve last successful response when the network is down"
```

---

### Task 4: Thunks and wiring

**Files:**
- Create: `app/src/offline/thunks.ts`, `thunks.test.ts`, `useOffline.ts`, `toDisplayRow.ts`, `toDisplayRow.test.ts`
- Modify: `app/src/main.tsx`

**Interfaces:**
- Produces:
  - `loadQueue()`, `enqueueTxn(args: AddTxnArgs)`, `flushQueue()`, `retryTxn(id)`, `removeTxn(id)` — `createAsyncThunk`s
  - `useOffline(): void`
  - `toDisplayRow(item: QueuedTxn, baseCurrency: string): DisplayTxn`

- [ ] **Step 1: Failing tests**

`offline/toDisplayRow.test.ts`:

```ts
import type { QueuedTxn } from './types';
import { toDisplayRow } from './toDisplayRow';

const item: QueuedTxn = {
  id: 'uuid-1',
  args: { date: '2026-09-20', amount: 12.5, currency: 'USD', code: 'каф', note: 'кофе' },
  createdAt: '2026-09-20T09:00:00Z',
  attempts: 0,
  error: null,
};

describe('toDisplayRow', () => {
  it('строка выглядит как ручная запись и помечена pending', () => {
    const row = toDisplayRow(item, 'USD');
    expect(row).toMatchObject({
      external_id: 'uuid-1',
      source: 'manual',
      txn_date: '2026-09-20',
      amount: 12.5,
      currency: 'USD',
      base_amount: 12.5,
      code: 'каф',
      kind: 'expense',
      note: 'кофе',
      pending: true,
    });
  });

  it('другая валюта — без суммы в базовой', () => {
    expect(toDisplayRow({ ...item, args: { ...item.args, currency: 'RSD' } }, 'USD').base_amount).toBeNull();
  });
});
```

`offline/thunks.test.ts` (store-level; mocks `@/api/supabase` exactly like the screen tests):

```ts
import { makeStore } from '@/app/store';
import { NETWORK_ERROR } from '@/api/errors';
import { enqueueTxn, flushQueue, removeTxn, retryTxn } from './thunks';
import { pendingSet } from './state';
import type { QueuedTxn } from './types';

const rpc = vi.fn();
vi.mock('@/api/supabase', () => ({
  supabase: { rpc: (...a: unknown[]): unknown => rpc(...a), auth: { signOut: vi.fn() } },
}));

const args = { date: '2026-09-20', amount: 5, currency: 'USD', code: 'каф', note: null };
const queued = (id: string, error: string | null = null): QueuedTxn => ({
  id, args, createdAt: `2026-09-20T09:00:0${id}Z`, attempts: 0, error,
});

beforeEach(() => {
  rpc.mockReset();
});

describe('enqueueTxn', () => {
  it('отправляет сразу и очищает очередь при успехе', async () => {
    rpc.mockResolvedValue({ data: 'uuid', error: null });
    const store = makeStore();
    await store.dispatch(enqueueTxn(args));
    expect(rpc).toHaveBeenCalledWith('app_add_txn', expect.objectContaining({ p_amount: 5, p_id: expect.any(String) }));
    expect(store.getState().offline.pending).toHaveLength(0);
  });

  it('при отсутствии сети запись остаётся в очереди', async () => {
    rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    const store = makeStore();
    await store.dispatch(enqueueTxn(args));
    const pending = store.getState().offline.pending;
    expect(pending).toHaveLength(1);
    expect(pending[0]?.error).toBeNull();
    expect(pending[0]?.attempts).toBe(1);
  });
});

describe('flushQueue', () => {
  it('сетевая ошибка прерывает обработку целиком', async () => {
    rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    const store = makeStore();
    store.dispatch(pendingSet([queued('1'), queued('2')]));
    await store.dispatch(flushQueue());
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(store.getState().offline.pending).toHaveLength(2);
  });

  it('отказ базы помечает свою запись и не мешает следующей', async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'Неизвестная категория: ххх' } })
      .mockResolvedValueOnce({ data: 'uuid', error: null });
    const store = makeStore();
    store.dispatch(pendingSet([queued('1'), queued('2')]));
    await store.dispatch(flushQueue());
    const pending = store.getState().offline.pending;
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe('1');
    expect(pending[0]?.error).toBe('Неизвестная категория: ххх');
  });

  it('отвергнутые не отправляются повторно сами', async () => {
    rpc.mockResolvedValue({ data: 'uuid', error: null });
    const store = makeStore();
    store.dispatch(pendingSet([queued('1', 'отказ')]));
    await store.dispatch(flushQueue());
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('retryTxn и removeTxn', () => {
  it('retry снимает ошибку и отправляет', async () => {
    rpc.mockResolvedValue({ data: 'uuid', error: null });
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
```

Run → FAIL.

- [ ] **Step 2: Implement `toDisplayRow.ts`**

```ts
import type { DisplayTxn } from '@/api/types';
import type { QueuedTxn } from './types';

// Неотправленная запись показывается в списках как обычная ручная трата.
// base_amount ставим только когда валюта совпадает с базовой: курса для
// другой валюты у приложения нет, и такая строка не должна искажать итог.
export function toDisplayRow(item: QueuedTxn, baseCurrency: string): DisplayTxn {
  const sameCurrency = item.args.currency === baseCurrency;
  return {
    external_id: item.id,
    source: 'manual',
    txn_date: item.args.date,
    txn_at: `${item.args.date}T00:00:00+00:00`,
    merchant_name: item.args.note,
    amount: item.args.amount,
    currency: item.args.currency,
    base_amount: sameCurrency ? item.args.amount : null,
    base_currency: baseCurrency,
    code: item.args.code,
    kind: 'expense',
    status: 'success',
    note: item.args.note,
    code_override: item.args.code,
    pending: true,
  };
}
```

- [ ] **Step 3: Implement `thunks.ts`**

```ts
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

// Одна отправка за раз: две параллельные съели бы одну и ту же запись дважды.
let flushing = false;

const persist = (items: QueuedTxn[], removed: string[]): void => {
  void Promise.all([...items.map((i) => queueStorage.put(i)), ...removed.map((id) => queueStorage.remove(id))]);
};

export const loadQueue = createAsyncThunk('offline/load', async (_: void, { dispatch }) => {
  const items = await queueStorage.all();
  dispatch(pendingSet(items));
});

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
      if ('error' in res && res.error) {
        const message = 'message' in res.error ? (res.error.message ?? 'Неизвестная ошибка') : 'Неизвестная ошибка';
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
  persist(items.filter((i) => i.id === id), []);
  await dispatch(flushQueue());
});

export const removeTxn = createAsyncThunk('offline/remove', (id: string, { dispatch, getState }) => {
  const items = (getState() as OfflineRootState).offline.pending.filter((i) => i.id !== id);
  dispatch(pendingSet(items));
  persist([], [id]);
});
```

Notes for the implementer: `api.endpoints.addTxn.initiate(...)` returns a promise with an `unwrap`; do **not** use `unwrap` (it throws). If the RTK types make `'error' in res` awkward, narrow with a small type guard rather than a cast. `res.error` may be a `SerializedError` without `message`; the code above already handles that.

- [ ] **Step 4: `useOffline.ts` and `main.tsx`**

```ts
import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '@/app/store';
import { onlineSet } from './state';
import { flushQueue, loadQueue } from './thunks';

// Очередь отправляется при появлении сети, при возвращении в приложение и
// один раз при старте. Периодического опроса нет: он ничего не добавляет.
export function useOffline(): void {
  const dispatch = useDispatch<AppDispatch>();
  useEffect(() => {
    void dispatch(loadQueue()).then(() => dispatch(flushQueue()));

    const goOnline = () => {
      dispatch(onlineSet(true));
      void dispatch(flushQueue());
    };
    const goOffline = () => {
      dispatch(onlineSet(false));
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void dispatch(flushQueue());
    };

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [dispatch]);
}
```

`main.tsx`: call `useOffline()` next to `useSessionListener()` in `App`.

- [ ] **Step 5: Pass, checks, commit**

```bash
git add app/src
git commit -m "Offline queue thunks: enqueue, single-flight flush, retry, remove"
```

---

### Task 5: UI — bar, pending rows, entry screen through the queue

**Files:**
- Create: `app/src/offline/OfflineBar.tsx`, `OfflineBar.module.scss`, `OfflineBar.test.tsx`, `PendingSheet.tsx`
- Modify: `app/src/features/entry/EntryScreen.tsx`, `TodayList.tsx`, `app/src/features/month/MonthScreen.tsx`, `TxnRow.tsx`, `app/src/features/entry/EntryScreen.test.tsx`

**Interfaces:**
- Produces: `<OfflineBar/>` (renders `null` when the queue is empty); `<PendingSheet open onClose/>`; `TxnRow` accepts `DisplayTxn`.

- [ ] **Step 1: Failing tests**

`offline/OfflineBar.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { makeStore } from '@/app/store';
import { pendingSet } from './state';
import type { QueuedTxn } from './types';
import { OfflineBar } from './OfflineBar';

const rpc = vi.fn();
vi.mock('@/api/supabase', () => ({
  supabase: { rpc: (...a: unknown[]): unknown => rpc(...a), auth: { signOut: vi.fn() } },
}));

const q = (id: string, error: string | null = null): QueuedTxn => ({
  id,
  args: { date: '2026-09-20', amount: 5, currency: 'USD', code: 'каф', note: 'кофе' },
  createdAt: '2026-09-20T09:00:00Z',
  attempts: 0,
  error,
});

const renderBar = (items: QueuedTxn[]) => {
  const store = makeStore();
  store.dispatch(pendingSet(items));
  render(
    <Provider store={store}>
      <OfflineBar />
    </Provider>,
  );
  return store;
};

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: 'uuid', error: null });
});

describe('OfflineBar', () => {
  it('скрыта, когда очередь пуста', () => {
    renderBar([]);
    expect(screen.queryByText(/Не отправлено/)).not.toBeInTheDocument();
  });

  it('показывает счётчик и отправляет по тапу', async () => {
    const user = userEvent.setup();
    renderBar([q('1'), q('2')]);
    const bar = screen.getByRole('button', { name: /Не отправлено: 2/ });
    await user.click(bar);
    expect(rpc).toHaveBeenCalled();
  });

  it('при отказе открывает список с текстом ошибки и удалением', async () => {
    const user = userEvent.setup();
    const store = renderBar([q('1', 'Неизвестная категория: ххх')]);
    await user.click(screen.getByRole('button', { name: /Не отправлено: 1/ }));
    const dialog = screen.getByRole('dialog', { name: 'Не отправлено' });
    expect(within(dialog).getByText(/Неизвестная категория: ххх/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Удалить' }));
    expect(store.getState().offline.pending).toHaveLength(0);
  });
});
```

`EntryScreen.test.tsx` — add one case (keep the existing five):

```tsx
  it('без сети сохраняет в очередь и показывает счётчик', async () => {
    const user = userEvent.setup();
    rpc.mockImplementation((fn: string) => {
      if (fn === 'app_codes') return Promise.resolve({ data: codes, error: null });
      if (fn === 'app_month_txns') return Promise.resolve({ data: [], error: null });
      return Promise.reject(new TypeError('Failed to fetch'));
    });
    renderScreen();
    await user.type(await screen.findByLabelText('Сумма'), '350');
    await user.click(screen.getByRole('radio', { name: 'каф' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Записано');
    expect(screen.getByRole('button', { name: /Не отправлено: 1/ })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Сегодня' })).getByText(/не отправлено/)).toBeInTheDocument();
  });
```

(`TodayList`'s `<section aria-label="Сегодня">` is a `region`; import `within` if it is not imported yet.)

Run → FAIL.

- [ ] **Step 2: `OfflineBar` and `PendingSheet`**

`OfflineBar.module.scss`:

```scss
.bar {
  position: fixed;
  left: 0; right: 0; bottom: 52px;
  display: block;
  width: 100%;
  min-height: 36px;
  padding: var(--space-2) var(--space-4);
  border: 0;
  border-top: 1px solid var(--line);
  background: var(--surface);
  color: var(--fg);
  font: inherit;
  font-size: 13px;
  text-align: center;
  cursor: pointer;
  z-index: 6;
}
.err { background: var(--err); color: #fff; }
.row { display: grid; gap: var(--space-1); padding: var(--space-2) 0; border-bottom: 1px solid var(--line); }
.meta { color: var(--muted); font-size: 13px; }
.error { color: var(--err); font-size: 13px; }
.actions { display: flex; gap: var(--space-2); }
```

`PendingSheet.tsx`: a `Sheet` titled «Не отправлено» listing `selectPending` items — date, amount with currency, code, note, the error text when present, and two buttons per row, «Отправить снова» (`retryTxn`) and «Удалить» (`removeTxn`). Reuse `formatMoney` and `formatDayTitle`.

`OfflineBar.tsx`: reads `selectPendingCount` and `selectHasErrors`; renders `null` at zero; otherwise a full-width `<button>` «Не отправлено: N». Click → if there are errors, open `PendingSheet`; else `dispatch(flushQueue())`. Keep the `PendingSheet` reachable even without errors by opening it on a long list — not required; the simple rule above is enough.

- [ ] **Step 3: Wire the screens**

- `EntryScreen`: replace the `addTxn` call in `onSubmit` with `await dispatch(enqueueTxn(v))`, always `show('Записано', 'ok')` and `return true`; keep `pushRecentCurrency`/`pushRecentCode`. Remove the now-unused `useAddTxnMutation` (`busy` becomes `false`, or keep a local `saving` state around the dispatch). Render `<OfflineBar />` right before `<TabBar />`.
- `TodayList`: read `selectPending`, map today's items through `toDisplayRow(item, base)` where `base` is `data?.[0]?.base_currency ?? 'USD'`, and prepend them to `rows`. Render the clock marker for `pending` rows (a `<span className={styles.code}>` with «не отправлено»).
- `MonthScreen`: same merge for the visible month — add pending rows into `rows` before `visibleRows`/`summarize`/`groupByDay`. Pending rows must not open the edit sheet: in `onRowClick`, ignore rows with `pending`.
- `TxnRow`: accept `DisplayTxn`; append «не отправлено» to the tag when `txn.pending`.
- `MonthScreen`: render `<OfflineBar />` before `<TabBar />`.

- [ ] **Step 4: Pass, checks, commit**

Full suite green, pristine.

```bash
git add app/src
git commit -m "Offline UI: pending counter, pending rows in lists, entry saves through the queue"
```

---

### Task 6: Service worker check, docs, manual verification

**Files:**
- Modify: `app/vite.config.ts` (only if the navigation fallback is missing), `README.md`, `docs/ROADMAP.md`, `CLAUDE.md` (local only, never committed)

- [ ] **Step 1: Offline navigation**

Run `cd app && npm run build`, then inspect `dist/sw.js` for a navigation route (`createHandlerBoundToURL` / `NavigationRoute`). If it is absent, add to the `VitePWA` options:

```ts
      workbox: { navigateFallback: 'index.html' },
```

and rebuild. Report which branch applied.

- [ ] **Step 2: Docs**

README «## App»: add a paragraph — adding an expense works offline, the entry is queued in IndexedDB with a client-generated id and sent when the connection returns (`db/016_app_add_txn_id.sql` makes the retry idempotent); the month and stats screens fall back to the last successful response. Add `db/016_app_add_txn_id.sql` to the Layout tree and the Setup migration list. Add `offline/` to the `app/` subtree.

`docs/ROADMAP.md`: item 5 → «**Офлайн-режим** — сделано (2026-09-20). Спека `2026-09-20-app-offline-design.md`.»

`CLAUDE.md` (local): migration list to `016`; a line that the entry screen writes through the offline queue, so `app_add_txn` must stay idempotent on `(source, external_id)`; `offline/` layout note.

- [ ] **Step 3: Checks**

`cd app && npm run lint && npm run typecheck && npm run test && npm run build`; from the repo root `supabase db query --linked -f db/004_verify.sql`.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/ROADMAP.md app/vite.config.ts
git commit -m "Docs: offline mode, migration 016; navigation fallback for offline deep links"
```

The controller performs the browser check (DevTools offline: app opens, categories present, save works and shows the counter, month screen shows cached data with a timestamp, going online flushes the queue).

---

## Self-review notes

- Spec coverage: DB idempotent id (T1); IndexedDB + pure helpers + slice (T2); read cache with the «данные от …» flag (T3); queue behaviour — stop on network, continue past rejected, single-flight, four flush triggers (T4); counter, pending rows, rejected list, entry through the queue (T5); service worker, docs, manual check (T6).
- Import cycle avoided by design: `api` → `cache` → `state` (no `api` import); thunks import `api` but nothing imports thunks except components and `main`.
- Test strategy: nothing depends on real IndexedDB; `db.ts` degrades to no-ops in jsdom, so store-level thunk tests work with an in-memory-free path.
- Known judgment calls for the executor: the exact RTK narrowing of `initiate()` results; whether `dist/sw.js` already has a navigation fallback; keeping `busy` on the entry form after the mutation hook is removed.
