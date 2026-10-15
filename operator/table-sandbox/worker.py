"""Read-only DuckDB over caller-supplied records, inside the data-only container."""
import json
import re
import sys
from decimal import Decimal
import duckdb


def identifier(value):
    return '"' + value.replace('"', '""') + '"'


def main():
    raw = sys.stdin.read(16 * 1024 * 1024 + 1)
    if len(raw) > 16 * 1024 * 1024:
        raise ValueError('Table input exceeds its processing bound')
    request = json.loads(raw)
    sources = request['sources']
    if not 1 <= len(sources) <= 4:
        raise ValueError('Choose one to four input tables')
    con = duckdb.connect(config={'enable_external_access': 'false', 'autoload_known_extensions': 'false',
        'autoinstall_known_extensions': 'false', 'allow_community_extensions': 'false',
        'memory_limit': '256MB', 'threads': '2', 'max_temp_directory_size': '0B'})
    try:
        con.execute('SET lock_configuration=true')
        tables = []
        for source in sources:
            name, columns, rows = source['table'], source['columns'], source['rows']
            if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,39}', name) or not 1 <= len(columns) <= 30 or len(rows) > 50000:
                raise ValueError('Invalid bounded input table')
            if len({column.casefold() for column in columns}) != len(columns) or not all(isinstance(column, str) and 0 < len(column) <= 200 for column in columns):
                raise ValueError('Input headers must be nonempty and unique')
            con.execute('CREATE TABLE ' + identifier(name) + '(' + ','.join(identifier(column) + ' VARCHAR' for column in columns) + ')')
            if rows:
                con.executemany('INSERT INTO ' + identifier(name) + ' VALUES (' + ','.join('?' for _ in columns) + ')', rows)
            tables.append({'table': name, 'columns': columns, 'columnTypes': ['VARCHAR'] * len(columns), 'rowCount': len(rows), 'preview': rows[:5], 'sha256': source['sha256']})
        result = {'engine': 'DuckDB ' + duckdb.__version__, 'tables': tables, 'readOnly': True, 'network': 'none', 'hostFilesMounted': False}
        query = request.get('query', '').strip()
        if query:
            statements = con.extract_statements(query)
            if len(statements) != 1 or statements[0].type != duckdb.StatementType.SELECT:
                raise ValueError('Provide one read-only SELECT or WITH query')
            cursor = con.execute(query)
            rows = cursor.fetchmany(201)
            result.update(columns=[item[0] for item in cursor.description], columnTypes=[str(item[1]) for item in cursor.description],
                          rows=[[str(cell) if isinstance(cell, Decimal) else cell for cell in row] for row in rows[:200]],
                          truncated=len(rows) > 200, exactDecimals=True)
        encoded = json.dumps({'ok': True, 'result': result}, ensure_ascii=False, default=str)
        if len(encoded) > 180000:
            raise ValueError('Query output is too large; select fewer columns/rows')
        print(encoded)
    finally:
        con.close()


try:
    main()
except Exception as error:
    print(json.dumps({'ok': False, 'error': str(error)[:600]}))
    raise SystemExit(1)
