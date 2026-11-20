import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {migrateT1Commission14} from '../lib/t1-commission-policy.mjs';
import {compareV43} from '../lib/settlement-documents.mjs';
import {commissionEvidence,paymentRows,paymentSummary} from '../lib/payment-reconciliation.mjs';
import {quote,recommend,compareChannels} from '../lib/pricing-v28.mjs';
import {estimateOrder} from '../lib/reconciliation-v28.mjs';
import {projectState} from '../lib/state-view.mjs';
const seed=()=>JSON.parse(fs.readFileSync(new URL('../data/seed-v43.json',import.meta.url)));
const context={now:'2026-11-20T12:00:00Z',requestId:'t1-policy-test'};
test('one-time migration replaces all active T1 rates and archives only obsolete forecasts, preserving documentary truth',()=>{
 const s=seed(),before=structuredClone(s),evidence=new Map(s.orders.filter(o=>['Sears','Sanborns'].includes(o.market)).map(o=>[o.id,commissionEvidence(o,s)]));
 const result=migrateT1Commission14(s,context);assert.ok(result.archivedOrders>400);
 assert.ok(s.config.commissions['T1 Comercios'].every(r=>r.rate===.14));assert.equal(s.config.bankReconciliation.commissionRate,.14);
 for(const key of Object.keys(before))if(!['config','orders','events'].includes(key))assert.deepEqual(s[key],before[key],key);
 for(const o of s.orders){const b=before.orders.find(b=>b.id===o.id);if(!['Sears','Sanborns'].includes(o.market)){assert.deepEqual(o,b);continue;}
  const expected=structuredClone(b);for(const k of ['expectedCommissionMxn','expectedVatMxn','expectedIsrMxn','expectedNetMxn','expectedProfitMxn','profitDifferenceMxn'])delete expected.v43Comparison[k];delete expected.reconciliation.modelDifferenceCents;
  assert.deepEqual(o,expected,o.id);assert.deepEqual(commissionEvidence(o,s),evidence.get(o.id),o.id+' actual fee');
  assert.equal(compareV43(o,s.products,s.config).commissionRate,.14);assert.equal(Object.hasOwn(o.v43Comparison,'expectedNetMxn'),false);
 }
 const once=structuredClone(s);assert.equal(migrateT1Commission14(s,context),null);assert.deepEqual(s,once);
 // A future deliberate configuration edit is not silently reset by repeated reads.
 s.config.commissions['T1 Comercios'][0].rate=.15;migrateT1Commission14(s,context);assert.equal(s.config.commissions['T1 Comercios'][0].rate,.15);
});
test('stored 18% estimates are invalidated without changing receipts, status, manual snapshots or saved 14% estimates',()=>{
 const s=seed(),o=s.orders.find(o=>o.market==='Sears'),other=s.orders.find(x=>x.market==='Sanborns');
 o.reconciliation.estimate={commissionRate:.18,grossCents:100000,commissionCents:18000,netCents:72948,profitCents:100};o.reconciliation.differenceCents=101;
 o.reconciliation.manual={amountCents:72948,estimateSnapshot:{commissionRate:.18,retentionCents:9052}};
 other.reconciliation.estimate={commissionRate:.14,netCents:76948};
 const before=structuredClone(o.reconciliation),otherEstimate=structuredClone(other.reconciliation.estimate);
 migrateT1Commission14(s,context);assert.equal(o.reconciliation.estimate,null);assert.equal(o.reconciliation.differenceCents,undefined);assert.deepEqual(o.reconciliation.manual,before.manual);
 for(const k of ['depositCents','depositDate','status','bankProofIds','history'])assert.deepEqual(o.reconciliation[k],before[k]);
 assert.deepEqual(other.reconciliation.estimate,otherEstimate);assert.deepEqual(s.commissionPolicyHistory[0].orders.find(x=>x.orderId===o.id).estimate,before.estimate);
});
test('real fees above 14% remain inferred from LP payment evidence, independently of current price calculators',()=>{
 const s=seed(),o=s.orders.find(o=>o.market==='Sears');o.totalCents=100000;
 s.settlementLedger.cheques=[{id:'proof18',market:'Sears',date:'2026-01-01',lines:[{orderId:o.id,code:'LP',amountCents:82000}]}];
 const before=commissionEvidence(o,s);assert.equal(before.rate,.18);migrateT1Commission14(s,context);assert.deepEqual(commissionEvidence(o,s),before);
 assert.equal(compareV43(o,s.products,s.config).commissionRate,.14);
});
test('all price modes, inventory recommendation, comparisons and settlement estimates use the same current 14%',()=>{
 const s=seed();migrateT1Commission14(s,context);const p=s.products.find(p=>p.costCents>0&&p.priceCents>0);
 for(const market of ['Sears','Sanborns'])for(const mode of ['automatico','precios','competitivo']){
  const r=quote(s.config,{channel:market,cost:500,marketPrice:2000,mode,margin:.1,manualShipping:0,manualDiscount:1160,manualRegular:1999});assert.equal(r.valid,true,JSON.stringify(r.errors));assert.equal(r.commissionRate,.14);assert.ok(Math.abs(r.discount.withholdingBase-r.discount.price/1.16)<1e-7);
 }
 assert.equal(recommend(s.config,p,{channel:'Sears',margin:.1,manualShipping:0}).commissionRate,.14);
 assert.equal(compareChannels(s.config,p,{margin:.1,manualShipping:0}).find(r=>r.channel==='T1 Comercios').commissionRate,.14);
 const order=s.orders.find(o=>o.market==='Sears'&&o.commercialStatus==='Activa');assert.equal(estimateOrder(order,s.products,s.config).commissionRate,.14);
 const rows=paymentRows(s,{market:'Sears'});assert.ok(rows.every(r=>r.expectedRate===.14));const metrics=paymentSummary(rows);assert.equal(metrics.estimatedCents,rows.reduce((n,r)=>n+(r.estimate?.netCents||0),0));
});
test('retired forecast archive is absent for users without financial access',()=>{
 const s=seed();migrateT1Commission14(s,context);const visible=projectState({workspace:'other',state:s},{permissions:['inventory']});assert.equal(visible.state.commissionPolicyHistory,undefined);assert.ok(s.commissionPolicyHistory.length);
});
