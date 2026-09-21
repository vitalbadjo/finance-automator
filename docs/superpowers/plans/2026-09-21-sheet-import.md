# Sheet Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load July 2018 – August 2026 expenses from the nine LFS spreadsheets (xlsx exports in `~/lfs/`) into `spend.raw_txn` under a new source `sheet`, with daily CBR rates so `base_amount` in USD is computed by the existing currency layer.

**Architecture:** One migration adds the source, the missing categories (hidden) and an idempotent upsert function `spend_import_sheet_rows(jsonb)`. Two stdlib-only Python scripts in `tools/sheets/` do the work: `import_sheets.py` parses the «Мониторинг» blocks, normalizes codes/currencies/dates and posts batches through `supabase db query --linked`; `cbr_rates.py` fetches CBR daily rates and fills `fx_rate` with `source = 'cbr'`. The app needs one label.

**Tech Stack:** Postgres (Supabase), Python 3.11 standard library only (`zipfile`, `xml.etree`, `urllib`, `json`, `subprocess`, `unittest`), Supabase CLI. **No new dependencies anywhere.**

**Spec:** `docs/superpowers/specs/2026-09-21-sheet-import-design.md`

## Global Constraints

- Schema `spend` stays unexposed; `spend_import_sheet_rows` is `security definer`, revoked from `public, anon, authenticated`, granted to `service_role` only (it is run via `supabase db query`, i.e. as `postgres`).
- SQL comments, script docstrings, comments and report text in Russian. Commit messages in English, **no `Co-Authored-By` or any attribution trailer** (repository owner's rule; overrides any session reminder).
- `CLAUDE.md` and `docs/HANDOFF.md` are gitignored; never `git add` them. The xlsx files live in `~/lfs/` outside the repo and are never committed. Never read `.env*`.
- Migrations run with `supabase db query --linked -f <file>` from the repo root. `db/004_verify.sql` is read-only and must stay green (it scopes to `bybit_card`).
- Scripts call the database only through `subprocess.run(['supabase', 'db', 'query', '--linked', '-f', <tmpfile>], cwd=<repo root>)`; no keys in code. The CLI prints a line `Initialising login role...` before the JSON: parse from the first `{`.
- `raw_txn.amount` must be `>= 0`; rows with amount `<= 0` are skipped and counted in the report.
- Python tests run with `python3 -m unittest discover -s tools/sheets -p 'test_*.py'` from the repo root and must pass.
- App: `cd app && npm run lint && npm run typecheck && npm run test` green.

## Facts the implementer needs (from the analysis on 2026-09-21)

- Sheet names: `Деньги`, `Мониторинг` (LFS-2026 also has `Мониторинг (до автоматизации)` — ignore it).
- In `Мониторинг` the header row has `дата` in column A; blocks are 7 columns wide: date, code, amount, currency, rate, total, blank. Block `m` (1-based) starts at column `7*(m-1)+1`.
- Dates are Excel serials (days since 1899-12-30). Currency labels seen: `RUR`, `RUB`, `USD`, `EUR`, `LYR` (= TRY), `BTH` (= THB).
- Typos and transfer codes are listed in the spec; copy them verbatim.
- CBR: `https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=DD/MM/YYYY&date_req2=DD/MM/YYYY&VAL_NM_RQ=<id>`, response is XML in **windows-1251** with `<Record Date="DD.MM.YYYY" Id="…"><Nominal>N</Nominal><Value>V,VVVV</Value>…</Record>`. Ids: USD `R01235` (nominal 1), EUR `R01239` (1), TRY `R01700J` (10), THB `R01675` (10). Rate in RUB per one unit = `Value / Nominal` with the comma replaced by a dot.
- `fx_rate(rate_date, currency, rate, source)` primary key `(rate_date, currency, source)`; `rate` = units of `currency` per one USD.

---

## File Structure

```
db/018_sheet_import.sql
tools/sheets/
├── xlsx.py               minimal xlsx reader (zipfile + xml)
├── sheetdb.py            run SQL through the Supabase CLI, parse JSON
├── import_sheets.py      parse blocks → normalized rows → report / upsert
├── cbr_rates.py          CBR daily rates → fx_rate (source 'cbr')
├── test_import_sheets.py unit tests for the pure parts
└── README.md             how to run (Russian)
app/src/features/month/TxnRow.tsx   + sheet: 'таблица'
README.md, docs/ROADMAP.md
```

---

### Task 1: Migration `018_sheet_import.sql`

**Files:**
- Create: `db/018_sheet_import.sql`

**Interfaces:**
- Produces: source `sheet`; hidden categories; `public.spend_import_sheet_rows(p_rows jsonb) returns int` taking an array of objects `{external_id, date, amount, currency, code, transfer, title, payload}`.

- [ ] **Step 1: Write the migration**

```sql
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
```

Before writing, check `db/001_schema.sql` for the exact `raw_txn` column list and `not null` constraints (e.g. `last_seen_at`, `first_seen_at` defaults, `local_amount`/`local_currency` nullable) and `db/005_manual.sql` for how `spend_add_manual` inserts a manual row — mirror any column that is `not null` without a default. If `raw_txn` has no `last_seen_at`, drop that line from the update.

- [ ] **Step 2: Apply and verify** (each verification is a separate `supabase db query --linked "<sql>"`; an exception aborts the whole call)

```sql
-- apply
-- supabase db query --linked -f db/018_sheet_import.sql   (twice: must be re-runnable)

select count(*) from spend.code_ref where hidden;                       -- expected 15
select title from spend.source where code = 'sheet';                    -- Таблица LFS

select public.spend_import_sheet_rows('[{"external_id":"sheet-2025-03-999","date":"2025-03-11","amount":1545,"currency":"RUB","code":"каф","transfer":false,"title":"Кафе","payload":{"total_rub":1545}}]'::jsonb);
-- expected 1
select public.spend_import_sheet_rows('[{"external_id":"sheet-2025-03-999","date":"2025-03-12","amount":1600,"currency":"RUB","code":"каф","transfer":false,"title":"Кафе","payload":{"total_rub":1600}}]'::jsonb);
-- expected 1, and:
select count(*), max(amount), max(payload->>'via') from spend.raw_txn where source = 'sheet';   -- 1 | 1600 | sheet
select kind, code from spend.v_txn where source = 'sheet';                                       -- expense | каф

select public.spend_import_sheet_rows('[{"external_id":"sheet-2025-03-998","date":"2025-03-11","amount":500,"currency":"RUB","code":"инв","transfer":true,"title":"Инвестиции","payload":{}}]'::jsonb);
select kind, code, code_override from spend.v_txn t join spend.raw_txn r using (source, external_id) where t.external_id = 'sheet-2025-03-998';  -- transfer | null | null

select public.spend_import_sheet_rows('[{"external_id":"sheet-2025-03-997","date":"2025-03-11","amount":5,"currency":"RUB","code":"нету","transfer":false}]'::jsonb);
-- expected error: Неизвестная категория: нету (строка sheet-2025-03-997)

set role authenticated; select public.spend_import_sheet_rows('[]'::jsonb);   -- expected: permission denied

delete from spend.raw_txn where source = 'sheet';   -- clean up the test rows; report the count (2)
```

Then `supabase db query --linked -f db/004_verify.sql` — every verdict still OK.

- [ ] **Step 3: Commit**

```bash
git add db/018_sheet_import.sql
git commit -m "Sheet import (018): source, hidden categories, idempotent row upsert"
```

---

### Task 2: `tools/sheets/` — reader, DB helper, importer, tests

**Files:**
- Create: `tools/sheets/xlsx.py`, `tools/sheets/sheetdb.py`, `tools/sheets/import_sheets.py`, `tools/sheets/test_import_sheets.py`, `tools/sheets/README.md`

**Interfaces:**
- Consumes: `public.spend_import_sheet_rows(jsonb)`; `spend.code_ref(code, title)`.
- Produces: CLI `python3 tools/sheets/import_sheets.py [--dry-run] FILES…`; pure functions `parse_blocks`, `normalize`, `resolve_date`, `summarize` used by tests and by Task 3's helper module.

- [ ] **Step 1: `tools/sheets/xlsx.py`** (verbatim)

```python
"""Минимальный читатель xlsx на стандартной библиотеке.

load(path) -> {имя листа: {(row, col): значение}} — строки из sharedStrings,
числа как float, даты остаются серийными числами Excel (дней с 1899-12-30).
"""
import re
import zipfile
import xml.etree.ElementTree as ET

NS = {
    'm': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}


def col2num(letters: str) -> int:
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n


def load(path: str) -> dict:
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        root = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in root.findall('m:si', NS):
            shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    rid2target = {rel.get('Id'): rel.get('Target') for rel in rels}
    sheets = {}
    for s in wb.find('m:sheets', NS):
        target = rid2target[s.get('{%s}id' % NS['r'])]
        target = target[1:] if target.startswith('/') else 'xl/' + target
        root = ET.fromstring(z.read(target))
        grid = {}
        for c in root.iter('{%s}c' % NS['m']):
            m = re.match(r'([A-Z]+)(\d+)', c.get('r'))
            key = (int(m.group(2)), col2num(m.group(1)))
            t = c.get('t')
            v = c.find('m:v', NS)
            if v is None:
                isel = c.find('m:is', NS)
                val = ''.join(x.text or '' for x in isel.iter('{%s}t' % NS['m'])) if isel is not None else None
            elif t == 's':
                val = shared[int(v.text)]
            elif t in ('str', 'inlineStr'):
                val = v.text
            elif t == 'b':
                val = v.text == '1'
            else:
                try:
                    val = float(v.text)
                except (TypeError, ValueError):
                    val = v.text
            grid[key] = val
        sheets[s.get('name')] = grid
    return sheets
```

- [ ] **Step 2: `tools/sheets/sheetdb.py`**

```python
"""Запросы к базе через Supabase CLI: без ключей в коде, от роли postgres.

query(sql) -> list[dict]: пишет sql во временный файл, запускает
`supabase db query --linked -f <file>` из корня репозитория и разбирает
JSON после служебной строки CLI. Ошибка базы приходит как {"_tag":"Error"}.
"""
import json
import os
import subprocess
import tempfile

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


class DbError(RuntimeError):
    pass


def query(sql: str) -> list:
    with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False, encoding='utf-8') as f:
        f.write(sql)
        path = f.name
    try:
        res = subprocess.run(
            ['supabase', 'db', 'query', '--linked', '-f', path],
            cwd=REPO_ROOT, capture_output=True, text=True,
        )
    finally:
        os.unlink(path)
    out = res.stdout
    start = out.find('{')
    if start < 0:
        if res.returncode != 0:
            raise DbError(res.stderr.strip() or out.strip() or 'supabase db query failed')
        return []
    data = json.loads(out[start:])
    if data.get('_tag') == 'Error':
        raise DbError(data.get('error', {}).get('message', str(data)))
    return data.get('rows', [])


def sql_literal(value) -> str:
    """Строковый литерал с долларовым квотированием — безопасно для любого JSON."""
    tag = '$j$'
    while tag in value:
        tag = tag[:-1] + 'j$'
    return f'{tag}{value}{tag}'
```

Note: `supabase db query` output for multi-statement files returns the last statement's rows; keep one statement per call.

- [ ] **Step 3: Failing tests** `tools/sheets/test_import_sheets.py`

```python
import datetime
import unittest

from import_sheets import CURRENCY, TRANSFER, TYPOS, normalize, parse_blocks, resolve_date, serial2date, summarize


def grid_with(rows):
    """Сетка листа «Мониторинг»: заголовок в строке 5, блоки по 7 колонок."""
    g = {(5, 1): 'дата', (5, 2): 'код', (5, 3): 'сумма', (5, 4): 'валюта', (5, 5): 'курс', (5, 6): 'итог'}
    for r, month, cells in rows:
        base = 7 * (month - 1)
        for i, v in enumerate(cells):
            if v is not None:
                g[(r, base + 1 + i)] = v
    return g


class ParseTests(unittest.TestCase):
    def test_blocks_rows_and_numbering(self):
        g = grid_with([
            (6, 1, [45658.0, 'каф', 1545.0, 'RUR', 1.0, 1545.0]),
            (7, 1, [45658.0, None, None, 'RUR', 1.0, 0.0]),          # пустая строка блока
            (8, 1, [45659.0, 'прод', 77.0, 'RUR', 1.0, 77.0]),
            (6, 3, [45717.0, 'такс', 400.0, 'RUR', 1.0, 400.0]),
        ])
        rows = parse_blocks(g, year=2025, months=range(1, 13))
        self.assertEqual([(r.month, r.n, r.code, r.amount) for r in rows],
                         [(1, 1, 'каф', 1545.0), (1, 2, 'прод', 77.0), (3, 1, 'такс', 400.0)])

    def test_skips_zero_and_negative_amounts_but_counts_them(self):
        g = grid_with([
            (6, 1, [45658.0, 'выр', -100.0, 'RUR', 1.0, -100.0]),
            (7, 1, [45658.0, 'каф', 0.0, 'RUR', 1.0, 0.0]),
            (8, 1, [45658.0, 'каф', 5.0, 'RUR', 1.0, 5.0]),
        ])
        rows = parse_blocks(g, year=2025, months=range(1, 13))
        self.assertEqual([(r.n, r.amount) for r in rows], [(1, 5.0)])
        self.assertEqual(parse_blocks.skipped, 2)


class DateTests(unittest.TestCase):
    def test_serial(self):
        self.assertEqual(serial2date(45658.0), datetime.date(2025, 1, 1))

    def test_keeps_day_when_block_matches(self):
        self.assertEqual(resolve_date(45668.0, 2025, 1), datetime.date(2025, 1, 11))

    def test_falls_back_to_first_when_year_or_month_differ(self):
        self.assertEqual(resolve_date(45303.0, 2025, 1), datetime.date(2025, 1, 1))   # 2024-01-12
        self.assertEqual(resolve_date(45658.0, 2025, 2), datetime.date(2025, 2, 1))   # январь в блоке февраля
        self.assertEqual(resolve_date('мусор', 2025, 2), datetime.date(2025, 2, 1))
        self.assertEqual(resolve_date(None, 2025, 2), datetime.date(2025, 2, 1))


class NormalizeTests(unittest.TestCase):
    titles = {'каф': 'Кафе, рестораны', 'сиг': 'Сигареты', 'быт': 'Бытовые расходы'}

    def test_typo_currency_and_external_id(self):
        row = normalize(year=2025, month=3, n=17, date=45727.0, code='cиг', amount=1200.0, cur='LYR', rate=3.9, total=4680.0, titles=self.titles)
        self.assertEqual(row['external_id'], 'sheet-2025-03-017')
        self.assertEqual(row['code'], 'сиг')
        self.assertEqual(row['currency'], 'TRY')
        self.assertFalse(row['transfer'])
        self.assertEqual(row['title'], 'Сигареты')
        self.assertEqual(row['payload'], {'via': 'sheet', 'year': 2025, 'month': 3, 'row': 17,
                                          'sheet_code': 'cиг', 'sheet_currency': 'LYR', 'sheet_rate': 3.9, 'total_rub': 4680.0})

    def test_transfer(self):
        row = normalize(year=2021, month=1, n=1, date=None, code='инв', amount=500.0, cur='RUR', rate=1.0, total=500.0, titles=self.titles)
        self.assertTrue(row['transfer'])
        self.assertEqual(row['code'], 'инв')
        self.assertEqual(row['title'], 'Инвестиции')

    def test_unknown_code_raises(self):
        with self.assertRaises(KeyError):
            normalize(year=2021, month=1, n=1, date=None, code='нету', amount=5.0, cur='RUR', rate=1.0, total=5.0, titles=self.titles)

    def test_maps_are_consistent(self):
        self.assertEqual(CURRENCY['RUR'], 'RUB')
        self.assertIn('инв', TRANSFER)
        self.assertEqual(TYPOS['ард'], 'быт')


class SummaryTests(unittest.TestCase):
    def test_summarize_groups_by_year_month(self):
        rows = [
            {'payload': {'year': 2025, 'month': 1, 'total_rub': 100.0}, 'currency': 'RUB', 'code': 'каф', 'transfer': False},
            {'payload': {'year': 2025, 'month': 1, 'total_rub': 50.0}, 'currency': 'USD', 'code': 'инв', 'transfer': True},
        ]
        s = summarize(rows)
        self.assertEqual(s[(2025, 1)]['n'], 2)
        self.assertEqual(s[(2025, 1)]['rub'], 150.0)
        self.assertEqual(s[(2025, 1)]['currencies'], {'RUB': 1, 'USD': 1})
        self.assertEqual(s[(2025, 1)]['transfers'], 1)


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 4: Run** `python3 -m unittest discover -s tools/sheets -p 'test_*.py'` — FAIL: `import_sheets` not found.

- [ ] **Step 5: `tools/sheets/import_sheets.py`**

```python
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
```

- [ ] **Step 6: Run the tests** — PASS. Then a real dry run from the repo root:

```
python3 tools/sheets/import_sheets.py --dry-run ~/lfs/LFS-*.xlsx
```

Expected: no «Коды вне справочника» abort (if it aborts, the list must be empty after the typo map — otherwise report the codes, do not edit the maps); total rows around 9 650; `2025-01` ≈ 148 397 ₽; `2026-08` present, `2026-09` absent. Paste the head and tail of the report into the report file.

- [ ] **Step 7: `tools/sheets/README.md`** (Russian, short): what the two scripts do, the two commands, where the xlsx files come from (Google Drive → export as xlsx into `~/lfs/`, not committed), order: 018 → `cbr_rates.py` → `import_sheets.py --dry-run` → `import_sheets.py`.

- [ ] **Step 8: Commit**

```bash
git add tools/sheets/xlsx.py tools/sheets/sheetdb.py tools/sheets/import_sheets.py tools/sheets/test_import_sheets.py tools/sheets/README.md
git commit -m "Sheet import tool: parse LFS monitoring blocks, normalize, upsert in batches"
```

---

### Task 3: `tools/sheets/cbr_rates.py` and the rate load

**Files:**
- Create: `tools/sheets/cbr_rates.py`, `tools/sheets/test_cbr_rates.py`

**Interfaces:**
- Consumes: `sheetdb.query`, `sheetdb.sql_literal`.
- Produces: CLI `python3 tools/sheets/cbr_rates.py --from 2018-07-01 --to 2026-08-31 [--dry-run]`; pure `parse_records(xml_text) -> dict[date, float]`, `to_usd_rates(usd, others) -> list[(date, currency, rate)]`.

- [ ] **Step 1: Failing tests** `tools/sheets/test_cbr_rates.py`

```python
import datetime
import unittest

from cbr_rates import parse_records, to_usd_rates

XML = ('<?xml version="1.0" encoding="windows-1251"?><ValCurs ID="R01700J">'
       '<Record Date="01.03.2023" Id="R01700J"><Nominal>10</Nominal><Value>39,6676</Value></Record>'
       '<Record Date="02.03.2023" Id="R01700J"><Nominal>10</Nominal><Value>40,0000</Value></Record></ValCurs>')


class ParseTests(unittest.TestCase):
    def test_parse_nominal_and_comma(self):
        r = parse_records(XML)
        self.assertAlmostEqual(r[datetime.date(2023, 3, 1)], 3.96676)
        self.assertAlmostEqual(r[datetime.date(2023, 3, 2)], 4.0)


class ConvertTests(unittest.TestCase):
    def test_rub_is_usd_rate_and_others_are_ratios(self):
        d1, d2 = datetime.date(2023, 3, 1), datetime.date(2023, 3, 2)
        usd = {d1: 74.8932, d2: 75.2513}
        out = to_usd_rates(usd, {'TRY': {d1: 3.96676}, 'EUR': {d2: 80.0}})
        as_map = {(d, c): r for d, c, r in out}
        self.assertAlmostEqual(as_map[(d1, 'RUB')], 74.8932)
        self.assertAlmostEqual(as_map[(d2, 'RUB')], 75.2513)
        self.assertAlmostEqual(as_map[(d1, 'TRY')], 74.8932 / 3.96676)
        self.assertAlmostEqual(as_map[(d2, 'EUR')], 75.2513 / 80.0)
        self.assertNotIn((d2, 'TRY'), as_map)   # нет курса TRY на d2 — пропуск


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Implement** `tools/sheets/cbr_rates.py`

```python
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
```

- [ ] **Step 3: Tests PASS**, then the real load from the repo root:

```
python3 tools/sheets/cbr_rates.py --from 2018-07-01 --to 2026-08-31
```

Expected: RUB ≈ 2 000+ dates, others similar. Verify:

```sql
select currency, count(*), min(rate_date), max(rate_date) from spend.fx_rate where source = 'cbr' group by 1 order by 1;
select rate from spend.fx_rate where source = 'cbr' and currency = 'RUB' and rate_date = '2023-03-01';   -- 74.8932
```

Run the load a second time: counts unchanged.

- [ ] **Step 4: Commit**

```bash
git add tools/sheets/cbr_rates.py tools/sheets/test_cbr_rates.py
git commit -m "CBR daily rates loader for fx_rate (source cbr)"
```

---

### Task 4: App label and docs

**Files:**
- Modify: `app/src/features/month/TxnRow.tsx`, `README.md`, `docs/ROADMAP.md`

- [ ] **Step 1:** In `TxnRow.tsx` change `SOURCE_LABEL` to `{ bybit_card: 'карта', manual: 'вручную', sheet: 'таблица' }`. Add one assertion to `app/src/features/month/MonthScreen.test.tsx`: a fixture row with `source: 'sheet'` renders the tag «таблица» (follow the existing fixture/`row()` pattern; keep totals assertions untouched by giving it `kind: 'expense'`, `base_amount: 1`, and adjust any total assertions you break, or use `txn_date` outside the asserted days). Run `cd app && npm run lint && npm run typecheck && npm run test`.
- [ ] **Step 2: README** — `db/` tree: `018_sheet_import.sql     source sheet, hidden categories, spend_import_sheet_rows`; migration order list: add `db/018_sheet_import.sql`; new section «Historical import» (English, 5–8 sentences): what `tools/sheets/` does, the order 018 → `cbr_rates.py` → `import_sheets.py --dry-run` → `import_sheets.py`, where xlsx files come from (Google Drive export, kept outside the repo), idempotency, and that transfers/savings land as `kind = 'transfer'`.
- [ ] **Step 3: ROADMAP** — replace the «Импорт истории из Google Таблиц» bullet (with its sub-bullets) with one line: `- **Импорт истории из Google Таблиц** — сделано (2026-09-21). Спека \`2026-09-21-sheet-import-design.md\`.` Also change «**Рыночные курсы.** Фид ЕЦБ …» to note that CBR rates (`source = 'cbr'`) now cover 2018-07 … 2026-08 for RUB/EUR/TRY/THB and the ECB feed remains a future option for other currencies.
- [ ] **Step 4: Commit**

```bash
git add app/src/features/month/TxnRow.tsx app/src/features/month/MonthScreen.test.tsx README.md docs/ROADMAP.md
git commit -m "Label sheet-sourced rows; docs for the historical import"
```

---

## Execution after the tasks (controller)

1. `python3 tools/sheets/import_sheets.py --dry-run ~/lfs/LFS-*.xlsx` — review.
2. `python3 tools/sheets/import_sheets.py ~/lfs/LFS-*.xlsx` — writes and verifies.
3. Checks from the spec: `v_missing_rates` empty; row count; re-run unchanged; `app_monthly_stats` for 2025; `004` green; browser.

## Self-review

- Spec coverage: source/codes/function (T1), parser+normalizer+report+write+verify (T2), CBR (T3), app label + docs (T4), execution steps listed for the controller.
- Type consistency: JSON fields produced by `normalize` = fields read by `spend_import_sheet_rows`; `sheetdb.sql_literal` used by both scripts; `parse_blocks.skipped` attribute referenced by tests and `collect`.
- Placeholders: none.
