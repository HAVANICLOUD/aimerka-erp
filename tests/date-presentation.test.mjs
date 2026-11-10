import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext, runInContext} from 'node:vm';

const source = readFileSync(new URL('../public/erp/date-presentation-ui.js', import.meta.url), 'utf8');
function pure() {
  const window = {};
  const context = createContext({window, Date, Intl});
  runInContext(source, context);
  return window.ERPDate;
}
const api = pure();

test('civil dates are displayed without a timezone shift, including low years', () => {
  for (const [iso, latin] of [['2026-11-10', '10/11/2026'], ['2000-02-29', '29/02/2000'], ['0004-02-29', '29/02/0004']]) {
    assert.equal(api.date(iso), latin);
    assert.equal(api.datetime(iso), latin);
    assert.equal(api.parse(latin), iso);
  }
});
test('calendar validation applies Gregorian leap and century rules', () => {
  for (const iso of ['2000-02-29', '2024-02-29', '2400-02-29', '2026-04-30']) assert.equal(api.isCalendarDate(iso), true);
  for (const iso of ['1900-02-29', '2100-02-29', '2026-02-29', '2026-04-31', '0000-01-01', '2026-00-10', '2026-13-01', '2026-01-00', '2026-1-01']) {
    assert.equal(api.isCalendarDate(iso), false, iso);
    assert.equal(api.date(iso), iso);
  }
  for (const value of ['1/02/2026', '02/1/2026', '29/02/1900', '31/04/2026', '2026-11-10', '10/11/26', '10/11/2026x']) assert.equal(api.parse(value), null, value);
});
test('instant formatting uses Mexico City at midnight boundaries and explicit offsets', () => {
  assert.equal(api.datetime('2026-11-10T05:59:59Z'), '09/11/2026 23:59');
  assert.equal(api.datetime('2026-11-10T06:00:00Z'), '10/11/2026 00:00');
  assert.equal(api.date('2026-11-10T00:15:00Z'), '09/11/2026');
  assert.equal(api.datetime('2026-11-10T00:15:00-06:00'), '10/11/2026 00:15');
  assert.equal(api.datetime('2026-11-10T10:00:00+04:00'), '10/11/2026 00:00');
  assert.equal(api.datetime(new Date('2026-11-10T05:00:00Z')), '09/11/2026 23:00');
  assert.equal(api.datetime('2026-11-10T06:00:00.123456Z'), '10/11/2026 00:00');
});
test('unzoned civil timestamps keep their date and time, independent of host zone', () => {
  assert.equal(api.datetime('2026-11-10T00:15'), '10/11/2026 00:15');
  assert.equal(api.datetime('2026-11-10 23:59:59'), '10/11/2026 23:59');
  assert.equal(api.date('2026-11-10T00:15'), '10/11/2026');
});
test('ambiguous and invalid values are preserved instead of normalized by Date', () => {
  for (const value of ['2026-02-30T12:00:00Z', '2026-11-10T24:00:00Z', '2026-11-10T12:60:00Z', '2026-11-10T12:00:60Z', '2026-11-10T12:00:00+14:01', '2026-11-10T12:00:00+09:99', '10/11/2026', 'noviembre', '']) assert.equal(api.datetime(value), value);
  assert.equal(api.date(null), '');
  assert.equal(api.date(undefined), '');
});
test('visible standalone dates and timestamps convert conservatively', () => {
  assert.equal(api.formatText('Desde 2026-11-10 hasta 2026-11-30.'), 'Desde 10/11/2026 hasta 30/11/2026.');
  assert.equal(api.formatText('(2026-11-10), [2026-11-11]'), '(10/11/2026), [11/11/2026]');
  assert.equal(api.formatText('Actualizado 2026-11-10T05:30:00Z · México'), 'Actualizado 09/11/2026 23:30 · México');
  assert.equal(api.formatText('Fecha 2026-11-10 13:25'), 'Fecha 10/11/2026 13:25');
  for (const invalid of ['2026-02-30', '2026-11-10T24:00:00Z', '2026-11-10 99:99']) assert.equal(api.formatText(invalid), invalid);
});
test('filepaths, fiscal names, filenames, ISO keys and embedded SKU identifiers stay exact', () => {
  const values = [
    '/tmp/2026-11-10/report.csv', 'C:\\facturas\\2026-11-10.xml', './2026-11-10', '../2026-11-10.pdf',
    '2026-11-10.csv', '2026-11-10.json', 'https://erp.test/2026-11-10',
    'SKU-2026-11-10', '2026-11-10-SKU', 'SKU_2026-11-10', '2026-11-10_01',
    'DING-DONG-2026-11-10-SA', 'RFC2026-11-10', 'ABC/2026-11-10/DEF',
    '{"2026-11-10":42}', '2026-11-10: total', '2026-11-10 : total',
    'Empresa fiscal 2026', 'RFC ABC123456XYZ'
  ];
  for (const value of values) assert.equal(api.formatText(value), value, value);
});
test('validation enforces min/max, required and native date-step constraints', () => {
  assert.equal(api.validate('', {}).iso, '');
  assert.ok(api.validate('', {required: true}).error);
  assert.ok(api.validate('29/02/2026').error);
  assert.ok(api.validate('09/11/2026', {min: '2026-11-10'}).error.includes('10/11/2026'));
  assert.ok(api.validate('11/11/2026', {max: '2026-11-10'}).error.includes('10/11/2026'));
  assert.equal(api.validate('10/11/2026', {min: '2026-11-10', max: '2026-11-10'}).iso, '2026-11-10');
  assert.ok(api.validate('11/11/2026', {min: '2026-11-10', step: '2'}).error);
  assert.equal(api.validate('12/11/2026', {min: '2026-11-10', step: '2'}).iso, '2026-11-12');
  assert.ok(api.validate('11/11/2026', {base: '2026-11-10', step: '2'}).error);
  assert.equal(api.validate('11/11/2026', {step: 'any'}).iso, '2026-11-11');
  assert.equal(api.validate('29/02/0004', {min: '0004-02-27', step: '2'}).iso, '0004-02-29');
});

