-- Настройки из приложения: скрытие категорий, правка справочников и правил
-- по мерчантам без SQL.
--
-- Правила те же, что у 012/013: схема spend снаружи закрыта, всё через
-- security definer в public, права только authenticated и service_role.
-- Чтение — одна функция app_settings(), отдаёт всё одним jsonb: данных
-- мало (десятки строк), а одна функция проще и в SQL, и в приложении.
-- Запись — узкие функции, каждая проверяет вход и бросает русский текст.
--
-- code_ref.hidden: скрытая категория пропадает с экрана ввода (app_codes),
-- но история и правила её не теряют — v_txn флаг не читает.

set search_path = public;

alter table spend.code_ref add column if not exists hidden boolean not null default false;

-- ── app_codes: только видимые ────────────────────────────────────────────

create or replace function public.app_codes()
returns table (code text, title text, section text, sort_order int)
language sql stable security definer set search_path = spend, public
as $$
  select c.code, c.title, c.section, c.sort_order
  from spend.code_ref c
  where not c.hidden
  order by c.sort_order, c.code
$$;

-- ── чтение всех настроек ─────────────────────────────────────────────────

create or replace function public.app_settings() returns jsonb
language sql stable security definer set search_path = spend, public
as $$
  select jsonb_build_object(
    'base_currency', spend.base_currency(),
    'sources', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', s.code,
        'title', s.title,
        'txn_count', (select count(*) from spend.raw_txn r where r.source = s.code),
        'last_sync_at', ls.at,
        'last_sync_ok', ls.ok
      ) order by s.code), '[]'::jsonb)
      from spend.source s
      left join lateral (
        select coalesce(sr.finished_at, sr.started_at) as at, sr.ok
        from spend.sync_run sr
        where sr.source = s.code
        order by sr.started_at desc
        limit 1
      ) ls on true
    ),
    'codes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', c.code,
        'title', c.title,
        'section', c.section,
        'sort_order', c.sort_order,
        'hidden', c.hidden,
        'in_use',
          exists (select 1 from spend.merchant_rule m where m.code = c.code)
          or exists (select 1 from spend.mcc_rule m where m.code = c.code)
          or exists (select 1 from spend.raw_txn r where r.code_override = c.code)
      ) order by c.sort_order, c.code), '[]'::jsonb)
      from spend.code_ref c
    ),
    'rules', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'pattern', m.pattern, 'code', m.code,
        'priority', m.priority, 'note', m.note
      ) order by m.priority, length(m.pattern) desc, m.id), '[]'::jsonb)
      from spend.merchant_rule m
    ),
    'unmapped', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'merchant', u.merchant, 'mcc', u.mcc, 'mcc_desc', u.mcc_desc,
        'txn_count', u.txn_count, 'amount', u.amount, 'last_seen', u.last_seen
      ) order by u.amount desc), '[]'::jsonb)
      from spend.v_unmapped u
    )
  )
$$;

-- ── название источника ───────────────────────────────────────────────────

create or replace function public.app_source_rename(p_code text, p_title text) returns void
language plpgsql security definer set search_path = spend, public
as $$
declare
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_n     int;
begin
  if v_title is null then
    raise exception 'Введите название';
  end if;
  update spend.source set title = v_title where code = p_code;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Неизвестный источник';
  end if;
end;
$$;

-- ── категория: создать или поправить ─────────────────────────────────────
-- Код — идентификатор из таблицы пользователя: не переименовывается,
-- поэтому upsert по коду, а не по суррогатному id.

create or replace function public.app_code_upsert(
  p_code text, p_title text, p_section text, p_sort_order int, p_hidden boolean
) returns text
language plpgsql security definer set search_path = spend, public
as $$
declare
  v_code  text := btrim(coalesce(p_code, ''));
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
begin
  if v_code = '' or v_code ~ '\s' or length(v_code) > 16 then
    raise exception 'Неверный код';
  end if;
  if v_title is null then
    raise exception 'Введите название';
  end if;
  if p_section is null or p_section not in ('Базовые', 'Комфорт', 'Путешествия', 'Саморазвитие') then
    raise exception 'Неизвестный раздел';
  end if;

  insert into spend.code_ref (code, title, section, sort_order, hidden)
  values (v_code, v_title, p_section, coalesce(p_sort_order, 100), coalesce(p_hidden, false))
  on conflict (code) do update
    set title      = excluded.title,
        section    = excluded.section,
        sort_order = excluded.sort_order,
        hidden     = excluded.hidden;

  return v_code;
