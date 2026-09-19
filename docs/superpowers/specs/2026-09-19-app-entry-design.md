# Приложение, задача 1: каркас и ввод транзакции

Дата: 2026-09-19. Статус: согласовано, ждёт план реализации.

## Цель

PWA, которое со временем заменит таблицу LFS-2026. Первая задача — минимум,
которым уже можно пользоваться каждый день: вход, экран добавления
транзакции, список записей за сегодня. Заменяет вызов `spend_add_manual`
из SQL Editor.

Последующие задачи (детализация по месяцам, статистика, настройки) описаны
в `docs/ROADMAP.md` и получат свои спеки.

## Решения

| вопрос | решение |
|---|---|
| Вход | Supabase Auth, email + пароль, один пользователь, заводится руками в панели; регистрация в проекте отключена |
| Стек | Vite + React + TypeScript (strict, без `any`), RTK + RTK Query, SCSS-модули, `vite-plugin-pwa` |
| Где код | этот репозиторий, папка `app/` |
| Хостинг | Cloudflare Pages, сборка из GitHub при пуше в `main` |
| Доступ к базе | функции в `public` с `security definer`, выданы роли `authenticated`; схема `spend` остаётся закрытой |
| Идентификатор ручной записи | `gen_random_uuid()`, без upsert; `spend_add_manual` остаётся для SQL Editor |

## База: миграция `db/012_app.sql`

Три функции в `public`, все `security definer`, `set search_path = spend, public`.
`revoke all ... from public, anon`, `grant execute ... to authenticated, service_role`.

### `app_codes()`

Возвращает `code_ref` целиком: `code, title, section, sort_order`,
отсортировано по `sort_order`. Справочник, приложение кэширует на сессию.

### `app_add_txn(p_date date, p_amount numeric, p_currency text, p_note text, p_code text)`

- Проверки, каждая с `raise exception` и русским текстом, который
  приложение показывает как есть: сумма больше нуля; код существует в
  `code_ref`; валюта — три латинские буквы.
- Вставка в `spend.raw_txn`: `source = 'manual'`,
  `external_id = gen_random_uuid()::text`,
  `txn_at = p_date::timestamp at time zone 'Europe/Belgrade'`,
  `merchant_raw = merchant_name = coalesce(p_note, code_ref.title)`,
  `amount = p_amount`, `currency = upper(p_currency)`,
  `txn_type = 'deduct'`, `message_type = '1'`, `display_status = '1'`,
  `code_override = p_code`,
  `payload = jsonb_build_object('note', p_note, 'via', 'app')`.
- Возвращает `external_id`.
- Никакого `on conflict`: каждый вызов — новая запись.

### `app_month_txns(p_from date, p_to date)`

Срез `v_txn` за период, все источники. Колонки: `external_id, source,
txn_date, txn_at, merchant_name, amount, currency, base_amount,
base_currency, code, kind, status, note` (`note` = `payload->>'note'`).
Сортировка `txn_at desc`. `base_amount` может быть `null`, если для валюты
нет курса — приложение показывает это как отсутствие суммы в базовой валюте,
не как ноль.

### Что не входит

Правка и удаление записей. Это часть задачи «детализация», потому что
требует ответа на вопрос, что можно править у карточной транзакции.

## Приложение: `app/`

```
app/
├── index.html · vite.config.ts · tsconfig.json · eslint.config.js · .prettierrc
├── .env.example        VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
├── public/             иконки PWA
└── src/
    ├── main.tsx        Provider, роутер
    ├── app/            store.ts, router.tsx
    ├── api/            supabase.ts, api.ts (RTK Query), types.ts, errors.ts
    ├── features/
    │   ├── auth/       LoginScreen, useSession, RequireAuth
    │   └── entry/      EntryScreen, entryReducer, AmountField, CurrencyToggle,
    │                   CodeGrid, DatePicker, TodayList
    ├── shared/         Button, Field, Toast, format.ts
    └── styles/         tokens.scss, globals.scss
```

### Данные

- Один RTK Query API. `baseQuery` вызывает `supabase.rpc(name, args)` и
  приводит ошибку к `AppError { message: string }` через type guard
  (`errors.ts`). Никакого `any`.
- Эндпоинты: `getCodes` (тег `Codes`), `getMonthTxns({from, to})` (тег
  `Txns`), `addTxn` (инвалидирует `Txns`).
- Типы ответов описаны руками в `types.ts` по сигнатурам функций из `012`.

### Сессия и маршруты

- Клиент Supabase хранит сессию в `localStorage` и обновляет токен сам.
  `useSession` подписан на `onAuthStateChange`.
- Маршруты: `/login`, `/` (ввод). Всё кроме `/login` обёрнуто в
  `RequireAuth`. Истёкшая сессия — редирект на `/login`, введённое в форме
  теряется, это приемлемо.

### Экран ввода

- Порядок полей: сумма (автофокус, `inputmode="decimal"`), валюта,
  категория, дата, заметка, кнопка «Сохранить».
- **Валюта**: переключатель из трёх последних использованных плюс базовая.
  По умолчанию та, что была в прошлый раз. Список хранится в
  `localStorage`.
- **Категория**: сетка кнопок с кодами, сгруппирована по `section` из
  `code_ref` в порядке `sort_order`. Обязательна.
- **Дата**: по умолчанию сегодня; кнопка «вчера» и нативный `input type="date"`.
- **Заметка**: одна строка, необязательна.
- Состояние формы в `useReducer` внутри `EntryScreen`, не в store.
- Сохранение: кнопка блокируется; успех → тост «Записано» на 2 с, сумма и
  заметка очищаются, категория, валюта и дата остаются; ошибка → тост с
  текстом, введённое сохраняется, кнопка снова активна.
- `TodayList` под формой: записи за сегодня из `getMonthTxns` за текущий
  месяц, фильтр по дате на клиенте. Показывает время, код, сумму с валютой,
  заметку, источник.

### Тема и язык

Светлая и тёмная по `prefers-color-scheme`, токены в `tokens.scss`.
Интерфейс на русском, коды категорий как в `code_ref`.

## Проверка

- `npm run lint` (ESLint, `typescript-eslint` strict,
  `no-explicit-any: error`), `npm run typecheck` (`tsc --noEmit`),
  `npm run test` (Vitest + Testing Library).
- Тесты: `entryReducer` (сброс после сохранения), `errors.ts` (приведение
  ошибок), `EntryScreen` с замоканным API (блокировка кнопки, тост,
  сохранение ввода при ошибке).
- База: `004_verify.sql` не меняет вердиктов — источник `manual` не входит
  в контрольные суммы; в раздел «справочно» добавляется счётчик записей с
  `via = 'app'`.

## Развёртывание

- Supabase: применить `012`; Authentication → отключить Sign-ups; завести
  пользователя; добавить адрес приложения в Redirect URLs.
- Cloudflare Pages: проект из GitHub, root `app`, build `npm run build`,
  output `dist`, переменные `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Локально: `app/.env.local` с теми же переменными (в `.gitignore`).

## Вне первой задачи

Правка и удаление записей, офлайн-режим, переключатель темы, графики,
второй пользователь, распознавание чеков. См. `docs/ROADMAP.md`.
