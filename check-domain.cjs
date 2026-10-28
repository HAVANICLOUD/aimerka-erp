'use strict';
const assert = require('node:assert/strict');
const D = require('./lib/legacy-domain.cjs');
let tested = 0;
function test(name, run) { run(); tested++; console.log('OK ' + name); }
function product(state, order) { return state.products.find(p => p.sku === order.sku); }
function inventory(state) { return JSON.stringify(state.products); }
function event(state, id, type, order, extra = {}) {
  return D.applyEvent(state, { id, type, orderId: order && order.id, ...extra });
}
function assertInvariants(state) {
  for (const p of state.products) {
    for (const key of ['good', 'reserved', 'quarantine', 'damaged', 'safety']) {
      assert.ok(Number.isSafeInteger(p[key]) && p[key] >= 0, p.sku + ':' + key);
    }
    assert.ok(p.reserved <= p.good, 'Cannot reserve more physical stock than exists');
    assert.equal(p.reserved, state.orders.filter(o => o.sku === p.sku && o.status === 'reserved').reduce((sum, o) => sum + o.qty, 0));
    assert.equal(p.quarantine, state.orders.filter(o => o.sku === p.sku && o.returnStatus === 'inspection').reduce((sum, o) => sum + o.qty, 0));
    assert.equal(D.available(p), Math.max(0, p.good - p.reserved - p.safety));
  }
}

test('Seed has twelve coherent orders, seven channels and isolated mutable state', () => {
  const a = D.createState(), b = D.createState();
  assert.equal(a.orders.length, 12);
  assert.equal(new Set(a.orders.map(o => o.market)).size, 7);
  assertInvariants(a);
  a.products[0].good = 0;
  assert.notEqual(a.products[0].good, b.products[0].good);
});

test('Cancel before shipping releases only the reservation; repeat and late ship are harmless', () => {
  const s = D.createState(), o = s.orders.find(o => o.status === 'reserved'), p = product(s, o);
  const before = { good: p.good, available: D.available(p), reserved: p.reserved };
  assert.equal(event(s, 'cancel-1', 'cancel', o).ok, true);
  assert.equal(p.good, before.good);
  assert.equal(p.reserved, before.reserved - o.qty);
  assert.equal(D.available(p), before.available + o.qty);
  const frozen = inventory(s);
  assert.equal(event(s, 'cancel-1', 'cancel', o).duplicate, true);
  assert.equal(event(s, 'cancel-2', 'cancel', o).ok, false);
  assert.equal(event(s, 'ship-late', 'ship', o).ok, false);
  assert.equal(inventory(s), frozen);
  assertInvariants(s);
});

test('Shipping closes reservation without a second reduction of available stock', () => {
  const s = D.createState(), o = s.orders.find(o => o.status === 'reserved'), p = product(s, o);
  const before = { good: p.good, available: D.available(p), reserved: p.reserved };
  assert.equal(event(s, 'ship-1', 'ship', o).ok, true);
  assert.equal(p.good, before.good - o.qty);
  assert.equal(p.reserved, before.reserved - o.qty);
  assert.equal(D.available(p), before.available);
  const frozen = inventory(s);
  assert.equal(event(s, 'ship-1', 'ship', o).duplicate, true);
  assert.equal(event(s, 'ship-2', 'ship', o).ok, false);
  assert.equal(inventory(s), frozen);
  assertInvariants(s);
});

test('Refund does not change inventory or recorded settlement; inspected return restores stock once', () => {
  const s = D.createState(), o = s.orders.find(o => o.status === 'delivered' && o.returnStatus === 'none'), p = product(s, o);
  const before = { inventory: inventory(s), good: p.good, paid: o.paidCents, available: D.available(p) };
  assert.equal(event(s, 'refund-1', 'refund', o).ok, true);
  assert.equal(inventory(s), before.inventory);
  assert.equal(o.paidCents, before.paid);
  assert.equal(event(s, 'restock-early', 'restock_return', o).ok, false);
  assert.equal(event(s, 'return-1', 'receive_return', o).ok, true);
  assert.equal(p.quarantine, o.qty);
  assert.equal(p.good, before.good);
  assert.equal(D.available(p), before.available);
  assert.equal(event(s, 'return-2', 'receive_return', o).ok, false);
  assert.equal(event(s, 'restock-1', 'restock_return', o).ok, true);
  assert.equal(p.good, before.good + o.qty);
  assert.equal(p.quarantine, 0);
  const frozen = inventory(s);
  assert.equal(event(s, 'restock-1', 'restock_return', o).duplicate, true);
  assert.equal(event(s, 'restock-2', 'restock_return', o).ok, false);
  assert.equal(event(s, 'late-return', 'receive_return', o).ok, false);
  assert.equal(inventory(s), frozen);
  assertInvariants(s);
});

