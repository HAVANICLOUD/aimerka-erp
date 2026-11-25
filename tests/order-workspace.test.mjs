import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {classifyOrder,matchesOrderCategory,ORDER_TABS,orderReference,expenseIssues} from '../lib/order-workspace.mjs';
const order=extra=>({id:'U-internal',number:'123',status:'reserved',stockMode:'operational',commercialStatus:'Activa',paymentStatus:'unknown',returnStatus:'none',...extra});

test('six requested categories and recorded operational states; local acceptance remains unknown',()=>{
 assert.deepEqual(ORDER_TABS.map(t=>t.label),['Todos','Por preparar','Enviados','Entregados','Devoluciones y reembolsos','Canceladas']);
 for(const status of ['reserved','pending_acceptance','preparing']) {
  const c=classifyOrder(order({status}));assert.equal(c.preparing,true);assert.equal(c.stateLabel,'Pendiente de aceptación / preparación local');
 }
 assert.equal(matchesOrderCategory(order({status:'shipped'}),'shipped'),true);
 assert.equal(matchesOrderCategory(order({status:'delivered'}),'delivered'),true);
 for(const status of [undefined,'unknown','confirmed','accepted','new','processing','historical']) {
  const c=classifyOrder(order({status}));assert.equal(c.preparing,false);assert.equal(c.shipped,false);assert.equal(c.delivered,false);
 }
});

test('historical unknowns stay in Todos with historical provenance and never become preparation or delivery',()=>{
 for(const status of ['historical','unknown','reserved']) {
  const o=order({stockMode:'historical',status});const c=classifyOrder(o);
  assert.equal(c.historical,true);assert.equal(c.preparing,false);assert.equal(c.delivered,false);assert.equal(c.shipped,false);
  assert.equal(matchesOrderCategory(o,''),true);
 }
 const seed=JSON.parse(fs.readFileSync(new URL('../data/seed-v43.json',import.meta.url)));
 assert.equal(seed.orders.filter(o=>matchesOrderCategory(o,'')).length,seed.orders.length);
 assert.ok(seed.orders.filter(o=>o.status==='historical').every(o=>!classifyOrder(o).preparing&&!classifyOrder(o).delivered));
});

test('commercial cancellation overrides a reservation; refund and receiving are independent dimensions',()=>{
 const cancelled=order({commercialStatus:'Cancelada'});
 assert.equal(classifyOrder(cancelled).preparing,false);assert.equal(matchesOrderCategory(cancelled,'cancelled'),true);
 const refunded=order({status:'cancelled',paymentStatus:'refunded',returnStatus:'requested',followupStatus:'Pendiente'});
 const c=classifyOrder(refunded);assert.equal(c.cancelled,true);assert.equal(c.refunded,true);assert.equal(c.receivingPending,true);
 assert.ok(c.subtypes.includes('refunded'));assert.ok(c.subtypes.includes('receivingPending'));assert.ok(c.subtypes.includes('incidence'));
 assert.equal(matchesOrderCategory(refunded,'returns'),true);assert.equal(matchesOrderCategory(refunded,'cancelled'),true);
});

test('returns group includes partial refunds, documentary evidence, physical receipt and independent followup',()=>{
 for(const extra of [{paymentStatus:'partially_refunded'},{refundCents:1},{returnStatus:'inspection'},{returnStatus:'restocked'},{returnStatus:'rejected'}]) assert.equal(matchesOrderCategory(order(extra),'returns'),true,JSON.stringify(extra));
 assert.equal(classifyOrder(order({}),{financialState:'refunded'}).refunded,true);
 assert.equal(classifyOrder(order({}),{documentaryRefund:true}).refunded,true);
 assert.equal(classifyOrder(order({refundCents:null})).refunded,false);
 assert.equal(classifyOrder(order({followupStatus:'Pendiente'})).preparing,true);
 assert.equal(classifyOrder(order({followupStatus:'Resuelto',incident:''})).incidence,false);
});

test('references use original numbers with honest missing number and never internal IDs',()=>{
 assert.equal(orderReference(order({})),'Pedido 123');assert.equal(orderReference(order({number:'',literalNumber:'0009'})),'Pedido 0009');
 assert.equal(orderReference(order({number:'Pedido 91'})),'Pedido 91');assert.equal(orderReference({id:'U00001'}),'Pedido sin número registrado');
});

test('expense alerts require real kind, known cents, valid due date and are limited to overdue through day seven',()=>{
 const today='2026-12-29';const row=(id,dueDate,extra={})=>({kind:'expense',entityId:id,number:1,term:1,balanceCents:100,dueDate,...extra});
 const rows=[row('eight','2027-01-06'),row('seven','2027-01-05'),row('today',today),row('old','2026-12-28'),row('purchase',today,{kind:'purchase'}),row('paid',today,{balanceCents:0}),row('unknown',today,{balanceCents:null}),row('no-date',null),row('bad','2026-12-32')];
 const before=JSON.stringify(rows);const issues=expenseIssues(rows,today);
 assert.deepEqual(issues.map(i=>i.payment.entityId),['old','today','seven']);assert.equal(JSON.stringify(rows),before);
 assert.deepEqual(issues.map(i=>i.title),['Gasto vencido','Gasto vence hoy','Gasto por vencer']);
 assert.deepEqual(expenseIssues(rows,'2026-02-31'),[]);
});

test('classifiers never mutate order data and browser classifier exactly matches pure source',()=>{
 const o=Object.freeze(order({returnStatus:'requested',paymentStatus:'refunded'}));const before=JSON.stringify(o);
 classifyOrder(o);matchesOrderCategory(o,'returns');assert.equal(JSON.stringify(o),before);
 assert.equal(fs.readFileSync(new URL('../lib/order-workspace.mjs',import.meta.url),'utf8'),fs.readFileSync(new URL('../public/erp/modules/order-workspace.mjs',import.meta.url),'utf8'));
});

 test('generic delivered followup or incident is not a return and retains recorded physical status',()=>{
 for(const extra of [{followupStatus:'Pendiente'},{followupStatus:'En seguimiento'},{incident:'Llamar al comprador'},{review:'Verificar datos'}]) {
  const o=order({status:'delivered',...extra}),c=classifyOrder(o);
  assert.equal(c.returns,false);assert.equal(c.delivered,true);assert.equal(matchesOrderCategory(o,'delivered'),true);assert.equal(matchesOrderCategory(o,'returns'),false);assert.equal(c.incidence,!extra.review);
 }
 const returned=classifyOrder(order({status:'delivered',returnStatus:'requested',incident:'Daño'}));assert.equal(returned.returns,true);assert.equal(returned.incidence,true);assert.equal(returned.receivingPending,true);
 for(const status of ['shipped','delivered']) {const c=classifyOrder(order({stockMode:'historical',status}));assert.equal(c.historical,true);assert.ok(c.categories.includes(status));assert.match(c.stateLabel,/registrado en ERP/);}
 });
