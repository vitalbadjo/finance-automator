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
