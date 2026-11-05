import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {paymentRows,paymentRow,paymentSummary,commissionEvidence,newestSales,saleDate,financialState} from '../lib/payment-reconciliation.mjs';
import {reconcileLedger} from '../lib/settlement-documents.mjs';
const seed=()=>JSON.parse(fs.readFileSync(new URL('../data/seed-v43.json',import.meta.url)));
function confirmed(){const s=seed();for(const c of s.settlementLedger.cheques){c.status='documented';s.settlementLedger.transactions.push({id:'bank:'+c.id,market:c.market,chequeNumber:c.number,date:c.date,amountCents:c.totalCents,reference:'000'+c.number,chequeId:null});}reconcileLedger(s);return s;}

test('all channels are shown, sorted by sale date before pagination; ties and missing dates are deterministic',()=>{
 const s=seed(),before=JSON.stringify(s),rows=paymentRows(s);assert.equal(rows.length,706);assert.equal(new Set(rows.map(r=>r.order.market)).size,7);
 for(let i=1;i<rows.length;i++)assert.ok(rows[i-1].date>=rows[i].date);
 for(const market of ['Sears','Sanborns','Liverpool','Mercado Libre','Coppel','Tienda Nube','Elektra']){const list=paymentRows(s,{market});assert.ok(list.length);assert.ok(list.every(r=>r.order.market===market));for(let i=25;i<list.length;i+=25)assert.ok(list[i-1].date>=list[i].date);}
 const orders=[{id:'10',documentDate:'2026-01-01',creationDate:'2026-11-01'},{id:'2',documentDate:'2026-02-01',creationDate:'2026-01-01'},{id:'none'}];assert.deepEqual(newestSales(orders).map(o=>o.id),['2','10','none']);assert.equal(JSON.stringify(s),before);
});
test('real fee is independent from calculator and drafts; NP with unknown tax stays explicitly preliminary',()=>{
 const s=confirmed(),o=s.orders.find(o=>o.id==='V000996'),before=commissionEvidence(o,s);assert.equal(before.amountCents,170786);assert.ok(Math.abs(before.rate-.14)<.000001);assert.equal(before.quality,'estimated-tax');
 s.config.commissions['T1 Comercios'][0].rate=.3;s.config.parameters.vatWithholding=.2;s.config.parameters.incomeWithholding=.1;o.reconciliation.draft={amountCents:1};assert.deepEqual(commissionEvidence(o,s),before);assert.equal(paymentRow(o,s).expectedRate,.3);
 const missing=s.orders.find(o=>o.market==='Sears'&&!s.settlementLedger.cheques.some(c=>c.lines.some(l=>l.orderId===o.id)));missing.reconciliation.draft={amountCents:123};assert.equal(commissionEvidence(missing,s).rate,null);
});
test('LP/CR and NP/DR taxes, SI/SV adjustments and returns preserve the Excel actual fee breakdown',()=>{
 const s=confirmed();for(const id of ['V001084','V000831','V002325','V002326','V002328','V002552']){const o=s.orders.find(o=>o.id===id),actual=commissionEvidence(o,s);assert.equal(actual.amountCents,Math.round(o.v43Comparison.inferredCommissionMxn*100),id);assert.ok(Math.abs(actual.rate-o.v43Comparison.inferredRate)<.00001,id);}
 const rows=paymentRows(s).filter(r=>r.actualCommission.amountCents!=null&&r.order.v43Comparison?.inferredCommissionMxn!=null);assert.equal(rows.length,363);assert.ok(rows.every(r=>Math.abs(r.actualCommission.amountCents-Math.round(r.order.v43Comparison.inferredCommissionMxn*100))<=1));
});
test('Excel summary separates cancelled/refunded/effective sales and labels partial profit coverage',()=>{
 const s=confirmed(),rows=paymentRows(s),summary=paymentSummary(rows);assert.equal(summary.grossCents,632910310);assert.equal(summary.cancelledCount,90);assert.equal(summary.refundedCount,15);assert.equal(summary.grossCents-summary.cancelledCents-summary.refundedCents,summary.effectiveCents);
 assert.equal(summary.depositCents,239852305);assert.equal(summary.depositCount,363);assert.equal(summary.confirmedCount,363);assert.equal(summary.realProfitCount,323);assert.equal(summary.realProfitCents,31391622);assert.ok(summary.realProfitCount<summary.depositCount);
 const t1=paymentSummary(rows.filter(r=>['Sears','Sanborns'].includes(r.order.market)));assert.equal(t1.pendingCount,16);assert.equal(t1.pendingCents,10842596);assert.equal(t1.cancelledCount,55);
});
test('search, dates and states filter the same rows used for financial metrics and exports',()=>{
 const s=confirmed(),query=paymentRows(s,{query:'31289383'});assert.equal(query.length,1);assert.equal(paymentSummary(query).depositCents,938692);
 const list=paymentRows(s,{market:'Sears',from:'2026-09-01',to:'2026-10-31',status:'confirmed'});assert.ok(list.length);assert.ok(list.every(r=>r.date>='2026-09-01'&&r.date.slice(0,10)<='2026-10-31'&&r.confirmed));
 assert.equal(paymentRows(s,{market:'Sears',status:'cancelled'}).length,42);assert.equal(paymentRows(s,{market:'Sanborns',status:'cancelled'}).length,13);
 assert.equal(paymentRows(s,{status:'refunded'}).length,15);assert.ok(paymentRows(s,{status:'pending'}).every(r=>r.financialState==='active'&&!r.confirmed));
});
test('a deposit on another market never becomes an invented commission',()=>{const s=seed(),o=s.orders.find(o=>o.market==='Liverpool');o.reconciliation.depositCents=123456;assert.equal(commissionEvidence(o,s).rate,null);assert.equal(commissionEvidence(o,s).quality,'unknown');});

test('a cancelled sale has a known zero net without inventing its missing quantity or merchandise cost',()=>{const s=seed(),o=s.orders.find(o=>o.id==='V002373'),before=JSON.stringify(o),r=paymentRow(o,s);assert.equal(r.financialState,'cancelled');assert.equal(r.estimate.netCents,0);assert.equal(r.estimate.costCents,null);assert.equal(r.pendingCents,0);assert.equal(r.realProfitCents,null);assert.equal(JSON.stringify(o),before);});
