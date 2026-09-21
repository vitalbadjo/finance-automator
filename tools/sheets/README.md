# tools/sheets

Импорт исторических расходов из таблиц LFS-YYYY.xlsx (лист «Мониторинг») в
`spend.raw_txn` (`source = 'sheet'`).

- `xlsx.py` — минимальный читатель xlsx на стандартной библиотеке: отдаёт
  сетку `{(row, col): значение}` по каждому листу.
- `sheetdb.py` — запросы к базе через `supabase db query --linked`, от роли
  postgres, без ключей в коде.
- `import_sheets.py` — парсит блоки месяцев, нормализует коды (с учётом
  опечаток и переводов), печатает отчёт по месяцам и пишет пачками через
  `public.spend_import_sheet_rows`.

## Команды

```bash
python3 tools/sheets/import_sheets.py --dry-run ~/lfs/LFS-*.xlsx   # только отчёт
python3 tools/sheets/import_sheets.py           ~/lfs/LFS-*.xlsx   # запись + сверка
```

## Откуда файлы

Google Drive → «Файл → Скачать → Microsoft Excel (.xlsx)» → положить в
`~/lfs/LFS-YYYY.xlsx`. Файлы не коммитятся (вне репозитория, в `~/lfs/`).

## Порядок

`018` (миграция с `spend_import_sheet_rows` и источником `sheet`) →
`cbr_rates.py` → `import_sheets.py --dry-run` → `import_sheets.py`.
