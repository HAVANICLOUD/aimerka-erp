import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {paymentRows,paymentRow,paymentSummary,commissionEvidence,newestSales,saleDate,financialState,paymentDocuments,documentMovement,paymentDate} from '../lib/payment-reconciliation.mjs';
import {reconcileLedger} from '../lib/settlement-documents.mjs';
const seed=()=>JSON.parse(fs.readFileSync(new URL('../data/seed-v43.json',import.meta.url)));
function confirmed(){const s=seed();for(const c of s.settlementLedger.cheques){c.status='documented';s.settlementLedger.transactions.push({id:'bank:'+c.id,market:c.market,chequeNumber:c.number,date:c.date,amountCents:c.totalCents,reference:'000'+c.number,chequeId:null});}reconcileLedger(s);return s;}

test('all channels are shown, sorted by documentary date before pagination; ties and missing dates are deterministic',()=>{
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
 const s=confirmed(),rows=paymentRows(s),summary=paymentSummary(rows);assert.equal(summary.grossCents,632910310);assert.equal(summary.cancelledCount,85);assert.equal(summary.refundedCount,20);assert.equal(summary.grossCents-summary.cancelledCents-summary.refundedCents,summary.effectiveCents);
 assert.equal(summary.depositCents,239852305);assert.equal(summary.depositCount,363);assert.equal(summary.confirmedCount,363);assert.equal(summary.realProfitCount,323);assert.equal(summary.realProfitCents,31391622);assert.ok(summary.realProfitCount<summary.depositCount);
 const t1=paymentSummary(rows.filter(r=>['Sears','Sanborns'].includes(r.order.market)));assert.equal(t1.pendingCount,16);assert.equal(t1.pendingCents,10842596);assert.equal(t1.cancelledCount,50);
});
test('search, dates and states filter the same rows used for financial metrics and exports',()=>{
 const s=confirmed(),query=paymentRows(s,{query:'31289383'});assert.equal(query.length,1);assert.equal(paymentSummary(query).depositCents,938692);
 const list=paymentRows(s,{market:'Sears',from:'2026-09-01',to:'2026-10-31',status:'confirmed'});assert.ok(list.length);assert.ok(list.every(r=>r.date>='2026-09-01'&&r.date.slice(0,10)<='2026-10-31'&&r.confirmed));
 assert.equal(paymentRows(s,{market:'Sears',status:'cancelled'}).length,39);assert.equal(paymentRows(s,{market:'Sanborns',status:'cancelled'}).length,11);
 assert.equal(paymentRows(s,{status:'refunded'}).length,20);assert.ok(paymentRows(s,{status:'pending'}).every(r=>r.financialState==='active'&&!r.confirmed));
});
test('a deposit on another market never becomes an invented commission',()=>{const s=seed(),o=s.orders.find(o=>o.market==='Liverpool');o.reconciliation.depositCents=123456;assert.equal(commissionEvidence(o,s).rate,null);assert.equal(commissionEvidence(o,s).quality,'unknown');});

test('a cancelled sale has a known zero net without inventing its missing quantity or merchandise cost',()=>{const s=seed(),o=s.orders.find(o=>o.id==='V002373'),before=JSON.stringify(o),r=paymentRow(o,s);assert.equal(r.financialState,'cancelled');assert.equal(r.estimate.netCents,0);assert.equal(r.estimate.costCents,null);assert.equal(r.pendingCents,0);assert.equal(r.realProfitCents,null);assert.equal(JSON.stringify(o),before);});