// Detached DOM fixture: exercises observer scopes and user commits, without a
// browser, application state, server, or dependency on a rendering engine.
class Node {
  constructor(tag, text) {
    this.nodeType = tag === '#text' ? 3 : 1;
    this.tagName = tag.toUpperCase();
    this.nodeValue = text || '';
    this.childNodes = [];
    this.attributes = {};
    this.listeners = new Map();
    this.value = '';
    this.defaultValue = '';
    this.className = '';
    this.type = '';
    this.labels = [];
  }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(n => n.textContent).join(''); }
  set textContent(value) { this.childNodes = []; if (value) this.append(new Node('#text', value)); }
  get parentElement() { return this.parentNode; }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parentNode) node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1);
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }
  before(node) {
    const parent = this.parentNode;
    node.parentNode = parent;
    parent.childNodes.splice(parent.childNodes.indexOf(this), 0, node);
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  matches(selector) {
    return selector.split(',').some(s => {
      if (s[0] === '.') return this.className.split(/\s+/).includes(s.slice(1));
      if (s === 'input[type="date"]') return this.tagName === 'INPUT' && this.type === 'date';
      if (s[0] === '[') return Object.hasOwn(this.attributes, s.slice(1, -1));
      return this.tagName.toLowerCase() === s;
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
  querySelectorAll(selector) { return this.children.flatMap(n => [...(n.matches(selector) ? [n] : []), ...n.querySelectorAll(selector)]); }
  contains(node) { return node === this || this.childNodes.some(n => n.contains(node)); }
  addEventListener(name, handler) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(handler); }
  dispatchEvent(event) {
    event.target ||= this;
    for (const handler of this.listeners.get(event.type) || []) handler(event);
    if (event.bubbles && !event.stopped) this.parentNode?.dispatchEvent(event);
    return !event.defaultPrevented;
  }
  setCustomValidity(message) { this.validationMessage = message; }
  checkValidity() { return !this.validationMessage; }
  reportValidity() { this.reported = true; return this.checkValidity(); }
  focus() { this.focused = true; }
}
class Event {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.stopped = true; }
}
function setup({loading = false} = {}) {
  const body = new Node('body');
  const observers = [], timers = [], pending = [];
  const document = {
    body, readyState: loading ? 'loading' : 'complete',
    createElement: tag => new Node(tag),
    createTreeWalker(root) {
      const texts = [];
      function visit(n) { if (n.nodeType === 3) texts.push(n); else n.childNodes.forEach(visit); }
      visit(root);
      return {nextNode: () => texts.shift()};
    },
    addEventListener(name, handler) { if (name === 'DOMContentLoaded') pending.push(handler); }
  };
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(root, options) { this.root = root; this.options = options; }
  }
  const window = {document, MutationObserver: Observer, Event,
    setInterval: fn => timers.push(fn), setTimeout: fn => fn()};
  const context = createContext({window, Date, Intl});
  runInContext(source, context);
  return {body, window, api: window.ERPDate, observers, timers, pending, context};
}
function dateField(fixture, value = '2026-11-10') {
  const form = new Node('form'), native = new Node('input');
  native.type = 'date';
  native.value = value;
  native.defaultValue = value;
  native.id = 'existing-date-id';
  native.name = 'invoiceDate';
  native.form = form;
  native.setAttribute('data-filter', 'date');
  form.append(native);
  fixture.body.append(form);
  fixture.api.refresh(form);
  return {form, native, proxy: native.parentNode.children[0], wrapper: native.parentNode};
}
function type(proxy, value) { proxy.value = value; proxy.dispatchEvent(new Event('input', {bubbles: true})); }
function commit(proxy) { proxy.dispatchEvent(new Event('change', {bubbles: true})); }

