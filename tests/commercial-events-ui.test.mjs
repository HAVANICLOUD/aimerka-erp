import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import * as commercialEvents from '../lib/commercial-events.mjs';
import * as warehouses from '../lib/warehouses.mjs';

const source = readFileSync(new URL('../public/erp/commercial-events-ui.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const campaign = overrides => ({ id: 'e1', name: 'Navidad', startDate: '2026-12-01', endDate: '2026-12-25', markets: ['Sears', 'Coppel'], selection: { brands: [], departments: [], skus: [], warehouseId: '', onlyPublished: false }, rules: { mode: 'margin', margin: .1, discount: .1, retentionTreatment: 'pass_through', t1CommissionMode: 'configured', mlType: 'CLASICA', msi: 'Sin MSI', marketReferences: [] }, ...overrides });
const row = (sku, color = 'green', valid = true) => ({ sku, name: 'Producto ' + sku, brand: 'Marca', department: 'Audio', market: 'Sears', valid, traffic: { color, reason: color }, regularCents: 199900, discountCents: 179900, actualMargin: .12, targetMargin: .1, result: { discount: { cashProfit: 100, commercialProfit: 150, withholdingTotal: 50, objectiveMargin: .12 } } });
function harness({ saved = true, rows = [row('A'), row('B', 'yellow'), row('C', 'red'), row('D', 'green', false)], real = false, date = '2026-11-11T03:00:00Z', products } = {}) {
  const listeners = {}, calls = [], data = { config: {}, products: products || [{ sku: 'A', upc: '12345', name: 'Audífonos', brand: 'Marca', department: 'Audio', imageUrl: 'javascript:alert(1)' }], commercialEvents: saved ? [campaign()] : [], commercialEventRuns: [] };
  let fingerprint = 'fp1', fail = '', failPreview = false;
  const engine = real ? commercialEvents : { eventTemplates: commercialEvents.eventTemplates, previewCommercialEvent() { if (failPreview) throw Error('Fallo de cálculo'); return { fingerprint, rows: structuredClone(rows) }; } };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [date])); } }
  const ERP = { engines: { commercialEvents: engine, warehouses }, async command(type, payload) {
    calls.push({ type, payload: plain(payload) }); if (fail) return { ok: false, error: { message: fail } };
    if (real) return commercialEvents.commercialEventCommand(data, { id: 'cmd' + calls.length, type, payload: structuredClone(payload) }, { now: '2026-11-10T18:00:00Z', actor: 'QA' });
    if (type === 'pricing.event.save') { const event = { ...plain(payload.event), id: payload.event.id || 'new-event' }; data.commercialEvents = [...data.commercialEvents.filter(e => e.id !== event.id), event]; return { ok: true, result: { id: event.id, eventId: event.id } }; }
    return { ok: true };
  } };
  const context = createContext({ window: { ERP }, state: data, renderers: {}, document: { addEventListener(name, fn) { listeners[name] = fn; }, getElementById() { return { reportValidity: () => true }; }, querySelector() { return null; } }, render() {}, icon: () => '', money: cents => `$${(cents / 100).toFixed(2)}`, Intl, Date: FixedDate, structuredClone, console });
  runInContext(source, context);
  const api = context.window.CommercialEventsUI;
  const click = async (action, extra = {}) => listeners.click({ target: { closest: () => ({ dataset: { ceAction: action, ...extra } }) } });
  const change = (dataset, value = '', checked = false, type = 'text') => listeners.change({ target: { dataset, value, checked, type } });
  const field = (path, value, type = 'text') => change({ ceField: path }, value, type === 'checkbox' && value, type);
  return { api, data, calls, click, change, field, listeners, html: () => api.render(), fingerprint: v => { fingerprint = v; }, fail: v => { fail = v; }, failPreview: v => { failPreview = v; } };
}

