-- Мультивалютность.
--
-- Зачем сейчас, когда всё в USD: v_daily группирует по коду И валюте, а
-- spend_sheet_rows суммирует поверх, не глядя на неё. Первая же запись в RSD
-- сложила бы динары с долларами и дала неверную цифру — молча, без ошибки.
-- Чинить надо до появления второй валюты, а не после.
--
-- Модель: в raw_txn лежит сумма в валюте операции. Приведение к базовой —
-- во вьюхе, как и вся остальная интерпретация. Курс хранится, а не
-- зашивается в результат: иначе через полгода не воспроизвести, откуда
-- взялась цифра.

set search_path = spend, public;

-- ── базовая валюта ───────────────────────────────────────────────────────

create table if not exists spend.app_config (
  key   text primary key,
  value text not null
);

insert into spend.app_config (key, value) values ('base_currency', 'USD')
on conflict (key) do nothing;

create or replace function spend.base_currency() returns text
language sql stable as $$
  select value from spend.app_config where key = 'base_currency'
$$;

-- ── курсы ────────────────────────────────────────────────────────────────
-- rate = сколько единиц currency за одну единицу базовой валюты.
-- Для RSD это ~100: та же величина, что local_amount / amount у карты.
--
-- source различает происхождение: 'card_implied' — курс, по которому реально
-- прошла карта, со спредом; 'ecb' — рыночный. Ближайшая дата важнее
-- источника, при равной дате предпочитается рыночный.

create table if not exists spend.fx_rate (
  rate_date date          not null,
  currency  text          not null,
  rate      numeric(20,8) not null check (rate > 0),
  source    text          not null default 'manual',
  primary key (rate_date, currency, source)
);

create index if not exists fx_rate_lookup_idx on spend.fx_rate (currency, rate_date desc);

create or replace function spend.fx_to_base(p_amount numeric, p_currency text, p_date date)
returns numeric
language sql stable as $$
  select case
    when p_amount is null then null
    when p_currency is null or p_currency = spend.base_currency() then p_amount
    else p_amount / nullif((
      select f.rate
        from spend.fx_rate f
       where f.currency = p_currency
         and f.rate_date <= p_date
       order by f.rate_date desc, (f.source = 'ecb') desc
       limit 1
    ), 0)
  end
$$;

-- Затравка из собственных транзакций: у карты есть и сумма в USD, и сумма на
-- месте — то есть фактический курс за каждый день, когда были покупки.
-- Это курс со спредом Bybit, а не рыночный; рыночный фид можно добавить
-- позже с source = 'ecb', он получит приоритет при совпадении даты.
insert into spend.fx_rate (rate_date, currency, rate, source)
select
  (t.txn_at at time zone 'Europe/Belgrade')::date,
  t.local_currency,
  round(sum(t.local_amount) / sum(t.amount), 8),
  'card_implied'
from spend.raw_txn t
where t.local_currency is not null
  and t.local_currency <> t.currency
  and t.amount > 0
  and t.local_amount > 0
group by 1, 2
on conflict (rate_date, currency, source) do nothing;

-- ── приведение к базовой валюте во вьюхах ────────────────────────────────
-- create or replace допускает только дозапись колонок в конец, поэтому
-- определение повторено целиком, а новое добавлено хвостом.

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
    t.code_override,
    (select mr.code
       from merchant_rule mr
      where norm_merchant(t.merchant_raw)  like '%' || upper(mr.pattern) || '%'
         or norm_merchant(t.merchant_name) like '%' || upper(mr.pattern) || '%'
      order by mr.priority, length(mr.pattern) desc
      limit 1),
    (select code from mcc_rule where mcc = t.mcc)
  ) as code,
  -- ниже — приведение к базовой валюте
  spend.base_currency() as base_currency,
  spend.fx_to_base(t.amount, t.currency,
    (t.txn_at at time zone 'Europe/Belgrade')::date)               as base_amount,
  spend.fx_to_base(coalesce(t.foreign_fee,0) + coalesce(t.withdrawal_fee,0), t.currency,
    (t.txn_at at time zone 'Europe/Belgrade')::date)               as base_fee,
  (case when t.txn_type = 'unfreeze' then 1 else -1 end) *
    spend.fx_to_base(t.amount, t.currency,
      (t.txn_at at time zone 'Europe/Belgrade')::date)             as signed_base_amount
from raw_txn t;

-- v_daily меняет состав колонок (валюта уходит), поэтому пересоздаётся.
-- Суммы теперь всегда в базовой валюте — складывать их безопасно.
drop view if exists v_daily;
create view v_daily as
select
  txn_date,
  code,
  round(sum(-signed_base_amount), 2) as amount,
  round(sum(base_fee), 2)            as fee,
  count(*)                           as txn_count
from v_txn
where kind = 'expense' and code is not null and base_amount is not null
group by txn_date, code;

create or replace view v_unmapped as
select
  norm_merchant(coalesce(merchant_name, merchant_raw)) as merchant,
  mcc,
  mcc_desc,
  count(*)                           as txn_count,
  round(sum(-signed_base_amount), 2) as amount,
  max(txn_at)                        as last_seen
from v_txn
where kind = 'expense' and code is null
group by 1, 2, 3
order by amount desc;

create or replace view v_fees_monthly as
select
  date_trunc('month', txn_date)::date as month,
  round(sum(base_amount), 2)          as turnover,
  round(sum(base_fee), 2)             as fees,
  round(100 * sum(base_fee) / nullif(sum(base_amount), 0), 2) as fee_pct
from v_txn
where kind in ('expense', 'transfer') and status = 'success'
group by 1
order by 1;

-- Траты, которые не удалось привести к базовой валюте: нет курса на дату.
-- Они выпадают из v_daily, поэтому заглядывать сюда надо до того, как
-- удивишься недостаче в отчёте.
create or replace view v_missing_rates as
select
  t.currency,
  min(t.txn_date) as first_date,
  max(t.txn_date) as last_date,
  count(*)        as txn_count,
  round(sum(t.amount), 2) as amount_in_currency
from v_txn t
where t.base_amount is null and t.kind = 'expense'
group by t.currency;

-- ── ввод курсов снаружи ──────────────────────────────────────────────────

create or replace function public.spend_set_rate(
  p_date date, p_currency text, p_rate numeric, p_source text default 'manual'
) returns void
language sql security definer set search_path = spend, public as $$
  insert into spend.fx_rate (rate_date, currency, rate, source)
  values (p_date, upper(p_currency), p_rate, p_source)
  on conflict (rate_date, currency, source) do update set rate = excluded.rate;
$$;

revoke all on function public.spend_set_rate(date, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.spend_set_rate(date, text, numeric, text) to service_role;
