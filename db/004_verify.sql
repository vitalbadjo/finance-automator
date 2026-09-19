-- Регрессионная проверка конвейера за 01–18.09.2026.
--
-- Эталон — цифры, посчитанные вручную по интерфейсу Bybit до того, как
-- появилась база, с учётом принятых правил: Glovo/Wolt → гот, PLANET BIKE →
-- байк, HAIRGUARD → внеш, подписки целиком в по, снятие наличных не расход.
--
-- ВАЖНО: проверка намеренно смотрит ТОЛЬКО на source = 'bybit_card'. Ручные
-- записи и будущие банки к эталону отношения не имеют, и если считать их
-- вместе, файл начнёт краснеть каждый раз, когда ты честно что-то добавил.
-- Проверка, которая ругается на нормальную работу, перестаёт читаться.
-- Всё остальное показано в разделе «справочно», без вердикта.
--
-- Запускать когда угодно, ничего не меняет. Читать колонку «итог».
--
-- История расхождений, чтобы не пересчитывать заново:
--   19.09.2026, первый прогон — три расхождения, все ошибки эталона:
--     по         160.37 → 183.32   потеряно одно из двух списаний OpenAI
--                                  22.95 от 09.09 (07:21 и 07:25, разные
--                                  txnId — две настоящие транзакции)
--     итого     1716.29 → 1739.24  следствие того же
--     комиссии    82.86 → 116.95   считался только foreignTransactionFee,
--                                  withdrawalFee (34.09) не учитывался
--     нул. авт.       7 → 8        v_zero_auth группирует по мерчанту, MCC и
--                                  карте; ANTHROPIC есть на 8189 и на 0700
--   19.09.2026, после 007 (мультивалютность) — все карточные суммы совпали,
--     то есть переход на приведение к базовой валюте ничего не сдвинул.
--
-- Все контрольные суммы ограничены датой эталона (по 18.09.2026 включительно),
-- иначе первая же следующая выгрузка сделала бы файл красным. Две проверки,
-- которые смотрят на текущее состояние, а не на эталон — незамеченные
-- мерчанты и валюты без курса — вынесены в раздел «здоровье»: они могут
-- честно покраснеть после новых данных, и это сигнал добавить правило или
-- курс, а не признак сломанной логики.

set search_path = spend, public;

with
period as (
  select '2026-09-01'::date as d1, '2026-09-18'::date as d2
),

-- ── 1. расходы по кодам, только карта ────────────────────────────────────
expected(code, amount) as (values
  ('прод',  148.33),
  ('каф',   269.98),
  ('гот',    52.53),
  ('фит',   105.18),
  ('байк',  712.78),
  ('внеш',  118.00),
  ('быт',    91.51),
  ('од',     52.56),
  ('тел',     5.05),
  ('по',    183.32)
),
actual as (
  select t.code, round(sum(-t.signed_base_amount), 2) as amount
  from v_txn t, period p
  where t.source = 'bybit_card'
    and t.kind = 'expense'
    and t.code is not null
    and t.txn_date between p.d1 and p.d2
  group by t.code
),
by_code as (
  select
    'расход по коду'         as раздел,
    coalesce(e.code, a.code) as ключ,
    e.amount                 as ожидание,
    a.amount                 as факт,
    round(coalesce(a.amount, 0) - coalesce(e.amount, 0), 2) as отклонение
  from expected e
  full outer join actual a on a.code = e.code
),

-- ── 2. контрольные суммы, только карта ───────────────────────────────────
totals as (
  select 'итого расходов' as ключ, 1739.24::numeric as ожидание,
         (select round(sum(amount), 2) from actual) as факт
  union all
  select 'снятие наличных (не расход)', 208.08,
         (select round(sum(-t.signed_base_amount), 2)
            from v_txn t, period p
           where t.source = 'bybit_card' and t.kind = 'transfer'
             and t.status = 'success' and t.txn_date between p.d1 and p.d2)
  union all
  select 'транзакций с карты по 18.09', 128,
         (select count(*) from v_txn t, period p
           where t.source = 'bybit_card' and t.txn_date <= p.d2)
  union all
  select 'оборот по карте по 18.09', 5896.04,
         (select round(sum(t.amount), 2) from v_txn t, period p
           where t.source = 'bybit_card' and t.txn_date <= p.d2)
  union all
  select 'комиссий по карте по 18.09', 116.95,
         (select round(sum(t.fee_total), 2) from v_txn t, period p
           where t.source = 'bybit_card' and t.txn_date <= p.d2)
  union all
  -- та же группировка, что в v_zero_auth, но с отсечкой по дате
  select 'нулевых авторизаций по 18.09', 8,
         (select count(*) from (
            select 1 from v_txn t, period p
             where t.source = 'bybit_card' and t.kind = 'auth' and t.txn_date <= p.d2
             group by coalesce(t.merchant_name, t.merchant_raw), t.mcc, t.mcc_desc, t.card_last4
          ) z)
),
-- ── 2а. здоровье: текущее состояние, не эталон ───────────────────────────
health as (
  select 'мерчантов без правила' as ключ, 0::numeric as ожидание,
         (select count(*) from v_unmapped)::numeric as факт
  union all
  -- после 007: трата без курса не обнуляется, а выпадает из v_daily
  select 'валют без курса', 0,
         (select count(*) from v_missing_rates)
),
by_health as (
  select 'здоровье' as раздел, ключ, ожидание, факт,
         round(coalesce(факт, 0) - ожидание, 2) as отклонение
  from health
),
by_total as (
  select 'контрольная сумма' as раздел, ключ, ожидание, факт,
         round(coalesce(факт, 0) - ожидание, 2) as отклонение
  from totals
),

-- ── 3. справочно: всё, что не карта ──────────────────────────────────────
-- Без эталона и без вердикта: это не регрессия, а текущая картина.
info as (
  select 'ручных записей' as ключ,
         (select count(*) from raw_txn where source = 'manual')::numeric as факт
  union all
  select 'из них через приложение',
         (select count(*) from raw_txn
           where source = 'manual' and payload->>'via' = 'app')::numeric
  union all
  select 'сумма ручных за период',
         (select round(sum(-t.signed_base_amount), 2)
            from v_txn t, period p
           where t.source = 'manual' and t.kind = 'expense'
             and t.txn_date between p.d1 and p.d2)
  union all
  select 'итого расходов за период, все источники',
         (select round(sum(d.amount), 2)
            from v_daily d, period p
           where d.txn_date between p.d1 and p.d2)
  union all
  select 'источников в базе',
         (select count(distinct source) from raw_txn)
),
by_info as (
  select 'справочно' as раздел, ключ, null::numeric as ожидание, факт,
         null::numeric as отклонение
  from info
)

select
  раздел, ключ, ожидание, факт, отклонение,
  case
    when раздел = 'справочно'            then '—'
    when раздел = 'здоровье'             then
         case when coalesce(факт, 0) = 0 then 'ok' else 'ВНИМАНИЕ' end
    when факт is null                    then 'НЕТ ДАННЫХ'
    when ожидание is null                then 'ЛИШНЕЕ'
    when abs(отклонение) < 0.005         then 'ok'
    when abs(отклонение) <= 0.05         then 'округление'
    else 'РАСХОЖДЕНИЕ'
  end as итог
from (
  select * from by_code
  union all select * from by_total
  union all select * from by_health
  union all select * from by_info
) r
order by
  case раздел when 'расход по коду' then 1 when 'контрольная сумма' then 2
              when 'здоровье' then 3 else 4 end,
  abs(coalesce(отклонение, -1)) desc,
  ключ;
