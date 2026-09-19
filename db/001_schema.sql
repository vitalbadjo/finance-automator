-- LFS spend pipeline — схема
-- Принцип: raw_txn хранит сырьё как есть, интерпретация живёт во вьюхах
-- и справочниках. Меняешь правило — вся история пересчитывается сама.

create schema if not exists spend;
set search_path = spend, public;

-- ── источники ────────────────────────────────────────────────────────────

create table source (
  code  text primary key,          -- 'bybit_card', позже 'bank_xxx'
  title text not null
);

insert into source (code, title) values ('bybit_card', 'Bybit Crypto Card');

-- ── сырые транзакции ─────────────────────────────────────────────────────
-- Ключ идемпотентности (source, external_id). Статусы меняются постфактум
-- (freeze → deduct, deduct → unfreeze), поэтому только upsert.
--
-- amount всегда >= 0, как присылает источник. Знак выводится во вьюхе из
-- txn_type: это свойство интерпретации, а не данных.

create table raw_txn (
  source          text        not null references source(code),
  external_id     text        not null,
  txn_at          timestamptz not null,

  merchant_raw    text,                   -- merchName, как прислал эквайер
  merchant_name   text,                   -- enrichment, «красивое» имя
  mcc             text,
  mcc_desc        text,

  -- базовая валюта расчёта (для Bybit-карты — USD)
  amount          numeric(14,2) not null,
  currency        text          not null,

  -- валюта и сумма на месте покупки
  local_amount    numeric(14,2),
  local_currency  text,

  -- комиссии и конвертация: настоящая стоимость транзакции
  foreign_fee     numeric(14,4) default 0,  -- foreignTransactionFee
  withdrawal_fee  numeric(14,4) default 0,  -- withdrawalFee
  fx_pad          numeric(14,8) default 0,  -- fxPad
  fx_pad_rate     numeric(14,8) default 0,  -- fxPadRate
  markup_rate     numeric(14,8) default 0,  -- markUpRate

  -- сырые коды источника, из них выводится статус и тип
  txn_type        text,                   -- deduct | freeze | unfreeze
  message_type    text,                   -- 1 покупка | 2 наличные
  display_status  text,                   -- 0 в обработке | 1 успех | 2 отказ | 3 возврат
  card_last4      text,

  payload         jsonb       not null,   -- полный ответ без uid/cardToken

  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),

  primary key (source, external_id)
);

create index raw_txn_at_idx       on raw_txn (txn_at desc);
create index raw_txn_mcc_idx      on raw_txn (mcc);
create index raw_txn_merchant_idx on raw_txn (merchant_raw);
create index raw_txn_card_idx     on raw_txn (source, card_last4);

-- ── справочники ──────────────────────────────────────────────────────────

-- Коды из LFS-2026, вкладка «Деньги». Единственный источник таксономии.
create table code_ref (
  code       text primary key,
  title      text not null,
  section    text not null,                -- Базовые | Комфорт | Путешествия | Саморазвитие
  sort_order int  not null default 100
);

-- Фоллбэк по MCC. Работает только там, где эквайеры не врут.
create table mcc_rule (
  mcc  text primary key,
  code text not null references code_ref(code)
);

-- Основной механизм. Матчится по вхождению pattern в нормализованное имя
-- (и сырое, и «красивое»). priority ниже = важнее.
create table merchant_rule (
  id       bigserial primary key,
  pattern  text not null,
  code     text not null references code_ref(code),
  priority int  not null default 100,
  note     text
);

create unique index merchant_rule_pattern_idx on merchant_rule (upper(pattern));

-- ── нормализация ─────────────────────────────────────────────────────────

create or replace function norm_merchant(s text) returns text
language sql immutable as $$
  select upper(btrim(regexp_replace(coalesce(s, ''), '\s+', ' ', 'g')))
$$;

-- ── классификация ────────────────────────────────────────────────────────
-- kind:
--   auth     — нулевая авторизация (привязка карты). Не расход.
--   transfer — снятие наличных. Не расход: деньги переложены, а не потрачены.
--   void     — отказ или возврат.
--   expense  — всё остальное.
--
-- signed_amount: расход отрицательный, возврат положительный.
-- fx_rate: сколько единиц местной валюты за единицу базовой.
-- true_cost: сумма плюс комиссии — во что транзакция обошлась на самом деле.

