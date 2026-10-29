import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperation, supplierPaymentAlerts } from '../lib/operations-v28.mjs';

const today='2026-10-29';
const context={today,now:'2026-10-29T18:00:00Z',user:'Prueba'};
const purchase=(id,firstPaymentDate,extra={})=>({id,sicar:`SICAR-${id}`,date:'2026-09-01',firstPaymentDate,
  lender:'Empresa',instrument:'Amex',supplier:'Proveedor',term:1,amountCents:10000,status:'Activa',...extra});
const workspace=(purchases=[])=>({purchases,expenses:[],purchasePayments:[],expensePayments:[],creditRules:[],events:[],
  catalogs:{lenders:['Empresa'],instruments:['Amex'],suppliers:['Proveedor']}});

test('supplier alerts separate overdue and today, include day 7, exclude day 8, and order chronologically',()=>{
  const state=workspace([
    purchase('eight','2026-11-06'),purchase('seven','2026-11-05'),purchase('today',today),
    purchase('yesterday','2026-10-28'),purchase('tomorrow','2026-10-30'),purchase('oldest','2026-10-01'),
  ]);
  const alerts=supplierPaymentAlerts(state,today);
  assert.equal(alerts.today,today);
  assert.equal(alerts.throughDate,'2026-11-05');
  assert.equal(alerts.windowDays,7);
  assert.deepEqual(alerts.overdue.rows.map(r=>[r.entityId,r.alertKind,r.daysUntil]),[['oldest','overdue',-28],['yesterday','overdue',-1]]);
  assert.deepEqual(alerts.dueToday.rows.map(r=>[r.entityId,r.alertKind,r.daysUntil]),[['today','today',0]]);
  assert.deepEqual(alerts.upcoming.rows.map(r=>[r.entityId,r.alertKind,r.daysUntil]),[['tomorrow','upcoming',1],['seven','upcoming',7]]);
  assert.deepEqual(alerts.actionableRows.map(r=>r.entityId),['oldest','yesterday','today','tomorrow','seven']);
  assert.equal(alerts.actionableCount,5);
  assert.equal(alerts.actionableCents,50000);
  assert.equal(alerts.missing.count,0);
});

test('seven-day window crosses year boundaries and February without treating months as 30 days',()=>{
  for (const [reference,seven,eight] of [
    ['2026-12-29','2027-01-05','2027-01-06'],
    ['2028-02-23','2028-03-01','2028-03-02'],
    ['2026-02-23','2026-03-02','2026-03-03'],
  ]) {
    const alerts=supplierPaymentAlerts(workspace([purchase('included',seven),purchase('later',eight)]),reference);
    assert.equal(alerts.throughDate,seven);
    assert.deepEqual(alerts.upcoming.rows.map(r=>[r.entityId,r.daysUntil]),[['included',7]]);
  }
});

test('multiple installments count separately while purchase counts and pending money stay exact after payments',()=>{
  const state=workspace([purchase('C1','2026-09-05',{term:3,amountCents:100000})]);
  state.creditRules=[{lender:'Empresa',instrument:'Amex',active:true,cutoffDay:15,paymentDay:5}];
  let alerts=supplierPaymentAlerts(state,today);
  assert.equal(alerts.overdue.count,2);
  assert.equal(alerts.overdue.purchaseCount,1);
  assert.equal(alerts.overdue.amountCents,66666);
  assert.equal(alerts.upcoming.amountCents,33334);
  assert.equal(alerts.actionableCents,100000);

  applyOperation(state,{type:'purchase.payment',payload:{entityId:'C1',mode:'Otro monto',amountCents:20000,
    installmentsCovered:1,date:'2026-10-20'}},context);
  alerts=supplierPaymentAlerts(state,today);
  assert.deepEqual(alerts.overdue.rows.map(r=>[r.number,r.balanceCents]),[[2,40000]]);
  assert.deepEqual(alerts.upcoming.rows.map(r=>[r.number,r.balanceCents]),[[3,40000]]);
  assert.equal(alerts.actionableCents,80000);

  applyOperation(state,{type:'purchase.payment',payload:{entityId:'C1',mode:'Liquidar saldo',date:today}},context);
  alerts=supplierPaymentAlerts(state,today);
  assert.equal(alerts.actionableCount,0);
  assert.equal(alerts.actionableCents,0);
  assert.equal(alerts.missing.count,0);
});

