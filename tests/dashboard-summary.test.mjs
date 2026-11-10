import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dashboardSummary,dashboardPeriod,dashboardYears} from '../lib/dashboard-summary.mjs';
const order=(id,extra={})=>({id,market:'Sears',documentDate:'2026-10-05',creationDate:'2026-11-01',commercialStatus:'Activa',totalCents:10000,...extra});
const options={mode:'month',anchor:'2026-10-15',today:'2026-11-10'};

test('default basis is documentary; creation is optional and current month is not latest data month',()=>{
 const state={orders:[order('one')]};
 assert.equal(dashboardSummary(state,options).activeGrossCents,10000);
 assert.equal(dashboardSummary(state,{...options,basis:'creation'}).activeGrossCents,0);
 assert.equal(dashboardSummary(state,{anchor:'2026-11-10'}).activeCount,0);
});
test('civil Mexican dates retain wall clock days and convert explicit instants',()=>{
 const state={orders:[order('civil',{documentDate:'2026-10-01T01:00:00'}),order('instant',{documentDate:'2026-11-01T05:30:00Z'})]};
 assert.equal(dashboardSummary(state,options).activeCount,2);
});
test('Monday weeks cross years; leap February and year bounds are exact',()=>{
 assert.deepEqual(dashboardPeriod('week','2027-01-03'),{mode:'week',anchor:'2027-01-03',from:'2026-12-28',to:'2027-01-03',endExclusive:'2027-01-04'});
 assert.equal(dashboardPeriod('month','2028-02-17').to,'2028-02-29');
 assert.equal(dashboardPeriod('year','2026-07-10').endExclusive,'2027-01-01');
 assert.equal(dashboardPeriod('day','2026-10-15').to,'2026-10-15');
 assert.throws(()=>dashboardPeriod('month','2026-02-30'));
});
test('cancellation and refund use event dates, not original sale date; absent event date is excluded',()=>{
 const state={orders:[order('c',{commercialStatus:'Cancelada',cancelledAt:'2026-10-10',documentDate:'2025-01-01'}),order('r',{documentDate:'2025-01-01',paymentStatus:'refunded',refundedAt:'2026-10-11'}),order('undated',{commercialStatus:'Cancelada'})]};
 const s=dashboardSummary(state,options);assert.equal(s.activeGrossCents,0);assert.equal(s.cancelledCents,10000);assert.equal(s.refundCents,10000);
});
test('linked SICAR refund suppresses order fallback globally even when event lies outside period',()=>{
 const state={orders:[order('r',{paymentStatus:'refunded',refundedAt:'2026-10-10'})],sicarMovements:[{id:'m',orderId:'r',market:'Sears',type:'REEMBOLSO',date:'2026-09-10',amountCents:-10000}]};
 assert.equal(dashboardSummary(state,options).refundCents,0);
});
test('duplicate IDs do not inflate totals; distinct partial movements retain amounts',()=>{
 const o=order('r',{paymentStatus:'refunded',refundedAt:'2026-10-10'}),m={id:'a',orderId:'r',type:'REEMBOLSO',date:'2026-10-11',amountCents:-1200};
 const s=dashboardSummary({orders:[o,{...o}],sicarMovements:[m,{...m},{...m,id:'b'}]},options);
 assert.equal(s.activeGrossCents,10000);assert.equal(s.refundCount,2);assert.equal(s.refundCents,2400);assert.equal(s.netCommercialCents,7600);
});
test('negative rows do not lower gross or duplicate linked refunds; source state stays unchanged',()=>{
 const state={orders:[order('one'),order('negative',{totalCents:-2000,paymentStatus:'refunded',refundedAt:'2026-10-10',orderId:'one'})],sicarMovements:[{id:'r',orderId:'one',market:'Sears',type:'REEMBOLSO',amountCents:-2000,date:'2026-10-10'}]};
 const before=JSON.stringify(state),s=dashboardSummary(state,options);
 assert.equal(s.activeGrossCents,10000);assert.equal(s.refundCents,2000);assert.equal(s.excludedNegativeOrders,1);assert.equal(JSON.stringify(state),before);
});
test('cancelled refunds remain visible without a second subtraction from active gross',()=>{
 const s=dashboardSummary({orders:[order('active'),order('cancelled',{market:'Liverpool',commercialStatus:'Cancelada',cancelledAt:'2026-10-10',paymentStatus:'refunded',refundedAt:'2026-10-12'})]},options);
 assert.equal(s.cancelledCents,0);assert.equal(s.refundOnCancelledCents,10000);assert.equal(s.refundCents,10000);assert.equal(s.netCommercialCents,10000);
});
test('partial status alone never creates a full-order fallback; unmatched refund is disclosed separately',()=>{
 const s=dashboardSummary({orders:[order('partial',{paymentStatus:'partially_refunded',refundCents:1000,refundedAt:'2026-10-12'})],sicarMovements:[{id:'orphan',type:'REEMBOLSO',market:'Sears',date:'2026-10-12',amountCents:-2000}]},options);
 assert.equal(s.refundCents,2000);assert.equal(s.unlinkedRefundCents,2000);assert.equal(s.netCommercialCents,10000);
});
test('dynamic years include sale and event years plus current year',()=>{
 assert.deepEqual(dashboardYears({orders:[order('old',{documentDate:'2021-10-01',creationDate:null,cancelledAt:'2023-01-01'})],sicarMovements:[{date:'2028-01-01'}]},'2026-11-10'),[2028,2026,2023,2021]);
});

// Tracked workbook evidence and independently frozen Resumen results. This test
// requires no ignored local audit outputs or application-generated expectations.
const reference=JSON.parse(readFileSync(new URL('./fixtures/dashboard-v43-reference.json',import.meta.url)));
const referenceState={
 orders:reference.orders.map(([id,marketIndex,documentDate,creationDate,commercialStatus,paymentStatus,cancelledAt,refundedAt,totalCents])=>
   ({id,market:reference.markets[marketIndex],documentDate,creationDate,commercialStatus,paymentStatus,cancelledAt,refundedAt,totalCents})),
 sicarMovements:reference.refundMovements.map(([id,orderId,marketIndex,date,amountCents])=>
   ({id,orderId,market:reference.markets[marketIndex],date,amountCents,type:'REEMBOLSO'}))
};
for(const golden of reference.expected)test(`audited workbook Resumen: ${golden.month} ${golden.basis}, all six columns and marketplaces`,()=>{
 const result=dashboardSummary(referenceState,{...options,basis:golden.basis,anchor:golden.month+'-15'});
 // Check the whole market set as well as every six-column row: missing output
 // channels must not escape validation by iterating only over returned rows.
 assert.deepEqual(result.markets.map(row=>row.market).sort(),[...reference.markets].sort());
 for(const [index,market] of reference.markets.entries()){
   const row=result.markets.find(row=>row.market===market);
   assert.deepEqual(reference.provenance.expectedColumns.map(key=>row[key]),golden.markets[index],market);
 }
});
test('November recomputation uses dated evidence instead of stale ESCRITORIO cache',()=>{
 const nov=dashboardSummary(referenceState,{...options,basis:'creation',anchor:'2026-11-04'});
 assert.equal(reference.provenance.cachedNovemberCreation.activeGrossCents,579800);
 assert.equal(reference.provenance.cachedNovemberCreation.activeCount,2);
 assert.equal(nov.activeGrossCents,0);assert.equal(nov.activeCount,0);
});
