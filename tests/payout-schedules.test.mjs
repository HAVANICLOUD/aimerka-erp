import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSchedule,calculatePayout,orderPayout} from '../lib/payout-schedules.mjs';
import {quote,recommend} from '../lib/pricing-v28.mjs';
import fs from 'node:fs';
const config=JSON.parse(fs.readFileSync(new URL('../data/pricing-config.json',import.meta.url)));
const base={channel:'Liverpool',type:'Calendario',confirmed:true,days:0,reference:'Acuerdo QA',calendar:[]};
test('unconfirmed calendars and absent delivery dates never fabricate expected payments',()=>{
 assert.equal(calculatePayout({...base,confirmed:false},'2026-10-30').payment,null);assert.equal(calculatePayout(base,null).payment,null);assert.equal(calculatePayout(base,'2026-10-30').payment,null);
});
test('explicit calendar chooses first cutoff after eligibility; invalid duplicates and reversed dates are rejected',()=>{
 const r=validateSchedule({...base,days:2,calendar:[{cutoff:'2026-11-05',payment:'2026-11-12'},{cutoff:'2026-10-30',payment:'2026-11-01'}]});
 assert.equal(calculatePayout(r,'2026-10-29').payment,'2026-11-12');assert.equal(calculatePayout(r,'2026-11-06').payment,null);
 assert.throws(()=>validateSchedule({...base,calendar:[{cutoff:'2026-11-05',payment:'2026-11-04'}]}),/fechas/);
 assert.throws(()=>validateSchedule({...r,calendar:[r.calendar[0],r.calendar[0]]}),/cortes/);
});
test('weekly and monthly rules reproduce Cortes29 including same-day cutoff and February capping',()=>{
 const weekly={...base,type:'Semanal',cutoffReference:'2026-10-30',paymentReference:'2026-11-03'};
 assert.deepEqual([calculatePayout(weekly,'2026-10-30').cutoff,calculatePayout(weekly,'2026-10-30').payment],['2026-10-30','2026-11-03']);
 const monthly={...base,type:'Mensual',cutoffReference:'2026-01-31',paymentReference:'2026-01-10'};
 const result=calculatePayout(monthly,'2028-02-20');assert.equal(result.cutoff,'2028-02-29');assert.equal(result.payment,'2028-03-10');
 assert.equal(calculatePayout({...base,type:'Días tras entrega',days:5},'2026-12-29').payment,'2027-01-03');
});
test('Liverpool prioritizes documented refund then cancellation and converts instants to Mexican civil dates',()=>{
 const rule={...base,type:'Días tras entrega',days:5};let order={market:'Liverpool',deliveredAt:'2026-10-28T04:00:00Z',marketplace34:{trace:{delivery:'2026-10-25',cancelMarketplace:'2026-10-26',refundSeller:'2026-10-27'}}};
 let result=orderPayout(order,{payoutSchedules:[rule]});assert.equal(result.eventDate,'2026-10-27');assert.equal(result.payment,'2026-11-01');
 delete order.marketplace34;result=orderPayout(order,{payoutSchedules:[rule]});assert.equal(result.eventDate,'2026-10-27');
});
test('actual V34 cached manual calculator case matches price, payout, profit and cost-based difference',()=>{
 // Read-only workbook reference: CALCULADORA C10/C11/C16/C17,
 // A28/E28, B52/D52, B53/D53 and B55/D55. No macro execution.
 const r=quote(config,{context:'calculadora',cost:8434,marketPrice:12799,channel:'T1 Comercios',shippingType:'Mediano',mode:'tasas',margin:.1,inflation:.2});
 const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
 assert.equal(r.discount.price,14199);assert.equal(r.regular.price,16999);close(r.discount.netPayout,9882.285);close(r.regular.netPayout,11884.285);close(r.discount.profit,1448.285);close(r.regular.profit,3450.285);close(r.discount.costBasedTargetDifference,577.885);
});
test('actual V34 UPC reference preserves zero-margin rounding and exact fractional deductions',()=>{
 // RECOMENDADOR_UPC B6/F10/F11 and A21/D21/G21/D49.
 const r=recommend(config,{sku:'REFERENCE34',upc:'195950638011',name:'Apple iPhone 17 Pro Max',category:'CELULARES SMARTPHONE',costCents:2794800,averageCostMxn:27948,priceCents:3099900,shippingType:'Pequeño'},{channel:'T1 Comercios',mode:'tasas',margin:0,inflation:0});
 assert.equal(r.discount.price,39299);assert.equal(r.regular.price,39299);assert.ok(Math.abs(r.discount.profit-20.785)<1e-8);assert.ok(Math.abs(r.discount.netPayout-27968.785)<1e-8);assert.equal(r.discount.isr,982.475);
});
