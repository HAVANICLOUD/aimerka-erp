import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
const source = readFileSync(new URL('../public/erp/competition-pricing-ui.js', import.meta.url), 'utf8');
// Small DOM harness: behavior tests use only simulated provider responses, never live prices.
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.textContent = ''; this.isConnected = false; this.value = ''; }
  append(...children) { for (const c of children) { c.parent = this; c.isConnected = this.isConnected; this.children.push(c); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(key, value) { this[key] = value; }
  addEventListener(key, handler) { (this.listeners[key] ||= []).push(handler); }
  async emit(key) { for (const fn of this.listeners[key] || []) await fn({ preventDefault() {} }); }
  async click() { if (!this.disabled) await this.emit('click'); }
  focus() {}
  reportValidity() { return true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
}
const flatten = el => [el, ...el.children.flatMap(flatten)];
const find = (root, label) => flatten(root).find(el => el.textContent === label);
const content = root => flatten(root).map(el => el.textContent).join('\n');
function harness(fetchImpl) {
  const body = new Element('body'); body.isConnected = true;
  const calls = [], window = {};
  const context = createContext({ window, document: { body, activeElement: null, createElement: tag => new Element(tag) }, URL, Intl, Date, AbortController, setTimeout, clearTimeout, fetch: (...args) => { calls.push(args); return fetchImpl(...args); } });
  runInContext(source, context);
  return { window, calls, body, dialog: () => body.children[0], open: options => window.CompetitionPricing.open(options) };
}
test('opening makes no automatic request; disconnected lookup stays honest and external links stay safe', async () => {
  const h = harness(async () => Response.json({ providerUnavailable: true, engine: { status: 'not_configured' } }));
  h.open({ name: '<img src=x onerror=alert(1)>', upc: '12345678' });
  assert.equal(h.calls.length, 0); assert.match(content(h.dialog()), /<img src=x onerror=alert\(1\)>/);
  await find(h.dialog(), 'Buscar precios públicos').click();
  assert.match(content(h.dialog()), /Conexión de búsqueda pendiente/);
  assert.match(content(h.dialog()), /SERPAPI_KEY/); assert.match(content(h.dialog()), /no la pegues en el chat, el navegador ni los datos del ERP/);
  assert.equal(find(h.dialog(), 'Registro oficial').href, 'https://serpapi.com/users/sign_up');
  assert.equal(find(h.dialog(), 'Clave de API').href, 'https://serpapi.com/manage-api-key');
  assert.ok(flatten(h.dialog()).filter(el => el.tag === 'input').every(el => el.type !== 'password'));
  assert.equal(h.calls[0][1].method, 'POST'); assert.deepEqual(JSON.parse(h.calls[0][1].body), { name: '<img src=x onerror=alert(1)>', upc: '12345678' });
  for (const a of flatten(h.dialog()).filter(el => el.tag === 'a')) { assert.equal(new URL(a.href).protocol, 'https:'); assert.equal(a.rel, 'noopener noreferrer'); }
  h.window.CompetitionPricing.close();
});
test('manual reference requires validation, preview and explicit application; no fabricated prices', async () => {
  let applied = null;
  const h = harness(() => assert.fail('manual capture must not fetch'));
  h.open({ name: 'Public', onApply: (price, reference) => { applied = { price, reference }; } });
  const dialog = h.dialog(), form = flatten(dialog).find(el => el.tag === 'form'), inputs = flatten(form).filter(el => el.tag === 'input');
  ['Mock store', 'javascript:bad', '1234.50', 'Nuevo', new Date().toISOString().slice(0, 10)].forEach((v, i) => { inputs[i].value = v; });
  await form.emit('submit'); assert.equal(find(dialog, 'Usar precio para comparar'), undefined); assert.equal(applied, null);
  inputs[1].value = 'https://example.com/product'; await form.emit('submit');
  assert.match(content(dialog), /Capturada manualmente; no verificada por IA/); assert.equal(applied, null);
  await find(dialog, 'Usar precio para comparar').click();
  assert.equal(applied.price, 1234.5); assert.equal(applied.reference.kind, 'manual'); assert.equal(applied.reference.observedAt, inputs[4].value); assert.equal(applied.reference.provenance, 'manual'); assert.equal(applied.reference.verified, false); assert.equal(applied.reference.url, 'https://example.com/product'); assert.equal(h.calls.length, 0); assert.equal(h.body.children.length, 0);
});
test('closed or superseded modal discards stale provider success and error', async () => {
  for (const fail of [false, true]) {
    let finish, signal;
    const h = harness((_url, options) => { signal = options.signal; return new Promise((resolve, reject) => { finish = () => fail ? reject(new Error('mock failure')) : resolve(Response.json({ results: [{ title: 'Stale mock', store: 'Old store', price: 11, currency: 'MXN', url: 'https://example.com/product', condition: 'Nuevo', date: new Date().toISOString().slice(0, 10) }] })); }); });
    let oldApplied = false;
    h.open({ name: 'Old product', onApply: () => { oldApplied = true; } });
    const pending = find(h.dialog(), 'Buscar precios públicos').click();
    h.open({ name: 'New product' }); assert.equal(signal.aborted, true);
    finish(); await pending;
    assert.match(content(h.dialog()), /New product/); assert.doesNotMatch(content(h.dialog()), /Stale mock|Old store|se interrumpió/); assert.equal(oldApplied, false);
    h.window.CompetitionPricing.close();
  }
});
test('mock search result requires a second explicit click and never claims exact UPC verification', async () => {
  let applied;
  const h = harness(async () => Response.json({ results: [{ title: 'Mock listing', store: 'Mock source', price: 222, currency: 'MXN', url: 'https://example.com/product', condition: 'No indicada', observedAt: new Date().toISOString(), date: new Date().toISOString().slice(0, 10) }], cached: true }));
  h.open({ name: 'Public', onApply: (price, ref) => { applied = { price, ref }; } });
  await find(h.dialog(), 'Buscar precios públicos').click();
  assert.match(content(h.dialog()), /consulta en caché/); assert.match(content(h.dialog()), /UPC no verificado/);
  await find(h.dialog(), 'Revisar este precio').click(); assert.equal(applied, undefined);
  await find(h.dialog(), 'Usar precio para comparar').click();
  assert.equal(applied.price, 222); assert.equal(applied.ref.kind, 'provider'); assert.equal(applied.ref.match, 'search'); assert.equal(applied.ref.verified, false);
});
