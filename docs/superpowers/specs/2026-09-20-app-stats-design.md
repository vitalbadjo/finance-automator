# Приложение, задача 3: статистика

Дата: 2026-09-20. Статус: согласовано, ждёт план реализации.
Предыдущие задачи: `2026-09-19-app-entry-design.md`, `2026-09-20-app-month-design.md` (обе в `main`).

## Цель

Экран «Статистика» на `/stats`: расходы по месяцам столбцами, разбивка
выбранного месяца по категориям, тренд категории по месяцам, прогноз на
конец текущего месяца. После этой задачи вкладка «Мониторинг» в таблице
больше не нужна как витрина.

## Решения

| вопрос | решение |
|---|---|
| Главный вопрос экрана | «сколько по месяцам и куда уходит» (вариант A) |
| Дополнительно в v1 | тренд категории по тапу; прогноз на конец текущего месяца |
| В роадмап | комиссии по месяцам, снятия по месяцам, период больше 12 месяцев |
| Данные | одна функция `app_monthly_stats(p_from, p_to)` (вариант A) |
| Графики | inline-SVG без библиотек, компонент `BarChart` в `shared/` |
| Состояние | выбранный месяц и код в `useState`, без URL-параметров |

## База: миграция `db/015_app_stats.sql`

### `app_monthly_stats(p_from date, p_to date)`

Возвращает `table (month date, code text, amount numeric, txn_count int)`.

```sql
select
  date_trunc('month', t.txn_date)::date as month,
  coalesce(t.code, '?')                 as code,
  round(sum(t.base_amount), 2)          as amount,
  count(*)::int                         as txn_count
from spend.v_txn t
where t.kind = 'expense'
  and t.base_amount is not null
  and t.txn_date between p_from and p_to
group by 1, 2
order by 1, 2
```

`security definer`, `set search_path = spend, public`, `revoke all from
public, anon`, `grant execute to authenticated, service_role`. Считается из
`v_txn`, а не `v_daily`, чтобы код без правила попадал как `'?'` и суммы
совпадали с экраном месяца. Никаких новых таблиц и вьюх.

## Приложение

### Файлы

```
app/src/
├── api/types.ts                     + MonthlyStat
├── api/api.ts                       + getMonthlyStats (тег Txns)
├── app/router.tsx                   + /stats
├── shared/TabBar.tsx                + «Статистика»
├── shared/BarChart.tsx (+ .module.scss, .test.tsx)
└── features/stats/
    ├── stats.ts (+ .test.ts)        monthTotals, monthBreakdown, codeTrend, forecast
    ├── StatsScreen.tsx (+ .module.scss, .test.tsx)
    ├── Breakdown.tsx                категории месяца с полосками доли
    └── Forecast.tsx                 строка прогноза
```

### Данные и логика

- `MonthlyStat { month: string; code: string; amount: number; txn_count: number }`.
- `useGetMonthlyStatsQuery({ from, to })`: `from` = первое число месяца
  11 месяцев назад, `to` = последний день текущего месяца; `providesTags: ['Txns']`.
- `monthTotals(rows): { month: string; total: number }[]` — по возрастанию
  месяца, только месяцы, где есть строки.
- `monthBreakdown(rows, month): { code: string; amount: number; share: number }[]`
  — по убыванию суммы, `share` в процентах от итога месяца (0–100), `'?'` в
  конце при равенстве.
- `codeTrend(rows, code, months): { month: string; total: number }[]` —
  для каждого месяца из `months` сумма кода или 0.
- `forecast(total, todayISO): { daysPassed: number; daysInMonth: number; perDay: number; projected: number }`
  — `daysPassed` включает сегодня (минимум 1), `perDay = total / daysPassed`,
  `projected = perDay * daysInMonth`, оба округлены до 2 знаков.
- Названия категорий берутся из `useGetCodesQuery` (`code_ref.title`);
  для `'?'` — «без категории».

### `BarChart`

Пропсы: `items: { key: string; label: string; value: number }[]`,
`activeKey: string | null`, `onSelect(key)`, `formatValue(value): string`.
Рендер: `<svg>` с `viewBox`, по прямоугольнику на элемент (`role="button"`,
`aria-pressed`, `aria-label = "{label}: {formatValue(value)}"`), высота
пропорциональна максимуму, подпись `label` под столбцом, значение над
активным столбцом. Цвета через CSS-переменные (`--accent` активный,
`--line` остальные). Пустой `items` → `null`.

### Экран

1. Заголовок «Статистика».
2. Крупно итог выбранного месяца и его название (`formatMonthTitle`).
   Под ним `BarChart` по `monthTotals`, метки — короткое название месяца
   («сен», «авг»), выбранный по умолчанию текущий месяц; если текущего нет в
   данных — последний имеющийся.
3. `Forecast` только когда выбран текущий месяц: «14 дней из 30 · в среднем
   62,10 USD в день · к концу месяца около 1 863,00 USD».
4. `Breakdown` выбранного месяца: строки «код · название · сумма» с
   горизонтальной полоской доли, тап открывает тренд.
5. Режим тренда: заголовок «{код} по месяцам», `BarChart` по
   `codeTrend`, кнопка «Назад к месяцу». Тап по столбцу в тренде выбирает
   месяц и возвращает к разбивке.
6. Пустое состояние без строк вообще: «Пока нет данных ни за один месяц».
7. `TabBar` с третьим пунктом «Статистика» (`/stats`).

Загрузка и ошибка — как на экране месяца («Загружаем…», «Не удалось
загрузить: …»).

## Проверка

- `stats.test.ts`: `monthTotals` сортировка и суммирование; `monthBreakdown`
  порядок и `share` в сумме 100 (с точностью до округления); `codeTrend`
  нули для месяцев без кода; `forecast` на фиксированной дате (например
  2026-09-14, total 869.40 → daysPassed 14, daysInMonth 30, perDay 62.10,
  projected 1863.00) и на первом числе месяца (daysPassed 1).
- `BarChart.test.tsx`: столбец на элемент, `onSelect` с ключом, `aria-pressed`
  на активном, `null` при пустом списке.
- `StatsScreen.test.tsx` (замоканный `rpc`): итог и название текущего месяца;
  строка прогноза есть для текущего и исчезает после выбора прошлого месяца;
  тап по столбцу меняет итог; тап по категории показывает «{код} по месяцам»
  и «Назад к месяцу» возвращает разбивку; пустое состояние.
- База: `015` применена; под `set role authenticated` сумма строк текущего
  месяца равна `total` из `summarize` на экране месяца (проверяется
  запросом к `app_month_txns` за тот же месяц); `004_verify.sql` зелёная.

## Развёртывание

Пуш в `main`, Worker пересобирается, `/stats` открывается по прямой ссылке.

## Вне задачи

Комиссии и снятия по месяцам, период больше 12 месяцев, сравнение с
таблицей, экспорт, анимации и подсказки на графике.