test('Cancel after shipment opens an incident without inventing inventory; rejected return stays unsellable', () => {
  const s = D.createState(), o = s.orders.find(o => o.status === 'shipped'), p = product(s, o);
  const before = { inventory: inventory(s), available: D.available(p), good: p.good, damaged: p.damaged };
  assert.equal(event(s, 'late-cancel', 'cancel', o).ok, true);
  assert.equal(inventory(s), before.inventory);
  assert.equal(o.status, 'shipped');
  assert.equal(o.returnStatus, 'requested');
  assert.ok(o.incident);
  assert.equal(event(s, 'receive-bad', 'receive_return', o).ok, true);
  assert.equal(event(s, 'reject-1', 'reject_return', o).ok, true);
  assert.equal(p.good, before.good);
  assert.equal(p.quarantine, 0);
  assert.equal(p.damaged, before.damaged + o.qty);
  assert.equal(D.available(p), before.available);
  const frozen = inventory(s);
  assert.equal(event(s, 'reject-2', 'reject_return', o).ok, false);
  assert.equal(event(s, 'restock-rejected', 'restock_return', o).ok, false);
  assert.equal(inventory(s), frozen);
  assertInvariants(s);
});

test('Consecutive reservations cannot consume the safety stock; duplicate create creates no second order', () => {
  const s = D.createState(), p = s.products[0], qty = D.available(p), beforeCount = s.orders.length;
  const a = event(s, 'create-1', 'create', null, { sku: p.sku, qty, market: 'Coppel' });
  assert.equal(a.ok, true);
  assert.equal(D.available(p), 0);
  assert.equal(s.orders.length, beforeCount + 1);
  const frozen = inventory(s);
  assert.equal(event(s, 'create-1', 'create', null, { sku: p.sku, qty, market: 'Coppel' }).duplicate, true);
  assert.equal(event(s, 'create-2', 'create', null, { sku: p.sku, qty: 1, market: 'Liverpool' }).ok, false);
  assert.equal(event(s, 'bad-qty', 'create', null, { sku: p.sku, qty: -1, market: 'Coppel' }).ok, false);
  assert.equal(event(s, 'fraction-qty', 'create', null, { sku: p.sku, qty: 0.5, market: 'Coppel' }).ok, false);
  assert.equal(inventory(s), frozen);
  assert.equal(s.orders.length, beforeCount + 1);
  assertInvariants(s);
});

test('Refunded reservation remains reserved until cancelled and cannot be shipped', () => {
  const s = D.createState(), o = s.orders.find(o => o.status === 'reserved');
  const before = inventory(s);
  assert.equal(event(s, 'paid-back', 'refund', o).ok, true);
  assert.equal(inventory(s), before);
  assert.equal(event(s, 'ship-refunded', 'ship', o).ok, false);
  assert.equal(event(s, 'receive-unsent', 'receive_return', o).ok, false);
  assert.equal(event(s, 'cancel-refunded', 'cancel', o).ok, true);
  assertInvariants(s);
});

test('Money arithmetic rounds each commission to cents and preserves explicit deductions', () => {
  const o = { qty: 3, unitPriceCents: 9999, commissionBps: 1250, msiBps: 225, shippingCents: 1234, withholdingCents: 567 };
  assert.equal(D.orderTotal(o), 29997);
  assert.equal(D.expectedNet(o), 23771);
});

test('Mixed valid and stale events preserve stock invariants and audit rejected events', () => {
  const s = D.createState();
  let id = 1;
  for (const o of [...s.orders]) {
    for (const type of ['receive_return', 'ship', 'cancel', 'refund', 'receive_return', 'restock_return', 'reject_return', 'ship', 'cancel']) {
      event(s, 'mixed-' + id++, type, o);
      assertInvariants(s);
    }
  }
  assert.ok(s.events.some(e => e.result === 'error'));
  assert.ok(s.events.some(e => e.result === 'ok'));
  assert.equal(s.events.length, s.processedEventIds.length);
});

console.log('\n' + tested + ' domain scenarios passed.');
