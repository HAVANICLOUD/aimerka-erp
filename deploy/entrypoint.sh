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
# Con SUPABASE_URL/SUPABASE_ANON_KEY el login es de Supabase Auth.
EXTRA=""
for NAME in DATABASE_URL SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY; do
  VALUE=$(printenv "$NAME" || true)
  [ -n "$VALUE" ] && EXTRA="$EXTRA --var $NAME:$VALUE"
done
[ -n "$DATABASE_URL" ] && echo "[aimerka] Usando Postgres (DATABASE_URL)."
[ -n "$SUPABASE_URL" ] && echo "[aimerka] Login con Supabase Auth."
$WRANGLER dev --config dist/server/wrangler.json --local --persist-to "$STATE" \
  --ip 0.0.0.0 --port 8787 --inspector-port 0 $EXTRA &
PID=$!

# Espera al servidor y siembra v43 (la primera lectura inicializa el workspace).
for i in $(seq 1 60); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "oai-authenticated-user-email: ${SEED_EMAIL:-geovanyjk@msn.com}" http://127.0.0.1:8787/api/state 2>/dev/null || true)
  # 200 = base lista; 401 = login de Supabase activo (la base se lee al primer acceso).
  if [ "$CODE" = "200" ] || [ "$CODE" = "401" ]; then
    echo "[aimerka] Base de datos lista (workspace v43 inicializado)."; break
  fi
  sleep 2
done

trap 'kill -TERM $PID' TERM INT
wait $PID
