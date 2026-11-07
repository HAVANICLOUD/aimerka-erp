import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompetitionHandler, searchCompetition, sanitizeResults, publicQuery, safeHttps, LIMITS } from '../lib/competition-pricing.mjs';

// All provider responses below are synthetic mocks, NOT live search evidence.
const at = '2026-11-07T12:00:00.000Z';
const row = (extra = {}) => ({ title: 'Mock product', source: 'Mock store', price: 'MX$1,299.00', extracted_price: 1299, product_link: 'https://example.com/product', ...extra });
const request = (input = { name: 'Public product', upc: '123456789012' }, options = {}) => new Request('https://erp.example/api/competition', { method: 'POST', headers: { Origin: 'https://erp.example', 'Content-Type': 'application/json' }, body: JSON.stringify(input), ...options });
test('public query rejects private extra fields and malformed UPCs', () => {
  assert.equal(publicQuery({ name: 'Product', cost: 44 }), null);
  assert.equal(publicQuery({ name: 'Product', upc: 'ABC123' }), null);
  assert.equal(publicQuery({ name: 'a'.repeat(161) }), null);
  assert.equal(publicQuery({}), null);
  assert.deepEqual(publicQuery({ name: ' Product ', upc: '12345678' }), { name: 'Product', upc: '12345678', query: 'Product 12345678' });
});
test('only explicit positive MXN total prices and safe sources survive', () => {
  const invalid = [{ extracted_price: 0 }, { extracted_price: -1 }, { extracted_price: Infinity }, { extracted_price: '1299' }, { price: '$1,299' }, { price: 'USD 1299', currency: 'MXN' }, { price: 'MXN 1299 por mes' }, { price: 'MXN 1299', snippet: 'a crédito' }, { price: 'MXN 1299', extensions: ['12 meses sin intereses'] }, { product_link: 'javascript:alert(1)' }, { source: '' }];
  const result = sanitizeResults({ shopping_results: [row(), row(), ...invalid.map(row), row({ source: 'Second mock', price: 'MXN 1299', installment: { extracted_price: 108.25 }, old_price: 'MXN 9999', alternative_price: { extracted_price: 42 } })] }, at);
  assert.equal(result.length, 2); assert.equal(result[1].price, 1299); assert.equal(result[0].observedAt, at); assert.equal(result[0].verified, false); assert.equal(result[0].match, 'search');
  for (const value of ['http://example.com', 'https://user:pass@example.com', 'https://127.0.0.1/x', 'https://localhost/x', 'https://example.com/?api_key=secret', 'data:text/html,bad']) assert.equal(safeHttps(value), null);
  assert.equal(safeHttps('https://shop.example/item?a=1'), 'https://shop.example/item?a=1');
  assert.equal(sanitizeResults({ shopping_results: Array.from({ length: 30 }, (_, n) => row({ source: `Mock ${n}` })) }, at).length, LIMITS.results);
});
test('missing provider is explicit and never performs a mock fetch', async () => {
  const result = await searchCompetition({ input: publicQuery({ name: 'Public' }), key: undefined, fetchImpl: () => assert.fail('No fetch without key') });
  assert.equal(result.providerUnavailable, true); assert.equal(result.engine.status, 'not_configured'); assert.deepEqual(result.results, []);
});
test('mock adapter sends only public query with documented Mexican locale', async () => {
  const result = await searchCompetition({ key: 'mock-secret', input: publicQuery({ name: 'Public', upc: '12345678' }), now: () => Date.parse(at), fetchImpl: async (url, options) => {
    const u = new URL(url); assert.equal(u.origin, 'https://serpapi.com');
    assert.equal(u.searchParams.get('engine'), 'google_shopping'); assert.equal(u.searchParams.get('gl'), 'mx'); assert.equal(u.searchParams.get('hl'), 'es'); assert.equal(u.searchParams.get('google_domain'), 'google.com.mx'); assert.equal(u.searchParams.get('q'), 'Public 12345678'); assert.equal(options.redirect, 'error');
    return Response.json({ shopping_results: [row()], search_metadata: { status: 'Success' } });
  } });
  assert.equal(result.results.length, 1); assert.equal(result.providerUnavailable, false); assert.ok(!JSON.stringify(result).includes('mock-secret'));
});
test('mock provider failures, errors, oversize, malformed payloads and timeout stay safe', async () => {
  for (const fetchImpl of [async () => { throw new Error('mock-secret'); }, async () => new Response('mock-secret', { status: 401 }), async () => Response.json({ error: 'mock-secret' }), async () => new Response('bad mock-secret'), async () => new Response('x'.repeat(LIMITS.responseBytes + 1)), async () => Response.json({ search_metadata: { status: 'Processing' } })]) {
    const r = await searchCompetition({ key: 'mock-secret', input: { query: 'Public' }, fetchImpl });
    assert.equal(r.engine.status, 'provider_error'); assert.equal(r.providerUnavailable, true); assert.ok(!JSON.stringify(r).includes('mock-secret'));
  }
  const r = await searchCompetition({ key: 'mock-secret', input: { query: 'Public' }, timeoutMs: 5, fetchImpl: () => new Promise(() => {}) });
  assert.equal(r.engine.status, 'timeout');
  const slowBody = await searchCompetition({ key: 'mock-secret', input: { query: 'Public' }, timeoutMs: 5, fetchImpl: async () => new Response(new ReadableStream({ start() {} })) });
  assert.equal(slowBody.engine.status, 'timeout');
});
test('handler enforces active authentication, same origin, POST and strict bounded public payload', async () => {
  let calls = 0;
  const handle = createCompetitionHandler({ access: async () => ({ active: true, email: 'reader@example.com' }), getKey: () => undefined, fetchImpl: async () => { calls++; } });
  assert.equal((await handle(new Request('https://erp.example/api/competition'))).status, 405);
  assert.equal((await handle(request({}, { headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' } }))).status, 403);
  assert.equal((await handle(request({}, { headers: { 'Content-Type': 'application/json' } }))).status, 403);
  assert.equal((await handle(request({ name: 'Public', cost: 20 }))).status, 400);
  assert.equal((await handle(request({ name: 'x'.repeat(3000) }))).status, 400);
  const missing = await (await handle(request())).json(); assert.equal(missing.providerUnavailable, true);
  const denied = createCompetitionHandler({ access: async () => ({ active: false, email: 'x' }), getKey: () => 'secret' });
  assert.equal((await denied(request())).status, 403); assert.equal(calls, 0);
});
test('mock search cache and rate limits are per authenticated user, expire, and coalesce in-flight clicks', async () => {
  let time = Date.parse(at), calls = 0, email = 'a@example.com';
  const handle = createCompetitionHandler({ access: async () => ({ active: true, email }), getKey: () => 'mock-secret', now: () => time, fetchImpl: async () => { calls++; return Response.json({ shopping_results: [row()] }); } });
  const first = await handle(request()); assert.equal(first.headers.get('cache-control'), 'private, no-store');
  assert.equal((await (await handle(request())).json()).cached, true); assert.equal(calls, 1);
  email = 'b@example.com'; await handle(request()); assert.equal(calls, 2);
  for (let i = 0; i < 5; i++) assert.equal((await handle(request({ name: `Public ${i}` }))).status, 200);
  assert.equal((await handle(request({ name: 'Public limited' }))).status, 429);
  time += LIMITS.cacheMs + 1; assert.equal((await handle(request())).status, 200);
  let release;
  const concurrent = createCompetitionHandler({ access: async () => ({ active: true, email }), getKey: () => 'mock-secret', fetchImpl: () => new Promise(resolve => { release = resolve; }) });
  const pending = concurrent(request());
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal((await concurrent(request())).status, 429);
  release(Response.json({ shopping_results: [] })); assert.equal((await pending).status, 200);
});