test('registers renderer without nav or state writes; names never auto-fill official dates', () => {
  const h = harness({ saved: false }), before = plain(h.data);
  assert.match(h.html(), /Aún no hay campañas/); h.api.open();
  assert.match(h.html(), /type="date" value=""/); assert.doesNotMatch(h.html(), /<main/);
  assert.equal((h.html().match(/data-ce-preset="Pre-navideño"/g) || []).length, 1);
  assert.match(h.html(), /Cyber Monday/); assert.deepEqual(h.data, before); assert.equal(h.calls.length, 0);
});

test('calendar uses Mexico civil date across UTC midnight and inclusive campaign bounds', () => {
  const h = harness(); assert.equal(h.api.mexicoDate(), '2026-11-10');
  assert.equal(h.api.status(campaign(), '2026-12-01'), 'En curso'); assert.equal(h.api.status(campaign(), '2026-12-25'), 'En curso');
  assert.equal(h.api.status(campaign(), '2026-11-30'), 'Próxima'); assert.equal(h.api.status(campaign(), '2026-12-26'), 'Finalizada');
  assert.match(h.html(), /datetime="2026-11-10" aria-current="date"/);
});

test('escapes campaign, SKU, UPC, filters and error text and rejects unsafe image schemes', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const h = harness({ products: [{ sku: evil, upc: evil, name: evil, brand: evil, department: evil, imageUrl: 'javascript:alert(1)' }] });
  h.data.commercialEvents[0].name = evil; h.api.open('e1'); h.change({ ceScope: 'selected' });
  assert.match(h.html(), /&lt;img/); assert.doesNotMatch(h.html(), /<img src=x|src="javascript:/);
  h.change({ ceScope: 'all' }); h.fail(evil); h.field('name', 'changed'); await h.api.calculate(); assert.match(h.html(), /role="alert">&lt;img/);
});

test('edits, presets and selections leave shared campaign and inventory unchanged until save', async () => {
  const h = harness(), before = plain(h.data); h.api.open('e1'); h.field('name', 'Privada'); h.field('rules.margin', '17.5', 'number');
  h.change({ ceArray: 'selection.brands' }, 'Marca', true, 'checkbox'); h.field('selection.onlyPublished', true, 'checkbox');
  await h.click('', { cePreset: 'Hot Sale' }); assert.deepEqual(h.data, before); assert.equal(h.calls.length, 0);
  await h.api.calculate(); assert.equal(h.calls[0].type, 'pricing.event.save'); assert.equal(h.calls[0].payload.event.rules.margin, .175);
  assert.equal(h.calls[0].payload.event.selection.onlyPublished, true); assert.equal(h.calls[0].payload.event.startDate, '2026-12-01');
});

test('calendar rejects invalid dates without issuing save; new one-click calculation saves before preview', async () => {
  const h = harness({ saved: false }); h.api.open(); h.field('name', 'Campaña'); h.field('startDate', '2026-02-29'); h.field('endDate', '2026-12-25');
  await h.api.calculate(); assert.equal(h.calls.length, 0); assert.match(h.html(), /Captura fechas válidas/);
  h.field('startDate', '2026-12-01'); await h.api.calculate(); assert.equal(h.calls[0].type, 'pricing.event.save'); assert.match(h.html(), /Cálculo listo/);
  await h.api.apply(); assert.equal(h.calls[1].payload.eventId, 'new-event');
});

test('green-only defaults; yellow override; red requires acknowledgement and deselection revokes it', async () => {
  const h = harness(); h.api.open('e1'); await h.api.calculate(); assert.match(h.html(), /1 seleccionadas/);
  h.change({ ceRow: '2' }, '', true, 'checkbox'); assert.match(h.html(), /Acepta explícitamente/);
  h.change({ ceAck: '2' }, '', true, 'checkbox'); h.change({ ceRow: '2' }, '', true, 'checkbox'); h.change({ ceRow: '1' }, '', true, 'checkbox');
  h.change({ ceRow: '0' }, '', false, 'checkbox'); await h.api.apply();
  assert.deepEqual(h.calls[0].payload.targets, [{ sku: 'B', market: 'Sears' }, { sku: 'C', market: 'Sears' }]);
  assert.deepEqual(h.calls[0].payload.riskAcknowledgedTargets, [{ sku: 'C', market: 'Sears' }]);
  const second = harness(); second.api.open('e1'); await second.api.calculate(); second.change({ ceAck: '2' }, '', true, 'checkbox'); second.change({ ceRow: '2' }, '', true, 'checkbox'); second.change({ ceRow: '2' }, '', false, 'checkbox'); second.change({ ceRow: '2' }, '', true, 'checkbox'); assert.match(second.html(), /Acepta explícitamente/);
});

