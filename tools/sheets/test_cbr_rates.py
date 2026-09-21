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
