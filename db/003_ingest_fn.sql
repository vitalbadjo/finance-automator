-- Приём выгрузки одним вызовом.
--
-- Живёт в public намеренно: схема spend не выставлена в PostgREST, и выставлять
-- её только ради одной вставки не стоит — это открыло бы наружу все таблицы.
-- security definer даёт функции доступ к spend, оставаясь единственной дверью.
--
-- Заодно здесь же чистится payload: идентификаторы аккаунта и токен карты в
-- базе не нужны, и правильное место их выбросить — там же, где запись
-- создаётся, а не на полпути.

set search_path = public;

create or replace function public.spend_ingest(p_source text, p_txns jsonb)
returns jsonb
language plpgsql
security definer
set search_path = spend, public
as $$
declare
  v_run_id    bigint;
  v_upserted  int;
  v_fetched   int := coalesce(jsonb_array_length(p_txns), 0);
begin
  if not exists (select 1 from spend.source where code = p_source) then
    raise exception 'неизвестный источник: %', p_source;
  end if;

  insert into spend.sync_run (source, fetched)
  values (p_source, v_fetched)
  returning id into v_run_id;

  with incoming as (
    select * from jsonb_to_recordset(p_txns) as x(
      external_id     text,
      txn_at          timestamptz,
      merchant_raw    text,
      merchant_name   text,
      mcc             text,
      mcc_desc        text,
      amount          numeric,
      currency        text,
      local_amount    numeric,
      local_currency  text,
      foreign_fee     numeric,
      withdrawal_fee  numeric,
      fx_pad          numeric,
      fx_pad_rate     numeric,
      markup_rate     numeric,
      txn_type        text,
      message_type    text,
      display_status  text,
      card_last4      text,
      payload         jsonb
    )
  ),
  ins as (
    insert into spend.raw_txn (
      source, external_id, txn_at, merchant_raw, merchant_name, mcc, mcc_desc,
      amount, currency, local_amount, local_currency,
      foreign_fee, withdrawal_fee, fx_pad, fx_pad_rate, markup_rate,
      txn_type, message_type, display_status, card_last4, payload, last_seen_at
    )
    select
      p_source, i.external_id, i.txn_at, i.merchant_raw, i.merchant_name,
      i.mcc, i.mcc_desc,
      coalesce(i.amount, 0), coalesce(i.currency, 'USD'),
      i.local_amount, i.local_currency,
      coalesce(i.foreign_fee, 0), coalesce(i.withdrawal_fee, 0),
      coalesce(i.fx_pad, 0), coalesce(i.fx_pad_rate, 0), coalesce(i.markup_rate, 0),
      i.txn_type, i.message_type, i.display_status, i.card_last4,
      coalesce(i.payload, '{}'::jsonb)
        - 'uid' - 'cardToken' - 'pixKey' - 'orderList' - 'totalTaxDetails',
      now()
    from incoming i
    where i.external_id is not null and i.txn_at is not null
    on conflict (source, external_id) do update set
      txn_at         = excluded.txn_at,
      merchant_raw   = excluded.merchant_raw,
      merchant_name  = excluded.merchant_name,
      mcc            = excluded.mcc,
      mcc_desc       = excluded.mcc_desc,
      amount         = excluded.amount,
      currency       = excluded.currency,
      local_amount   = excluded.local_amount,
      local_currency = excluded.local_currency,
      foreign_fee    = excluded.foreign_fee,
      withdrawal_fee = excluded.withdrawal_fee,
      fx_pad         = excluded.fx_pad,
      fx_pad_rate    = excluded.fx_pad_rate,
      markup_rate    = excluded.markup_rate,
      txn_type       = excluded.txn_type,
      message_type   = excluded.message_type,
      display_status = excluded.display_status,
      card_last4     = excluded.card_last4,
      payload        = excluded.payload,
      last_seen_at   = now()
    returning 1
  )
  select count(*)::int into v_upserted from ins;

  update spend.sync_run
     set finished_at = now(), upserted = v_upserted, ok = true
   where id = v_run_id;

  return jsonb_build_object(
    'ok', true, 'fetched', v_fetched, 'upserted', v_upserted, 'run_id', v_run_id
  );
end;
$$;

revoke all on function public.spend_ingest(text, jsonb) from public, anon, authenticated;
grant execute on function public.spend_ingest(text, jsonb) to service_role;
