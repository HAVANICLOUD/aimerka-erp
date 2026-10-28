import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {applyCommand} from '../lib/commands.mjs';
import {available,orderTotal} from '../lib/inventory-v28.mjs';
import {estimateOrder,reconciliationOf} from '../lib/reconciliation-v28.mjs';
import {installmentState,installmentSchedule} from '../lib/operations-v28.mjs';
import {splitState,joinState,diffFragments} from '../lib/state-codec.mjs';

const seed=JSON.parse(fs.readFileSync(new URL('../data/seed-v28.json',import.meta.url)));
const config=JSON.parse(fs.readFileSync(new URL('../data/pricing-config.json',import.meta.url)));
const context={now:'2026-10-28T04:00:00.000Z',actor:'Prueba integración',workspace:'v28'};
let sequence=0;
function state(){const s=structuredClone(seed);s.config=structuredClone(config);return s;}
function command(s,type,payload={},id){return applyCommand(s,{id:id||'test-integration-'+(++sequence),type,payload},context);}
function twoProducts(s){const selected=s.products.filter(p=>p.sku&&p.upc).slice(0,2);for(const p of selected)Object.assign(p,{good:10,reserved:0,safety:0,quarantine:0,damaged:0});return selected;}
function createSale(s,ps,patch={}){return command(s,'sale.create',{market:'Sears',number:'TEST-ORDER-'+(++sequence),account:'Cuenta de prueba',sicar:'TEST-FOLIO-'+sequence,documentDate:'2026-10-27',shippingChargedCents:3000,items:[{sku:ps[0].sku,qty:2,unitPriceCents:10000},{sku:ps[1].sku,qty:1,unitPriceCents:50000}],...patch});}
const stock=s=>s.products.map(({sku,good,reserved,quarantine,damaged,safety})=>({sku,good,reserved,quarantine,damaged,safety}));

test('actual V28 estimates all complete active sales, blocks cancellations and incomplete historical headers',()=>{
  const s=state(),before=JSON.stringify(s);let ok=0,cancelled=0,missing=0;
  for(const o of s.orders){try{const e=estimateOrder(o,s.products,s.config,context);ok++;assert.equal(e.grossCents,o.totalCents);assert.equal(e.netCents,e.grossCents-e.commissionCents-e.vatCents-e.incomeCents-e.shippingCents);assert.ok(e.lines.length>0);}catch(e){if(/cancelada/.test(e.message))cancelled++;else if(/partidas verificadas/.test(e.message))missing++;else throw e;}}
  assert.deepEqual({ok,cancelled,missing},{ok:407,cancelled:32,missing:53});assert.equal(JSON.stringify(s),before);
});

test('multi-line create, shipment, refund, physical receipt and reintegration preserve original stock',()=>{
  const s=state(),ps=twoProducts(s),created=createSale(s,ps),o=s.orders.find(x=>x.id===created.orderId);
  assert.equal(o.number.startsWith('TEST-ORDER-'),true);assert.equal(o.items.length,2);assert.equal(orderTotal(o),73000);
  assert.deepEqual(ps.map(p=>[p.good,p.reserved,available(p)]),[[10,2,8],[10,1,9]]);
  command(s,'sale.ship',{orderId:o.id});assert.deepEqual(ps.map(p=>[p.good,p.reserved]),[[8,0],[9,0]]);
  command(s,'sale.refund',{orderId:o.id,amountCents:73000,reason:'Devolución de prueba'});assert.equal(o.paymentStatus,'refunded');assert.deepEqual(ps.map(p=>p.good),[8,9]);
  command(s,'sale.return_request',{orderId:o.id,reason:'Regresa mercancía'});command(s,'sale.return_receive',{orderId:o.id});
  assert.deepEqual(ps.map(p=>[p.good,p.quarantine]),[[8,2],[9,1]]);
  command(s,'sale.return_restock',{orderId:o.id,reason:'Inspección aprobada'});assert.deepEqual(ps.map(p=>[p.good,p.reserved,p.quarantine]),[[10,0,0],[10,0,0]]);assert.equal(o.paymentStatus,'refunded');
  const done=JSON.stringify(s);assert.throws(()=>command(s,'sale.return_restock',{orderId:o.id}));assert.equal(JSON.stringify(s),done);
});

