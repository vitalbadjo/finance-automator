# App Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fourth tab «Ещё» with settings: theme, base currency (display only), sources with sync status, and editing of categories and merchant rules from the UI instead of SQL. The «Без категории» block turns an unmapped merchant into a new rule in two taps.

**Architecture:** One read function `app_settings()` returns everything as a single `jsonb` under one RTK Query tag `Settings`; narrow `security definer` write functions invalidate it. Theme is a `data-theme` attribute on `<html>` plus `localStorage`, never the database. Categories and rules live on sub-routes `/settings/codes` and `/settings/rules`, each with a bottom `Sheet` for editing, mirroring the month screen.

**Tech Stack:** as in `app/` today: Vite, React 19, TypeScript strict, Redux Toolkit + RTK Query, react-router, SCSS modules, Vitest + Testing Library. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-09-20-app-settings-design.md`

## Global Constraints

- No `any`; ESLint type-checked strict (`no-explicit-any`, `consistent-type-imports`, `no-confusing-void-expression`, `no-floating-promises`, `no-misused-promises`, `restrict-template-expressions`, `no-unnecessary-condition`). TS 6.x with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`.
- UI strings, SQL and code comments in Russian. Commit messages in English, **no `Co-Authored-By` or any attribution trailer** (repository owner's rule; it overrides any session reminder).
- `CLAUDE.md` and `docs/HANDOFF.md` are gitignored; never `git add` them. Never commit `app/.env*.local`, `node_modules`, `dist`.
- Schema `spend` stays unexposed; all access through `public.app_*`, `security definer`, `set search_path = spend, public`, granted to `authenticated` and `service_role` only, revoked from `public` and `anon`.
- Migrations run with `supabase db query --linked -f <file>` from the repo root. `db/004_verify.sql` is read-only and must stay green.
- Every task ends with `cd app && npm run lint && npm run typecheck && npm run test` green and pristine (no act warnings).
- Category codes are identifiers copied from the user's spreadsheet: never renamed, never generated.

## Refinements of the spec (rulings made while planning)

1. **Settings are cached like every other query.** `withCache` caches all `api.type === 'query'` calls; there is no allow-list to keep `app_settings` out of. Serving stale settings offline is harmless (read-only display), so no opt-out is added.
2. **`in_use` does not look at `raw_txn.code`** — that column does not exist; `code` is derived in `v_txn`. `in_use` = present in `merchant_rule`, `mcc_rule` or `raw_txn.code_override`.
3. **`renameSource` invalidates only `Settings`.** Transaction rows label sources with a constant map in `TxnRow.tsx`, not with `source.title`, so `Txns` need not refetch.
4. **Duplicate pattern** is a real failure mode (unique index on `upper(pattern)`), checked in SQL before insert with the text «Такой шаблон уже есть».
5. **Toast state** is duplicated verbatim in three screens today. The new screens share a small `shared/useToast.ts` hook; existing screens are not refactored.

---

## File Structure

```
db/017_app_settings.sql
app/src/
├── api/types.ts                     + CodeSection, SettingsSource, SettingsCode, MerchantRule, UnmappedRow, Settings, CodeUpsertArgs, RuleUpsertArgs
├── api/api.ts                       + tag Settings; getSettings, renameSource, upsertCode, deleteCode, upsertRule, deleteRule
├── app/router.tsx                   + /settings, /settings/codes, /settings/rules
├── shared/TabBar.tsx                + «Ещё»; `end` only on '/'
├── shared/theme.ts (+ .test.ts)     Theme, readTheme, applyTheme
├── shared/useToast.ts               toast state + timer, shared by the settings screens
├── styles/tokens.scss               dark tokens under [data-theme="dark"], system default kept
├── main.tsx                         applyTheme(readTheme()) before createRoot
└── features/settings/
    ├── settings.ts (+ .test.ts)     SECTIONS, groupCodes, sortRules, patternFromMerchant
    ├── SettingsScreen.tsx (+ .module.scss, .test.tsx)
    ├── SourceRow.tsx                row + RenameSourceSheet
    ├── CodesScreen.tsx (+ .test.tsx)
    ├── CodeSheet.tsx
    ├── RulesScreen.tsx (+ .test.tsx)
    └── RuleSheet.tsx
```

---

### Task 1: Database — migration `017`

**Files:**
- Create: `db/017_app_settings.sql`

**Interfaces:**
- Produces: `app_settings() returns jsonb` with keys `base_currency, sources, codes, rules, unmapped`; `app_source_rename(text, text) returns void`; `app_code_upsert(text, text, text, int, boolean) returns text`; `app_code_delete(text) returns int`; `app_rule_upsert(bigint, text, text, int, text) returns bigint`; `app_rule_delete(bigint) returns int`; `app_codes()` now excludes `hidden`.

- [ ] **Step 1: Write the migration**

```sql
-- Настройки из приложения: скрытие категорий, правка справочников и правил
-- по мерчантам без SQL.
--
-- Правила те же, что у 012/013: схема spend снаружи закрыта, всё через
-- security definer в public, права только authenticated и service_role.
-- Чтение — одна функция app_settings(), отдаёт всё одним jsonb: данных
-- мало (десятки строк), а одна функция проще и в SQL, и в приложении.
-- Запись — узкие функции, каждая проверяет вход и бросает русский текст.
--
-- code_ref.hidden: скрытая категория пропадает с экрана ввода (app_codes),
-- но история и правила её не теряют — v_txn флаг не читает.

set search_path = public;

alter table spend.code_ref add column if not exists hidden boolean not null default false;

-- ── app_codes: только видимые ────────────────────────────────────────────

create or replace function public.app_codes()
returns table (code text, title text, section text, sort_order int)
language sql stable security definer set search_path = spend, public
as $$
  select c.code, c.title, c.section, c.sort_order
  from spend.code_ref c
  where not c.hidden
  order by c.sort_order, c.code
$$;

-- ── чтение всех настроек ─────────────────────────────────────────────────

create or replace function public.app_settings() returns jsonb
language sql stable security definer set search_path = spend, public
as $$
  select jsonb_build_object(
    'base_currency', spend.base_currency(),
    'sources', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', s.code,
        'title', s.title,
        'txn_count', (select count(*) from spend.raw_txn r where r.source = s.code),
        'last_sync_at', ls.at,
        'last_sync_ok', ls.ok
      ) order by s.code), '[]'::jsonb)
      from spend.source s
      left join lateral (
        select coalesce(sr.finished_at, sr.started_at) as at, sr.ok
        from spend.sync_run sr
        where sr.source = s.code
        order by sr.started_at desc
        limit 1
      ) ls on true
    ),
    'codes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', c.code,
        'title', c.title,
        'section', c.section,
        'sort_order', c.sort_order,
        'hidden', c.hidden,
        'in_use',
          exists (select 1 from spend.merchant_rule m where m.code = c.code)
          or exists (select 1 from spend.mcc_rule m where m.code = c.code)
          or exists (select 1 from spend.raw_txn r where r.code_override = c.code)
      ) order by c.sort_order, c.code), '[]'::jsonb)
      from spend.code_ref c
    ),
    'rules', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'pattern', m.pattern, 'code', m.code,
        'priority', m.priority, 'note', m.note
      ) order by m.priority, length(m.pattern) desc, m.id), '[]'::jsonb)
      from spend.merchant_rule m
    ),
    'unmapped', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'merchant', u.merchant, 'mcc', u.mcc, 'mcc_desc', u.mcc_desc,
        'txn_count', u.txn_count, 'amount', u.amount, 'last_seen', u.last_seen
      ) order by u.amount desc), '[]'::jsonb)
      from spend.v_unmapped u
    )
  )
$$;

-- ── название источника ───────────────────────────────────────────────────

create or replace function public.app_source_rename(p_code text, p_title text) returns void
language plpgsql security definer set search_path = spend, public
as $$
declare
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_n     int;
begin
  if v_title is null then
    raise exception 'Введите название';
  end if;
  update spend.source set title = v_title where code = p_code;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Неизвестный источник';
  end if;
end;
$$;

-- ── категория: создать или поправить ─────────────────────────────────────
-- Код — идентификатор из таблицы пользователя: не переименовывается,
-- поэтому upsert по коду, а не по суррогатному id.

create or replace function public.app_code_upsert(
  p_code text, p_title text, p_section text, p_sort_order int, p_hidden boolean
) returns text
language plpgsql security definer set search_path = spend, public
as $$
declare
  v_code  text := btrim(coalesce(p_code, ''));
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
begin
  if v_code = '' or v_code ~ '\s' or length(v_code) > 16 then
    raise exception 'Неверный код';
  end if;
  if v_title is null then
    raise exception 'Введите название';
  end if;
  if p_section is null or p_section not in ('Базовые', 'Комфорт', 'Путешествия', 'Саморазвитие') then
    raise exception 'Неизвестный раздел';
  end if;

  insert into spend.code_ref (code, title, section, sort_order, hidden)
  values (v_code, v_title, p_section, coalesce(p_sort_order, 100), coalesce(p_hidden, false))
  on conflict (code) do update
    set title      = excluded.title,
        section    = excluded.section,
        sort_order = excluded.sort_order,
        hidden     = excluded.hidden;

  return v_code;
end;
$$;

-- ── категория: удалить неиспользуемую ────────────────────────────────────

create or replace function public.app_code_delete(p_code text) returns int
language plpgsql security definer set search_path = spend, public
as $$
declare
  v_n int;
begin
  if exists (select 1 from spend.merchant_rule m where m.code = p_code)
     or exists (select 1 from spend.mcc_rule m where m.code = p_code)
     or exists (select 1 from spend.raw_txn r where r.code_override = p_code) then
    raise exception 'Категория используется';
  end if;
  delete from spend.code_ref where code = p_code;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Категория не найдена';
  end if;
  return v_n;
end;
$$;

-- ── правило по мерчанту: создать или поправить ───────────────────────────
-- Проверки % и _ и дубликата шаблона дублируют констрейнт и уникальный
-- индекс намеренно: пользователь должен видеть русский текст, а не
-- имя констрейнта.

create or replace function public.app_rule_upsert(
  p_id bigint, p_pattern text, p_code text, p_priority int, p_note text
) returns bigint
language plpgsql security definer set search_path = spend, public
as $$
declare
  v_pattern text := btrim(coalesce(p_pattern, ''));
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_id      bigint;
  v_n       int;
begin
  if v_pattern = '' then
    raise exception 'Введите шаблон';
  end if;
  if v_pattern ~ '[%_]' then
    raise exception 'Шаблон не может содержать % и _';
  end if;
  if not exists (select 1 from spend.code_ref c where c.code = p_code) then
    raise exception 'Неизвестная категория: %', coalesce(p_code, '(пусто)');
  end if;
  if exists (
    select 1 from spend.merchant_rule m
    where upper(m.pattern) = upper(v_pattern) and (p_id is null or m.id <> p_id)
  ) then
    raise exception 'Такой шаблон уже есть';
  end if;

  if p_id is null then
    insert into spend.merchant_rule (pattern, code, priority, note)
    values (v_pattern, p_code, coalesce(p_priority, 100), v_note)
    returning id into v_id;
  else
    update spend.merchant_rule
       set pattern = v_pattern, code = p_code,
           priority = coalesce(p_priority, 100), note = v_note
     where id = p_id;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'Правило не найдено';
    end if;
    v_id := p_id;
  end if;

  return v_id;
end;
$$;

-- ── правило по мерчанту: удалить ─────────────────────────────────────────

create or replace function public.app_rule_delete(p_id bigint) returns int
language plpgsql security definer set search_path = spend, public
as $$
declare
  v_n int;
begin
  delete from spend.merchant_rule where id = p_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Правило не найдено';
  end if;
  return v_n;
end;
$$;

-- ── права ────────────────────────────────────────────────────────────────

revoke all on function public.app_codes() from public, anon;
revoke all on function public.app_settings() from public, anon;
revoke all on function public.app_source_rename(text, text) from public, anon;
revoke all on function public.app_code_upsert(text, text, text, int, boolean) from public, anon;
revoke all on function public.app_code_delete(text) from public, anon;
revoke all on function public.app_rule_upsert(bigint, text, text, int, text) from public, anon;
revoke all on function public.app_rule_delete(bigint) from public, anon;

grant execute on function public.app_codes() to authenticated, service_role;
grant execute on function public.app_settings() to authenticated, service_role;
grant execute on function public.app_source_rename(text, text) to authenticated, service_role;
grant execute on function public.app_code_upsert(text, text, text, int, boolean) to authenticated, service_role;
grant execute on function public.app_code_delete(text) to authenticated, service_role;
grant execute on function public.app_rule_upsert(bigint, text, text, int, text) to authenticated, service_role;
grant execute on function public.app_rule_delete(bigint) to authenticated, service_role;
```

- [ ] **Step 2: Apply**

Run from the repo root: `supabase db query --linked -f db/017_app_settings.sql`
Expected: no error output. Re-run it once more: still no error (the file must be re-runnable).

- [ ] **Step 3: Verify each function under the `authenticated` role**

Run each as a separate `supabase db query --linked "<sql>"` call (a raised exception aborts the statement, so do not chain them):

```sql
set role authenticated; select jsonb_object_keys(public.app_settings()) order by 1;
-- expected 5 rows: base_currency, codes, rules, sources, unmapped

set role authenticated; select public.app_settings()->'sources';
-- expected: two objects, bybit_card with last_sync_at not null, manual with last_sync_at null

set role authenticated; select public.app_code_delete('прод');
-- expected error: Категория используется

set role authenticated; select public.app_rule_upsert(null, 'A%B', 'прод', 100, null);
-- expected error: Шаблон не может содержать % и _

set role authenticated; select public.app_rule_upsert(null, 'LIDL', 'прод', 100, null);
-- expected error: Такой шаблон уже есть   (LIDL rule exists; if not, pick any existing pattern from app_settings()->'rules')

set role authenticated; select public.app_code_upsert('тест17', 'Тест', 'Комфорт', 999, true);
-- expected: тест17

set role authenticated; select count(*) from public.app_codes() where code = 'тест17';
-- expected: 0 (hidden)

set role authenticated; select count(*) from jsonb_array_elements(public.app_settings()->'codes') c where c->>'code' = 'тест17' and (c->>'hidden')::boolean;
-- expected: 1

set role authenticated; select public.app_code_delete('тест17');
-- expected: 1

set role anon; select public.app_settings();
-- expected error: permission denied
```

Then `supabase db query --linked -f db/004_verify.sql` — every verdict line must still read OK.

- [ ] **Step 4: Commit**

```bash
git add db/017_app_settings.sql
git commit -m "Settings functions (017): app_settings, code and merchant-rule editing, hidden codes"
```

---

### Task 2: Theme — `shared/theme.ts`, tokens, `main.tsx`

**Files:**
- Create: `app/src/shared/theme.ts`, `app/src/shared/theme.test.ts`
- Modify: `app/src/styles/tokens.scss`, `app/src/main.tsx`

**Interfaces:**
- Produces: `type Theme = 'system' | 'light' | 'dark'`; `readTheme(): Theme`; `applyTheme(theme: Theme): void`.

- [ ] **Step 1: Write the failing test** `app/src/shared/theme.test.ts`

```ts
import { applyTheme, readTheme } from './theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('theme', () => {
  it('applyTheme ставит атрибут и пишет хранилище', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(readTheme()).toBe('dark');
  });

  it('system снимает атрибут и удаляет ключ', () => {
    applyTheme('light');
    applyTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('theme')).toBeNull();
    expect(readTheme()).toBe('system');
  });

  it('readTheme даёт system при мусоре в хранилище', () => {
    localStorage.setItem('theme', 'blue');
    expect(readTheme()).toBe('system');
  });

  it('readTheme и applyTheme переживают недоступное хранилище', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readTheme()).toBe('system');
    expect(() => {
      applyTheme('dark');
    }).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    get.mockRestore();
    set.mockRestore();
  });
});
```

- [ ] **Step 2: Run it** — `cd app && npx vitest run src/shared/theme.test.ts` — expected FAIL: cannot find module `./theme`.

- [ ] **Step 3: Implement** `app/src/shared/theme.ts`

```ts
export type Theme = 'system' | 'light' | 'dark';

const KEY = 'theme';

const isTheme = (v: unknown): v is Theme => v === 'system' || v === 'light' || v === 'dark';

// Тема хранится только на устройстве. Недоступное хранилище (приватный
// режим, запрет на данные сайта) — не ошибка: тема живёт до перезагрузки.
export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return isTheme(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

// «Как в системе» — атрибута нет, работает prefers-color-scheme из tokens.scss.
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // хранилище недоступно — см. readTheme
  }
}
```

- [ ] **Step 4: Tokens** — replace `app/src/styles/tokens.scss` entirely:

```scss
// Тёмный набор один: включается системной темой, если пользователь не
// выбрал светлую, и принудительно по data-theme="dark" (см. shared/theme.ts).
@mixin dark {
  --bg: #161616;
  --fg: #ececec;
  --muted: #9a9a9a;
  --line: #333333;
  --surface: #222222;
  --accent: #ececec;
  --accent-fg: #161616;
  --ok: #6cc48d;
  --err: #f2857c;
}

:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #1a1a1a;
  --muted: #6b6b6b;
  --line: #e3e3e3;
  --surface: #f5f5f5;
  --accent: #1a1a1a;
  --accent-fg: #ffffff;
  --ok: #1c6b3c;
  --err: #b3261e;
  --radius: 10px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --font: 16px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    @include dark;
  }
}

:root[data-theme='light'] {
  color-scheme: light;
}

:root[data-theme='dark'] {
  color-scheme: dark;
  @include dark;
}
```

- [ ] **Step 5: `main.tsx`** — add the import and call before `createRoot`:

```ts
import { applyTheme, readTheme } from '@/shared/theme';
// ...after the imports, before `function App()`:
applyTheme(readTheme());
```

- [ ] **Step 6: Run** `npx vitest run src/shared/theme.test.ts` — PASS. Then `npm run lint && npm run typecheck && npm run test`.

- [ ] **Step 7: Commit**

```bash
git add src/shared/theme.ts src/shared/theme.test.ts src/styles/tokens.scss src/main.tsx
git commit -m "Theme switch: system, light, dark via data-theme and localStorage"
```

---

### Task 3: Types, API endpoints, pure helpers, toast hook

**Files:**
- Modify: `app/src/api/types.ts`, `app/src/api/api.ts`
- Create: `app/src/features/settings/settings.ts`, `app/src/features/settings/settings.test.ts`, `app/src/shared/useToast.ts`

**Interfaces:**
- Produces: the types below; hooks `useGetSettingsQuery, useRenameSourceMutation, useUpsertCodeMutation, useDeleteCodeMutation, useUpsertRuleMutation, useDeleteRuleMutation`; `SECTIONS`, `groupCodes`, `sortRules`, `patternFromMerchant`; `useToast(): { toast: ToastState | null; show: (message: string, kind: 'ok' | 'err') => void }`.

- [ ] **Step 1: Types** — append to `app/src/api/types.ts`:

```ts
export type CodeSection = 'Базовые' | 'Комфорт' | 'Путешествия' | 'Саморазвитие';

export interface SettingsSource {
  code: string;
  title: string;
  txn_count: number;
  last_sync_at: string | null;
  last_sync_ok: boolean | null;
}

export interface SettingsCode {
  code: string;
  title: string;
  section: CodeSection;
  sort_order: number;
  hidden: boolean;
  in_use: boolean;
}

export interface MerchantRule {
  id: number;
  pattern: string;
  code: string;
  priority: number;
  note: string | null;
}

export interface UnmappedRow {
  merchant: string;
  mcc: string | null;
  mcc_desc: string | null;
  txn_count: number;
  amount: number;
  last_seen: string;
}

export interface Settings {
  base_currency: string;
  sources: SettingsSource[];
  codes: SettingsCode[];
  rules: MerchantRule[];
  unmapped: UnmappedRow[];
}

export interface CodeUpsertArgs {
  code: string;
  title: string;
  section: CodeSection;
  sort_order: number;
  hidden: boolean;
}

export interface RuleUpsertArgs {
  id: number | null;
  pattern: string;
  code: string;
  priority: number;
  note: string | null;
}
```

- [ ] **Step 2: API** — in `app/src/api/api.ts`: extend the type import with `CodeUpsertArgs, RuleUpsertArgs, Settings`; change `tagTypes: ['Codes', 'Txns']` to `tagTypes: ['Codes', 'Txns', 'Settings']`; add endpoints after `setCode`:

```ts
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
```

and extend the export line:

```ts
export const {
  useGetCodesQuery, useGetMonthTxnsQuery, useGetMonthlyStatsQuery,
  useAddTxnMutation, useUpdateTxnMutation, useDeleteTxnMutation, useSetCodeMutation,
  useGetSettingsQuery, useRenameSourceMutation, useUpsertCodeMutation, useDeleteCodeMutation,
  useUpsertRuleMutation, useDeleteRuleMutation,
} = api;
```

- [ ] **Step 3: Failing test** `app/src/features/settings/settings.test.ts`

```ts
import type { MerchantRule, SettingsCode } from '@/api/types';
import { groupCodes, patternFromMerchant, sortRules } from './settings';

const code = (over: Partial<SettingsCode>): SettingsCode => ({
  code: 'x', title: 'X', section: 'Базовые', sort_order: 100, hidden: false, in_use: false, ...over,
});
const rule = (over: Partial<MerchantRule>): MerchantRule => ({
  id: 1, pattern: 'A', code: 'прод', priority: 100, note: null, ...over,
});

describe('groupCodes', () => {
  it('разделы в фиксированном порядке, пустые пропущены, внутри по порядку и коду, скрытые в конце', () => {
    const groups = groupCodes([
      code({ code: 'б', section: 'Комфорт', sort_order: 20 }),
      code({ code: 'а', section: 'Комфорт', sort_order: 20 }),
      code({ code: 'скр', section: 'Комфорт', sort_order: 1, hidden: true }),
      code({ code: 'з', section: 'Базовые', sort_order: 5 }),
      code({ code: 'с', section: 'Саморазвитие', sort_order: 1 }),
    ]);
    expect(groups.map((g) => g.section)).toEqual(['Базовые', 'Комфорт', 'Саморазвитие']);
    expect(groups[1]?.codes.map((c) => c.code)).toEqual(['а', 'б', 'скр']);
  });
});

describe('sortRules', () => {
  it('по приоритету, затем длиннее шаблон раньше, затем id; вход не меняется', () => {
    const input = [
      rule({ id: 1, pattern: 'AB', priority: 100 }),
      rule({ id: 2, pattern: 'ABCD', priority: 100 }),
      rule({ id: 3, pattern: 'Z', priority: 10 }),
      rule({ id: 4, pattern: 'AB', priority: 100 }),
    ];
    expect(sortRules(input).map((r) => r.id)).toEqual([3, 2, 1, 4]);
    expect(input.map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });
});

describe('patternFromMerchant', () => {
  it('убирает % и _, обрезает пробелы и длину', () => {
    expect(patternFromMerchant('  LIDL_121 %SUBOTICA  ')).toBe('LIDL121 SUBOTICA');
    expect(patternFromMerchant('A'.repeat(50))).toHaveLength(40);
    expect(patternFromMerchant('A'.repeat(39) + ' B')).toBe('A'.repeat(39));
  });
});
```

- [ ] **Step 4: Run** `npx vitest run src/features/settings/settings.test.ts` — FAIL: module not found.

- [ ] **Step 5: Implement** `app/src/features/settings/settings.ts`

```ts
import type { CodeSection, MerchantRule, SettingsCode } from '@/api/types';

export const SECTIONS: readonly CodeSection[] = ['Базовые', 'Комфорт', 'Путешествия', 'Саморазвитие'];

export interface CodeGroup {
  section: CodeSection;
  codes: SettingsCode[];
}

// Разделы в порядке таблицы пользователя; скрытые — в конце своего раздела.
export function groupCodes(codes: SettingsCode[]): CodeGroup[] {
  return SECTIONS.map((section) => ({
    section,
    codes: codes
      .filter((c) => c.section === section)
      .sort(
        (a, b) =>
          Number(a.hidden) - Number(b.hidden) || a.sort_order - b.sort_order || a.code.localeCompare(b.code, 'ru'),
      ),
  })).filter((g) => g.codes.length > 0);
}

// Тот же порядок, в котором v_txn выбирает правило: приоритет, затем
// длиннее шаблон — важнее. Чтобы список показывал, какое правило победит.
export const sortRules = (rules: MerchantRule[]): MerchantRule[] =>
  [...rules].sort((a, b) => a.priority - b.priority || b.pattern.length - a.pattern.length || a.id - b.id);

// Заготовка шаблона из строки «Без категории»: без подстановочных знаков,
// не длиннее 40 символов.
export const patternFromMerchant = (merchant: string): string =>
  merchant.replace(/[%_]/g, '').trim().slice(0, 40).trim();
```

- [ ] **Step 6: Toast hook** `app/src/shared/useToast.ts`

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

export interface ToastState {
  message: string;
  kind: 'ok' | 'err';
}

// Тост с таймером: успех гаснет через 2 с, ошибка — через 5 с. Тот же
// порядок, что на экранах ввода и месяца.
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, kind: 'ok' | 'err') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, kind });
    timer.current = setTimeout(() => {
      setToast(null);
    }, kind === 'ok' ? 2000 : 5000);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { toast, show };
}
```

- [ ] **Step 7: Run** the settings test — PASS; then `npm run lint && npm run typecheck && npm run test`.

- [ ] **Step 8: Commit**

```bash
git add src/api/types.ts src/api/api.ts src/features/settings/settings.ts src/features/settings/settings.test.ts src/shared/useToast.ts
git commit -m "Settings API: types, endpoints, grouping helpers, toast hook"
```

---

### Task 4: Navigation and the settings screen

**Files:**
- Modify: `app/src/app/router.tsx`, `app/src/shared/TabBar.tsx`
- Create: `app/src/features/settings/SettingsScreen.tsx`, `SettingsScreen.module.scss`, `SourceRow.tsx`, `SettingsScreen.test.tsx`

**Interfaces:**
- Consumes: Task 2 `Theme/readTheme/applyTheme`; Task 3 hooks and `useToast`.
- Produces: routes `/settings`, `/settings/codes`, `/settings/rules` (the last two render placeholders until Tasks 5–6 replace them); class names in `SettingsScreen.module.scss` reused by Tasks 5–6: `wrap, withBar, header, title, back, h2, section, row, chip, chipOn, muted, value, link, list, item, itemMain, itemSub, itemRight, form, actions`.

- [ ] **Step 1: Failing test** `app/src/features/settings/SettingsScreen.test.tsx`

```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router';
import { makeStore } from '@/app/store';
import type { Settings } from '@/api/types';
import { SettingsScreen } from './SettingsScreen';

