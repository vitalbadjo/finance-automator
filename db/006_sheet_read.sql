-- Чтение для Google Таблицы.
--
-- Отдельная функция, а не выставленная наружу схема: таблице нужен ровно один
-- срез — суточные суммы по кодам за период, в базовой валюте. Всё остальное
-- (сырьё, комиссии, курсы) остаётся внутри.

set search_path = public;

create or replace function public.spend_sheet_rows(p_from date, p_to date)
returns table (txn_date date, code text, amount numeric)
language sql stable security definer set search_path = spend, public
as $$
  select d.txn_date, d.code, round(sum(d.amount), 2)
  from spend.v_daily d
  where d.txn_date between p_from and p_to
  group by d.txn_date, d.code
  order by d.txn_date, d.code
$$;

revoke all on function public.spend_sheet_rows(date, date) from public, anon, authenticated;
grant execute on function public.spend_sheet_rows(date, date) to service_role;
