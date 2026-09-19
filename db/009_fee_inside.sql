-- Комиссия входит в сумму, а не начисляется сверху.
--
-- Проверено 19.09.2026 по всем 107 карточным транзакциям с комиссией:
-- round((amount - foreign_fee - withdrawal_fee) * rate, 2) = foreign_fee
-- сходится на всех 107, гипотеза «сверху» — только на 47, где округления
-- совпадают. Снятие 208.08 раскладывается ровно: 202.00 + 4.04 + 2.04.
--
-- Следствия:
--   * amount уже и есть реальная стоимость операции. Прежний true_cost
--     (amount + комиссии) считал комиссию дважды. Теперь true_cost = amount,
--     колонка оставлена для совместимости. v_daily не менялась: она и так
--     считала по amount, поэтому сентябрьские цифры верны.
--   * Появляется net_amount — сумма без комиссий, столько получил мерчант.
--     Именно её надо делить на local_amount, чтобы получить курс без спреда.
--   * v_fees_monthly: оборот теперь без комиссий, доля комиссии считается
--     от него. Раньше оборот включал комиссии, и доля была занижена.
--
-- create or replace допускает только дозапись колонок в конец, поэтому
-- определение v_txn повторено целиком.

set search_path = spend, public;

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
  t.amount::numeric                                               as true_cost,  -- ::numeric: тип колонки вьюхи менять нельзя
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
      (t.txn_at at time zone 'Europe/Belgrade')::date)             as signed_base_amount,
  -- ниже — добавлено в 009: сумма без комиссий, то, что получил мерчант
  t.amount - coalesce(t.foreign_fee, 0) - coalesce(t.withdrawal_fee, 0) as net_amount,
  spend.fx_to_base(t.amount - coalesce(t.foreign_fee, 0) - coalesce(t.withdrawal_fee, 0),
    t.currency, (t.txn_at at time zone 'Europe/Belgrade')::date)   as net_base_amount
from raw_txn t;

create or replace view v_fees_monthly as
select
  date_trunc('month', txn_date)::date as month,
  round(sum(net_base_amount), 2)      as turnover,
  round(sum(base_fee), 2)             as fees,
  round(100 * sum(base_fee) / nullif(sum(net_base_amount), 0), 2) as fee_pct
from v_txn
where kind in ('expense', 'transfer') and status = 'success'
group by 1
order by 1;
