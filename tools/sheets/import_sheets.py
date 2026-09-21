#!/usr/bin/env python3
"""Импорт истории из таблиц LFS-YYYY.xlsx (лист «Мониторинг») в spend.raw_txn.

  python3 tools/sheets/import_sheets.py --dry-run ~/lfs/LFS-*.xlsx
  python3 tools/sheets/import_sheets.py           ~/lfs/LFS-*.xlsx

Год берётся из имени файла. Для 2026 импортируются блоки январь–август:
с сентября лист заполняет скрипт из базы. Сухой прогон печатает отчёт и
ничего не пишет. Запись идёт пачками через public.spend_import_sheet_rows,
повторный запуск обновляет строки (external_id = sheet-YYYY-MM-NNN).
"""
import argparse
import collections
import datetime
import json
import os
import re
import sys
from dataclasses import dataclass

sys.path.insert(0, os.path.dirname(__file__))
import sheetdb  # noqa: E402
import xlsx  # noqa: E402

SHEET = 'Мониторинг'
BATCH = 500

# Опечатки в кодах → код справочника. «cиг» начинается с латинской c.
TYPOS = {
    'cиг': 'сиг', 'каФ': 'каф', 'одеж': 'од', 'разрл': 'развл', 'тран': 'тр',
    'про': 'прод', 'хоз': 'быт', 'свмол': 'самол', 'фмн': 'фин', 'надж': 'гадж',
    'моб': 'тел', 'фмт': 'фит', 'акл': 'алк', 'фоб': 'хоб', 'та': 'такс', 'ард': 'быт',
}
# Переводы и накопления: не расходы, в v_txn станут kind = 'transfer'.
TRANSFER = {'инв', 'конв', 'выр', 'вкп', 'вкм', 'вкз', 'пб', 'баланс', 'бал', 'вд', 'дол'}
TRANSFER_TITLES = {
    'инв': 'Инвестиции', 'конв': 'Покупка валюты', 'выр': 'Выравнивание', 'вкп': 'Вклад подушка',
    'вкм': 'Вклад машина', 'вкз': 'Вклад зубы', 'пб': 'Финансовая подушка', 'баланс': 'Выравнивание баланса',
    'бал': 'Баланс', 'вд': 'Возврат долга', 'дол': 'Долг старый',
}
CURRENCY = {'RUR': 'RUB', 'RUB': 'RUB', 'LYR': 'TRY', 'BTH': 'THB'}


@dataclass
class Raw:
    month: int
    n: int
    date: object
    code: str
    amount: float
    cur: str
    rate: float
    total: float


def serial2date(v) -> datetime.date:
    return datetime.date(1899, 12, 30) + datetime.timedelta(days=int(v))


def resolve_date(cell, year: int, month: int) -> datetime.date:
    """День из ячейки берём только если её год и месяц совпадают с блоком."""
    if isinstance(cell, (int, float)):
        try:
            d = serial2date(cell)
        except (OverflowError, ValueError):
            return datetime.date(year, month, 1)
        if d.year == year and d.month == month:
            return d
    return datetime.date(year, month, 1)


def parse_blocks(grid: dict, year: int, months) -> list:
    """Строки блоков: заполнены код и сумма > 0. Пропущенные (сумма <= 0)
    считаются в parse_blocks.skipped — они видны в отчёте."""
    header = next(r for (r, c), v in grid.items() if c == 1 and v == 'дата')
    maxrow = max(r for r, _ in grid)
    out, skipped = [], 0
    for m in months:
        o = 7 * (m - 1)
        n = 0
        for r in range(header + 1, maxrow + 1):
            code, amount = grid.get((r, o + 2)), grid.get((r, o + 3))
            if not isinstance(code, str) or not code.strip() or not isinstance(amount, (int, float)):
                continue
            if amount <= 0:
                skipped += 1
                continue
            n += 1
            rate = grid.get((r, o + 5))
            total = grid.get((r, o + 6))
            out.append(Raw(
                month=m, n=n, date=grid.get((r, o + 1)), code=code.strip(), amount=float(amount),
                cur=str(grid.get((r, o + 4)) or 'RUR').strip(),
                rate=float(rate) if isinstance(rate, (int, float)) else 1.0,
                total=float(total) if isinstance(total, (int, float)) else float(amount) * (float(rate) if isinstance(rate, (int, float)) else 1.0),
            ))
    parse_blocks.skipped = skipped
    return out


parse_blocks.skipped = 0


