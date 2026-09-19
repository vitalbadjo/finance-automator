-- Пополнение курсов card_implied после каждой выгрузки.
--
-- В 007 курсы из собственных транзакций засеяны один раз. Дальше выгрузки
-- добавляли транзакции в динарах, а строки в fx_rate не появлялись: ручная
-- запись в RSD за октябрь взяла бы последний сентябрьский курс. Здесь та же
-- выборка вынесена в функцию, а триггер на raw_txn вызывает её после каждого
-- upsert — одним вызовом на выражение, не на строку.
--
-- on conflict do update, а не do nothing: курс дня — среднее по покупкам
-- этого дня, и если на второй выгрузке подъехала ещё одна покупка того же
-- дня, среднее должно уточниться. Источник 'ecb' при этом не трогается и
-- по-прежнему выигрывает при совпадении даты.

set search_path = spend, public;

create or replace function spend.refresh_implied_rates() returns int
language plpgsql as $$
declare
  v_n int;
begin
  insert into spend.fx_rate as f (rate_date, currency, rate, source)
  select
    (t.txn_at at time zone 'Europe/Belgrade')::date,
    t.local_currency,
    round(sum(t.local_amount) / sum(t.amount), 8),
    'card_implied'
  from spend.raw_txn t
  where t.local_currency is not null
    and t.local_currency <> t.currency
    and t.amount > 0
    and t.local_amount > 0
  group by 1, 2
  on conflict (rate_date, currency, source) do update
    set rate = excluded.rate
    where f.rate is distinct from excluded.rate;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function spend.trg_refresh_implied_rates() returns trigger
language plpgsql as $$
begin
  perform spend.refresh_implied_rates();
  return null;
end;
$$;

drop trigger if exists raw_txn_refresh_rates on spend.raw_txn;
create trigger raw_txn_refresh_rates
  after insert or update on spend.raw_txn
  for each statement
  execute function spend.trg_refresh_implied_rates();

-- Разовый прогон, чтобы догнать всё, что накопилось с 007.
select spend.refresh_implied_rates() as rates_touched;
