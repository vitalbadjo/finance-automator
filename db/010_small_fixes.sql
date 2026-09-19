-- Мелкие правки по итогам ревью 19.09.2026. Ни одна не меняет цифры в v_daily.
--
-- 1. spend_add_manual: p_date::timestamptz зависел от часового пояса сессии.
--    Из SQL Editor это UTC и дата не съезжала; из клиента в другом поясе
--    могла бы уехать на день. Теперь дата явно берётся как полночь Белграда —
--    тот же пояс, в котором v_txn считает txn_date. Заодно on conflict стал
--    обновлять и валюту: раньше повторный вызов с другой валютой молча
--    оставлял старую.
--
-- 2. merchant_rule: pattern подставляется в like как есть, и % или _ в нём
--    стали бы подстановочными знаками. Таких правил нет и не должно быть —
--    констрейнт не даст завести.
--
-- 3. v_fees_monthly: считала по всем источникам, и ручные записи (аренда,
--    юрист) размывали долю комиссии — 0.7% вместо 2% за сентябрь. У ручных
--    записей комиссий не бывает по определению, поэтому они исключены.

set search_path = spend, public;

-- ── 1 ────────────────────────────────────────────────────────────────────

create or replace function public.spend_add_manual(
  p_date date, p_code text, p_amount numeric,
  p_note text default null, p_currency text default 'USD'
) returns text
language plpgsql security definer set search_path = spend, public
as $$
declare
  v_id text := 'manual-' || to_char(p_date, 'YYYY-MM-DD') || '-' || p_code ||
               case when p_note is null then '' else '-' || left(md5(p_note), 6) end;
begin
  insert into spend.raw_txn (
    source, external_id, txn_at, merchant_raw, merchant_name,
    amount, currency, txn_type, message_type, display_status,
    code_override, payload
  ) values (
    'manual', v_id,
    (p_date::timestamp at time zone 'Europe/Belgrade'),
    coalesce(p_note, p_code), coalesce(p_note, p_code),
    p_amount, upper(p_currency), 'deduct', '1', '1',
    p_code, jsonb_build_object('note', p_note)
  )
  on conflict (source, external_id) do update set
    amount        = excluded.amount,
    currency      = excluded.currency,
    merchant_raw  = excluded.merchant_raw,
    merchant_name = excluded.merchant_name,
    code_override = excluded.code_override,
    last_seen_at  = now();
  return v_id;
end;
$$;

-- ── 2 ────────────────────────────────────────────────────────────────────

alter table spend.merchant_rule
  drop constraint if exists merchant_rule_pattern_no_wildcards;
alter table spend.merchant_rule
  add constraint merchant_rule_pattern_no_wildcards
  check (pattern !~ '[%_]');

-- ── 3 ────────────────────────────────────────────────────────────────────

create or replace view v_fees_monthly as
select
  date_trunc('month', txn_date)::date as month,
  round(sum(net_base_amount), 2)      as turnover,
  round(sum(base_fee), 2)             as fees,
  round(100 * sum(base_fee) / nullif(sum(net_base_amount), 0), 2) as fee_pct
from v_txn
where kind in ('expense', 'transfer') and status = 'success'
  and source <> 'manual'
group by 1
order by 1;