test('a paid and subsequently debited Sanborns sale is both reconciled and refunded; source and stock stay intact',()=>{
 const s=confirmed(),o=s.orders.find(o=>o.id==='V002552'),before=JSON.stringify(s),r=paymentRow(o,s);assert.equal(r.documentaryRefund,true);assert.equal(r.financialState,'refunded');assert.equal(r.confirmed,true);assert.equal(r.statusLabel,'Conciliada · Reembolsada');assert.equal(r.realProfitCents,null);assert.equal(r.depositCents,117663);
 assert.deepEqual(r.documents.map(d=>[d.cheque.number,d.parts[0].kind]),[['5909','payment'],['6875','refund']]);assert.equal(r.documents[0].netCents,1117914);assert.equal(r.documents[1].netCents,-1000251);assert.equal(r.documents[1].taxAdjustmentCents,117663);assert.equal(JSON.stringify(s),before);
});
test('SI/SV distinguish compensation directions from refunds, including a payment and discount in one cheque',()=>{
 const s=confirmed();for(const [id,kind,amount]of [['V002325','compensation-credit',71992],['V002326','compensation-debit',-35996],['V002328','compensation-debit',-59996]]){const r=paymentRow(s.orders.find(o=>o.id===id),s);assert.equal(r.documentaryRefund,false);assert.equal(r.financialState,'active');assert.equal(r.confirmed,true);assert.ok(r.compensations.some(p=>p.kind===kind&&p.amountCents===amount));assert.equal(r.actualCommission.amountCents,Math.round(r.order.v43Comparison.inferredCommissionMxn*100));}
 const one=paymentRow(s.orders.find(o=>o.id==='V002328'),s);assert.equal(one.documents.length,1);assert.deepEqual(one.documents[0].parts.map(p=>p.kind),['payment','compensation-debit']);assert.ok(paymentRows(s,{status:'compensated'}).every(r=>r.compensations.length));
});
test('a multi-sale positive cheque can contain this sale refund; cheque sign and two documents never imply refund by themselves',()=>{
 const s=confirmed(),refunded=paymentRow(s.orders.find(o=>o.id==='V002552'),s);assert.ok(refunded.documents.find(d=>d.hasRefund).cheque.totalCents>0);
 const original=paymentRow(s.orders.find(o=>o.id==='V002325'),s);assert.equal(original.documents.length,2);assert.equal(original.documentaryRefund,false);
 const ordinary=paymentRow(s.orders.find(o=>o.id==='V001084'),s);assert.equal(ordinary.documentaryRefund,false);assert.ok(ordinary.documents[0].taxAdjustmentCents<0);
 assert.equal(documentMovement({code:'DR',amountCents:-100}).kind,'tax');assert.equal(documentMovement({code:'SV',amountCents:-100}).kind,'compensation-debit');assert.equal(documentMovement({code:'ND',amountCents:100}).kind,'review');assert.equal(documentMovement({code:'UNRECOGNIZED',amountCents:-100}).kind,'review');
});
test('classified document parts and tax allocation conserve all 363 per-sale documentary and bank totals',()=>{
 const s=confirmed();for(const r of paymentRows(s).filter(r=>r.documents.length)){assert.equal(r.documents.reduce((sum,d)=>sum+d.netCents,0),r.depositCents,r.order.id);for(const d of r.documents)assert.equal(d.directCents+d.taxAdjustmentCents,d.netCents);}
 assert.equal(paymentRows(s).filter(r=>r.documentaryRefund&&r.confirmed).length,5);assert.equal(paymentSummary(paymentRows(s)).depositCents,239852305);
});
test('documentary date has priority and creation date is preserved',()=>{
 const s=seed(),o=s.orders.find(o=>o.id==='V000996'),r=paymentRow(o,s);assert.ok(r.date.startsWith('2026-10-06'));assert.ok(r.documentDate.startsWith('2026-10-06'));assert.equal(r.dateLabel,'Fecha documental');const source={id:'only-document',documentDate:'2026-01-01'};assert.equal(saleDate(source),'2026-01-01');
});

test('Excel creation-date serials are normalized for display, ordering and date filters without replacing the originals',()=>{
 assert.equal(paymentDate('46261.3855'),'2026-08-27T09:15:07');assert.equal(paymentDate('2026-02-30'),'');assert.equal(paymentDate('not a date'),'');const s=seed(),before=JSON.stringify(s);const rows=paymentRows(s);assert.ok(rows.every(r=>!r.date||/^20\d\d-\d\d-\d\d/.test(r.date)));assert.equal(rows[0].date,rows.map(r=>r.date).sort().at(-1));for(let i=1;i<rows.length;i++)assert.ok(rows[i-1].date>=rows[i].date);assert.equal(JSON.stringify(s),before);
});

test('explicit UTC timestamps display and sort in Mexico City while naive Excel timestamps retain local time',()=>{assert.equal(paymentDate('2026-01-02T01:00:00Z'),'2026-01-01T19:00:00');assert.equal(paymentDate('2026-01-02T01:00:00'),'2026-01-02T01:00:00');assert.equal(paymentDate('2026-01-02T01:00:00-06:00'),'2026-01-02T01:00:00');});

