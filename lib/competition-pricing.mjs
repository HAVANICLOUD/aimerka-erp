// SerpApi docs: https://serpapi.com/google-shopping-api and /shopping-results.
// No currency-forcing parameter is documented: require explicit MXN evidence.
export const ENGINE = 'google_shopping';
export const LIMITS = Object.freeze({ timeoutMs: 8000, responseBytes: 524288, requestBytes: 2048, results: 12, cacheMs: 300000, perMinute: 6, users: 256 });
const clean = (value, max = 200) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
export function safeHttps(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\u0000-\u001f]/.test(value)) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.') || u.hostname === 'localhost' || u.hostname.endsWith('.local') || u.hostname.endsWith('.localhost') || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':')) return null;
    if ([...u.searchParams.keys()].some(k => /^(api[_-]?key|token|access_token|authorization)$/i.test(k))) return null;
    return u.href;
  } catch { return null; }
}
export function publicQuery(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['name', 'upc'].includes(k))) return null;
  if ((input.name != null && typeof input.name !== 'string') || (input.upc != null && typeof input.upc !== 'string')) return null;
  const name = clean(input.name, 160), upc = clean(input.upc, 14);
  if (input.name?.length > 160 || input.upc?.length > 14 || (upc && !/^\d{8,14}$/.test(upc)) || (!name && !upc)) return null;
  return { name, upc, query: [name, upc].filter(Boolean).join(' ') };
}
export function sanitizeResults(payload, observedAt) {
  const rows = [...(Array.isArray(payload?.shopping_results) ? payload.shopping_results : []), ...(Array.isArray(payload?.categorized_shopping_results) ? payload.categorized_shopping_results.slice(0, 20).flatMap(c => Array.isArray(c.shopping_results) ? c.shopping_results.slice(0, 50) : []) : [])];
  const results = [], seen = new Set();
  for (const r of rows.slice(0, 500)) {
    if (!r || typeof r !== 'object') continue;
    const title = clean(r.title), store = clean(r.source, 100), url = safeHttps(r.link) || safeHttps(r.product_link);
    const display = clean(r.price, 100), currency = clean(r.currency, 10).toUpperCase();
    // Never use installment.extracted_price, alternative_price, or old_price.
    const credit = /mensual|quincenal|semanal|\bmes(?:es)?\b|\bmsi\b|installment|\/\s*(?:mo|month)|\bper month\b|cr[eé]dito|financ|abono|enganche|desde|\bfrom\b/i.test([display, r.snippet, ...(Array.isArray(r.extensions) ? r.extensions : [])].map(v => clean(v)).join(' '));
    const mxn = currency === 'MXN' || /\bMXN\b|MX\s*\$/i.test(display);
    const foreign = /\b(?:USD|CAD|AUD|EUR|GBP|ARS|COP|CLP|BRL)\b|US\s*\$|[€£]/i.test(display) || (currency && currency !== 'MXN');
    const price = r.extracted_price;
    if (!title || !store || !url || credit || !mxn || foreign || typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || price > 1e9) continue;
    const id = `${store}\n${url}\n${price}`;
    if (seen.has(id)) continue;
    seen.add(id);
    results.push({ title, store, url, price, currency: 'MXN', condition: clean(r.second_hand_condition, 80) || 'No indicada', observedAt, date: observedAt.slice(0, 10), kind: 'provider', provenance: 'serpapi', match: 'search', verified: false });
    if (results.length === LIMITS.results) break;
  }
  return results;
}
export async function readBoundedJSON(response, maxBytes) {
  if (Number(response.headers.get('content-length')) > maxBytes || !response.body) throw new Error('size');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('size');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally { await reader.cancel().catch(() => {}); }
}
export async function searchCompetition({ key, input, fetchImpl = fetch, now = Date.now, timeoutMs = LIMITS.timeoutMs }) {
  const unavailable = status => ({ providerUnavailable: true, engine: { provider: 'serpapi', name: ENGINE, status }, results: [] });
  if (!key || typeof key !== 'string' || !key.trim()) return unavailable('not_configured');
  const controller = new AbortController();
  let timer;
  try {
    const url = new URL('https://serpapi.com/search.json');
    url.search = new URLSearchParams({ engine: ENGINE, q: input.query, gl: 'mx', hl: 'es', google_domain: 'google.com.mx', api_key: key }).toString();
    const work = async () => {
      const response = await fetchImpl(url.href, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('provider');
      const payload = await readBoundedJSON(response, LIMITS.responseBytes);
      if (!payload || payload.error || (payload.search_metadata?.status && payload.search_metadata.status !== 'Success')) throw new Error('provider');
      const observedAt = new Date(now()).toISOString();
      return { providerUnavailable: false, engine: { provider: 'serpapi', name: ENGINE, status: 'ready' }, results: sanitizeResults(payload, observedAt), observedAt, match: 'search', currency: 'MXN' };
    };
    return await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs); })]);
  } catch { return unavailable(controller.signal.aborted ? 'timeout' : 'provider_error'); }
  finally { clearTimeout(timer); }
}
// Bounded, ephemeral, per authenticated user, per worker isolate. Not a distributed quota.
export function createCompetitionHandler({ access, getKey, fetchImpl = fetch, now = Date.now }) {
  const users = new Map();
  const reply = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', ...headers } });
  return async request => {
    if (request.method !== 'POST') return reply({ error: 'Usa POST para iniciar una búsqueda.' }, 405, { Allow: 'POST' });
    if (request.headers.get('origin') !== new URL(request.url).origin || ['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site'))) return reply({ error: 'Origen no permitido.' }, 403);
    try {
      const identity = await access(request);
      if (!identity?.active || !identity.email) return reply({ error: 'Inicia sesión con acceso activo.' }, 403);
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return reply({ error: 'Envía JSON con nombre público y UPC.' }, 415);
      let input;
      try { input = publicQuery(await readBoundedJSON(request, LIMITS.requestBytes)); } catch { /* invalid or oversized JSON */ }
      if (!input) return reply({ error: 'Escribe un nombre público (hasta 160 caracteres) o UPC de 8 a 14 dígitos. Solo se admiten name y upc.' }, 400);
      const key = getKey();
      if (!key) return reply(await searchCompetition({ key, input }));
      const time = now(), userId = identity.email.toLowerCase();
      for (const [id, row] of users) if (time - row.touched > LIMITS.cacheMs && !row.pending) users.delete(id);
      let user = users.get(userId);
      if (!user) {
        if (users.size >= LIMITS.users) return reply({ error: 'Búsqueda ocupada. Intenta más tarde.' }, 429, { 'Retry-After': '60' });
        user = { touched: time, starts: [], cache: null, pending: null }; users.set(userId, user);
      }
      user.touched = time;
      if (user.cache?.query === input.query && time - user.cache.at < LIMITS.cacheMs) return reply({ ...user.cache.value, cached: true });
      if (user.pending) return reply({ error: 'Ya hay una búsqueda en curso.' }, 429, { 'Retry-After': '8' });
      user.starts = user.starts.filter(t => time - t < 60000);
      if (user.starts.length >= LIMITS.perMinute) return reply({ error: 'Límite de búsquedas alcanzado. Espera un minuto.' }, 429, { 'Retry-After': '60' });
      user.starts.push(time);
      user.pending = searchCompetition({ key, input, fetchImpl, now });
      try {
        const value = await user.pending;
        if (!value.providerUnavailable) user.cache = { query: input.query, at: now(), value };
        return reply({ ...value, cached: false });
      } finally { user.pending = null; }
    } catch { return reply({ error: 'La búsqueda no está disponible. Puedes capturar una referencia manual.' }, 503); }
  };
}
