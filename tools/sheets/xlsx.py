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
