-- Функции для приложения. Единственная дверь в spend для роли authenticated.
--
-- Схема spend наружу не выставлена, как и раньше. Приложение ходит только
-- через эти три функции: справочник кодов, добавление ручной записи,
-- срез транзакций за период. Права — только authenticated и service_role.
--
-- app_add_txn нарочно без on conflict и с uuid вместо составного ключа:
-- у spend_add_manual два кофе в один день без заметки перезаписали бы
-- друг друга, для приложения это неприемлемо (с 016 — с on conflict do
-- nothing, см. 016). spend_add_manual остаётся для SQL Editor.

set search_path = public;

-- ── справочник кодов ─────────────────────────────────────────────────────

create or replace function public.app_codes()
returns table (code text, title text, section text, sort_order int)
language sql stable security definer set search_path = spend, public
as $$
  select c.code, c.title, c.section, c.sort_order
  from spend.code_ref c
  order by c.sort_order, c.code
$$;

-- ── ручная запись ────────────────────────────────────────────────────────

create or replace function public.app_add_txn(
  p_date date, p_amount numeric, p_currency text, p_code text,
  p_note text default null
) returns text
language plpgsql security definer set search_path = spend, public
as $$
declare
  v_id    text := gen_random_uuid()::text;
  v_title text;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_cur   text := upper(btrim(coalesce(p_currency, '')));
begin
  if p_amount is null or not (p_amount > 0 and p_amount < 1e12) then
    raise exception 'Сумма должна быть больше нуля';
  end if;
  if v_cur !~ '^[A-Z]{3}$' then
    raise exception 'Валюта — три латинские буквы, например USD';
  end if;
  if p_date is null then
    raise exception 'Не указана дата';
  end if;

  select c.title into v_title from spend.code_ref c where c.code = p_code;
  if v_title is null then
    raise exception 'Неизвестная категория: %', coalesce(p_code, '(пусто)');
  end if;

  insert into spend.raw_txn (
    source, external_id, txn_at, merchant_raw, merchant_name,
    amount, currency, txn_type, message_type, display_status,
    code_override, payload
  ) values (
    'manual', v_id,
    (p_date::timestamp at time zone 'Europe/Belgrade'),
    coalesce(v_note, v_title), coalesce(v_note, v_title),
    p_amount, v_cur, 'deduct', '1', '1',
    p_code, jsonb_build_object('note', v_note, 'via', 'app')
  );
  return v_id;
end;
$$;

-- ── транзакции за период, все источники ──────────────────────────────────

create or replace function public.app_month_txns(p_from date, p_to date)
returns table (
  external_id   text,
  source        text,
  txn_date      date,
  txn_at        timestamptz,
  merchant_name text,
  amount        numeric,
  currency      text,
  base_amount   numeric,
  base_currency text,
  code          text,
  kind          text,
  status        text,
  note          text
)
language sql stable security definer set search_path = spend, public
as $$
  select
    t.external_id, t.source, t.txn_date, t.txn_at,
    coalesce(t.merchant_name, t.merchant_raw),
    t.amount, t.currency, t.base_amount, t.base_currency,
    t.code, t.kind, t.status,
    r.payload->>'note'
  from spend.v_txn t
  join spend.raw_txn r on r.source = t.source and r.external_id = t.external_id
  where t.txn_date between p_from and p_to
  order by t.txn_at desc
$$;

-- ── права ────────────────────────────────────────────────────────────────

revoke all on function public.app_codes() from public, anon;
revoke all on function public.app_add_txn(date, numeric, text, text, text) from public, anon;
revoke all on function public.app_month_txns(date, date) from public, anon;

grant execute on function public.app_codes() to authenticated, service_role;
grant execute on function public.app_add_txn(date, numeric, text, text, text) to authenticated, service_role;
grant execute on function public.app_month_txns(date, date) to authenticated, service_role;