end;
$$;

-- ── категория: удалить неиспользуемую ────────────────────────────────────

create or replace function public.app_code_delete(p_code text) returns int
language plpgsql security definer set search_path = spend, public
as $$
declare
  v_n int;
begin
  if exists (select 1 from spend.merchant_rule m where m.code = p_code)
     or exists (select 1 from spend.mcc_rule m where m.code = p_code)
     or exists (select 1 from spend.raw_txn r where r.code_override = p_code) then
    raise exception 'Категория используется';
  end if;
  delete from spend.code_ref where code = p_code;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Категория не найдена';
  end if;
  return v_n;
end;
$$;

-- ── правило по мерчанту: создать или поправить ───────────────────────────
-- Проверки % и _ и дубликата шаблона дублируют констрейнт и уникальный
-- индекс намеренно: пользователь должен видеть русский текст, а не
-- имя констрейнта.

create or replace function public.app_rule_upsert(
  p_id bigint, p_pattern text, p_code text, p_priority int, p_note text
) returns bigint
language plpgsql security definer set search_path = spend, public
as $$
declare
  v_pattern text := btrim(coalesce(p_pattern, ''));
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_id      bigint;
  v_n       int;
begin
  if v_pattern = '' then
    raise exception 'Введите шаблон';
  end if;
  if v_pattern ~ '[%_]' then
    raise exception 'Шаблон не может содержать %% и _';
  end if;
  if not exists (select 1 from spend.code_ref c where c.code = p_code) then
    raise exception 'Неизвестная категория: %', coalesce(p_code, '(пусто)');
  end if;
  if exists (
    select 1 from spend.merchant_rule m
    where upper(m.pattern) = upper(v_pattern) and (p_id is null or m.id <> p_id)
  ) then
    raise exception 'Такой шаблон уже есть';
  end if;

  if p_id is null then
    insert into spend.merchant_rule (pattern, code, priority, note)
    values (v_pattern, p_code, coalesce(p_priority, 100), v_note)
    returning id into v_id;
  else
    update spend.merchant_rule
       set pattern = v_pattern, code = p_code,
           priority = coalesce(p_priority, 100), note = v_note
     where id = p_id;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'Правило не найдено';
    end if;
    v_id := p_id;
  end if;

  return v_id;
end;
$$;

-- ── правило по мерчанту: удалить ─────────────────────────────────────────

create or replace function public.app_rule_delete(p_id bigint) returns int
language plpgsql security definer set search_path = spend, public
as $$
declare
  v_n int;
begin
  delete from spend.merchant_rule where id = p_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Правило не найдено';
  end if;
  return v_n;
end;
$$;

-- ── права ────────────────────────────────────────────────────────────────

revoke all on function public.app_codes() from public, anon;
revoke all on function public.app_settings() from public, anon;
revoke all on function public.app_source_rename(text, text) from public, anon;
revoke all on function public.app_code_upsert(text, text, text, int, boolean) from public, anon;
revoke all on function public.app_code_delete(text) from public, anon;
revoke all on function public.app_rule_upsert(bigint, text, text, int, text) from public, anon;
revoke all on function public.app_rule_delete(bigint) from public, anon;

grant execute on function public.app_codes() to authenticated, service_role;
grant execute on function public.app_settings() to authenticated, service_role;
grant execute on function public.app_source_rename(text, text) to authenticated, service_role;
grant execute on function public.app_code_upsert(text, text, text, int, boolean) to authenticated, service_role;
grant execute on function public.app_code_delete(text) to authenticated, service_role;
grant execute on function public.app_rule_upsert(bigint, text, text, int, text) to authenticated, service_role;
grant execute on function public.app_rule_delete(bigint) to authenticated, service_role;