test('partial receipts never receive unselected lines; unresolved units can arrive in a later package',()=>{
  const s=state(),ps=twoProducts(s),created=createSale(s,ps),o=s.orders.find(x=>x.id===created.orderId);command(s,'sale.ship',{orderId:o.id});command(s,'sale.return_request',{orderId:o.id});
  command(s,'sale.return_receive',{orderId:o.id,items:[{id:o.items[0].id,qty:1}]});
  assert.deepEqual(ps.map(p=>p.quarantine),[1,0]);assert.equal(o.items[0].returnedQty,1);assert.equal(o.items[1].returnedQty||0,0);
  command(s,'sale.return_restock',{orderId:o.id});assert.deepEqual(ps.map(p=>p.good),[9,9]);
  if(o.returnStatus!=='requested')command(s,'sale.return_request',{orderId:o.id,reason:'Segundo paquete pendiente'});
  command(s,'sale.return_receive',{orderId:o.id,items:[{id:o.items[0].id,qty:1},{id:o.items[1].id,qty:1}]});
  command(s,'sale.return_reject',{orderId:o.id,reason:'Daño confirmado'});assert.deepEqual(ps.map(p=>[p.good,p.damaged,p.quarantine]),[[9,1,0],[9,1,0]]);
});

test('invalid dates, insufficient stock, duplicate references and invalid receipt IDs have no effects',()=>{
  const s=state(),ps=twoProducts(s);for(const patch of [{documentDate:'2026-02-30'},{documentDate:'2026-10-28'},{items:[{sku:ps[0].sku,qty:11,unitPriceCents:10000}]},{items:[{sku:ps[0].sku,qty:1,unitPriceCents:-1}]}]){
    const before=JSON.stringify(s);assert.throws(()=>createSale(s,ps,patch));assert.equal(JSON.stringify(s),before);
  }
  const r=createSale(s,ps,{number:'DUPLICATE-TEST'}),o=s.orders.find(x=>x.id===r.orderId);const before=JSON.stringify(s);
  assert.throws(()=>createSale(s,ps,{number:'DUPLICATE-TEST'}),/Ya existe/);assert.equal(JSON.stringify(s),before);
  command(s,'sale.ship',{orderId:o.id});command(s,'sale.return_request',{orderId:o.id});const after=JSON.stringify(s);
  assert.throws(()=>command(s,'sale.return_receive',{orderId:o.id,items:[{id:'NO-SUCH-LINE',qty:1}]}));assert.equal(JSON.stringify(s),after);
});

test('historical sales never replay a stock deduction; current physical returns require explicit confirmation',()=>{
  const s=state(),o=s.orders.find(x=>x.stockMode==='historical'&&x.commercialStatus==='Activa'&&x.items.length),before=stock(s);
  assert.throws(()=>command(s,'sale.ship',{orderId:o.id}),/reserva activa/);assert.deepEqual(stock(s),before);
  command(s,'sale.cancel',{orderId:o.id,reason:'Revisión de histórico'});assert.deepEqual(stock(s),before);
  command(s,'sale.return_request',{orderId:o.id,reason:'Retorno físico actual'});assert.throws(()=>command(s,'sale.return_receive',{orderId:o.id}),/Confirma/);assert.deepEqual(stock(s),before);
  command(s,'sale.return_receive',{orderId:o.id,confirmPhysical:true});assert.ok(o.items.every(i=>i.returnedQty===i.qty));
});

test('new configuration applies to new estimates while existing snapshots remain stable',()=>{
  const s=state(),o=s.orders.find(x=>x.market==='Sears'&&x.commercialStatus==='Activa'&&x.items.length);command(s,'reconciliation.estimate',{orderId:o.id});const old=structuredClone(o.reconciliation.estimate);
  command(s,'config.pricing.save',{section:'parameters',value:{...s.config.parameters,vatWithholding:0.09}});assert.deepEqual(o.reconciliation.estimate,old);
  command(s,'reconciliation.estimate',{orderId:o.id});const next=o.reconciliation.estimate;assert.ok(next.vatCents>old.vatCents);assert.ok(next.netCents<old.netCents);assert.equal(old.configSnapshot.parameters.vatWithholding,.08);assert.equal(next.configSnapshot.parameters.vatWithholding,.09);
  const snapshot=JSON.stringify(s);assert.throws(()=>command(s,'config.pricing.save',{section:'parameters',value:{...s.config.parameters,vatWithholding:1}}));assert.equal(JSON.stringify(s),snapshot);
});