test('none and select greens work over all pages; invalid rows cannot be manually selected', async () => {
  const rows = Array.from({ length: 327 * 7 }, (_, i) => row('SKU' + i)); rows[1] = row('invalid', 'green', false);
  const h = harness({ rows }); h.api.open('e1'); await h.api.calculate();
  assert.equal((h.html().match(/data-ce-row=/g) || []).length, 50); assert.match(h.html(), /Página 1 de 46/);
  await h.click('none'); await h.api.apply(); assert.equal(h.calls.length, 0);
  await h.click('greens'); h.change({ ceRow: '1' }, '', true, 'checkbox'); await h.click('next-page'); assert.match(h.html(), /data-ce-row="50"/);
  await h.api.apply(); assert.equal(h.calls[0].payload.targets.length, 2288); assert.ok(!h.calls[0].payload.targets.some(t => t.sku === 'invalid'));
});

test('apply requires saved unedited campaign and current shared-state fingerprint', async () => {
  const h = harness(); h.api.open('e1'); await h.api.calculate(); h.fingerprint('fp2'); await h.api.apply();
  assert.equal(h.calls.length, 0); assert.match(h.html(), /inventario o las reglas cambiaron/);
  await h.api.calculate(); h.field('rules.margin', '20', 'number'); await h.api.apply(); assert.equal(h.calls.length, 0); assert.match(h.html(), /vista previa vigente/);
  const other = harness(); other.api.open('e1'); await other.api.calculate(); other.data.commercialEvents[0].rules.margin = .3; await other.api.apply(); assert.equal(other.calls.length, 0);
});

test('save and apply errors retain entered data, preview and selection for retry', async () => {
  const h = harness(); h.api.open('e1'); h.field('name', 'Campaña conservada'); h.fail('Validación del servidor'); await h.api.calculate();
  assert.match(h.html(), /value="Campaña conservada"/); assert.match(h.html(), /Validación del servidor/);
  h.fail(''); await h.api.calculate(); h.change({ ceRow: '1' }, '', true, 'checkbox'); h.fail('Reintenta'); await h.api.apply();
  assert.match(h.html(), /2 seleccionadas/); assert.match(h.html(), /Precios de campaña/); assert.match(h.html(), /Reintenta/);
  h.fail(''); await h.api.apply(); assert.deepEqual(h.calls.at(-1).payload.targets, [{ sku: 'A', market: 'Sears' }, { sku: 'B', market: 'Sears' }]);
});

test('product picker exposes all inventory matches with lazy safe images and principal warehouse fallback', () => {
  const products = Array.from({ length: 327 }, (_, i) => ({ sku: 'SKU' + i, name: 'Producto ' + i, upc: 'UPC' + i, imageUrl: 'https://example.com/image.png' }));
  const h = harness({ products }); h.api.open('e1'); h.change({ ceScope: 'selected' });
  assert.equal((h.html().match(/data-ce-array="selection.skus"/g) || []).length, 327);
  assert.match(h.html(), /SKU326/); assert.match(h.html(), /loading="lazy"/); assert.match(h.html(), /value="principal"/); assert.match(h.html(), /Almacén principal/);
  h.change({ ceArray: 'selection.skus' }, 'SKU326', true, 'checkbox'); assert.match(h.html(), /1 productos seleccionados/);
});