const rpc = vi.fn();
vi.mock('@/api/supabase', () => ({
  supabase: { rpc: (...a: unknown[]): unknown => rpc(...a), auth: { signOut: vi.fn(() => Promise.resolve({ error: null })) } },
}));

const settings: Settings = {
  base_currency: 'USD',
  sources: [
    { code: 'bybit_card', title: 'Bybit Crypto Card', txn_count: 120, last_sync_at: '2026-09-20T18:42:00+00:00', last_sync_ok: true },
    { code: 'manual', title: 'Ручной ввод', txn_count: 3, last_sync_at: null, last_sync_ok: null },
  ],
  codes: [{ code: 'прод', title: 'Продукты', section: 'Базовые', sort_order: 20, hidden: false, in_use: true }],
  rules: [{ id: 1, pattern: 'LIDL', code: 'прод', priority: 100, note: null }],
  unmapped: [{ merchant: 'NEW SHOP', mcc: '5999', mcc_desc: null, txn_count: 2, amount: 12.5, last_seen: '2026-09-19T10:00:00+00:00' }],
};

const renderScreen = () =>
  render(
    <Provider store={makeStore()}>
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/settings/codes" element={<div>codes page</div>} />
          <Route path="/settings/rules" element={<div>rules page</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  rpc.mockReset();
  rpc.mockImplementation((fn: string) => {
    if (fn === 'app_settings') return Promise.resolve({ data: settings, error: null });
    if (fn === 'app_source_rename') return Promise.resolve({ data: null, error: null });
    return Promise.resolve({ data: null, error: { message: `нет функции ${fn}` } });
  });
});