test('DOM formatter skips editable/code/identifier scopes and leaves attributes untouched', () => {
  const f = setup();
  for (const tag of ['script', 'style', 'input', 'textarea', 'code', 'pre', 'option', 'select']) {
    const element = new Node(tag); element.textContent = '2026-11-10'; f.body.append(element);
  }
  for (const attribute of ['contenteditable', 'data-erp-date-skip', 'data-identifier', 'data-filepath']) {
    const element = new Node('div'); element.setAttribute(attribute, ''); element.textContent = '2026-11-10'; f.body.append(element);
  }
  for (const className of ['sku', 'code', 'identifier', 'identifiers', 'filepath', 'file-path']) {
    const element = new Node('span'); element.className = className; element.textContent = '2026-11-10'; f.body.append(element);
  }
  const safe = new Node('span'); safe.textContent = '2026-11-10';
  safe.id = '2026-11-10'; safe.setAttribute('data-date', '2026-11-10'); safe.setAttribute('title', '2026-11-10');
  f.body.append(safe);
  f.api.refresh();
  for (const element of f.body.children.filter(n => n !== safe)) assert.equal(element.textContent, '2026-11-10');
  assert.equal(safe.textContent, '10/11/2026');
  assert.equal(safe.id, '2026-11-10');
  assert.equal(safe.getAttribute('data-date'), '2026-11-10');
  assert.equal(safe.getAttribute('title'), '2026-11-10');
});
test('scoped observer handles additions and changed text; no repeat writes', () => {
  const f = setup(), section = new Node('section'), outside = new Node('span');
  outside.textContent = '2026-11-10'; f.body.append(section, outside);
  f.api.observe(section); f.api.observe(section);
  assert.equal(f.observers.length, 2); // body + one explicit scope
  const observer = f.observers[1];
  const text = new Node('#text', '2026-11-10'); section.append(text);
  observer.callback([{type: 'childList', addedNodes: [text, outside]}]);
  assert.equal(text.nodeValue, '10/11/2026');
  assert.equal(outside.textContent, '2026-11-10');
  text.nodeValue = '2026-11-11';
  observer.callback([{type: 'characterData', target: text}]);
  assert.equal(text.nodeValue, '11/11/2026');
  observer.callback([{type: 'characterData', target: text}]);
  assert.equal(text.nodeValue, '11/11/2026');
  assert.deepEqual(Array.from(observer.options.attributeFilter), ['value', 'min', 'max', 'step', 'required', 'disabled', 'readonly']);
});
test('proxy retains original identity, ISO data, constraints and event handlers', () => {
  const f = setup(), {native, proxy, wrapper, form} = dateField(f);
  const events = [];
  form.addEventListener('input', event => events.push(['input', event.target]));
  form.addEventListener('change', event => events.push(['change', event.target]));
  assert.equal(native.id, 'existing-date-id'); assert.equal(native.name, 'invoiceDate');
  assert.equal(native.getAttribute('data-filter'), 'date');
  assert.equal(native.value, '2026-11-10'); assert.equal(native.type, 'date');
  assert.equal(proxy.type, 'text'); assert.equal(proxy.name, undefined);
  assert.equal(proxy.value, '10/11/2026');
  assert.match(wrapper.children[1].innerHTML, /^<svg /);
  type(proxy, '12/11/2026');
  assert.equal(native.value, '2026-11-10'); assert.equal(events.length, 0);
  commit(proxy);
  assert.equal(native.value, '2026-11-12');
  assert.deepEqual(events, [['input', native], ['change', native]]);
  proxy.dispatchEvent(new Event('blur'));
  assert.equal(events.length, 2);
});
test('invalid and partial drafts survive refresh and background native events', () => {
  const f = setup(), {native, proxy} = dateField(f);
  for (const draft of ['2', '29/02/2026', '31/04/2026']) {
    type(proxy, draft); commit(proxy);
    native.dispatchEvent(new Event('change'));
    f.api.refresh();
    assert.equal(proxy.value, draft);
    assert.equal(native.value, '2026-11-10');
    assert.equal(proxy.checkValidity(), false);
  }
  type(proxy, '12/11/2026');
  native.value = '2026-12-01';
  f.api.refresh();
  assert.equal(proxy.value, '12/11/2026');
  commit(proxy);
  assert.equal(native.value, '2026-11-12');
});
test('Enter rejects invalid drafts and accepts valid complete dates', () => {
  const f = setup(), {native, proxy} = dateField(f);
  type(proxy, '31/02/2026');
  const bad = new Event('keydown', {key: 'Enter'}); proxy.dispatchEvent(bad);
  assert.equal(bad.defaultPrevented, true); assert.equal(proxy.reported, true);
  assert.equal(native.value, '2026-11-10');
  type(proxy, '29/02/2028'); proxy.dispatchEvent(new Event('keydown', {key: 'Enter'}));
  assert.equal(native.value, '2028-02-29');
});
test('required, min/max and step errors never commit the ISO original', () => {
  const f = setup(), {native, proxy} = dateField(f);
  native.required = true; native.min = '2026-11-10'; native.max = '2026-11-20'; native.step = '2';
  for (const value of ['', '09/11/2026', '21/11/2026', '11/11/2026']) {
    type(proxy, value); commit(proxy);
    assert.equal(native.value, '2026-11-10'); assert.equal(proxy.checkValidity(), false);
  }
  type(proxy, '12/11/2026'); commit(proxy); assert.equal(native.value, '2026-11-12');
  native.required = false; type(proxy, ''); commit(proxy); assert.equal(native.value, '');
});
test('native calendar is accessible and its explicit selection can replace a draft', () => {
  const f = setup(), {native, proxy} = dateField(f);
  type(proxy, 'draft');
  native.value = '2028-02-29';
  native.dispatchEvent(new Event('change', {isTrusted: true, bubbles: true}));
  assert.equal(proxy.value, '29/02/2028');
  assert.equal(native.type, 'date');
  assert.equal(native.getAttribute('hidden'), null);
  assert.equal(native.getAttribute('tabindex'), null);
});
test('clean proxies follow silent native updates via refresh and focused fields stay safe', () => {
  const f = setup(), {native, proxy, wrapper} = dateField(f);
  native.value = '2026-12-31'; f.api.refresh(); assert.equal(proxy.value, '31/12/2026');
  native.disabled = true; native.readOnly = true; f.api.refresh();
  assert.equal(proxy.disabled, true); assert.equal(proxy.readOnly, true);
  type(proxy, '01/01/2027'); commit(proxy); assert.equal(native.value, '2026-12-31');
  f.api.refresh(); assert.equal(native.parentNode, wrapper); assert.equal(wrapper.children.length, 3);
});
test('form reset explicitly clears the proxy draft after the native reset', () => {
  const f = setup(), {native, proxy, form} = dateField(f);
  type(proxy, 'partial'); native.value = '2026-11-10';
  form.dispatchEvent(new Event('reset'));
  assert.equal(proxy.value, '10/11/2026'); assert.equal(proxy.checkValidity(), true);
});
test('clock slots update immediately and each minute without replacing child markup', () => {
  const f = setup();
  const nodes = ['', 'date', 'time'].map(mode => { const n = new Node('time'); n.setAttribute('data-erp-clock', mode); f.body.append(n); return n; });
  const mixed = new Node('div'); mixed.setAttribute('data-erp-clock', ''); mixed.append(new Node('strong')); f.body.append(mixed);
  f.observers[0].callback([{type: 'childList', addedNodes: nodes}]);
  assert.match(nodes[0].textContent, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  assert.equal(nodes[1].textContent, nodes[0].textContent.slice(0, 10));
  assert.equal(nodes[2].textContent, nodes[0].textContent.slice(-5));
  nodes[0].textContent = 'stale'; f.timers[0](); assert.notEqual(nodes[0].textContent, 'stale');
  assert.equal(mixed.children[0].tagName, 'STRONG');
  assert.equal(f.timers.length, 1);
  runInContext(source, f.context); assert.equal(f.timers.length, 1);
});
test('initialization waits for DOM readiness and installs only once', () => {
  const f = setup({loading: true});
  assert.equal(f.observers.length, 0);
  assert.equal(f.pending.length, 1);
  f.pending[0](); assert.equal(f.observers.length, 1); assert.equal(f.timers.length, 1);
});