test('Sears comparison uses the same completed-sale population, without adding unpaid balances',()=>{
 const s=confirmed(),all=paymentSummary(paymentRows(s,{market:'Sears'})),paid=paymentSummary(paymentRows(s,{market:'Sears',status:'confirmed'})),pending=paymentSummary(paymentRows(s,{market:'Sears',status:'pending'}));
 assert.equal(all.estimatedCents,200653223);assert.equal(paid.estimatedCents,191101666);assert.equal(all.depositCents,204767357);assert.equal(paid.depositCents,all.depositCents);assert.equal(all.pendingCents,9551557);assert.equal(paid.pendingCents,0);assert.equal(all.estimatedCents-paid.estimatedCents,pending.estimatedCents);
 assert.equal(all.differenceCents,13665691);assert.equal(all.comparableEstimatedCents,191101666);assert.equal(all.comparableReceivedCents,204767357);assert.equal(all.comparableReceivedCents-all.comparableEstimatedCents,all.differenceCents);assert.equal(paid.differenceCents,all.differenceCents);assert.equal(pending.comparisonCount,0);
 assert.equal(all.favorableCents,13665695);assert.equal(all.shortfallCents,4);assert.equal(all.favorableCount,246);assert.equal(all.shortfallCount,4);assert.equal(all.roundingShortfallCount,4);assert.equal(all.favorableCents-all.shortfallCents,all.differenceCents);
});
test('positive and negative differences cannot cancel each other or absorb partial, unpaid and refunded amounts',()=>{
 const row=(id,deposit,expected,extra={})=>({order:{id,totalCents:100000},financialState:'active',confirmed:true,depositCents:deposit,estimate:{netCents:expected},...extra});
 const summary=paymentSummary([row('over',11000,10000),row('under',8000,10000),row('unpaid',null,30000,{confirmed:false,unpaid:true,pendingCents:30000}),row('partial',5000,20000,{confirmed:false,pendingCents:15000}),row('refund',500,0,{financialState:'refunded'})]);
 assert.equal(summary.favorableCents,1000);assert.equal(summary.shortfallCents,2000);assert.equal(summary.differenceCents,-1000);assert.equal(summary.comparisonCount,2);assert.equal(summary.comparableEstimatedCents,20000);assert.equal(summary.comparableReceivedCents,19000);assert.equal(summary.pendingCents,45000);assert.equal(summary.unpaidCount,1);assert.equal(summary.partialCount,1);
});
test('unpaid review queue detects later bank-paid sales only within the same marketplace and respects documentary dates',()=>{
 const s=confirmed(),before=JSON.stringify(s),rows=paymentRows(s,{market:'Sears',status:'unpaid'}),older=paymentRows(s,{market:'Sears',status:'older-unpaid'});assert.equal(rows.length,14);assert.equal(older.length,5);assert.ok(older.every(r=>r.unpaid&&r.laterPaidSale.date>r.date.slice(0,10)));
 assert.deepEqual(new Set(older.map(r=>r.order.number)),new Set(['31279221','87585219','87357571','86465164','86313193']));assert.equal(paymentSummary(older).olderUnpaidEstimatedCents,5948570);assert.equal(paymentRows(s,{market:'Sanborns',status:'older-unpaid'}).length,1);
 assert.equal(paymentRows(s,{market:'Sears',status:'unpaid',from:'2026-10-01'}).length,9);assert.equal(paymentRows(s,{market:'Sears',status:'favorable'}).length,246);assert.equal(paymentRows(s,{market:'Sears',status:'shortfall'}).length,4);assert.equal(JSON.stringify(s),before);
});
test('later-payment alert requires a later documentary day and bank proof; other channels and manual declarations do not qualify',()=>{
 const s=confirmed();s.orders=s.orders.filter(o=>o.id==='V000967'||o.market==='Sanborns');assert.equal(paymentRows(s,{market:'Sears',status:'older-unpaid'}).length,0);
 const base=s.orders.find(o=>o.id==='V000967'),later=structuredClone(base);later.id='later-manual';later.documentDate='2026-10-31';later.reconciliation={status:'Conciliada manualmente',depositCents:100,confirmationSource:'manual',manual:{complete:true}};s.orders.push(later);assert.equal(paymentRows(s,{market:'Sears',status:'older-unpaid'}).length,0);
 later.reconciliation={status:'Conciliada',depositCents:100,bankProofIds:['bank-confirmed']};later.documentDate=base.documentDate;assert.equal(paymentRows(s,{market:'Sears',status:'older-unpaid'}).length,0);later.documentDate='2026-10-31';assert.equal(paymentRows(s,{market:'Sears',status:'older-unpaid'}).length,1);
});
