-- Ручные записи и точечное переопределение кода.
--
-- Зачем колонка code_override, а не правило по мерчанту: правило — про класс
-- явлений («всё из Lidl — продукты»), а тут нужны исключения из одной штуки:
-- аренда, юрист, разовая покупка не в ту категорию. Плодить правила ради
-- одной записи — засорять справочник.
--
-- Важно: code_override не входит в список колонок spend_ingest, поэтому
-- выгрузка его не затирает. Поправил один платёж руками — правка переживёт
-- любое число последующих синхронизаций.

set search_path = spend, public;

alter table spend.raw_txn add column if not exists code_override text
  references spend.code_ref(code);

comment on column spend.raw_txn.code_override is
  'Код, назначенный руками. Приоритетнее правил. Выгрузкой не затирается.';

-- Приоритет: ручной код → правило по мерчанту → фоллбэк по MCC.
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
  ) as code
from raw_txn t;

-- ── источник для ручного ввода ───────────────────────────────────────────

insert into spend.source (code, title)
values ('manual', 'Ручной ввод')
on conflict (code) do nothing;

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
    'manual', v_id, p_date::timestamptz, coalesce(p_note, p_code), coalesce(p_note, p_code),
    p_amount, p_currency, 'deduct', '1', '1',
    p_code, jsonb_build_object('note', p_note)
  )
  on conflict (source, external_id) do update set
    amount = excluded.amount,
    merchant_raw = excluded.merchant_raw,
    merchant_name = excluded.merchant_name,
    code_override = excluded.code_override,
    last_seen_at = now();
  return v_id;
end;
$$;

revoke all on function public.spend_add_manual(date, text, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.spend_add_manual(date, text, numeric, text, text)
  to service_role;

-- ── перенос строк из «Мониторинга», которых нет на карте ─────────────────
-- Из одиннадцати строк сентября девять пришли с карты и теперь берутся из
-- raw_txn — переносить их значило бы посчитать дважды. Переезжают только эти:

select public.spend_add_manual('2026-09-01', 'жил', 1955, 'Аренда жилья');
select public.spend_add_manual('2026-09-01', 'юр',  1102, 'Юридические услуги');
