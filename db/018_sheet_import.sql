-- Импорт истории из таблиц LFS-2018 … LFS-2026 (лист «Мониторинг»).
--
-- Источник 'sheet' — строки, перенесённые разово скриптом
-- tools/sheets/import_sheets.py. external_id = sheet-YYYY-MM-NNN, где NNN —
-- номер строки внутри месячного блока, поэтому повторный запуск обновляет
-- запись, а не задваивает. Категория ставится через code_override, как у
-- ручного ввода; переводы и накопления получают message_type = '2' и в
-- v_txn становятся kind = 'transfer' — в расходы не попадают.
--
-- Категории, которых не было в справочнике, заводятся скрытыми: они нужны
-- истории, но не экрану ввода. В настройках их можно показать.

set search_path = public;

insert into spend.source (code, title) values ('sheet', 'Таблица LFS')
on conflict (code) do nothing;

insert into spend.code_ref (code, title, section, sort_order, hidden) values
  ('серв',   'Обслуживание авто',      'Базовые',      140, true),
  ('авто',   'Покупка авто',           'Базовые',      141, true),
  ('бенз',   'Бензин',                 'Базовые',      142, true),
  ('астрах', 'Страховка авто',         'Базовые',      143, true),
  ('штр',    'Штрафы',                 'Базовые',      144, true),
  ('зем',    'Земля',                  'Комфорт',      320, true),
  ('налог',  'Налоги ИП',              'Комфорт',      321, true),
  ('род',    'Родители',               'Комфорт',      322, true),
  ('благ',   'Благотворительность',    'Комфорт',      323, true),
  ('ж',      'Женщина',                'Комфорт',      324, true),
  ('мам',    'Родителям',              'Комфорт',      325, true),
  ('хоб',    'Хобби',                  'Саморазвитие', 560, true),
  ('муз',    'Музыка',                 'Саморазвитие', 561, true),
  ('пут',    'Путешествия',            'Путешествия',  460, true),
  ('автом',  'Автомобиль в поездке',   'Путешествия',  461, true)
on conflict (code) do nothing;

-- ── загрузка пачки строк ─────────────────────────────────────────────────

create or replace function public.spend_import_sheet_rows(p_rows jsonb) returns int
language plpgsql security definer set search_path = spend, public
as $$
declare
  r        jsonb;
  v_n      int := 0;
  v_code   text;
  v_cur    text;
  v_amount numeric;
  v_ext    text;
  v_date   date;
  v_transfer boolean;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Ожидается массив строк';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_ext      := r->>'external_id';
    v_date     := (r->>'date')::date;
    v_amount   := (r->>'amount')::numeric;
    v_cur      := upper(btrim(coalesce(r->>'currency', '')));
    v_code     := nullif(btrim(coalesce(r->>'code', '')), '');
    v_transfer := coalesce((r->>'transfer')::boolean, false);

    if v_ext is null or v_ext !~ '^sheet-\d{4}-\d{2}-\d{3}$' then
      raise exception 'Неверная строка: external_id %', coalesce(v_ext, '(пусто)');
    end if;
    if v_amount is null or not (v_amount > 0 and v_amount < 1e12) then
      raise exception 'Неверная строка %: сумма должна быть больше нуля', v_ext;
    end if;
    if v_cur !~ '^[A-Z]{3}$' then
      raise exception 'Неверная строка %: валюта — три латинские буквы', v_ext;
    end if;
    if not v_transfer and (v_code is null or not exists (select 1 from spend.code_ref c where c.code = v_code)) then
      raise exception 'Неизвестная категория: % (строка %)', coalesce(v_code, '(пусто)'), v_ext;
    end if;

    insert into spend.raw_txn (
      source, external_id, txn_at, merchant_raw, merchant_name,
      amount, currency, txn_type, message_type, display_status,
      code_override, payload
    ) values (
      'sheet', v_ext,
      (v_date::timestamp at time zone 'Europe/Belgrade'),
      coalesce(r->>'title', v_code, 'перевод'), coalesce(r->>'title', v_code, 'перевод'),
      v_amount, v_cur, 'deduct',
      case when v_transfer then '2' else '1' end, '1',
      case when v_transfer then null else v_code end,
      coalesce(r->'payload', '{}'::jsonb) || jsonb_build_object('via', 'sheet')
    )
    on conflict (source, external_id) do update set
      txn_at         = excluded.txn_at,
      merchant_raw   = excluded.merchant_raw,
      merchant_name  = excluded.merchant_name,
      amount         = excluded.amount,
      currency       = excluded.currency,
      txn_type       = excluded.txn_type,
      message_type   = excluded.message_type,
      display_status = excluded.display_status,
      code_override  = excluded.code_override,
      payload        = excluded.payload,
      last_seen_at   = now();

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

revoke all on function public.spend_import_sheet_rows(jsonb) from public, anon, authenticated;
grant execute on function public.spend_import_sheet_rows(jsonb) to service_role;
