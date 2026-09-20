-- Новые правила категоризации по итогам выгрузки 20.09.2026.
--
-- GOG Sp. z o.o. — магазин игр GOG.com. Эквайер ставит MCC 7993
-- «видеоигры», и этот MCC надёжен, поэтому правило и по мерчанту,
-- и по MCC: другие игровые магазины лягут в «развл» сами.

set search_path = spend, public;

insert into merchant_rule (pattern, code, priority, note)
values ('GOG SP', 'развл', 50, 'GOG.com, игры')
on conflict (upper(pattern)) do nothing;

insert into mcc_rule (mcc, code) values ('7993', 'развл')
on conflict (mcc) do nothing;
