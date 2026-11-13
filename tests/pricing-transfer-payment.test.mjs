import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {quote,recommend,compareChannels} from '../lib/pricing-v28.mjs';import {applyCommand} from '../lib/commands.mjs';
const config=JSON.parse(readFileSync(new URL('../data/pricing-config.json',import.meta.url)));
const product={sku:'A',name:'Audífonos',brand:'Apple',category:'AUDIFONOS',costCents:50000,priceCents:199900,good:2};
const base={channel:'Tienda Nube',context:'calculadora',category:'Todas las categorías',cost:500,marketPrice:1999,manualShipping:100,mode:'precios',manualDiscount:1499,manualRegular:1999,margin:.1};
const transferPayment={enabled:true,discount:.1,commissionRate:.0007,rounding:'ending99'};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('all calculators use only 0.07% of the final transfer price; main MSI rates and cash stay intact',()=>{
 for(const calculate of [input=>quote(config,input),input=>recommend(config,product,input)]){
  const old=calculate(base),r=calculate({...base,transferPayment});const t=r.transfer;
  assert.equal(r.valid,true);assert.deepEqual(r.discount,old.discount);assert.deepEqual(r.regular,old.regular);
  assert.equal(t.price,1299);assert.equal(t.price%100,99);assert.equal(t.commission,.91);assert.equal(t.withholdingTotal,0);assert.equal(t.financing,0);
  close(t.cashProfit,1299-.91-500-100);assert.ok(t.effectiveAdditionalDiscount>=.1);
 }
 const rows=compareChannels(config,product,{...base,transferPayment});assert.equal(rows.filter(r=>r.transfer).length,1);assert.equal(rows.find(r=>r.channel==='Tienda Nube').transfer.commissionRate,.0007);
});
test('1–50% additional discounts guarantee at least the selected discount with 99 endings',()=>{
 for(let discount=1;discount<=50;discount++){
  const r=quote(config,{...base,transferPayment:{...transferPayment,discount:discount/100}});assert.equal(r.valid,true);assert.equal(r.transfer.price%100,99);assert.ok(r.transfer.effectiveAdditionalDiscount+1e-10>=discount/100);
 }
});
test('disabled transfer stays hidden and invalid transfer rules reject the quote without modifying input',()=>{
 assert.equal(quote(config,{...base,transferPayment:{...transferPayment,enabled:false}}).transfer,null);
 for(const patch of [{discount:0},{discount:.51},{commissionRate:1},{commissionRate:null},{commissionRate:NaN},{rounding:'unknown'}]){
  const input={...base,transferPayment:{...transferPayment,...patch}},before=structuredClone(input),r=quote(config,input);assert.equal(r.valid,false);assert.deepEqual(input,before);
 }
});
test('no positive 99 price reports nonviability, not a fabricated positive transfer result',()=>{
 const r=quote(config,{...base,manualDiscount:99,manualRegular:99,transferPayment:{...transferPayment,discount:.5}});assert.equal(r.transfer.price,0);assert.equal(r.transfer.traffic.color,'red');assert.match(r.transfer.traffic.reason,/No existe/);
});
test('saved calculator scenarios and virtual TN prices retain independent transfer figures',()=>{
 const s=JSON.parse(readFileSync(new URL('../data/seed-v28.json',import.meta.url)));s.config=structuredClone(config);s.products=[structuredClone(product)];
 const before=structuredClone(s.products),input={...base,transferPayment};
 applyCommand(s,{id:'test-transfer-publish',type:'pricing.publication.prepare',payload:{productSku:'A',targets:['Tienda Nube'],input}},{now:'2026-11-12T12:00:00Z',actor:'QA'});
 assert.equal(s.productChannelPrices[0].discountCents,149900);assert.equal(s.pricePublicationQueue[0].result.transfer.price,1299);assert.deepEqual(s.products,before);
});

test('transfer loss or low margin cannot be auto-selected as green by the comparator', async()=>{
 const {classifyPricing}=await import('../lib/pricing-signals.mjs');
 const viable=quote(config,{...base,transferPayment});assert.equal(classifyPricing([viable])[0].color,'green');
 const low={...viable,transfer:{...viable.transfer,traffic:{color:'yellow',reason:'Margen bajo por transferencia.'}}};assert.equal(classifyPricing([low])[0].color,'yellow');
 const loss={...viable,transfer:{...viable.transfer,traffic:{color:'red',reason:'No deja caja por transferencia.'}}};assert.equal(classifyPricing([loss])[0].color,'red');
});
