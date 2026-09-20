# Приложение, задача 5: настройки

Дата: 2026-09-20. Статус: согласовано, ждёт план реализации.
Предыдущие задачи: `2026-09-19-app-entry-design.md`, `2026-09-20-app-month-design.md`,
`2026-09-20-app-stats-design.md`, `2026-09-20-app-offline-design.md` (все в `main`).

## Цель

Экран «Ещё» с настройками: тема приложения, базовая валюта (только показ),
источники со статусом синхронизации, редактирование категорий и правил по
мерчантам из интерфейса вместо SQL. Главная причина заходить сюда — блок
«Без категории»: траты карты, для которых ещё нет правила.

## Решения

| вопрос | решение |
|---|---|
| Базовая валюта | только показ с пояснением «меняется вместе с курсами»; переключение — отдельная задача вместе с фидом курсов (вариант A) |
| Источники | список с числом записей и последней синхронизацией; правится только название; добавления и удаления нет (вариант A) |
| Категории | правка названия, раздела, порядка; добавление; удаление только неиспользуемых; флаг «скрыть» (вариант C) |
| Правила | правила по мерчантам: список, добавить, править, удалить; блок «Без категории» из `v_unmapped` заполняет шаблон нового правила; правила по MCC не трогаем (вариант A) |
| Тема | «как в системе / светлая / тёмная», хранится на устройстве, в базу не пишется |
| Данные | одна функция чтения `app_settings()` + узкие функции записи, один тег `Settings` (вариант A) |
| Навигация | четвёртая вкладка «Ещё» → `/settings`; категории и правила на подэкранах `/settings/codes`, `/settings/rules` |

## База: миграция `db/017_app_settings.sql`

- `alter table spend.code_ref add column hidden boolean not null default false`.
- `app_codes()` отдаёт только `hidden = false` (пересоздаётся через
  `create or replace`, сигнатура прежняя). `v_txn` и правила флаг не читают,
  история не меняется.
- `app_settings() returns jsonb`:
  - `base_currency`: текст;
  - `sources[]`: `code, title, txn_count, last_sync_at, last_sync_ok`
    (`txn_count` из `raw_txn`; `last_sync_*` из последнего `sync_run` по
    источнику, `null` если синхронизаций не было, как у `manual`);
  - `codes[]`: `code, title, section, sort_order, hidden, in_use`
    (`in_use` = есть в `merchant_rule`, `mcc_rule`, `raw_txn.code` или
    `raw_txn.code_override`);
  - `rules[]`: `id, pattern, code, priority, note`;
  - `unmapped[]`: строки `v_unmapped` как есть
    (`merchant, mcc, mcc_desc, txn_count, amount, last_seen`).
- Запись, все `security definer`, `set search_path = spend, public`,
  `revoke all from public, anon`, `grant execute to authenticated, service_role`:
  - `app_source_rename(p_code text, p_title text)`: пустое название — «Введите название»;
    неизвестный код — «Неизвестный источник».
  - `app_code_upsert(p_code text, p_title text, p_section text, p_sort_order int, p_hidden boolean)`:
    `insert … on conflict (code) do update`. Проверки: код непустой, без
    пробелов, не длиннее 16 символов — «Неверный код»; название непустое —
    «Введите название»; раздел из четырёх известных (Базовые, Комфорт,
    Путешествия, Саморазвитие) — «Неизвестный раздел».
  - `app_code_delete(p_code text)`: если `in_use` — «Категория используется»;
    иначе `delete`, возвращает число удалённых строк.
  - `app_rule_upsert(p_id bigint, p_pattern text, p_code text, p_priority int, p_note text) returns bigint`:
    `p_id null` — вставка, иначе `update` (неизвестный id — «Правило не найдено»).
    Шаблон после `btrim` непустой — «Введите шаблон»; без `%` и `_` — «Шаблон
    не может содержать % и _» (проверяем до вставки, чтобы не показывать
    текст constraint); код существует в `code_ref` — «Неизвестная категория».
  - `app_rule_delete(p_id bigint) returns int`.
- Все ошибки через `raise exception` с русским текстом, как в `app_add_txn`.
- `004_verify.sql` не трогается и остаётся зелёной.

## Приложение

### Файлы

```
app/src/
├── api/types.ts                     + Settings, SettingsSource, SettingsCode, MerchantRule, UnmappedRow, CodeSection
├── api/api.ts                       + getSettings (тег Settings); renameSource, upsertCode, deleteCode,
│                                      upsertRule, deleteRule (инвалидируют Settings, Codes; upsertRule/deleteRule ещё и Txns)
├── app/router.tsx                   + /settings, /settings/codes, /settings/rules
├── shared/TabBar.tsx                + «Ещё» (/settings, активна и на подэкранах)
├── shared/theme.ts (+ .test.ts)     Theme = 'system' | 'light' | 'dark'; applyTheme, readTheme
├── styles/tokens.scss               тёмные токены также под :root[data-theme="dark"],
│                                    светлые под :root[data-theme="light"] поверх prefers-color-scheme
├── main.tsx                         applyTheme(readTheme()) до рендера
└── features/settings/
    ├── SettingsScreen.tsx (+ .module.scss, .test.tsx)
    ├── SourceRow.tsx                название (правка по тапу через Sheet), записей, последняя синхронизация
    ├── CodesScreen.tsx (+ .test.tsx) список по разделам, скрытые серым в конце раздела, «Добавить»
    ├── CodeSheet.tsx                код (поле только при создании), название, раздел, порядок, скрыть, удалить
    ├── RulesScreen.tsx (+ .test.tsx) блок «Без категории», список правил, «Добавить»
    ├── RuleSheet.tsx                шаблон, категория, приоритет, заметка, удалить
    └── settings.ts (+ .test.ts)     groupCodes, sortRules, patternFromMerchant
```