test('cancelled, fully paid, unknown-amount and zero-amount documents cannot create supplier debt alerts',()=>{
  const state=workspace([
    purchase('active','2026-10-28'),purchase('cancelled','2026-10-28',{status:'Cancelada'}),
    purchase('paid','2026-10-28'),purchase('unknown','2026-10-28',{amountCents:null}),
    purchase('zero','2026-10-28',{amountCents:0}),
  ]);
  state.purchasePayments=[{entityId:'paid',number:1,installmentsCovered:1,amountCents:10000}];
  state.expenses=[purchase('expense','2026-10-01',{amountCents:999999})];
  const alerts=supplierPaymentAlerts(state,today);
  assert.deepEqual(alerts.actionableRows.map(r=>r.entityId),['active']);
  assert.equal(alerts.overdue.amountCents,10000);
  assert.equal(alerts.missing.count,0);
});

test('unknown dates remain configuration work and do not invent installments from the payment day alone',()=>{
  const state=workspace([purchase('no-date',null)]);
  state.creditRules=[{lender:'Empresa',instrument:'Amex',active:true,paymentDay:28,cutoffDay:null}];
  let alerts=supplierPaymentAlerts(state,today);
  assert.deepEqual(alerts.missing.rows.map(r=>[r.entityId,r.alertKind,r.daysUntil,r.dueDate]),[['no-date','missing',null,null]]);
  assert.equal(alerts.missing.amountCents,10000);
  assert.equal(alerts.missing.purchaseCount,1);
  assert.equal(alerts.actionableCount,0);

  const manual=workspace([purchase('manual','2026-10-28',{term:3,amountCents:30000})]);
  alerts=supplierPaymentAlerts(manual,today);
  assert.equal(alerts.overdue.count,1);
  assert.equal(alerts.overdue.amountCents,10000);
  assert.equal(alerts.missing.count,2);
  assert.equal(alerts.missing.purchaseCount,1);
  assert.equal(alerts.missing.amountCents,20000);
});

test('saving an instrument after a purchase immediately computes alerts while preserving explicit first dates',()=>{
  const state=workspace();
  applyOperation(state,{type:'purchase.create',payload:{sicar:'COMPRA-PRUEBA',date:'2026-10-01',
    lender:'Empresa',instrument:'Amex',supplier:'Proveedor',term:1,amountCents:10000,items:[]}},context);
  assert.equal(supplierPaymentAlerts(state,today).missing.count,1);
  applyOperation(state,{type:'credit.save',payload:{lender:'Empresa',instrument:'Amex',cutoffDay:15,paymentDay:28}},context);
  let alerts=supplierPaymentAlerts(state,today);
  assert.equal(alerts.missing.count,0);
  assert.equal(alerts.overdue.count,1);
  assert.equal(alerts.overdue.rows[0].dueDate,'2026-10-28');
  assert.equal(alerts.overdue.rows[0].origin,'Estimado por corte');

  applyOperation(state,{type:'purchase.update',payload:{id:state.purchases[0].id,firstPaymentDate:'2026-11-05'}},context);
  alerts=supplierPaymentAlerts(state,today);
  assert.equal(alerts.overdue.count,0);
  assert.equal(alerts.upcoming.count,1);
  assert.equal(alerts.upcoming.rows[0].dueDate,'2026-11-05');
  assert.equal(alerts.upcoming.rows[0].origin,'Fecha registrada');
});

test('workspace summaries stay isolated, independent of report filters and without mutations',()=>{
  const practice=workspace([purchase('same-id','2026-10-28',{amountCents:12345})]);
  const operational=workspace([purchase('same-id','2027-02-01',{amountCents:90000})]);
  practice.filters={year:2025,from:'2026-11-01',instrument:'Otra tarjeta'};
  const beforePractice=structuredClone(practice),beforeOperational=structuredClone(operational);
  assert.equal(supplierPaymentAlerts(practice,today).actionableCents,12345);
  assert.equal(supplierPaymentAlerts(operational,today).actionableCount,0);
  assert.equal(supplierPaymentAlerts(practice,today).actionableCents,12345);
  assert.deepEqual(practice,beforePractice);
  assert.deepEqual(operational,beforeOperational);
});

test('reference timestamps use the Mexican calendar day and invalid dates are rejected',()=>{
  const alerts=supplierPaymentAlerts(workspace([purchase('end-year','2026-12-31')]),'2027-01-01T05:30:00Z');
  assert.equal(alerts.today,'2026-12-31');
  assert.equal(alerts.throughDate,'2027-01-07');
  assert.equal(alerts.dueToday.count,1);
  assert.throws(()=>supplierPaymentAlerts(workspace(),'2026-02-30'),/fecha de referencia/);
});
