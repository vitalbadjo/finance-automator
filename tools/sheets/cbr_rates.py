#!/usr/bin/env python3
"""Дневные курсы ЦБ РФ → spend.fx_rate (source = 'cbr').

  python3 tools/sheets/cbr_rates.py --from 2018-07-01 --to 2026-08-31 [--dry-run]

fx_rate.rate — единиц валюты за один доллар. Для RUB это курс USD ЦБ;
для EUR/TRY/THB — отношение рублёвых курсов на ту же дату. Ответ ЦБ —
XML в windows-1251, номинал у лиры и бата 10. Запись идемпотентна
(on conflict (rate_date, currency, source) do update).
"""
import argparse
import datetime
import os
import re
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
import sheetdb  # noqa: E402

IDS = {'USD': 'R01235', 'EUR': 'R01239', 'TRY': 'R01700J', 'THB': 'R01675'}
URL = 'https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1={a}&date_req2={b}&VAL_NM_RQ={id}'
BATCH = 500
REC = re.compile(r'<Record Date="(\d\d)\.(\d\d)\.(\d{4})"[^>]*><Nominal>([\d,\.]+)</Nominal><Value>([\d,\.]+)</Value>')


def parse_records(xml_text: str) -> dict:
    out = {}
    for dd, mm, yyyy, nominal, value in REC.findall(xml_text):
        out[datetime.date(int(yyyy), int(mm), int(dd))] = float(value.replace(',', '.')) / float(nominal.replace(',', '.'))
    return out


def fetch(currency: str, d_from: datetime.date, d_to: datetime.date) -> dict:
    url = URL.format(a=d_from.strftime('%d/%m/%Y'), b=d_to.strftime('%d/%m/%Y'), id=IDS[currency])
    with urllib.request.urlopen(url, timeout=60) as resp:
        return parse_records(resp.read().decode('windows-1251'))


def to_usd_rates(usd: dict, others: dict) -> list:
    out = [(d, 'RUB', r) for d, r in sorted(usd.items())]
    for cur, series in others.items():
        for d, rub_per_unit in sorted(series.items()):
            if d in usd and rub_per_unit > 0:
                out.append((d, cur, usd[d] / rub_per_unit))
    return out


def write(rates: list) -> int:
    n = 0
    for i in range(0, len(rates), BATCH):
        chunk = rates[i:i + BATCH]
        # Значения — только date.isoformat(), фиксированный ключ 'cbr' и
        # отформатированное число: ни одна внешняя строка сюда не попадает.
        # Всё, что могло бы прийти извне, должно идти через sheetdb.sql_literal.
        values = ',\n'.join(f"('{d.isoformat()}', '{c}', {r:.8f}, 'cbr')" for d, c, r in chunk)
        sheetdb.query(
            'insert into spend.fx_rate (rate_date, currency, rate, source) values\n' + values +
            '\non conflict (rate_date, currency, source) do update set rate = excluded.rate'
        )
        n += len(chunk)
    return n


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--from', dest='d_from', required=True, type=datetime.date.fromisoformat)
    ap.add_argument('--to', dest='d_to', required=True, type=datetime.date.fromisoformat)
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args(argv)
    usd = fetch('USD', args.d_from, args.d_to)
    others = {c: fetch(c, args.d_from, args.d_to) for c in IDS if c != 'USD'}
    rates = to_usd_rates(usd, others)
    by_cur = {}
    for _, c, _ in rates:
        by_cur[c] = by_cur.get(c, 0) + 1
    print('Дат по валютам:', by_cur)
    if args.dry_run:
        print('Сухой прогон: ничего не записано.')
        return
    print('Записано строк:', write(rates))


if __name__ == '__main__':
    main()