### Данные

```ts
type CodeSection = 'Базовые' | 'Комфорт' | 'Путешествия' | 'Саморазвитие';
interface SettingsSource { code: string; title: string; txn_count: number; last_sync_at: string | null; last_sync_ok: boolean | null }
interface SettingsCode { code: string; title: string; section: CodeSection; sort_order: number; hidden: boolean; in_use: boolean }
interface MerchantRule { id: number; pattern: string; code: string; priority: number; note: string | null }
interface UnmappedRow { merchant: string; mcc: string | null; mcc_desc: string | null; txn_count: number; amount: number; last_seen: string }
interface Settings { base_currency: string; sources: SettingsSource[]; codes: SettingsCode[]; rules: MerchantRule[]; unmapped: UnmappedRow[] }
```

`settings.ts`:

- `groupCodes(codes): { section: CodeSection; codes: SettingsCode[] }[]` —
  разделы в порядке Базовые → Комфорт → Путешествия → Саморазвитие, пустые
  разделы пропускаются; внутри по `sort_order`, затем `code`; скрытые в
  конце раздела.
- `sortRules(rules): MerchantRule[]` — по `priority`, затем по длине
  `pattern` по убыванию (тот же порядок, что в `v_txn`), затем `id`.
- `patternFromMerchant(merchant): string` — `btrim`, удаление `%` и `_`,
  обрезка до 40 символов.

### Поведение

- **Тема.** Три кнопки в ряд, активная выделена. `applyTheme` ставит
  `data-theme` на `<html>` и пишет `localStorage['theme']`; `'system'`
  снимает атрибут и удаляет ключ. `readTheme` возвращает `'system'` при
  отсутствии, мусоре или недоступном `localStorage` (try/catch).
  `main.tsx` вызывает `applyTheme(readTheme())` до `createRoot`.
- **Базовая валюта.** Строка «Базовая валюта · USD» и подпись «Меняется
  вместе с курсами, отдельной задачей». Никаких контролов.
- **Источники.** Строка: название, «N записей», «синхронизация 20 сентября,
  21:42» или «ошибка синхронизации» (`last_sync_ok = false`) или «—» (нет
  синхронизаций). Тап открывает шторку с одним полем «Название».
- **Категории.** Список по разделам, у строки код, название, порядок;
  скрытые серым с подписью «скрыта». «Добавить» открывает пустую шторку с
  полем кода. У существующей код показан заголовком и не правится.
  «Удалить» недоступна с подсказкой «используется», если `in_use`; иначе
  подтверждение внутри шторки («Удалить категорию?» → «Удалить»), как у
  трат на экране месяца.
- **Правила.** Сверху блок «Без категории», если `unmapped` не пуст: строки
  «мерчант · MCC · N трат · сумма». Тап открывает `RuleSheet` с
  `pattern = patternFromMerchant(merchant)`, категория не выбрана,
  приоритет 100. Ниже список правил: шаблон, код и название категории,
  приоритет, заметка. Тап правит, «Добавить» создаёт.
- **Кэш и офлайн.** `app_settings` в список кэшируемых функций `withCache`
  не входит. Мутации настроек без сети получают «Нет связи с сервером» в
  тосте; очередь для них не заводится.
- **Инвалидация.** Мутации категорий → `Settings`, `Codes` (экран ввода
  пересчитывает пять частых). Мутации правил → `Settings`, `Txns` (месяц и
  статистика подтягивают новые категории). Переименование источника →
  `Settings`, `Txns` (название источника в строках).
- **Ошибки.** Текст из `raise exception` в тосте, шторка остаётся открытой.
- **Загрузка и пустые состояния.** «Загружаем…» / «Не удалось загрузить: …»
  как на экране месяца. Пустой список правил: «Правил пока нет».

## Проверка

- `theme.test.ts`: `applyTheme('dark')` ставит атрибут и пишет хранилище;
  `'system'` снимает атрибут и удаляет ключ; `readTheme` даёт `'system'`
  при мусоре и при бросающем `localStorage`.
- `settings.test.ts`: порядок разделов и кодов, скрытые в конце; сортировка
  правил; `patternFromMerchant` убирает `%`/`_` и обрезает.
- `SettingsScreen.test.tsx` (замоканный `rpc`): три кнопки темы, активная
  по `readTheme`; валюта без контролов; у карты дата синхронизации, у
  ручного ввода «—»; переименование вызывает `app_source_rename`.
- `CodesScreen.test.tsx`: разделы; шторка; `app_code_upsert` с аргументами;
  «Удалить» недоступна при `in_use`; ошибка сервера в тосте.
- `RulesScreen.test.tsx`: блок «Без категории»; тап заполняет шаблон;
  сохранение с `p_id: null`; правка с `p_id`; удаление; пустое состояние.
- База под `set role authenticated`: `app_settings()` отдаёт пять ключей;
  `app_code_delete` используемого кода — «Категория используется»; шаблон с
  `%` — «Шаблон не может содержать % и _»; `app_codes()` не отдаёт скрытые;
  `anon` не имеет доступа; `004_verify.sql` зелёная.
- Браузер: тема переключается и переживает перезагрузку; скрытая категория
  пропадает с экрана ввода; правило, созданное из «Без категории», меняет
  категорию на экране месяца.

## Развёртывание

Применить `017`, пуш в `main`, Worker пересобирается. `/settings/*`
открывается по прямой ссылке (SPA fallback уже есть).

## Вне задачи

Переключение базовой валюты, правила по MCC, добавление и удаление
источников, перетаскивание порядка, очередь офлайн-мутаций для настроек,
объединение или переименование кодов.
