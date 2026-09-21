import unittest
from unittest.mock import patch

import sheetdb


class OneTests(unittest.TestCase):
    def test_raises_db_error_on_empty_response(self):
        with patch.object(sheetdb, 'query', return_value=[]):
            with self.assertRaises(sheetdb.DbError):
                sheetdb.one('select 1')

    def test_returns_first_row(self):
        with patch.object(sheetdb, 'query', return_value=[{'n': 3}]):
            self.assertEqual(sheetdb.one('select 1'), {'n': 3})


if __name__ == '__main__':
    unittest.main()
