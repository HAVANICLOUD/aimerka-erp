# AIMERKA ERP — imagen para VPS (DigitalOcean)
# Corre el worker compilado con wrangler/miniflare en modo local:
#   D1 -> SQLite en disco, R2 -> archivos en disco, ambos en /app/.wrangler/state (volumen).
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV CI=true WRANGLER_SEND_METRICS=false

COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm run install:ci

COPY . .
RUN node scripts/sync-client.mjs && npm run build

COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8787
VOLUME ["/app/.wrangler/state"]
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8787/api/revision | grep -qE "200|401|403" || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
