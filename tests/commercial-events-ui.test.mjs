import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import * as commercialEvents from '../lib/commercial-events.mjs';
import * as warehouses from '../lib/warehouses.mjs';
import * as inventory from '../lib/inventory-v28.mjs';

const source = readFileSync(new URL('../public/erp/commercial-events-ui.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const campaign = overrides => ({ id: 'e1', name: 'Navidad', startDate: '2026-12-01', endDate: '2026-12-25', markets: ['Sears', 'Coppel'], selection: { brands: [], departments: [], skus: [], warehouseId: '', onlyPublished: false }, rules: { mode: 'margin', margin: .1, discount: .1, retentionTreatment: 'pass_through', t1CommissionMode: 'configured', mlType: 'CLASICA', msi: 'Sin MSI', marketReferences: [] }, ...overrides });
const row = (sku, color = 'green', valid = true) => ({ sku, name: 'Producto ' + sku, brand: 'Marca', department: 'Audio', market: 'Sears', valid, traffic: { color, reason: color }, regularCents: 199900, discountCents: 179900, actualMargin: .12, targetMargin: .1, result: { discount: { cashProfit: 100, commercialProfit: 150, withholdingTotal: 50, objectiveMargin: .12 } } });
function harness({ saved = true, rows = [row('A'), row('B', 'yellow'), row('C', 'red'), row('D', 'green', false)], real = false, date = '2026-11-11T03:00:00Z', products, lifecycle } = {}) {
  const listeners = {}, calls = [], data = { config: {}, products: products || [{ sku: 'A', upc: '12345', name: 'Audífonos', brand: 'Marca', department: 'Audio', imageUrl: 'javascript:alert(1)' }], commercialEvents: saved ? [campaign()] : [], commercialEventRuns: [] };
  let fingerprint = 'fp1', fail = '', failPreview = false;
  const engine = real ? commercialEvents : { commercialEventPriceRows:commercialEvents.commercialEventPriceRows, commercialEventCompletedTargets:commercialEvents.commercialEventCompletedTargets, commercialCampaignCoverage:commercialEvents.commercialCampaignCoverage,eventTemplates: commercialEvents.eventTemplates, previewCommercialEvent() { if (failPreview) throw Error('Fallo de cálculo'); return { fingerprint, rows: structuredClone(rows) }; } };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [date])); } }
  const ERP = { downloadCSV(name,rows){calls.push({type:'download',name,rows:plain(rows)});}, engines: { commercialEvents: engine, warehouses, inventory, productLifecycle: lifecycle }, async command(type, payload) {
    calls.push({ type, payload: plain(payload) }); if (fail) return { ok: false, error: { message: fail } };
    if (real) return commercialEvents.commercialEventCommand(data, { id: 'cmd' + calls.length, type, payload: structuredClone(payload) }, { now: '2026-11-10T18:00:00Z', actor: 'QA' });
    if (type === 'pricing.event.save') { const event = { ...plain(payload.event), id: payload.event.id || 'new-event' }; data.commercialEvents = [...data.commercialEvents.filter(e => e.id !== event.id), event]; return { ok: true, result: { id: event.id, eventId: event.id } }; }
    return { ok: true };
  } };
  const context = createContext({ window: { ERP }, showModal:html=>{calls.push({type:'modal',html});}, state: data, renderers: {}, document: { addEventListener(name, fn) { listeners[name] = fn; }, getElementById() { return { reportValidity: () => true }; }, querySelector() { return null; } }, render() {}, icon: () => '', money: cents => `$${(cents / 100).toFixed(2)}`, Intl, Date: FixedDate, structuredClone, console });
  runInContext(source, context);
  const api = context.window.CommercialEventsUI;
  const click = async (action, extra = {}) => listeners.click({ target: { closest: () => ({ dataset: { ceAction: action, ...extra } }) } });
  const change = (dataset, value = '', checked = false, type = 'text') => listeners.change({ target: { dataset, value, checked, type } });
  const field = (path, value, type = 'text') => change({ ceField: path }, value, type === 'checkbox' && value, type);
  return { context, api, data, calls, click, change, field, listeners, html: () => api.render(), fingerprint: v => { fingerprint = v; }, fail: v => { fail = v; }, failPreview: v => { failPreview = v; } };
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
  assert.match(h.html(), /Al terminar el día de cierre en Ciudad de México se restauran los precios anteriores; el envío a tiendas requiere integración\./);
  assert.doesNotMatch(h.html(), /Programada/);
});