create or replace view v_txn as
select
  t.source,
  t.external_id,
  t.txn_at,
  (t.txn_at at time zone 'Europe/Belgrade')::date as txn_date,
  t.merchant_raw,
  t.merchant_name,
  t.mcc,
  t.mcc_desc,
  t.amount,
  t.currency,
  t.local_amount,
  t.local_currency,
  case when t.amount > 0 and t.local_amount is not null
       then round(t.local_amount / t.amount, 4) end               as fx_rate,
  coalesce(t.foreign_fee, 0) + coalesce(t.withdrawal_fee, 0)      as fee_total,
  t.amount + coalesce(t.foreign_fee, 0) + coalesce(t.withdrawal_fee, 0) as true_cost,
  t.card_last4,
  t.txn_type,
  case t.display_status
    when '0' then 'in_progress'
    when '1' then 'success'
    when '2' then 'failed'
    when '3' then 'reversed'
    else 'unknown'
  end as status,
  case
    when t.display_status in ('2','3')                    then 'void'
    when t.amount = 0                                     then 'auth'
    when t.mcc in ('6010','6011') or t.message_type = '2' then 'transfer'
    else 'expense'
  end as kind,
  case when t.txn_type = 'unfreeze' then t.amount else -t.amount end as signed_amount,
  coalesce(
    (select mr.code
       from merchant_rule mr
      where norm_merchant(t.merchant_raw)  like '%' || upper(mr.pattern) || '%'
         or norm_merchant(t.merchant_name) like '%' || upper(mr.pattern) || '%'
      order by mr.priority, length(mr.pattern) desc
      limit 1),
    (select code from mcc_rule where mcc = t.mcc)
  ) as code
from raw_txn t;

-- Суточный агрегат по коду — ровно то, что уезжает в «Мониторинг».
-- Расход положительным числом, в базовой валюте.
create or replace view v_daily as
select
  txn_date,
  code,
  currency,
  round(sum(-signed_amount), 2) as amount,
  round(sum(fee_total), 2)      as fee,
  count(*)                      as txn_count
from v_txn
where kind = 'expense' and code is not null
group by txn_date, code, currency;

-- Что автомат не смог разметить. Разбираешь раз в месяц, добавляешь правило
-- в merchant_rule — история пересчитывается сама.
create or replace view v_unmapped as
select
  norm_merchant(coalesce(merchant_name, merchant_raw)) as merchant,
  mcc,
  mcc_desc,
  count(*)                      as txn_count,
  round(sum(-signed_amount), 2) as amount,
  max(txn_at)                   as last_seen
from v_txn
where kind = 'expense' and code is null
group by 1, 2, 3
order by amount desc;

-- Нулевые авторизации: привязка карты сервисом. Обычно безобидно, но именно
-- так выглядит и перебор карты. Смотреть на незнакомые имена.
create or replace view v_zero_auth as
select
  coalesce(merchant_name, merchant_raw) as merchant,
  mcc, mcc_desc, card_last4,
  count(*)    as attempts,
  min(txn_at) as first_at,
  max(txn_at) as last_at
from v_txn
where kind = 'auth'
group by 1, 2, 3, 4
order by last_at desc;

-- Во что обходится карта: комиссии как доля оборота, по месяцам.
create or replace view v_fees_monthly as
select
  date_trunc('month', txn_date)::date as month,
  round(sum(amount), 2)               as turnover,
  round(sum(fee_total), 2)            as fees,
  round(100 * sum(fee_total) / nullif(sum(amount), 0), 2) as fee_pct
from v_txn
where kind in ('expense', 'transfer') and status = 'success'
group by 1
order by 1;

-- ── журнал выгрузок ──────────────────────────────────────────────────────
-- Нужен для бейджа «дней с последней синхронизации» в расширении.

create table sync_run (
  id          bigserial primary key,
  source      text not null references source(code),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  fetched     int,
  upserted    int,
  ok          boolean,
  error       text
);

create index sync_run_source_idx on sync_run (source, started_at desc);

create or replace view v_sync_status as
select
  s.code                                        as source,
  max(r.finished_at) filter (where r.ok)        as last_ok_at,
  extract(day from now() - max(r.finished_at) filter (where r.ok))::int as days_since
from source s
left join sync_run r on r.source = s.code
group by s.code;
