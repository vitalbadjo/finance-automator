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