test('reconciliation router preserves per-order conditions, drafts, independent outcomes, stock and refunds',()=>{
  const s=state(),orders=s.orders.filter(x=>x.market==='Liverpool'&&x.commercialStatus==='Activa'&&x.items.length).slice(0,2),ids=orders.map(x=>x.id),before=stock(s);orders[0].paymentStatus='refunded';
  command(s,'reconciliation.conditions',{orderId:ids[0],conditions:{msi:3,shippingCents:0}});command(s,'reconciliation.conditions',{orderId:ids[1],conditions:{msi:6,shippingCents:25000}});
  command(s,'reconciliation.select',{ids,selected:true});const estimated=command(s,'reconciliation.estimateBatch',{ids});assert.equal(estimated.succeeded,2);assert.equal(orders[0].reconciliation.estimate.conditions.msi,3);assert.equal(orders[1].reconciliation.estimate.conditions.msi,6);
  command(s,'reconciliation.draft',{orderId:ids[0],draft:{amountCents:orders[0].reconciliation.estimate.netCents,date:'2026-10-27',notes:'Depósito verificado'}});
  command(s,'reconciliation.draft',{orderId:ids[1],draft:{amountCents:0,date:'2026-10-28',notes:'Fecha por corregir'}});
  const saved=command(s,'reconciliation.saveBatch',{ids});assert.equal(saved.succeeded,1);assert.equal(saved.failed,1);assert.equal(orders[0].reconciliation.status,'Conciliada');assert.equal(orders[0].paymentStatus,'refunded');assert.equal(orders[0].reconciliation.draft,null);assert.equal(orders[1].reconciliation.depositCents,null);assert.equal(orders[1].reconciliation.draft.amountCents,0);
  assert.deepEqual(stock(s),before);
  command(s,'reconciliation.clearSelection');assert.ok(ids.every(id=>!reconciliationOf(s.orders.find(o=>o.id===id)).selected));
});

test('purchase, installment payment, physical receipt and later document edit keep received counters',()=>{
  const s=state(),p=twoProducts(s)[0],catalog=s.catalogs;
  const r=command(s,'purchase.create',{sicar:'COMPRA-TEST-'+(++sequence),date:'2026-10-01',lender:catalog.lenders[0],instrument:catalog.instruments[0],supplier:catalog.suppliers[0],term:3,amountCents:100000,receiptStatus:'Pendiente',satReviewed:'No',items:[{skuOrUpc:p.sku,name:p.name,qty:2,unitCostCents:50000}]});
  let purchase=s.purchases.find(x=>x.id===r.id);assert.equal(purchase.balanceCents,100000);
  const stockBefore=p.good;command(s,'inventory.receivePurchase',{purchaseId:purchase.id,items:[{lineId:purchase.items[0].id,qty:1}]});assert.equal(p.good,stockBefore+1);assert.equal(purchase.items[0].receivedQty,1);
  command(s,'purchase.update',{id:purchase.id,notes:'Documento revisado'});purchase=s.purchases.find(x=>x.id===r.id);assert.equal(purchase.items[0].receivedQty,1);assert.equal(purchase.items[0].sku,p.sku);
  const before=JSON.stringify(s);assert.throws(()=>command(s,'inventory.receivePurchase',{purchaseId:purchase.id,items:[{lineId:purchase.items[0].id,qty:2}]}),/supera/);assert.equal(JSON.stringify(s),before);
  const paymentId='integration-payment-unique';const payload={entityId:purchase.id,mode:'Otro monto',amountCents:20000,installmentsCovered:1,date:'2026-10-20'};
  command(s,'purchase.payment',payload,paymentId);assert.equal(purchase.balanceCents,80000);assert.equal(installmentState(purchase,s.purchasePayments).recommendedCents,40000);
  assert.equal(command(s,'purchase.payment',payload,paymentId).duplicate,true);assert.equal(purchase.balanceCents,80000);
  assert.equal(installmentSchedule(purchase,s.purchasePayments,s.creditRules,'2026-10-27').reduce((n,x)=>n+x.balanceCents,0),80000);
});

test('product cost changes record real prior value and update exact cost basis',()=>{
  const s=state(),p=s.products[0],old=p.costCents;command(s,'product.save',{originalSku:p.sku,product:{...p,costCents:old+100}});
  assert.equal(p.averageCostMxn,(old+100)/100);assert.equal(s.events[0].changes.before.costCents,old);assert.equal(s.events[0].changes.after.costCents,old+100);
});

test('fragment roundtrip retains actual seed, mutations, deletes and Unicode crossing chunk boundaries',()=>{
  const s=state();assert.deepEqual(joinState(splitState(s)),s);const next=structuredClone(s);next.unicodeProbe='a'.repeat(89998)+'😀 á 漢字';delete next.rawReconciliationDetail;
  const diff=diffFragments(s,next),stored=new Map(splitState(s).map(x=>[x.name+'|'+x.part,x]));for(const d of diff.deletes)stored.delete(d.name+'|'+d.part);for(const u of diff.upserts)stored.set(u.name+'|'+u.part,{...u,body:Buffer.from(u.body,'utf8').toString('utf8')});
  const joined=joinState([...stored.values()]);assert.equal(joined.unicodeProbe.slice(-20),next.unicodeProbe.slice(-20));assert.equal(joined.unicodeProbe.length,next.unicodeProbe.length);assert.deepEqual(joined,next);assert.ok(diff.deletes.length>0);
  assert.ok(splitState(next).every(row=>Buffer.byteLength(row.body,'utf8')<=90000));
});
