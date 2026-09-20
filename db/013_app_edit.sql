-- Правка из приложения: ручные записи целиком, у любых — категория.
--
-- Правила те же, что у 012: схема spend снаружи закрыта, всё через
-- security definer в public, права только authenticated и service_role.
-- Править и удалять можно только source = 'manual': карточные строки
-- перезаписывает выгрузка, и любая правка кроме code_override пропала бы
-- на следующем синке. code_override выгрузка не трогает — поэтому это
-- единственное, что разрешено менять у карточных.

set search_path = public;

-- ── app_month_txns: + code_override ──────────────────────────────────────
-- create or replace не даёт менять состав возвращаемых колонок,
-- поэтому drop + create, права выдаются заново.

drop function if exists public.app_month_txns(date, date);

create function public.app_month_txns(p_from date, p_to date)
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
  note          text,
  code_override text
)
language sql stable security definer set search_path = spend, public
as $$
  select
    t.external_id, t.source, t.txn_date, t.txn_at,
    coalesce(t.merchant_name, t.merchant_raw),
    t.amount, t.currency, t.base_amount, t.base_currency,
    t.code, t.kind, t.status,
    r.payload->>'note',
    r.code_override
  from spend.v_txn t
  join spend.raw_txn r on r.source = t.source and r.external_id = t.external_id
  where t.txn_date between p_from and p_to
  order by t.txn_at desc
$$;

revoke all on function public.app_month_txns(date, date) from public, anon;
grant execute on function public.app_month_txns(date, date) to authenticated, service_role;

-- ── общая проверка: строка существует и она ручная ───────────────────────

create or replace function spend.assert_manual(p_id text) returns void
language plpgsql as $$
declare
  v_source text;
begin
  select r.source into v_source from spend.raw_txn r where r.external_id = p_id limit 1;
  if v_source is null then
    raise exception 'Запись не найдена';
  end if;
  if v_source <> 'manual' then
    raise exception 'Карточную операцию править нельзя';
  end if;
end;
$$;

-- ── обновление ручной записи ─────────────────────────────────────────────

create or replace function public.app_update_txn(
  p_id text, p_date date, p_amount numeric, p_currency text, p_code text,
  p_note text default null
) returns text
language plpgsql security definer set search_path = spend, public
as $$
declare
  v_title text;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_cur   text := upper(btrim(coalesce(p_currency, '')));
begin
  perform spend.assert_manual(p_id);

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

  update spend.raw_txn set
    txn_at        = (p_date::timestamp at time zone 'Europe/Belgrade'),
    amount        = p_amount,
    currency      = v_cur,
    code_override = p_code,
    merchant_raw  = coalesce(v_note, v_title),
    merchant_name = coalesce(v_note, v_title),
    payload       = payload || jsonb_build_object('note', v_note),
    last_seen_at  = now()
  where source = 'manual' and external_id = p_id;

  return p_id;
end;
$$;

-- ── удаление ручной записи ───────────────────────────────────────────────

create or replace function public.app_delete_txn(p_id text) returns int
language plpgsql security definer set search_path = spend, public
as $$
declare
  v_n int;
begin
  perform spend.assert_manual(p_id);
  delete from spend.raw_txn where source = 'manual' and external_id = p_id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ── категория руками у любой транзакции ──────────────────────────────────
-- p_code = null снимает переопределение: категория снова по правилу.

create or replace function public.app_set_code(p_source text, p_id text, p_code text)
returns void
language plpgsql security definer set search_path = spend, public
as $$
declare
  v_n int;
begin
  if p_code is not null and not exists (select 1 from spend.code_ref c where c.code = p_code) then
    raise exception 'Неизвестная категория: %', p_code;
  end if;
  update spend.raw_txn set code_override = p_code
   where source = p_source and external_id = p_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Запись не найдена';
  end if;
end;
$$;

-- ── права ────────────────────────────────────────────────────────────────

revoke all on function spend.assert_manual(text) from public, anon, authenticated;
revoke all on function public.app_update_txn(text, date, numeric, text, text, text) from public, anon;
revoke all on function public.app_delete_txn(text) from public, anon;
revoke all on function public.app_set_code(text, text, text) from public, anon;

grant execute on function public.app_update_txn(text, date, numeric, text, text, text) to authenticated, service_role;
grant execute on function public.app_delete_txn(text) to authenticated, service_role;
grant execute on function public.app_set_code(text, text, text) to authenticated, service_role;
