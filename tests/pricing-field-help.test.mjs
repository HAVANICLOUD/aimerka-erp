import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext, runInContext, Script} from 'node:vm';

const source = readFileSync(new URL('../public/erp/pricing-field-help-ui.js', import.meta.url), 'utf8');

// Small detached DOM fixture. The browser owns HTML parsing; these tests exercise
// decoration and delegated events without starting the ERP or touching its data.
class Element {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.classes = new Set();
    this.classList = {add: (...items) => items.forEach(item => this.classes.add(item))};
    this.textContent = '';
  }
  append(...items) {
    for (const item of items) {
      if (item.parent) item.parent.children.splice(item.parent.children.indexOf(item), 1);
      item.parent = this;
      this.children.push(item);
    }
  }
  prepend(item) { this.append(item); this.children.unshift(this.children.pop()); }
  before(item) {
    item.parent = this.parent;
    this.parent.children.splice(this.parent.children.indexOf(this), 0, item);
  }
  after(item) {
    item.parent = this.parent;
    this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, item);
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  contains(item) { return item === this || this.children.some(child => child.contains(item)); }
  matches(selector) {
    if (selector === '.field') return this.classes.has('field');
    if (selector.includes('.price28-help-trigger')) return this.className === 'price28-help-trigger';
    if (selector === '.price28-help-heading') return this.className === 'price28-help-heading';
    if (selector === 'label' || selector === 'svg') return this.tag === selector;
    return selector.includes('[data-price28-field]') && !!this.dataset.price28Field;
  }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector); }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function setup({readonly = false, labelIcon = false} = {}) {
  const form = new Element('form'), field = new Element(), label = new Element('label'), input = new Element('input');
  field.classList.add('field');
  input.id = 'price28-margin';
  input.dataset.price28Field = 'margin';
  input.value = '17.25';
  input.readOnly = readonly;
  input.setAttribute('aria-describedby', 'existing-note');
  label.htmlFor = input.id;
  label.textContent = '<img src=x onerror=alert(1)> Utilidad';
  if (labelIcon) label.append(new Element('svg'));
  form.append(field); field.append(label, input);
  const listeners = new Map();
  let calls = 0;
  const original = function(...args) { calls++; assert.equal(this.marker, 42); assert.deepEqual(args, ['scenario']); return '<form>original</form>'; };
  const document = {
    activeElement: null,
    addEventListener: (name, handler) => listeners.set(name, handler),
    createElement: tag => tag === 'template' ? {content: {querySelector: () => form}, innerHTML: ''} : new Element(tag),
    getElementById: id => {
      const visit = node => node.id === id ? node : node.children.map(visit).find(Boolean);
      return visit(form);
    }
  };
  const window = {price28Form: original};
  const context = createContext({window, document});
  runInContext(source, context);
  const render = () => window.price28Form.call({marker: 42}, 'scenario');
  const fire = (name, target, extra = {}) => listeners.get(name)({target, ...extra});
  render();
  return {form, field, label, input, window, document, context, listeners, render, fire, calls: () => calls,
    button: form.querySelector('.price28-help-trigger'), tip: field.children.find(node => node.className === 'price28-field-tooltip')};
}

test('helper parses and preserves native field identity, value, label and description', () => {
  new Script(source);
  const fixture = setup();
  assert.equal(fixture.input.value, '17.25');
  assert.equal(fixture.input.id, fixture.label.htmlFor);
  assert.equal(fixture.button.type, 'button');
  assert.ok(fixture.input.classes.has('price28-fill-control'));
  assert.equal(fixture.tip.attributes.role, 'tooltip');
  assert.equal(fixture.tip.hidden, true);
  assert.match(fixture.input.getAttribute('aria-describedby'), /^existing-note price28-field-help-/);
  assert.equal(fixture.button.getAttribute('aria-controls'), fixture.tip.id);
  assert.equal(fixture.button.getAttribute('aria-describedby'), fixture.tip.id);
  assert.equal(fixture.label.textContent, '<img src=x onerror=alert(1)> Utilidad');
  assert.equal(fixture.label.innerHTML, undefined);
});

test('decoration and wrapper installation are idempotent and retain existing vectors', () => {
  const fixture = setup({labelIcon: true});
  const wrapped = fixture.window.price28Form;
  fixture.render();
  runInContext(source, fixture.context);
  assert.equal(fixture.window.price28Form, wrapped);
  assert.equal(fixture.form.querySelectorAll('.price28-help-trigger').length, 1);
  assert.equal(fixture.label.children.length, 1);
  assert.equal(fixture.calls(), 2);
  assert.equal(fixture.listeners.size, 6);
});

test('read-only information never gets editable styling', () => {
  const fixture = setup({readonly: true});
  assert.equal(fixture.input.classes.has('price28-fill-control'), false);
  assert.ok(fixture.input.classes.has('price28-read-control'));
  assert.match(fixture.tip.textContent, /Dato de consulta/);
});

test('hover and focus expose help; Escape dismisses without moving focus', () => {
  const {fire, button, tip, document, input} = setup();
  fire('mouseover', button);
  assert.equal(tip.hidden, false);
  fire('mouseout', button, {relatedTarget: tip});
  assert.equal(tip.hidden, false);
  fire('mouseout', tip, {relatedTarget: input});
  assert.equal(tip.hidden, true);
  document.activeElement = button;
  fire('focusin', button);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  fire('keydown', button, {key: 'Escape'});
  assert.equal(tip.hidden, true);
  assert.equal(document.activeElement, button);
  assert.equal(input.value, '17.25');
});

test('touch clicks pin and toggle help, and outside click closes it', () => {
  const {fire, button, tip, input} = setup();
  fire('click', button);
  fire('mouseout', button, {relatedTarget: input});
  assert.equal(tip.hidden, false);
  fire('click', button);
  assert.equal(tip.hidden, true);
  fire('click', button);
  fire('click', input);
  assert.equal(tip.hidden, true);
  assert.equal(input.value, '17.25');
});
