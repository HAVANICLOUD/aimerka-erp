#!/usr/bin/env python3
"""Copia las tablas ERP de una base D1 local (SQLite de miniflare) a un SQL para Postgres.

Uso:  python3 scripts/migrate-d1-to-postgres.py <archivo.sqlite> > migracion.sql
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migracion.sql

Reemplaza por completo erp_workspaces, erp_fragments y erp_actions en el destino.
"""
import sqlite3, sys

def lit(v):
    if v is None: return 'NULL'
    if isinstance(v, int): return str(v)
    return "'" + str(v).replace("'", "''") + "'"

db = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
out = sys.stdout
out.write("TRUNCATE erp_workspaces, erp_fragments, erp_actions;\n")
for table, cols in [
    ("erp_workspaces", "id,revision,initialized,last_action,updated_at"),
    ("erp_fragments", "workspace,name,part,body"),
    ("erp_actions", "workspace,id,type,input_hash,result,revision,actor,created_at"),
]:
    for row in db.execute(f"SELECT {cols} FROM {table}"):
        out.write(f"INSERT INTO {table}({cols}) VALUES({','.join(lit(v) for v in row)});\n")
