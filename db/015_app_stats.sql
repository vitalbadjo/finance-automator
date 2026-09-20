-- Статистика по месяцам для приложения: сумма расходов в базовой валюте
-- по каждой паре «месяц × категория» за период, одним вызовом.
--
-- Считается из v_txn, а не из v_daily: код без правила идёт как '?', чтобы
-- цифры сходились с экраном месяца один в один (v_daily такие строки
-- отбрасывает). Права — только authenticated и service_role, как у
-- остальных app_*.

set search_path = public;

create or replace function public.app_monthly_stats(p_from date, p_to date)
returns table (month date, code text, amount numeric, txn_count int)
language sql stable security definer set search_path = spend, public
as $$
  select
    date_trunc('month', t.txn_date)::date as month,
    coalesce(t.code, '?')                 as code,
    round(sum(t.base_amount), 2)          as amount,
    count(*)::int                         as txn_count
  from spend.v_txn t
  where t.kind = 'expense'
    and t.base_amount is not null
    and t.txn_date between p_from and p_to
  group by 1, 2
  order by 1, 2
$$;

revoke all on function public.app_monthly_stats(date, date) from public, anon;
grant execute on function public.app_monthly_stats(date, date) to authenticated, service_role;
