-- Идентификатор записи, созданный приложением.
--
-- Офлайн-очередь повторяет отправку, и без готового id повтор после
-- потерянного ответа создал бы дубль: запрос дошёл, ответ не вернулся,
-- очередь отправила ещё раз. Теперь id приходит снаружи, а вставка
-- идемпотентна (on conflict do nothing) и всё равно возвращает id.
--
-- Почему drop, а не create or replace: добавление параметра со значением
-- по умолчанию создаёт ВТОРУЮ функцию, а не заменяет первую, и вызов по
-- именам параметров через PostgREST становится неоднозначным.

set search_path = public;

drop function if exists public.app_add_txn(date, numeric, text, text, text);
-- И свою собственную версию: файл должен переприменяться без ошибки
-- «функция уже существует» и без второй перегрузки.
drop function if exists public.app_add_txn(date, numeric, text, text, text, text);

create function public.app_add_txn(
  p_date date, p_amount numeric, p_currency text, p_code text,
  p_note text default null, p_id text default null
) returns text
language plpgsql security definer set search_path = spend, public
as $$
declare
  v_given text := nullif(btrim(coalesce(p_id, '')), '');
  v_id    text;
  v_title text;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_cur   text := upper(btrim(coalesce(p_currency, '')));
begin
  if v_given is not null
     and v_given !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Неверный идентификатор записи';
  end if;
  v_id := coalesce(v_given, gen_random_uuid()::text);

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
  )
  -- Повторная отправка той же записи не должна ничего менять и не должна
  -- падать: первая попытка могла дойти, а ответ — потеряться.
  on conflict (source, external_id) do nothing;

  return v_id;
end;
$$;

revoke all on function public.app_add_txn(date, numeric, text, text, text, text) from public, anon;
grant execute on function public.app_add_txn(date, numeric, text, text, text, text) to authenticated, service_role;
