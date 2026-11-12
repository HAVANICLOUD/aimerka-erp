import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {quote,recommend,compareChannels} from '../lib/pricing-v28.mjs';
import {applyCommand} from '../lib/commands.mjs';
const config=JSON.parse(fs.readFileSync(new URL('../data/pricing-config.json',import.meta.url)));
const policy={presentationPolicy:'market-discount-99',cost:1000,marketPrice:5999,channel:'T1 Comercios',category:'Todas las categorías',manualShipping:100,margin:.1,inflation:0,mode:'tasas'};
const product={sku:'TEST',name:'AirPods Max',brand:'Apple',category:'AUDIFONOS',costCents:100000,priceCents:599900,shippingType:'Pequeño',good:3};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const ends99=price=>assert.equal(price%100,99);
test('utility price keeps its objective while regular is raised to market in free and inventory scenarios',()=>{
 for(const r of [quote(config,policy),recommend(config,product,{...policy,mode:'automatico'})]){
  assert.equal(r.valid,true);assert.equal(r.regular.price,5999);assert.equal(r.marketFloorApplied,true);
  ends99(r.discount.price);ends99(r.regular.price);
  close(r.displayDiscountRate,1-r.discount.price/r.regular.price);
  close(r.discount.cashProfit,r.discount.price-r.discount.commission-r.discount.withholdingTotal-r.cost-r.shipping);
 }
 const prior=quote(config,{...policy,presentationPolicy:undefined});const next=quote(config,policy);
 assert.equal(next.discount.price,prior.discount.price);assert.equal(next.discount.cashProfit,prior.discount.cashProfit);
});
test('minimum customer discount raises only regular and is never undercut by 99 rounding',()=>{
 for(const minimumDiscount of [0,.05,.1,.25,.5,.9,.99]){
  const automatic=quote(config,{...policy,marketPrice:99,inflation:0});
  const r=quote(config,{...policy,marketPrice:99,inflation:0,displayDiscountMode:'minimum',minimumDiscount});
  assert.equal(r.valid,true);assert.equal(r.discount.price,automatic.discount.price);
  assert.equal(r.discount.cashProfit,automatic.discount.cashProfit);assert.ok(r.displayDiscountRate+1e-12>=minimumDiscount);
  ends99(r.discount.price);ends99(r.regular.price);
 }
});
test('reference not ending 99 rounds up and over-market warning tracks actual prices',()=>{
 const r=quote(config,{...policy,marketPrice:6000});assert.equal(r.regular.price,6099);assert.equal(r.regularAboveMarket,true);
 const exact=quote(config,policy);assert.equal(exact.regularAboveMarket,false);
 const inflated=quote(config,{...policy,marketPrice:1499,inflation:1});assert.equal(inflated.valid,true);assert.ok(inflated.regularAboveMarket);assert.match(inflated.warnings.join(' '),/regular supera/);
});
test('percentages through 100 are accepted and impossible profit targets produce explicit errors',()=>{
 for(let percent=0;percent<=100;percent+=5){
  const r=quote(config,{...policy,inflation:percent/100});assert.equal(r.valid,true);ends99(r.regular.price);
  const m=quote(config,{...policy,margin:percent/100});
  if(percent/100>=1-m.commissionRate-(m.vatRate||0)-(m.isrRate||0)&&m.valid)assert.fail('Impossible target accepted');
  if(!m.valid)assert.match(m.errors.map(e=>e.message).join(' '),/no es alcanzable/);
 }
 for(const patch of [{margin:1.05},{inflation:1.05},{minimumDiscount:1},{minimumDiscount:NaN},{displayDiscountMode:'arbitrary'}])assert.equal(quote(config,{...policy,...patch}).valid,false);
});
test('all inventory marketplaces independently calculate the real displayed discount and floor',()=>{
 const before=structuredClone(product);const rows=compareChannels(config,product,{...policy,mode:'automatico',inflation:.6,displayDiscountMode:'minimum',minimumDiscount:.2});
 assert.equal(rows.length,6);
 for(const r of rows){assert.equal(r.valid,true,JSON.stringify(r.errors));ends99(r.regular.price);ends99(r.discount.price);assert.ok(r.regular.price>=5999);assert.ok(r.displayDiscountRate>=.2);close(r.discount.withholdingTotal,r.discount.vat+r.discount.isr);}
 assert.deepEqual(product,before);
});
test('server saved virtual prices match the new calculator input without changing inventory',()=>{
 const state=JSON.parse(fs.readFileSync(new URL('../data/seed-v28.json',import.meta.url)));state.config=structuredClone(config);state.products=[structuredClone(product)];const original=structuredClone(state.products);
 const input={...policy,mode:'automatico',displayDiscountMode:'minimum',minimumDiscount:.25};const expected=recommend(state.config,product,input);
 applyCommand(state,{id:'discount-save',type:'pricing.publication.prepare',payload:{productSku:'TEST',targets:['Sears'],input}},{now:'2026-11-11T12:00:00Z',actor:'QA'});
 const saved=state.productChannelPrices.find(p=>p.market==='Sears');assert.equal(saved.regularCents,Math.round(expected.regular.price*100));assert.equal(saved.discountCents,Math.round(expected.discount.price*100));assert.deepEqual(state.products,original);
});
test('manual and competitive presentations retain valid 99 endings',()=>{
 const m=quote(config,{...policy,mode:'precios',manualDiscount:1500,manualRegular:2000});assert.equal(m.discount.price,1599);assert.equal(m.regular.price,2099);
 const c=quote(config,{...policy,mode:'competitivo',marketPrice:6000,competitiveInflation:1});assert.equal(c.discount.price,5999);ends99(c.regular.price);
});
