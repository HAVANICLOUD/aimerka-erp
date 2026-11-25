import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {maintainOrderGross} from '../lib/order-gross-maintenance.mjs';import {orderGrossValidation} from '../lib/order-gross-validation.mjs';import {commissionEvidence,paymentRow,paymentDifference} from '../lib/payment-reconciliation.mjs';
const fixture=()=>JSON.parse(fs.readFileSync(new URL('fixtures/gross-correction-87195171.json',import.meta.url)));
const evidence={orderId:'V000876',market:'Sears',number:'87195171',totalCents:1169900,currency:'MXN',source:'T1',observedAt:'2026-11-24'};
test('gross mismatch remains visible on a bank-reconciled sale and cannot masquerade as inferred fee or favorable net',()=>{
 const s=fixture(),o=s.orders.find(o=>o.id===evidence.orderId);o.marketplaceGrossEvidence=evidence;
 assert.equal(o.reconciliation.status,'Conciliada');assert.equal(orderGrossValidation(o).differenceCents,900);assert.equal(commissionEvidence(o,s).quality,'gross-mismatch');assert.equal(commissionEvidence(o,s).rate,null);assert.equal(paymentDifference({confirmed:true,financialState:'active',depositCents:900218,estimate:{netCents:899525},grossValidation:orderGrossValidation(o)}),null);
});
test('owner correction changes only the single sale gross, links the original certificate and preserves bank and inventory byte-for-byte',()=>{
 const s=fixture(),before=structuredClone(s),o=s.orders.find(o=>o.id===evidence.orderId),r=maintainOrderGross(s,{rows:[evidence]},{now:'2026-11-24',actor:'Propietario'});
 assert.deepEqual(r,{corrected:true,certificateLinked:true});assert.equal(o.totalCents,1169900);assert.equal(o.items[0].totalCents,1169900);assert.deepEqual(o.reconciliation,before.orders.find(x=>x.id===o.id).reconciliation);
 for(const k of ['products','movements'])assert.deepEqual(s[k],before[k]);for(const k of ['cheques','transactions'])assert.deepEqual(s.settlementLedger[k],before.settlementLedger[k]);
 const cert=s.settlementLedger.retentionCertificates[0];assert.equal(cert.status,'matched');assert.deepEqual(cert.chequeIds,['Sears|12514']);assert.equal(cert.candidates[0].grossDifferenceCents,1);assert.equal(cert.candidates[0].netDifferenceCents,1);
 const actual=commissionEvidence(o,s);assert.equal(actual.quality,'certificate-allocation');assert.ok(Math.abs(actual.rate-.14)<.00001);assert.equal(orderGrossValidation(o).mismatch,false);assert.equal(s.orderGrossCorrectionHistory[0].originalOrder.totalCents,1169000);
 const post=JSON.stringify(s);assert.equal(maintainOrderGross(s,{rows:[evidence]}),null);assert.equal(JSON.stringify(s),post);
});
test('evidence must match original market, number, currency and integer cents',()=>{const o={id:evidence.orderId,market:'Sears',number:'87195171',totalCents:1169000};for(const e of [{...evidence,market:'Liverpool'},{...evidence,number:'0'},{...evidence,currency:'USD'},{...evidence,totalCents:1.5}])assert.equal(orderGrossValidation({...o,marketplaceGrossEvidence:e}).status,'unverified');});
test('a changed or multi-line order is never overwritten and certificate is not forced',()=>{const s=fixture(),o=s.orders.find(o=>o.id===evidence.orderId);o.items[0].qty=2;assert.equal(maintainOrderGross(s,{rows:[evidence]}).corrected,false);assert.equal(o.totalCents,1169000);assert.equal(s.settlementLedger.retentionCertificates[0].status,'review');});

import {projectState} from '../lib/state-view.mjs';
test('correction archive preserves existing financial access boundary',()=>{const data={state:{orderGrossCorrectionHistory:[{originalCertificate:{uuid:'protected'}}]}};assert.equal(projectState(data,{active:true,permissions:[]}).state.orderGrossCorrectionHistory,undefined);assert.deepEqual(projectState(data,{active:true,permissions:['finance_read']}).state.orderGrossCorrectionHistory,data.state.orderGrossCorrectionHistory);assert.equal(data.state.orderGrossCorrectionHistory.length,1);});
