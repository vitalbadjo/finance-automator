-- Функция для пинга против засыпания проекта.
--
-- Корень /rest/v1/ Supabase отдаёт только секретному ключу, а класть
-- секретный ключ в GitHub незачем. Эта функция — единственное, что доступно
-- публичному ключу: возвращает время и ничего не читает. Зато вызов через
-- /rest/v1/rpc/ping — настоящий запрос в базу, а не только к шлюзу.

create or replace function public.ping() returns timestamptz
language sql stable as $$ select now() $$;

revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated, service_role;