test('all modes expose margin; preview shows MXN cash, commercial profit, retentions and application history', async () => {
  const h = harness(); h.api.open('e1');
  for (const mode of ['margin', 'discount', 'competitive']) { h.field('rules.mode', mode, 'select-one'); assert.match(h.html(), /data-ce-field="rules.margin"/); }
  h.field('rules.mode', 'margin', 'select-one'); await h.api.calculate();
  assert.match(h.html(), /Disponible de caja/); assert.match(h.html(), /Utilidad comercial/); assert.match(h.html(), /Retenciones/); assert.match(h.html(), /\$100.00/); assert.match(h.html(), /\$150.00/); assert.match(h.html(), /\$50.00/);
  h.data.commercialEventRuns.push({ id: 'run1', eventId: 'e1', date: '2026-11-11T03:00:00Z', actor: '<QA>', targets: [{ sku: 'A', market: 'Sears' }] });
  assert.match(h.html(), /run1/); assert.match(h.html(), /&lt;QA&gt;/); assert.match(h.html(), /pendiente de envío/);
});

test('real backend integration saves internal prices and excludes paused or pending listings exactly', async () => {
  const h = harness({ real: true, saved: false }); h.data.config = JSON.parse(readFileSync(new URL('../data/pricing-config.json', import.meta.url)));
  h.data.products = [{ sku: 'A', name: 'Laptop', brand: 'APPLE', department: 'COMPUTO', category: 'LAPTOPS', shippingType: 'Pequeño', costCents: 1200000, priceCents: 2100000, status: 'OK', good: 3, channelListings: { Sears: { status: 'published' }, Coppel: { status: 'paused' }, Sanborns: { status: 'pending_approval' } } }];
  h.api.open(); h.field('name', 'Mi campaña'); h.field('startDate', '2026-12-01'); h.field('endDate', '2026-12-25'); h.field('selection.onlyPublished', true, 'checkbox');
  const before = plain(h.data.products); await h.api.calculate(); assert.match(h.html(), /1 combinaciones/); await h.api.apply();
  assert.equal(h.calls.at(-1).type, 'pricing.event.apply'); assert.equal(h.data.commercialEventRuns.length, 1); assert.equal(h.data.commercialEventRuns[0].targets[0].market, 'Sears');
  assert.equal(h.data.pricePublicationQueue[0].status, 'awaiting_connection'); assert.deepEqual(h.data.products, before);
});

test('monthly grid includes persisted campaigns on both boundaries; presets keep dates blank', async () => {
  const h = harness(); await h.click('next-month');
  assert.equal((h.html().match(/data-ce-edit="e1"/g) || []).length, 26); // 25 calendar days + agenda.
  assert.match(h.html(), /diciembre de 2026/); await h.click('next-month'); assert.match(h.html(), /enero de 2027/);
  h.api.open(); await h.click('', { cePreset: 'Buen Fin' });
  assert.match(h.html(), /data-ce-field="name" type="text" value="Buen Fin"/);
  assert.match(h.html(), /data-ce-field="startDate" type="date" value=""/);
  assert.match(h.html(), /data-ce-field="endDate" type="date" value=""/);
});

test('concurrent calculate submissions issue one save and form edits stay blocked during command', async () => {
  const h = harness({ saved: false }); h.api.open(); h.field('name', 'Original'); h.field('startDate', '2026-12-01'); h.field('endDate', '2026-12-25');
  const pending = h.api.calculate(); h.field('name', 'Concurrent edit'); await h.api.calculate(); await pending;
  assert.equal(h.calls.filter(c => c.type === 'pricing.event.save').length, 1); assert.equal(h.data.commercialEvents[0].name, 'Original');
});


test('calendar clearly explains manual price application without implying scheduled writes', () => {
  const h = harness();
  assert.match(h.html(), /El calendario organiza la vigencia; guardar fechas no cambia ni restaura precios automáticamente\. Aplica la selección cuando corresponda\./);
  assert.doesNotMatch(h.html(), /Programada/);
});