describe('SettingsScreen', () => {
  it('тема: три кнопки, активная из хранилища, тап применяет', async () => {
    localStorage.setItem('theme', 'dark');
    renderScreen();
    const group = screen.getByRole('radiogroup', { name: 'Тема' });
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    expect(within(group).getByRole('radio', { name: 'Тёмная' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(group).getByRole('radio', { name: 'Светлая' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('валюта без контролов, источники со статусом, ссылки на подэкраны', async () => {
    renderScreen();
    expect(await screen.findByText('USD')).toBeInTheDocument();
    expect(screen.getByText('Меняется вместе с курсами, отдельной задачей')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /валюта/i })).not.toBeInTheDocument();
    const card = screen.getByRole('button', { name: /Bybit Crypto Card/ });
    expect(card).toHaveTextContent('записей: 120');
    expect(card).toHaveTextContent(/синхронизация 20 сентября/);
    expect(screen.getByRole('button', { name: /Ручной ввод/ })).toHaveTextContent('—');
    expect(screen.getByRole('link', { name: /Категории/ })).toHaveTextContent('1');
    expect(screen.getByRole('link', { name: /Правила по мерчантам/ })).toHaveTextContent('без категории: 1');
  });

  it('ошибка синхронизации у источника', async () => {
    rpc.mockImplementation((fn: string) =>
      fn === 'app_settings'
        ? Promise.resolve({
            data: { ...settings, sources: [{ ...settings.sources[0], last_sync_ok: false }] },
            error: null,
          })
        : Promise.resolve({ data: null, error: { message: 'нет' } }),
    );
    renderScreen();
    expect(await screen.findByRole('button', { name: /Bybit/ })).toHaveTextContent('ошибка синхронизации');
  });

  it('переименование источника вызывает app_source_rename и показывает тост', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /Ручной ввод/ }));
    const dialog = screen.getByRole('dialog', { name: 'Источник' });
    const input = within(dialog).getByLabelText('Название');
    await userEvent.clear(input);
    await userEvent.type(input, 'Наличные');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('app_source_rename', { p_code: 'manual', p_title: 'Наличные' });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Сохранено');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ошибка сервера при переименовании остаётся в шторке', async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === 'app_settings') return Promise.resolve({ data: settings, error: null });
      return Promise.resolve({ data: null, error: { message: 'Введите название' } });
    });
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /Ручной ввод/ }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Введите название');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it** — FAIL: module not found.

- [ ] **Step 3: Router** — `app/src/app/router.tsx`: import `SettingsScreen`, `CodesScreen`, `RulesScreen` from `@/features/settings/...` and add the children:

```tsx
      { path: '/settings', element: <SettingsScreen /> },
      { path: '/settings/codes', element: <CodesScreen /> },
      { path: '/settings/rules', element: <RulesScreen /> },
```

For this task, create minimal placeholders so the build passes; Tasks 5 and 6 replace them entirely:

```tsx
// app/src/features/settings/CodesScreen.tsx  (placeholder, replaced in Task 5)
export function CodesScreen() {
  return <main>Категории</main>;
}
// app/src/features/settings/RulesScreen.tsx  (placeholder, replaced in Task 6)
export function RulesScreen() {
  return <main>Правила</main>;
}
```

- [ ] **Step 4: TabBar** — `app/src/shared/TabBar.tsx`: add `{ to: '/settings', label: 'Ещё' }` to `TABS` and change `end` to `end={t.to === '/'}` so «Ещё» stays active on `/settings/codes` and `/settings/rules`.

- [ ] **Step 5: Styles** `app/src/features/settings/SettingsScreen.module.scss`

```scss
.wrap { max-width: 480px; margin: 0 auto; padding: var(--space-4) var(--space-4) 72px; display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-4); }
.withBar { padding-bottom: 112px; }
.header { display: flex; align-items: center; gap: var(--space-3); }
.title { font-size: 20px; font-weight: 600; margin: 0; }
.back { color: var(--muted); text-decoration: none; font-size: 14px; }
.section { display: grid; gap: var(--space-2); }
.h2 { font-size: 13px; color: var(--muted); font-weight: 400; margin: 0; text-transform: uppercase; letter-spacing: 0.04em; }
.row { display: flex; gap: var(--space-1); flex-wrap: wrap; }
.chip { min-height: 40px; padding: 0 var(--space-3); font-size: 14px; }
.chipOn { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
.muted { color: var(--muted); font-size: 14px; margin: 0; }
.value { font-size: 20px; font-weight: 600; margin: 0; }
.link { display: flex; justify-content: space-between; align-items: center; min-height: 48px; padding: var(--space-2) 0; border-bottom: 1px solid var(--line); color: var(--fg); text-decoration: none; }
.list { display: grid; }
.item {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-2); align-items: center;
  width: 100%; text-align: left; padding: var(--space-2) 0; border: 0; border-bottom: 1px solid var(--line);
  background: none; cursor: pointer; min-width: 0; color: inherit;
}
.itemMain { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.itemSub { display: block; color: var(--muted); font-size: 12px; }
.itemRight { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; font-size: 14px; }
.hidden { opacity: 0.5; }
.form { display: grid; gap: var(--space-3); }
.actions { display: grid; gap: var(--space-2); }
.select {
  min-height: 48px; padding: 0 var(--space-3); border: 1px solid var(--line); border-radius: var(--radius);
  background: transparent; width: 100%; font: inherit; color: inherit;
}
.check { display: flex; align-items: center; gap: var(--space-2); min-height: 48px; }
```

- [ ] **Step 6: `SourceRow.tsx`**

```tsx
import { useState } from 'react';
import { useRenameSourceMutation } from '@/api/api';
import type { SettingsSource } from '@/api/types';
import { Button } from '@/shared/Button';
import { Field } from '@/shared/Field';
import { Sheet } from '@/shared/Sheet';
import { formatDateTime } from '@/shared/format';
import styles from './SettingsScreen.module.scss';

const syncLabel = (s: SettingsSource): string => {
  if (s.last_sync_at === null) return '—';
  if (s.last_sync_ok === false) return 'ошибка синхронизации';
  return `синхронизация ${formatDateTime(s.last_sync_at)}`;
};

export function SourceRow({ source, onClick }: { source: SettingsSource; onClick: () => void }) {
  return (
    <button type="button" className={styles.item} onClick={onClick}>
      <span className={styles.itemMain}>
        {source.title}
        <span className={styles.itemSub}>{syncLabel(source)}</span>
      </span>
      <span className={styles.itemRight}>записей: {source.txn_count}</span>
    </button>
  );
}

interface SheetProps {
  source: SettingsSource;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}

export function RenameSourceSheet({ source, onClose, onDone, onError }: SheetProps) {
  const [title, setTitle] = useState(source.title);
  const [rename, { isLoading }] = useRenameSourceMutation();

  return (
    <Sheet open title="Источник" onClose={onClose}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void (async () => {
            const r = await rename({ code: source.code, title });
            if ('error' in r && r.error) {
              onError(r.error.message);
              return;
            }
            onDone('Сохранено');
          })();
        }}
      >
        <Field
          id="source-title"
          label="Название"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
        <Button type="submit" variant="primary" disabled={isLoading}>
          Сохранить
        </Button>
      </form>
    </Sheet>
  );
}
```

Note: `Button` sets `type="button"` before spreading `rest`, so `type="submit"` passed as a prop wins. `r.error.message` is typed `string` because the base query's error type is `AppError`.

- [ ] **Step 7: `SettingsScreen.tsx`**

```tsx
import { useState } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router';
import { useGetSettingsQuery } from '@/api/api';
import type { SettingsSource } from '@/api/types';
import { OfflineBar } from '@/offline/OfflineBar';
import { selectPendingCount } from '@/offline/state';
import { Button } from '@/shared/Button';
import { TabBar } from '@/shared/TabBar';
import { Toast } from '@/shared/Toast';
import { applyTheme, readTheme, type Theme } from '@/shared/theme';
import { useToast } from '@/shared/useToast';
import { RenameSourceSheet, SourceRow } from './SourceRow';
import styles from './SettingsScreen.module.scss';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'Как в системе' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
];

export function SettingsScreen() {
  const { data, isLoading, error } = useGetSettingsQuery();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [renaming, setRenaming] = useState<SettingsSource | null>(null);
  const { toast, show } = useToast();
  const pendingCount = useSelector(selectPendingCount);

  return (
    <main className={[styles.wrap, pendingCount > 0 ? styles.withBar : ''].join(' ')}>
      <h1 className={styles.title}>Ещё</h1>

      <section className={styles.section}>
        <h2 className={styles.h2}>Тема</h2>
        <div role="radiogroup" aria-label="Тема" className={styles.row}>
          {THEMES.map((t) => (
            <Button
              key={t.value}
              role="radio"
              aria-checked={theme === t.value}
              className={[styles.chip, theme === t.value ? styles.chipOn : ''].join(' ')}
              onClick={() => {
                applyTheme(t.value);
                setTheme(t.value);
              }}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </section>

      {isLoading && <p className={styles.muted}>Загружаем…</p>}
      {error && <p className={styles.muted}>Не удалось загрузить: {error.message}</p>}
      {data && (
        <>
          <section className={styles.section}>
            <h2 className={styles.h2}>Базовая валюта</h2>
            <p className={styles.value}>{data.base_currency}</p>
            <p className={styles.muted}>Меняется вместе с курсами, отдельной задачей</p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.h2}>Источники</h2>
            <div className={styles.list}>
              {data.sources.map((s) => (
                <SourceRow
                  key={s.code}
                  source={s}
                  onClick={() => {
                    setRenaming(s);
                  }}
                />
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.h2}>Справочники</h2>
            <Link to="/settings/codes" className={styles.link}>
              Категории <span className={styles.itemRight}>{data.codes.length}</span>
            </Link>
            <Link to="/settings/rules" className={styles.link}>
              Правила по мерчантам{' '}
              <span className={styles.itemRight}>
                {data.rules.length}
                {data.unmapped.length > 0 && ` · без категории: ${String(data.unmapped.length)}`}
              </span>
            </Link>
          </section>
        </>
      )}

      {renaming && (
        <RenameSourceSheet
          key={renaming.code}
          source={renaming}
          onClose={() => {
            setRenaming(null);
          }}
          onDone={(m) => {
            setRenaming(null);
            show(m, 'ok');
          }}
          onError={(m) => {
            show(m, 'err');
          }}
        />
      )}
      <Toast message={toast?.message ?? null} kind={toast?.kind ?? 'ok'} />
      <OfflineBar />
      <TabBar />
    </main>
  );
}
```

- [ ] **Step 8: Run** the test — PASS. Then `npm run lint && npm run typecheck && npm run test && npm run build`.

- [ ] **Step 9: Commit**

```bash
git add src/app/router.tsx src/shared/TabBar.tsx src/features/settings/
git commit -m "Settings screen: theme, base currency, sources; fourth tab"
```

---

### Task 5: Categories — `CodesScreen` and `CodeSheet`

**Files:**
- Replace: `app/src/features/settings/CodesScreen.tsx`
- Create: `app/src/features/settings/CodeSheet.tsx`, `app/src/features/settings/CodesScreen.test.tsx`

**Interfaces:**
- Consumes: `groupCodes`, `SECTIONS` (Task 3); `useUpsertCodeMutation`, `useDeleteCodeMutation`; styles from Task 4.

- [ ] **Step 1: Failing test** `app/src/features/settings/CodesScreen.test.tsx`

```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router';
import { makeStore } from '@/app/store';
import type { Settings } from '@/api/types';
import { CodesScreen } from './CodesScreen';

const rpc = vi.fn();
vi.mock('@/api/supabase', () => ({
  supabase: { rpc: (...a: unknown[]): unknown => rpc(...a), auth: { signOut: vi.fn(() => Promise.resolve({ error: null })) } },
}));

const settings: Settings = {
  base_currency: 'USD',
  sources: [],
  codes: [
    { code: 'прод', title: 'Продукты', section: 'Базовые', sort_order: 20, hidden: false, in_use: true },
    { code: 'каф', title: 'Кафе', section: 'Комфорт', sort_order: 210, hidden: false, in_use: false },
    { code: 'стар', title: 'Старое', section: 'Комфорт', sort_order: 5, hidden: true, in_use: false },
  ],
  rules: [],
  unmapped: [],
};

const renderScreen = () =>
  render(
    <Provider store={makeStore()}>
      <MemoryRouter initialEntries={['/settings/codes']}>
        <CodesScreen />
      </MemoryRouter>
    </Provider>,
  );

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation((fn: string) => {
    if (fn === 'app_settings') return Promise.resolve({ data: settings, error: null });
    if (fn === 'app_code_upsert') return Promise.resolve({ data: 'x', error: null });
    if (fn === 'app_code_delete') return Promise.resolve({ data: 1, error: null });
    return Promise.resolve({ data: null, error: { message: `нет функции ${fn}` } });
  });
});

describe('CodesScreen', () => {
  it('список по разделам, скрытая в конце с подписью', async () => {
    renderScreen();
    expect(await screen.findByRole('heading', { name: 'Категории' })).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Базовые', 'Комфорт']);
    const rows = screen.getAllByRole('button', { name: /^(прод|каф|стар)/ }).map((b) => b.textContent);
    expect(rows[0]).toContain('прод');
    expect(rows[1]).toContain('каф');
    expect(rows[2]).toContain('стар');
    expect(rows[2]).toContain('скрыта');
  });

  it('правка: код заголовком, сохранение вызывает app_code_upsert', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /^каф/ }));
    const dialog = screen.getByRole('dialog', { name: 'каф' });
    expect(within(dialog).queryByLabelText('Код')).not.toBeInTheDocument();
    const title = within(dialog).getByLabelText('Название');
    await userEvent.clear(title);
    await userEvent.type(title, 'Кафе и бары');
    await userEvent.selectOptions(within(dialog).getByLabelText('Раздел'), 'Путешествия');
    await userEvent.click(within(dialog).getByLabelText('Скрыть с экрана ввода'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('app_code_upsert', {
        p_code: 'каф', p_title: 'Кафе и бары', p_section: 'Путешествия', p_sort_order: 210, p_hidden: true,
      });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Сохранено');
  });

  it('создание: поле кода есть, сохранение с новым кодом', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: 'Добавить' }));
    const dialog = screen.getByRole('dialog', { name: 'Новая категория' });
    await userEvent.type(within(dialog).getByLabelText('Код'), 'спорт');
    await userEvent.type(within(dialog).getByLabelText('Название'), 'Спорт');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('app_code_upsert', {
        p_code: 'спорт', p_title: 'Спорт', p_section: 'Базовые', p_sort_order: 100, p_hidden: false,
      });
    });
  });

  it('удаление недоступно у используемой, у свободной — с подтверждением', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /^прод/ }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Удалить' })).toBeDisabled();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Закрыть' }));
    await userEvent.click(screen.getByRole('button', { name: /^каф/ }));
    const del = within(screen.getByRole('dialog')).getByRole('button', { name: 'Удалить' });
    expect(del).toBeEnabled();
    await userEvent.click(del);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Точно удалить' }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('app_code_delete', { p_code: 'каф' });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Удалено');
  });

  it('ошибка сервера в тосте, шторка остаётся', async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === 'app_settings') return Promise.resolve({ data: settings, error: null });
      return Promise.resolve({ data: null, error: { message: 'Неверный код' } });
    });
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: 'Добавить' }));
    await userEvent.type(within(screen.getByRole('dialog')).getByLabelText('Название'), 'X');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Неверный код');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run** — FAIL (placeholder has no heading/list).

- [ ] **Step 3: `CodeSheet.tsx`**

```tsx
import { useState } from 'react';
import { useDeleteCodeMutation, useUpsertCodeMutation } from '@/api/api';
import type { CodeSection, SettingsCode } from '@/api/types';
import { Button } from '@/shared/Button';
import { Field } from '@/shared/Field';
import { Sheet } from '@/shared/Sheet';
import { SECTIONS } from './settings';
import styles from './SettingsScreen.module.scss';

interface Props {
  // null — создание новой категории
  code: SettingsCode | null;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}

const isSection = (v: string): v is CodeSection => (SECTIONS as readonly string[]).includes(v);

// Шторка категории. Код правится только при создании: это идентификатор,
// на который ссылаются правила, переопределения и таблица пользователя.
export function CodeSheet({ code, onClose, onDone, onError }: Props) {
  const [id, setId] = useState(code?.code ?? '');
  const [title, setTitle] = useState(code?.title ?? '');
  const [section, setSection] = useState<CodeSection>(code?.section ?? 'Базовые');
  const [order, setOrder] = useState(String(code?.sort_order ?? 100));
  const [hidden, setHidden] = useState(code?.hidden ?? false);
  const [confirm, setConfirm] = useState(false);
  const [upsert, { isLoading: saving }] = useUpsertCodeMutation();
  const [remove, { isLoading: removing }] = useDeleteCodeMutation();
  const busy = saving || removing;

  return (
    <Sheet open title={code?.code ?? 'Новая категория'} onClose={onClose}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void (async () => {
            const sortOrder = Number.parseInt(order, 10);
            const r = await upsert({
              code: id.trim(),
              title,
              section,
              sort_order: Number.isFinite(sortOrder) ? sortOrder : 100,
              hidden,
            });
            if ('error' in r && r.error) {
              onError(r.error.message);
              return;
            }
            onDone('Сохранено');
          })();
        }}
      >
        {code === null && (
          <Field
            id="code-id"
            label="Код"
            value={id}
            maxLength={16}
            autoComplete="off"
            onChange={(e) => {
              setId(e.target.value);
            }}
          />
        )}
        <Field
          id="code-title"
          label="Название"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
        <label className={styles.form}>
          <span className={styles.muted}>Раздел</span>
          <select
            className={styles.select}
            value={section}
            onChange={(e) => {
              if (isSection(e.target.value)) setSection(e.target.value);
            }}
          >
            {SECTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <Field
          id="code-order"
          label="Порядок"
          type="number"
          inputMode="numeric"
          value={order}
          onChange={(e) => {
            setOrder(e.target.value);
          }}
        />
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={hidden}
            onChange={(e) => {
              setHidden(e.target.checked);
            }}
          />
          Скрыть с экрана ввода
        </label>
        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={busy}>
            Сохранить
          </Button>
          {code !== null && (
            <Button
              variant="ghost"
              disabled={busy || code.in_use}
              title={code.in_use ? 'Категория используется' : undefined}
              onClick={() => {
                if (!confirm) {
                  setConfirm(true);
                  return;
                }
                void (async () => {
                  const r = await remove(code.code);
                  if ('error' in r && r.error) {
                    onError(r.error.message);
                    return;
                  }
                  onDone('Удалено');
                })();
              }}
            >
              {confirm ? 'Точно удалить' : 'Удалить'}
            </Button>
          )}
        </div>
      </form>
    </Sheet>
  );
}
```

`exactOptionalPropertyTypes` note: `title={code.in_use ? '...' : undefined}` is not allowed for an optional prop. Use the spread pattern from `CodePicker.tsx` instead: `{...(code.in_use ? { title: 'Категория используется' } : {})}`.

- [ ] **Step 4: `CodesScreen.tsx`** (replace the placeholder)

```tsx
import { useState } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router';
import { useGetSettingsQuery } from '@/api/api';
import type { SettingsCode } from '@/api/types';
import { OfflineBar } from '@/offline/OfflineBar';
import { selectPendingCount } from '@/offline/state';
import { Button } from '@/shared/Button';
import { TabBar } from '@/shared/TabBar';
import { Toast } from '@/shared/Toast';
import { useToast } from '@/shared/useToast';
import { CodeSheet } from './CodeSheet';
import { groupCodes } from './settings';
import styles from './SettingsScreen.module.scss';