test('groups noncontiguous channels by whole product, takes metadata from inventory, and keeps SKU hue', async () => {
  const rows = Array.from({ length: 51 }, (_, i) => row('P' + i));
  rows.push({ ...row('P0'), market: 'Coppel', name: 'DO NOT USE RESULT NAME', upc: 'WRONG', good: 999 });
  const h = harness({ rows, products: [{ sku: 'P0', name: 'Inventario real', upc: 'UPC-REAL', good: 20, reserved: 3, safety: 2, imageUrl: '/erp/product.png' }] });
  h.api.open('e1'); await h.api.calculate();
  const html = h.html();
  assert.equal((html.match(/data-ce-product=/g) || []).length, 50);
  assert.equal((html.match(/data-ce-row=/g) || []).length, 51);
  assert.match(html, /data-ce-row="51"/); assert.doesNotMatch(html, /data-ce-row="50"/);
  assert.match(html, /Inventario real/); assert.match(html, /UPC UPC-REAL/);
  assert.match(html, /Físico vendible: 20/); assert.match(html, /Disponible: 15/);
  assert.doesNotMatch(html, /DO NOT USE RESULT NAME|UPC WRONG|Físico vendible: 999/);
  const hue = html.match(/ce-product-group (ce-hue-\d)" data-ce-product="P0"/)[1];
  await h.click('view', { ceView: 'cards' });
  assert.match(h.html(), new RegExp(`ce-product-group ${hue}" data-ce-product="P0"`));
  assert.equal((h.html().match(/class="ce-channel-card"/g) || []).length, 51);
  await h.click('next-page'); assert.match(h.html(), /Página 2 de 2/);
  assert.equal((h.html().match(/data-ce-row=/g) || []).length, 1); assert.match(h.html(), /data-ce-row="50"/);
});

test('signal filters keep global counts, original indices, checked targets and risk acceptance across views and pages', async () => {
  const rows = Array.from({ length: 52 }, (_, i) => row('P' + i));
  rows[1] = row('P1', 'red'); rows[50] = row('P50', 'yellow'); rows[51] = row('P51', 'red');
  const h = harness({ rows }); h.api.open('e1'); await h.api.calculate(); await h.click('none');
  await h.click('filter', { ceFilter: 'red' });
  assert.match(h.html(), /data-ce-filter="red" aria-pressed="true"/);
  assert.match(h.html(), /49 verdes/); assert.match(h.html(), /1 amarillos/); assert.match(h.html(), /2 rojos/); assert.match(h.html(), /52 todos/);
  assert.match(h.html(), /data-ce-row="51"/); assert.doesNotMatch(h.html(), /data-ce-row="0"/);
  h.change({ ceAck: '51' }, '', true, 'checkbox'); h.change({ ceRow: '51' }, '', true, 'checkbox');
  await h.click('view', { ceView: 'cards' }); assert.match(h.html(), /data-ce-ack="51" checked/);
  await h.click('filter', { ceFilter: 'all' }); await h.click('next-page');
  assert.match(h.html(), /data-ce-row="51"[^>]*checked/); assert.match(h.html(), /data-ce-ack="51" checked/);
  await h.click('view', { ceView: 'matrix' }); assert.match(h.html(), /class="ce-matrix"/);
  assert.match(h.html(), /data-ce-row="51"[^>]*checked/);
  await h.click('filter', { ceFilter: 'amber' });
  h.change({ ceRow: '50' }, '', true, 'checkbox');
  await h.api.apply();
  assert.deepEqual(h.calls[0].payload.targets, [{ sku: 'P50', market: 'Sears' }, { sku: 'P51', market: 'Sears' }]);
  assert.deepEqual(h.calls[0].payload.riskAcknowledgedTargets, [{ sku: 'P51', market: 'Sears' }]);
});

test('empty red filter retains global counts and global greens action despite no visible rows', async () => {
  const h = harness({ rows: [row('A'), row('B'), row('C', 'yellow'), row('D', 'green', false)] });
  h.api.open('e1'); await h.api.calculate(); await h.click('none'); await h.click('filter', { ceFilter: 'red' });
  assert.match(h.html(), /No hay resultados/); assert.match(h.html(), /3 verdes/); assert.match(h.html(), /0 rojos/);
  assert.equal((h.html().match(/data-ce-row=/g) || []).length, 0);
  await h.click('greens'); assert.match(h.html(), /2 seleccionadas/); await h.api.apply();
  assert.deepEqual(h.calls[0].payload.targets, [{ sku: 'A', market: 'Sears' }, { sku: 'B', market: 'Sears' }]);
});

test('matrix compares channels inside one product with real economics, signal and shared controls', async () => {
  const h = harness({ rows: [row('A'), { ...row('A', 'red'), market: 'Coppel' }] });
  h.api.open('e1'); await h.api.calculate(); await h.click('view', { ceView: 'matrix' });
  const html = h.html();
  assert.equal((html.match(/data-ce-product=/g) || []).length, 1);
  assert.equal((html.match(/scope="col"/g) || []).length, 2);
  assert.match(html, /Sears/); assert.match(html, /Coppel/);
  for (const text of ['Regular', 'Campaña', 'Disponible de caja', 'Utilidad comercial', 'Retenciones', 'Margen / objetivo', '$100.00', '$150.00', '$50.00', 'Rojo · riesgo']) assert.ok(html.includes(text), text);
  h.change({ ceRow: '1' }, '', true, 'checkbox'); assert.match(h.html(), /Acepta explícitamente/);
  h.change({ ceAck: '1' }, '', true, 'checkbox'); h.change({ ceRow: '1' }, '', true, 'checkbox');
  await h.click('view', { ceView: 'list' }); assert.match(h.html(), /data-ce-row="1"[^>]*checked/);
  h.change({ ceAck: '1' }, '', false, 'checkbox'); await h.click('view', { ceView: 'cards' });
  assert.doesNotMatch(h.html(), /data-ce-row="1"[^>]*checked/);
});

test('unsafe images and metadata stay escaped in every view; broken safe images fall back to vector', async () => {
  for (const imageUrl of ['javascript:alert(1)', 'data:image/svg+xml,evil', '//evil.test/a', '/\\evil.test/a', '/\nevil.test/a', 'http://evil.test/a']) {
    const evil = '<img src=x onerror=alert(1)>';
    const h = harness({ rows: [row('A')], products: [{ sku: 'A', name: evil, upc: evil, imageUrl }] });
    h.api.open('e1'); await h.api.calculate();
    for (const view of ['list', 'cards', 'matrix']) {
      await h.click('view', { ceView: view }); assert.doesNotMatch(h.html(), /<img\b/); assert.match(h.html(), /&lt;img/); assert.match(h.html(), /ce-product-image/);
    }
  }
  const h = harness({ products: [{ sku: 'A', name: 'Safe', imageUrl: 'https://images.example/a.png?x="bad"' }] });
  h.api.open('e1'); await h.api.calculate(); assert.match(h.html(), /src="https:\/\/images.example\/a.png\?x=&quot;bad&quot;"/);
  h.data.products[0].images = [{ url: '/erp/secondary.png' }, { url: '/erp/primary.png', primary: true }];
  assert.match(h.html(), /src="\/erp\/primary.png"/); assert.doesNotMatch(h.html(), /src="https:\/\/images.example/);
  h.data.products[0].images[1].url = 'javascript:alert(1)';
  assert.match(h.html(), /src="https:\/\/images.example/); assert.doesNotMatch(h.html(), /src="javascript:/);
  let removed = false; h.listeners.error({ target: { dataset: { ceImage: '' }, remove() { removed = true; } } }); assert.ok(removed);
});

test('new campaign pickers and brand/department choices respect lifecycle without removing historical results', async () => {
  const products = [{ sku: 'A', name: 'Visible', brand: 'Active brand', department: 'Active dept' }, { sku: 'H', name: 'Hidden', brand: 'Hidden brand', department: 'Hidden dept', hidden: true }, { sku: 'X', name: 'Discontinued', brand: 'Old brand', department: 'Old dept', discontinued: true }];
  const h = harness({ products, rows: [row('H')], lifecycle: { commerciallySelectable: p => !p.hidden && !p.discontinued } });
  h.api.open(); h.change({ ceScope: 'selected' });
  assert.match(h.html(), /data-ce-array="selection.skus" value="A"/);
  assert.doesNotMatch(h.html(), /data-ce-array="selection.skus" value="(?:H|X)"|Hidden brand|Hidden dept|Old brand|Old dept/);
  h.data.products[1].good = 10; h.data.products[1].lifecycle = { hidden: true, discontinued: true };
  h.api.open('e1'); await h.api.calculate(); assert.match(h.html(), /data-ce-product="H"/);
  assert.match(h.html(), /Físico vendible: 10/); assert.match(h.html(), /Disponible: 0/);
  h.data.commercialEventRuns.push({ id: 'archived-run', eventId: 'e1', targets: [{ sku: 'H', market: 'Sears' }] });
  assert.match(h.html(), /archived-run/);
});

test('all buttons and dropdowns contain decorative inline SVG icons', async () => {
  const h = harness(); h.api.open('e1'); await h.api.calculate();
  for (const match of h.html().matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) assert.match(match[1], /<svg[^>]*aria-hidden="true"/);
  const html = h.html();
  for (const wrapper of html.matchAll(/<span class="ce-select-wrap">([\s\S]*?)<\/select>/g)) {
    assert.match(wrapper[1], /ce-select-leading/); assert.match(wrapper[1], /ce-select-chevron/);
    assert.equal((wrapper[1].match(/<svg\b/g) || []).length, 2);
  }
  assert.match(html, /data-ce-preset="[^"]+"><svg[^>]*>[\s\S]*?<path d="M4 5h16/);
  for (const light of html.matchAll(/<svg class="ce-icon ce-traffic-light"[^>]*>([\s\S]*?)<\/svg>/g)) {
    assert.match(light[1], /<rect[^>]*fill="#263b43"/);
    assert.equal((light[1].match(/<circle/g) || []).length, 3);
  }
  assert.match(html, /fill="#ef6b68" opacity="1"/); assert.match(html, /fill="#62cf94" opacity="0\.18"/);
  assert.equal((h.html().match(/<select\b/g) || []).length, (h.html().match(/class="ce-select-wrap"/g) || []).length);
});

test('product headers show inventory average and general sale price in every view without changing state', async () => {
  const products = [
    { sku: 'A', averageCostMxn: 123.456789, costCents: 98765, priceCents: 234500 },
    { sku: 'B', costCents: 45678, priceCents: 89900 },
    { sku: 'C', averageCostMxn: 0, costCents: 12345, priceCents: 0 },
    { sku: 'D', averageCostMxn: 999, costCents: 99900, costStatus: 'Por confirmar', priceCents: 199900 },
    { sku: 'E' }
  ];
  const h = harness({ products, rows: products.map(p => ({ ...row(p.sku), costCents: 77777, averageCostMxn: 777 })) });
  const before = plain(h.data);
  h.api.open('e1'); await h.api.calculate();
  for (const view of ['list', 'cards', 'matrix']) {
    await h.click('view', { ceView: view });
    const headers = [...h.html().matchAll(/<header class="ce-product-header">([\s\S]*?)<\/header>/g)].map(m => m[1]);
    for (const [index, average, general] of [[0, '$123.46', '$2345.00'], [1, '$456.78', '$899.00'], [2, '$0.00', '$0.00'], [3, 'Por confirmar', '$1999.00'], [4, '—', '—']]) {
      assert.ok(headers[index].includes(`Costo promedio: <strong>${average}</strong>`));
      assert.ok(headers[index].includes(`Precio general: <strong>${general}</strong>`));
      assert.match(headers[index], /title="Precio general registrado en la ficha del producto"/);
    }
    assert.equal((headers[3].match(/ce-cost-pending/g) || []).length, 1);
    assert.doesNotMatch(headers[3], /Costo comercial/);
  }
  assert.deepEqual(h.data, before);
  assert.equal(h.calls.length, 0);
});

test('matrix tracks only visible channels (7/2/1), retains reasons and original selection targets', async () => {
  const markets = ['Sears', 'Sanborns', 'Coppel', 'Mercado Libre', 'Liverpool', 'Tienda Nube', 'Elektra'];
  const reason = '<revisar> ' + 'referencia-sin-espacios'.repeat(60);
  const rows = markets.map((market, i) => ({ ...row('A', i < 2 ? 'green' : i === 2 ? 'amber' : 'red'), market, reason, warnings: ['Aviso & revisión'] }));
  const h = harness({ rows }); h.api.open('e1'); await h.api.calculate();
  await h.click('view', { ceView: 'matrix' });
  for (const [filter, count, indices] of [['all', 7, [0, 1, 2, 3, 4, 5, 6]], ['green', 2, [0, 1]], ['amber', 1, [2]], ['all', 7, [0, 1, 2, 3, 4, 5, 6]]]) {
    await h.click('filter', { ceFilter: filter });
    assert.match(h.html(), /tabindex="0" role="region" aria-label="Comparación horizontal por marketplace"/);
    const matrix = h.html().match(/<table class="ce-matrix"[\s\S]*?<\/table>/)[0];
    assert.match(matrix, new RegExp(`style="--ce-market-count:${count}"`));
    assert.equal((matrix.match(/scope="col"/g) || []).length, count);
    assert.deepEqual([...matrix.matchAll(/data-ce-row="(\d+)"/g)].map(m => +m[1]), indices);
    assert.equal((matrix.match(/&lt;revisar&gt;/g) || []).length, count);
    assert.ok(matrix.includes('Aviso &amp; revisión'));
  }
  const actions = h.html().match(/<div class="ce-selection-actions"[\s\S]*?<\/div>/)[0];
  assert.match(actions, /role="group" aria-label="Selección de precios"/);
  assert.match(actions, /data-ce-action="greens"/); assert.match(actions, /data-ce-action="none"/);
  await h.click('none'); assert.match(h.html(), /0 seleccionadas/);
  await h.click('greens'); assert.match(h.html(), /2 seleccionadas/);
  await h.api.apply();
  assert.deepEqual(h.calls[0].payload.targets, [{ sku: 'A', market: 'Sears' }, { sku: 'A', market: 'Sanborns' }]);
});

test('evaluation omits exact repeated warnings and those already in reason, preserving unique escaped warnings', async () => {
  const warning = 'Por debajo del margen objetivo configurado.';
  const h = harness({ rows: [{ ...row('A', 'amber'), reason: `El margen de caja está por debajo del mínimo configurado. ${warning}`, warnings: [warning, warning, 'Revisar <referencia>', 'Revisar <referencia>', 'Otro aviso'] }] });
  h.api.open('e1'); await h.api.calculate();
  for (const view of ['list', 'cards', 'matrix']) {
    await h.click('view', { ceView: view });
    const reason = h.html().match(/class="ce-evaluation-reason">([^<]*)/)[1];
    assert.equal(reason, `El margen de caja está por debajo del mínimo configurado. ${warning} · Revisar &lt;referencia&gt; · Otro aviso`);
  }
});

 test('new campaign buttons contain one vector plus and reveal and focus the editor without saving',async()=>{
 const h=harness({saved:false}),actions=[];h.context.document.getElementById=id=>id==='commercial-events-form'?{scrollIntoView:o=>actions.push(['scroll',o.block]),querySelector:()=>({focus:o=>actions.push(['focus',o.preventScroll])})}:null;
 assert.match(h.html(),/>Nueva campaña<\/button>/);assert.match(h.html(),/>Crear campaña<\/button>/);assert.doesNotMatch(h.html(),/\+ (Nueva|Crear) campaña/);
 await h.click('new');assert.deepEqual(actions,[['scroll','start'],['focus',true]]);assert.match(h.html(),/id="commercial-events-form"/);assert.equal(h.calls.length,0);
 });

test('transfer strategy offers all additional discounts 1–50 and explicit percentage fee', async () => {
 const h=harness({saved:false});h.api.open();
 assert.match(h.html(),/Activar descuento adicional por transferencia/);
 await h.click('transfer-toggle');
 let html=h.html();assert.match(html,/Descuento adicional por transferencia/);assert.match(html,/Comisión por transferencia \(%\)/);
 const choices=html.match(/data-ce-field="rules.transfer.discount"[\s\S]*?<\/select>/)?.[0];
 assert.equal((choices.match(/<option/g)||[]).length,50);assert.match(choices,/value="1"/);assert.match(choices,/value="50"/);
 h.field('rules.transfer.commissionRate','0.07');h.field('rules.transfer.discount','25','select-one');
 await h.click('save');assert.match(h.html(),/Escribe el nombre/);
});
test('transfer results appear in list cards and matrix with separate cash, zero withholding and fee',async()=>{
 const r=row('A');r.market='Tienda Nube';r.campaignTransfer={price:810,additionalDiscount:.1,commissionRate:.0007,commission:.57,marketplacePayout:809.43,cost:500,shipping:100,cashProfit:209.43,margin:209.43/810,targetMargin:.1,totalDiscountRate:.19,traffic:{color:'green',reason:'Cumple el margen.'}};
 const h=harness({rows:[r]});h.api.open('e1');await h.click('save');await h.listeners.submit({target:{id:'commercial-events-form',reportValidity:()=>true},preventDefault(){}});
 for(const view of ['list','cards','matrix']){await h.click('view',{ceView:view});const html=h.html();assert.match(html,/Pago por transferencia/);assert.match(html,/\$810.00/);assert.match(html,/Comisión \(0.07%\)/);assert.match(html,/Disponible de caja/);assert.match(html,/Sin MSI · Retenciones \$0.00/);}
});


test('history consults separate discount batches and exports snapshots without recalculating or writing',async()=>{
 const h=harness();const original=campaign();original.rules.mode='discount';original.rules.discount=.25;original.selection.brands=['Apple'];
 h.data.commercialEventRuns=[{id:'batch25',eventId:'e1',date:'2026-11-13T18:00:00Z',event:original,targets:[{...row('A'),name:'Nombre histórico',upc:'001234',discount:{profit:100},regularCents:100000,discountCents:75000}]},{id:'batch10',eventId:'e1',event:{...original,rules:{...original.rules,discount:.1},selection:{brands:['Dyson']}},targets:[{...row('B','yellow'),regularCents:100000,discountCents:90000}]}];
 const before=plain(h.data);assert.match(h.html(),/Descuento 25%/);assert.match(h.html(),/Descuento 10%/);assert.match(h.html(),/Marcas: Apple/);assert.match(h.html(),/Marcas: Dyson/);
 await h.click('history-run',{ceRunId:'batch25'});assert.match(h.html(),/Nombre histórico/);assert.match(h.html(),/UPC 001234/);assert.match(h.html(),/\$750.00/);
 await h.click('export-run',{ceRunId:'batch25',ceGreen:'1'});const exported=h.calls.at(-1);assert.equal(exported.type,'download');assert.equal(exported.rows[0].precio_descuento_mxn,'750.00');assert.equal(exported.rows[0].upc,'001234');assert.equal(exported.rows[0].descuento_configurado_porcentaje,25);
 h.change({ceHistoryCampaign:''},'e1');assert.match(h.html(),/Exportar campaña CSV/);await h.click('export-campaign',{ceEventId:'e1'});assert.equal(h.calls.at(-1).rows.length,2);assert.deepEqual(plain(h.data),before);assert.equal(h.calls.some(c=>c.type.startsWith('pricing.')),false);
});
test('campaign removal waits for explicit in-app choice, keeps history and permits recovery',async()=>{
 const h=harness({real:true});h.data.commercialEventRuns=[{id:'saved-run',eventId:'e1',targets:[]}];
 h.api.open('e1');await h.click('delete',{ceEventId:'e1'});assert.equal(h.calls.length,0);assert.match(h.html(),/¿Eliminar esta campaña/);
 await h.click('cancel-delete');assert.equal(h.calls.length,0);
 await h.click('delete',{ceEventId:'e1'});await h.click('confirm-delete',{ceEventId:'e1'});
 assert.equal(h.calls[0].type,'pricing.event.delete');assert.ok(h.data.commercialEvents[0].deletedAt);assert.match(h.html(),/Campañas eliminadas/);assert.equal(h.data.commercialEventRuns[0].id,'saved-run');assert.doesNotMatch(h.html(),/data-ce-edit="e1"/);
 await h.click('restore',{ceEventId:'e1'});assert.equal(h.calls[1].type,'pricing.event.restore');assert.equal(h.data.commercialEvents[0].deletedAt,undefined);assert.match(h.html(),/data-ce-edit="e1"/);
});

test('one accumulated campaign block displays all discount groups and product images in its consolidated view',async()=>{
 const h=harness();
 h.data.commercialEventRuns=[{id:'r25',eventId:'e1',event:campaign({selection:{brands:['Apple']},rules:{mode:'discount',discount:.25}}),targets:[{...row('A'),brand:'Apple',imageUrl:'/api/media/product-a',regularCents:100000,discountCents:75000}]},{id:'r10',eventId:'e1',event:campaign({selection:{departments:['Audio']},rules:{mode:'discount',discount:.1}}),targets:[{...row('B'),brand:'Other',imageUrl:'javascript:alert(1)',regularCents:100000,discountCents:90000}]}];
 assert.equal((h.html().match(/data-ce-campaign="e1"/g)||[]).length,1);
 assert.match(h.html(),/Descuento 25%/);assert.match(h.html(),/Descuento 10%/);assert.match(h.html(),/Departamentos: Audio/);
 await h.click('history-campaign',{ceEventId:'e1'});
 assert.match(h.html(),/src="\/api\/media\/product-a"/);assert.doesNotMatch(h.html(),/src="javascript:/);
 assert.match(h.html(),/Campaña · pasarela \/ MSI: 25%/);assert.match(h.html(),/Campaña · pasarela \/ MSI: 10%/);assert.match(h.html(),/SKU A/);assert.match(h.html(),/SKU B/);
});

test('reopened campaign picker omits completed products and retains chosen brand filters for deselection',()=>{
 const h=harness({products:[{sku:'A',name:'Guardado',brand:'Apple'},{sku:'B',name:'Pendiente',brand:'Dyson'}]});
 h.data.commercialEvents[0].markets=['Sears'];h.data.commercialEvents[0].selection.brands=['Apple'];
 h.data.commercialEventRuns=[{id:'done',eventId:'e1',event:campaign(),targets:[{...row('A'),brand:'Apple'}]}];
 h.api.open('e1');h.change({ceScope:'selected'});
 assert.doesNotMatch(h.html(),/data-ce-array="selection.skus" value="A"/);
 assert.match(h.html(),/data-ce-array="selection.skus" value="B"/);
 assert.match(h.html(),/data-ce-array="selection.brands" value="Apple" checked/);
});

test('history names campaign discount and additional SPEI separately with one typography class',async()=>{
 const h=harness();h.data.commercialEventRuns=[{id:'spei',eventId:'e1',event:campaign({rules:{mode:'discount',discount:.25}}),targets:[{...row('A'),brand:'Apple',regularCents:100000,discountCents:75000,campaignTransfer:{additionalDiscount:.1,totalDiscountRate:.325,priceCents:67500}}]}];await h.click('history-campaign',{ceEventId:'e1'});
 const html=h.html();assert.match(html,/Campaña · pasarela \/ MSI: 25%/);assert.match(html,/SPEI adicional: 10% sobre el precio de campaña/);assert.match(html,/Descuento total por SPEI: 32.5%/);assert.match(html,/Precio por SPEI: \$675.00/);assert.match(html,/Marca: Apple/);assert.doesNotMatch(html,/>25% efectivo|Descuento asignado/);
});


test('saved agenda shows roots only and opens their lots and progress in a read-only modal',async()=>{
 const h=harness();h.data.commercialEvents=[campaign({id:'root',name:'Principal',isParent:true}),campaign({id:'apple',name:'Apple lot',parentId:'root'}),campaign({id:'consoles',name:'Consoles lot',parentId:'root'})];
 const html=h.html(),agenda=html.slice(html.indexOf('<aside class="ce-panel ce-agenda">'),html.indexOf('</aside>'));
 assert.match(agenda,/data-ce-edit="root"/);assert.doesNotMatch(agenda,/data-ce-edit="apple"|data-ce-edit="consoles"/);
 const before=plain(h.data);await h.click('',{ceEdit:'root'});const modal=h.calls.at(-1);assert.equal(modal.type,'modal');assert.match(modal.html,/id="modal-title">Principal/);assert.match(modal.html,/Apple lot/);assert.match(modal.html,/Consoles lot/);assert.match(modal.html,/AVANCE DE CAMPAÑA PRINCIPAL/);assert.deepEqual(plain(h.data),before);
 await h.click('family-new-lot',{ceEventId:'root'});assert.match(h.html(),/<option value="root" selected>Principal/);
});
test('campaign and lot filters isolate consultations and CSV exports and reset when switching campaign',async()=>{
 const h=harness();h.data.commercialEvents=[campaign({id:'root',name:'Parent',isParent:true}),campaign({id:'a',name:'Apple lot',parentId:'root'}),campaign({id:'b',name:'Other lot',parentId:'root'}),campaign({id:'other',name:'Other parent',isParent:true})];
 h.data.commercialEventRuns=[{id:'a-run',eventId:'a',event:campaign({name:'Apple lot'}),targets:[row('A')]},{id:'b-run',eventId:'b',event:campaign({name:'Other lot'}),targets:[row('B')]},{id:'other-run',eventId:'other',event:campaign({name:'Else'}),targets:[row('C')]}];
 h.change({ceHistoryCampaign:''},'root');assert.match(h.html(),/data-ce-history-lot/);assert.match(h.html(),/SKU A/);assert.match(h.html(),/SKU B/);assert.doesNotMatch(h.html(),/SKU C/);
 h.change({ceHistoryLot:''},'a');assert.match(h.html(),/SKU A/);assert.doesNotMatch(h.html(),/SKU B/);assert.match(h.html(),/data-ce-lot-id="a"/);
 await h.click('export-campaign',{ceEventId:'root',ceLotId:'a'});assert.equal(h.calls.at(-1).rows.length,1);assert.equal(h.calls.at(-1).rows[0].sku,'A');assert.match(h.calls.at(-1).name,/lote-a/);
 h.change({ceHistoryCampaign:''},'other');assert.doesNotMatch(h.html(),/value="a" selected/);assert.match(h.html(),/SKU C/);assert.doesNotMatch(h.html(),/SKU A/);
});

test('discount base selection defaults to current general price and labels channel prices separately',async()=>{
 const r=row('A');Object.assign(r,{input:{mode:'manual_precios'},baselineSource:'general',baselineCents:1249900,channelRegularCents:1409900});
 const h=harness({rows:[r]});h.api.open('e1');h.field('rules.mode','discount','select-one');
 assert.match(h.html(),/Precio base del descuento/);assert.match(h.html(),/value="general" selected/);
 await h.api.calculate();assert.match(h.html(),/general actualizado de la ficha/);assert.match(h.html(),/Precio regular guardado del canal: \$14099.00/);
 h.field('rules.discountBase','channel','select-one');await h.api.calculate();assert.equal(h.calls.findLast(c=>c.type==='pricing.event.save').payload.event.rules.discountBase,'channel');
});
test('calculate refreshes shared product data while preserving form inputs and refuses externally edited campaign definitions',async()=>{
 const h=harness();h.api.open('e1');let refreshed=0;
 h.context.window.ERP.reload=async()=>{refreshed++;h.data.products[0].priceCents=1249900;};
 h.field('rules.discount','15','number');await h.api.calculate();assert.equal(refreshed,1);assert.equal(h.data.products[0].priceCents,1249900);assert.equal(h.calls.find(c=>c.type==='pricing.event.save').payload.event.rules.discount,.15);
 const conflict=harness();conflict.api.open('e1');conflict.context.window.ERP.reload=async()=>{conflict.data.commercialEvents[0].name='Edited elsewhere';};conflict.field('rules.margin','20','number');await conflict.api.calculate();assert.equal(conflict.calls.length,0);assert.match(conflict.html(),/La campaña cambió desde otra ventana/);assert.match(conflict.html(),/value="20"/);
});
