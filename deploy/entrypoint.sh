#!/bin/sh
# Deja la base de datos lista: aplica el esquema la primera vez,
# arranca el servidor y fuerza la carga inicial del workspace v43.
set -e
cd /app
STATE=/app/.wrangler/state
MARK="$STATE/.schema-0000-applied"
WRANGLER="node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js"

if [ ! -f "$MARK" ]; then
  echo "[aimerka] Base de datos nueva: aplicando esquema inicial…"
  $WRANGLER d1 execute DB --local --config dist/server/wrangler.json \
    --persist-to "$STATE" --file drizzle/0000_blushing_bloodscream.sql
  touch "$MARK"
fi

# Con DATABASE_URL (Supabase/Postgres) el ERP guarda ahí; sin ella usa D1 local.
EXTRA=""
if [ -n "$DATABASE_URL" ]; then
  echo "[aimerka] Usando Postgres (DATABASE_URL)."
  EXTRA="--var DATABASE_URL:$DATABASE_URL"
fi
$WRANGLER dev --config dist/server/wrangler.json --local --persist-to "$STATE" \
  --ip 0.0.0.0 --port 8787 --inspector-port 0 $EXTRA &
PID=$!

# Espera al servidor y siembra v43 (la primera lectura inicializa el workspace).
for i in $(seq 1 60); do
  if curl -fsS -H "oai-authenticated-user-email: ${SEED_EMAIL:-geovanyjk@msn.com}" http://127.0.0.1:8787/api/state -o /dev/null 2>/dev/null; then
    echo "[aimerka] Base de datos lista (workspace v43 inicializado)."; break
  fi
  sleep 2
done

trap 'kill -TERM $PID' TERM INT
wait $PID