def normalize(year: int, month: int, n: int, date, code: str, amount: float, cur: str, rate: float, total: float, titles: dict) -> dict:
    """Строка для spend_import_sheet_rows. Неизвестный код → KeyError."""
    mapped = TYPOS.get(code, code)
    transfer = mapped in TRANSFER
    if transfer:
        title = TRANSFER_TITLES[mapped]
    else:
        title = titles[mapped]  # KeyError — код вне справочника
    return {
        'external_id': f'sheet-{year:04d}-{month:02d}-{n:03d}',
        'date': resolve_date(date, year, month).isoformat(),
        'amount': round(amount, 2),
        'currency': CURRENCY.get(cur.upper(), cur.upper()),
        'code': mapped,
        'transfer': transfer,
        'title': title,
        'payload': {
            'via': 'sheet', 'year': year, 'month': month, 'row': n,
            'sheet_code': code, 'sheet_currency': cur, 'sheet_rate': rate, 'total_rub': round(total, 2),
        },
    }


def summarize(rows: list) -> dict:
    s = collections.defaultdict(lambda: {'n': 0, 'rub': 0.0, 'currencies': collections.Counter(), 'transfers': 0})
    for r in rows:
        p = r['payload']
        k = (p['year'], p['month'])
        s[k]['n'] += 1
        s[k]['rub'] += p['total_rub']
        s[k]['currencies'][r['currency']] += 1
        s[k]['transfers'] += int(r['transfer'])
    return {k: {**v, 'currencies': dict(v['currencies']), 'rub': round(v['rub'], 2)} for k, v in s.items()}


def load_titles() -> dict:
    return {r['code']: r['title'] for r in sheetdb.query('select code, title from spend.code_ref')}


def year_of(path: str) -> int:
    m = re.search(r'LFS-(\d{4})', os.path.basename(path))
    if not m:
        raise SystemExit(f'Не могу понять год из имени файла: {path}')
    return int(m.group(1))


def collect(paths: list, titles: dict) -> list:
    rows, unknown, skipped = [], collections.Counter(), 0
    for path in paths:
        year = year_of(path)
        months = range(1, 9) if year == 2026 else range(1, 13)
        grid = xlsx.load(path)[SHEET]
        for raw in parse_blocks(grid, year, months):
            try:
                rows.append(normalize(year, raw.month, raw.n, raw.date, raw.code, raw.amount, raw.cur, raw.rate, raw.total, titles))
            except KeyError:
                unknown[raw.code] += 1
        skipped += parse_blocks.skipped
    if unknown:
        raise SystemExit('Коды вне справочника: ' + ', '.join(f'{c} ×{n}' for c, n in unknown.most_common()))
    print(f'Пропущено строк с суммой <= 0: {skipped}')
    return rows


def print_report(rows: list) -> None:
    s = summarize(rows)
    for (y, m) in sorted(s):
        v = s[(y, m)]
        print(f'{y}-{m:02d}  строк {v["n"]:4d}  переводов {v["transfers"]:3d}  итого {v["rub"]:>12,.2f} ₽  {v["currencies"]}')
    codes = collections.Counter(r['code'] for r in rows)
    print(f'Всего строк: {len(rows)}; кодов: {len(codes)}')
    print('Коды:', ', '.join(f'{c} {n}' for c, n in codes.most_common()))


def write(rows: list) -> int:
    total = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        sql = f'select public.spend_import_sheet_rows({sheetdb.sql_literal(json.dumps(chunk, ensure_ascii=False))}::jsonb) as n'
        n = sheetdb.query(sql)[0]['n']
        total += n
        print(f'  пачка {i // BATCH + 1}: {n} строк')
    return total


def verify(rows: list) -> None:
    """Сверка сумм в рублях по месяцам: файл против базы."""
    expected = summarize(rows)
    got = {(int(r['y']), int(r['m'])): float(r['rub']) for r in sheetdb.query(
        "select (payload->>'year') as y, (payload->>'month') as m, sum((payload->>'total_rub')::numeric) as rub "
        "from spend.raw_txn where source = 'sheet' group by 1, 2"
    )}
    bad = [(k, expected[k]['rub'], got.get(k)) for k in expected if abs(expected[k]['rub'] - got.get(k, 0.0)) > 0.01]
    if bad:
        print('РАСХОЖДЕНИЯ:', bad)
        raise SystemExit(1)
    print(f'Сверка: {len(expected)} месяцев сходятся.')


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('files', nargs='+')
    ap.add_argument('--dry-run', action='store_true', help='только отчёт, без записи')
    args = ap.parse_args(argv)
    titles = load_titles()
    rows = collect(sorted(args.files), titles)
    print_report(rows)
    if args.dry_run:
        print('Сухой прогон: ничего не записано.')
        return
    print(f'Записываю {len(rows)} строк…')
    n = write(rows)
    print(f'Записано: {n}')
    verify(rows)


if __name__ == '__main__':
    main()
