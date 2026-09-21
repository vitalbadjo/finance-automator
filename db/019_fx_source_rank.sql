-- Детерминированный приоритет источника курса при совпадении даты.
--
-- Зачем: раньше единственный тай-брейк отдавал предпочтение 'ecb', а
-- источники 'cbr' и 'card_implied' были равноправны — при совпадении даты
-- порядок между ними решала СУБД произвольно. С приходом курсов ЦБ РФ это
-- перестало быть теорией: на EUR 2026-07-09 есть и 'cbr', и 'card_implied'
-- на одну и ту же дату. card_implied предпочтительнее cbr, потому что это
-- курс, по которому реально прошло списание, а не справочный.

set search_path = spend, public;

create or replace function spend.fx_to_base(p_amount numeric, p_currency text, p_date date)
returns numeric
language sql stable as $$
  select case
    when p_amount is null then null
    when p_currency is null or p_currency = spend.base_currency() then p_amount
    else p_amount / nullif((
      select f.rate
        from spend.fx_rate f
       where f.currency = p_currency
         and f.rate_date <= p_date
       order by f.rate_date desc,
         case f.source
           when 'ecb' then 0
           when 'manual' then 1
           when 'card_implied' then 2
           when 'cbr' then 3
           else 4
         end
       limit 1
    ), 0)
  end
$$;