type Editing = { kind: 'closed' } | { kind: 'new' } | { kind: 'edit'; code: SettingsCode };

export function CodesScreen() {
  const { data, isLoading, error } = useGetSettingsQuery();
  const [editing, setEditing] = useState<Editing>({ kind: 'closed' });
  const { toast, show } = useToast();
  const pendingCount = useSelector(selectPendingCount);

  const close = () => {
    setEditing({ kind: 'closed' });
  };

  return (
    <main className={[styles.wrap, pendingCount > 0 ? styles.withBar : ''].join(' ')}>
      <div className={styles.header}>
        <Link to="/settings" className={styles.back}>
          ← Ещё
        </Link>
        <h1 className={styles.title}>Категории</h1>
      </div>
      {isLoading && <p className={styles.muted}>Загружаем…</p>}
      {error && <p className={styles.muted}>Не удалось загрузить: {error.message}</p>}
      {data && (
        <>
          {groupCodes(data.codes).map((g) => (
            <section key={g.section} className={styles.section}>
              <h2 className={styles.h2}>{g.section}</h2>
              <div className={styles.list}>
                {g.codes.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    className={[styles.item, c.hidden ? styles.hidden : ''].join(' ')}
                    onClick={() => {
                      setEditing({ kind: 'edit', code: c });
                    }}
                  >
                    <span className={styles.itemMain}>
                      {c.code} · {c.title}
                      {c.hidden && <span className={styles.itemSub}>скрыта</span>}
                    </span>
                    <span className={styles.itemRight}>{c.sort_order}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          <Button
            onClick={() => {
              setEditing({ kind: 'new' });
            }}
          >
            Добавить
          </Button>
        </>
      )}
      {editing.kind !== 'closed' && (
        <CodeSheet
          key={editing.kind === 'edit' ? editing.code.code : 'new'}
          code={editing.kind === 'edit' ? editing.code : null}
          onClose={close}
          onDone={(m) => {
            close();
            show(m, 'ok');
          }}
          onError={(m) => {
            show(m, 'err');
          }}
        />
      )}
      <Toast message={toast?.message ?? null} kind={toast?.kind ?? 'ok'} />
      <OfflineBar />
      <TabBar />
    </main>
  );
}
```

- [ ] **Step 5: Run** the test — PASS; `npm run lint && npm run typecheck && npm run test`.

- [ ] **Step 6: Commit**

```bash
git add src/features/settings/CodesScreen.tsx src/features/settings/CodeSheet.tsx src/features/settings/CodesScreen.test.tsx
git commit -m "Settings: categories screen with create, edit, hide, delete"
```

---

### Task 6: Merchant rules — `RulesScreen` and `RuleSheet`

**Files:**
- Replace: `app/src/features/settings/RulesScreen.tsx`
- Create: `app/src/features/settings/RuleSheet.tsx`, `app/src/features/settings/RulesScreen.test.tsx`

**Interfaces:**
- Consumes: `sortRules`, `patternFromMerchant`, `groupCodes` (Task 3); `useUpsertRuleMutation`, `useDeleteRuleMutation`; styles from Task 4.

- [ ] **Step 1: Failing test** `app/src/features/settings/RulesScreen.test.tsx`

```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router';
import { makeStore } from '@/app/store';
import type { Settings } from '@/api/types';
import { RulesScreen } from './RulesScreen';

const rpc = vi.fn();
vi.mock('@/api/supabase', () => ({
  supabase: { rpc: (...a: unknown[]): unknown => rpc(...a), auth: { signOut: vi.fn(() => Promise.resolve({ error: null })) } },
}));

const settings: Settings = {
  base_currency: 'USD',
  sources: [],
  codes: [
    { code: 'прод', title: 'Продукты', section: 'Базовые', sort_order: 20, hidden: false, in_use: true },
    { code: 'каф', title: 'Кафе', section: 'Комфорт', sort_order: 210, hidden: false, in_use: true },
  ],
  rules: [
    { id: 1, pattern: 'LIDL', code: 'прод', priority: 100, note: null },
    { id: 2, pattern: 'BURGER', code: 'каф', priority: 50, note: 'бургерная' },
  ],
  unmapped: [
    { merchant: 'NEW_SHOP 12', mcc: '5999', mcc_desc: 'Misc', txn_count: 2, amount: 12.5, last_seen: '2026-09-19T10:00:00+00:00' },
  ],
};

let current = settings;
const renderScreen = () =>
  render(
    <Provider store={makeStore()}>
      <MemoryRouter initialEntries={['/settings/rules']}>
        <RulesScreen />
      </MemoryRouter>
    </Provider>,
  );

beforeEach(() => {
  current = settings;
  rpc.mockReset();
  rpc.mockImplementation((fn: string) => {
    if (fn === 'app_settings') return Promise.resolve({ data: current, error: null });
    if (fn === 'app_rule_upsert') return Promise.resolve({ data: 3, error: null });
    if (fn === 'app_rule_delete') return Promise.resolve({ data: 1, error: null });
    return Promise.resolve({ data: null, error: { message: `нет функции ${fn}` } });
  });
});

describe('RulesScreen', () => {
  it('блок «Без категории» и правила в порядке применения', async () => {
    renderScreen();
    expect(await screen.findByRole('heading', { name: 'Без категории' })).toBeInTheDocument();
    const un = screen.getByRole('button', { name: /NEW_SHOP 12/ });
    expect(un).toHaveTextContent('5999');
    expect(un).toHaveTextContent('2 · 12,50 USD');
    const rules = screen.getAllByRole('button', { name: /^(LIDL|BURGER)/ }).map((b) => b.textContent);
    expect(rules[0]).toContain('BURGER');
    expect(rules[0]).toContain('каф · Кафе');
    expect(rules[1]).toContain('LIDL');
  });

  it('тап по мерчанту заполняет шаблон без подстановочных знаков; сохранение с p_id null', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /NEW_SHOP 12/ }));
    const dialog = screen.getByRole('dialog', { name: 'Новое правило' });
    expect(within(dialog).getByLabelText('Шаблон')).toHaveValue('NEWSHOP 12');
    await userEvent.selectOptions(within(dialog).getByLabelText('Категория'), 'каф');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('app_rule_upsert', {
        p_id: null, p_pattern: 'NEWSHOP 12', p_code: 'каф', p_priority: 100, p_note: null,
      });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Сохранено');
  });

  it('правка существующего с p_id и заметкой', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /^LIDL/ }));
    const dialog = screen.getByRole('dialog', { name: 'LIDL' });
    const prio = within(dialog).getByLabelText('Приоритет');
    await userEvent.clear(prio);
    await userEvent.type(prio, '20');
    await userEvent.type(within(dialog).getByLabelText('Заметка'), 'сеть');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('app_rule_upsert', {
        p_id: 1, p_pattern: 'LIDL', p_code: 'прод', p_priority: 20, p_note: 'сеть',
      });
    });
  });

  it('удаление с подтверждением', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /^LIDL/ }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Удалить' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Точно удалить' }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('app_rule_delete', { p_id: 1 });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Удалено');
  });

  it('без категории не выбрана — сохранение не уходит на сервер', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: 'Добавить' }));
    const dialog = screen.getByRole('dialog', { name: 'Новое правило' });
    await userEvent.type(within(dialog).getByLabelText('Шаблон'), 'X');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Выберите категорию');
    expect(rpc).not.toHaveBeenCalledWith('app_rule_upsert', expect.anything());
  });

  it('пустые состояния', async () => {
    current = { ...settings, rules: [], unmapped: [] };
    renderScreen();
    expect(await screen.findByText('Правил пока нет')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Без категории' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: `RuleSheet.tsx`**

```tsx
import { useState } from 'react';
import { useDeleteRuleMutation, useUpsertRuleMutation } from '@/api/api';
import type { MerchantRule, SettingsCode } from '@/api/types';
import { Button } from '@/shared/Button';
import { Field } from '@/shared/Field';
import { Sheet } from '@/shared/Sheet';
import { groupCodes } from './settings';
import styles from './SettingsScreen.module.scss';

interface Props {
  // Существующее правило, либо заготовка нового (id null): шаблон из
  // блока «Без категории» или пустой.
  rule: MerchantRule | { id: null; pattern: string };
  codes: SettingsCode[];
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}

export function RuleSheet({ rule, codes, onClose, onDone, onError }: Props) {
  const existing = rule.id !== null ? rule : null;
  const [pattern, setPattern] = useState(rule.pattern);
  const [code, setCode] = useState(existing?.code ?? '');
  const [priority, setPriority] = useState(String(existing?.priority ?? 100));
  const [note, setNote] = useState(existing?.note ?? '');
  const [confirm, setConfirm] = useState(false);
  const [upsert, { isLoading: saving }] = useUpsertRuleMutation();
  const [remove, { isLoading: removing }] = useDeleteRuleMutation();
  const busy = saving || removing;

  return (
    <Sheet open title={existing?.pattern ?? 'Новое правило'} onClose={onClose}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (code === '') {
            onError('Выберите категорию');
            return;
          }
          void (async () => {
            const prio = Number.parseInt(priority, 10);
            const r = await upsert({
              id: rule.id,
              pattern,
              code,
              priority: Number.isFinite(prio) ? prio : 100,
              note: note.trim() === '' ? null : note.trim(),
            });
            if ('error' in r && r.error) {
              onError(r.error.message);
              return;
            }
            onDone('Сохранено');
          })();
        }}
      >
        <Field
          id="rule-pattern"
          label="Шаблон"
          value={pattern}
          maxLength={40}
          autoComplete="off"
          onChange={(e) => {
            setPattern(e.target.value);
          }}
        />
        <label className={styles.form}>
          <span className={styles.muted}>Категория</span>
          <select
            className={styles.select}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
            }}
          >
            <option value="">— не выбрана —</option>
            {groupCodes(codes).map((g) => (
              <optgroup key={g.section} label={g.section}>
                {g.codes.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <Field
          id="rule-priority"
          label="Приоритет"
          type="number"
          inputMode="numeric"
          value={priority}
          onChange={(e) => {
            setPriority(e.target.value);
          }}
        />
        <Field
          id="rule-note"
          label="Заметка"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
        <p className={styles.muted}>Меньше приоритет — важнее. При равном побеждает более длинный шаблон.</p>
        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={busy}>
            Сохранить
          </Button>
          {existing && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (!confirm) {
                  setConfirm(true);
                  return;
                }
                void (async () => {
                  const r = await remove(existing.id);
                  if ('error' in r && r.error) {
                    onError(r.error.message);
                    return;
                  }
                  onDone('Удалено');
                })();
              }}
            >
              {confirm ? 'Точно удалить' : 'Удалить'}
            </Button>
          )}
        </div>
      </form>
    </Sheet>
  );
}
```

- [ ] **Step 4: `RulesScreen.tsx`** (replace the placeholder)

```tsx
import { useState } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router';
import { useGetSettingsQuery } from '@/api/api';
import type { MerchantRule } from '@/api/types';
import { OfflineBar } from '@/offline/OfflineBar';
import { selectPendingCount } from '@/offline/state';
import { Button } from '@/shared/Button';
import { TabBar } from '@/shared/TabBar';
import { Toast } from '@/shared/Toast';
import { formatMoney } from '@/shared/format';
import { useToast } from '@/shared/useToast';
import { RuleSheet } from './RuleSheet';
import { patternFromMerchant, sortRules } from './settings';
import styles from './SettingsScreen.module.scss';

type Editing = { kind: 'closed' } | { kind: 'new'; pattern: string } | { kind: 'edit'; rule: MerchantRule };

export function RulesScreen() {
  const { data, isLoading, error } = useGetSettingsQuery();
  const [editing, setEditing] = useState<Editing>({ kind: 'closed' });
  const { toast, show } = useToast();
  const pendingCount = useSelector(selectPendingCount);
  const titles = new Map((data?.codes ?? []).map((c) => [c.code, c.title] as const));

  const close = () => {
    setEditing({ kind: 'closed' });
  };

  return (
    <main className={[styles.wrap, pendingCount > 0 ? styles.withBar : ''].join(' ')}>
      <div className={styles.header}>
        <Link to="/settings" className={styles.back}>
          ← Ещё
        </Link>
        <h1 className={styles.title}>Правила по мерчантам</h1>
      </div>
      {isLoading && <p className={styles.muted}>Загружаем…</p>}
      {error && <p className={styles.muted}>Не удалось загрузить: {error.message}</p>}
      {data && (
        <>
          {data.unmapped.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.h2}>Без категории</h2>
              <div className={styles.list}>
                {data.unmapped.map((u) => (
                  <button
                    key={`${u.merchant}|${u.mcc ?? ''}`}
                    type="button"
                    className={styles.item}
                    onClick={() => {
                      setEditing({ kind: 'new', pattern: patternFromMerchant(u.merchant) });
                    }}
                  >
                    <span className={styles.itemMain}>
                      {u.merchant}
                      <span className={styles.itemSub}>{u.mcc ?? '—'}{u.mcc_desc ? ` · ${u.mcc_desc}` : ''}</span>
                    </span>
                    <span className={styles.itemRight}>
                      {u.txn_count} · {formatMoney(u.amount, data.base_currency)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          <section className={styles.section}>
            <h2 className={styles.h2}>Правила</h2>
            {data.rules.length === 0 && <p className={styles.muted}>Правил пока нет</p>}
            <div className={styles.list}>
              {sortRules(data.rules).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={styles.item}
                  onClick={() => {
                    setEditing({ kind: 'edit', rule: r });
                  }}
                >
                  <span className={styles.itemMain}>
                    {r.pattern}
                    <span className={styles.itemSub}>
                      {r.code} · {titles.get(r.code) ?? '?'}
                      {r.note !== null && ` · ${r.note}`}
                    </span>
                  </span>
                  <span className={styles.itemRight}>{r.priority}</span>
                </button>
              ))}
            </div>
          </section>
          <Button
            onClick={() => {
              setEditing({ kind: 'new', pattern: '' });
            }}
          >
            Добавить
          </Button>
        </>
      )}
      {editing.kind !== 'closed' && data && (
        <RuleSheet
          key={editing.kind === 'edit' ? editing.rule.id : `new:${editing.pattern}`}
          rule={editing.kind === 'edit' ? editing.rule : { id: null, pattern: editing.pattern }}
          codes={data.codes}
          onClose={close}
          onDone={(m) => {
            close();
            show(m, 'ok');
          }}
          onError={(m) => {
            show(m, 'err');
          }}
        />
      )}
      <Toast message={toast?.message ?? null} kind={toast?.kind ?? 'ok'} />
      <OfflineBar />
      <TabBar />
    </main>
  );
}
```

`restrict-template-expressions`: `u.txn_count` and `r.priority` are numbers rendered as JSX children, which is fine; inside template literals wrap numbers with `String()`.

- [ ] **Step 5: Run** the test — PASS; `npm run lint && npm run typecheck && npm run test && npm run build`.

- [ ] **Step 6: Commit**

```bash
git add src/features/settings/RulesScreen.tsx src/features/settings/RuleSheet.tsx src/features/settings/RulesScreen.test.tsx
git commit -m "Settings: merchant rules screen with unmapped merchants block"
```

---

### Task 7: Documentation

**Files:**
- Modify: `README.md`, `docs/ROADMAP.md`

- [ ] **Step 1: README** — in the `db/` tree listing add `017_app_settings.sql   settings: app_settings, code/rule editing, hidden codes`; in the migration order list add `db/017_app_settings.sql` after `016`; in the app section add a short paragraph «Settings» describing the «Ещё» tab (theme on device, base currency display only, sources, categories with hide, merchant rules with the unmapped block) and that all writes go through `app_source_rename`, `app_code_upsert/delete`, `app_rule_upsert/delete`.
- [ ] **Step 2: ROADMAP** — item 4 becomes `**Настройки** — сделано (2026-09-20). Спека \`2026-09-20-app-settings-design.md\`.` Add under «Приложение, после статистики»: `- **Переключение базовой валюты** вместе с фидом курсов ЕЦБ.` and `- **Правила по MCC из интерфейса.**`
- [ ] **Step 3: Commit**

```bash
git add README.md docs/ROADMAP.md
git commit -m "Docs: settings screen, migration 017"
```

---

## Self-review

- **Spec coverage:** theme (T2, T4), base currency display (T4), sources with sync + rename (T1, T4), categories with hide/add/delete-if-unused (T1, T5), rules with unmapped block (T1, T6), navigation (T4), invalidation tags (T3), docs (T7). Browser check is the controller's job after the final review.
- **Type consistency:** `CodeSection` used in types, SQL check list, `SECTIONS`, `CodeSheet`; `RuleUpsertArgs.id: number | null` matches `p_id bigint` nullable; `deleteCode` takes `string`, `deleteRule` takes `number`; sheet callbacks `onDone/onError(message)` identical across T4–T6.
- **Placeholders:** none; T4 placeholders for `CodesScreen`/`RulesScreen` are explicit and replaced in T5/T6.
