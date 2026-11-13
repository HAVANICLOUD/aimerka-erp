import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {previewCommercialEvent,commercialEventCommand,campaignTransfer} from '../lib/commercial-events.mjs';
const config=JSON.parse(readFileSync(new URL('../data/pricing-config.json',import.meta.url)));
const setup=()=>({config:structuredClone(config),products:[{sku:'TEST',name:'Audífonos',brand:'Apple',category:'AUDIFONOS',shippingType:'Pequeño',costCents:50000,priceCents:100000,good:3}],orders:[{sku:'TEST'}],movements:[]});
const rule=commissionRate=>({enabled:true,discount:.1,commissionRate});
const event=(transfer)=>({name:'Buen Fin',startDate:'2026-11-13',endDate:'2026-11-17',markets:['Tienda Nube','Sears'],selection:{},rules:{mode:'discount',margin:.1,discount:.1,...(transfer?{transfer}:{})}});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('additional discount compounds on campaign price with only the explicit fee and no withholding or MSI',()=>{
 // Test both interpretations as explicit inputs; no percentage is inferred.
 for(const commissionRate of [.0007,.07]){
  const s=setup(),before=structuredClone(s),p=previewCommercialEvent(s,{event:event(rule(commissionRate))}),r=p.rows.find(x=>x.market==='Tienda Nube'),t=r.campaignTransfer;
  assert.equal(r.discountCents,90000);assert.equal(t.priceCents,81000);assert.equal(t.commissionCents,Math.round(81000*commissionRate));
  assert.equal(t.withholdingTotal,0);assert.equal(t.financing,0);close(t.totalDiscountRate,.19);
  close(t.cashProfit,810-t.commission-500-r.result.shipping);close(t.marketplacePayout,810-t.commission);
  assert.equal(p.rows.find(x=>x.market==='Sears').campaignTransfer,undefined);assert.deepEqual(s,before);
 }
});
test('transfer comparison leaves normal prices and original commission untouched',()=>{
 const s=setup(),base=previewCommercialEvent(s,{event:event()}).rows;
 const next=previewCommercialEvent(s,{event:event(rule(.0007))}).rows;
 for(let i=0;i<base.length;i++)for(const key of ['discountCents','regularCents'])assert.equal(next[i][key],base[i][key]);
 for(let i=0;i<base.length;i++)for(const key of ['commission','withholdingTotal','cashProfit'])assert.equal(next[i].result.discount[key],base[i].result.discount[key]);
});
test('1% and 50% are allowed; invalid ranges, missing rate and malformed types fail without writes',()=>{
 for(const discount of [.01,.5])assert.ok(previewCommercialEvent(setup(),{event:event({...rule(.0007),discount})}).rows.find(r=>r.market==='Tienda Nube').campaignTransfer);
 for(const patch of [{discount:0},{discount:.51},{discount:NaN},{discount:'10'},{commissionRate:null},{commissionRate:1},{commissionRate:-.01},{commissionRate:'0.07'},{enabled:'yes'}]){
  const s=setup(),before=structuredClone(s);assert.throws(()=>previewCommercialEvent(s,{event:event({...rule(.0007),...patch})}));assert.deepEqual(s,before);
 }
});
test('transfer signal enforces the minimum margin even with no pass-through tax objective',()=>{
 const r={valid:true,channel:'Tienda Nube',cost:75,shipping:5,discount:{price:100}};
 const green=campaignTransfer(r,rule(0),.1,11000);assert.equal(green.traffic.color,'green');
 const yellow=campaignTransfer({...r,cost:80},rule(0),.1,11000);assert.equal(yellow.traffic.color,'yellow');assert.ok(yellow.belowTargetMargin);
 const red=campaignTransfer({...r,cost:90},rule(0),.1,11000);assert.equal(red.traffic.color,'red');
 assert.equal(campaignTransfer({...r,channel:'Sears'},rule(0),.1),null);
});
test('transfer risk affects parent selection and persists separately when campaign is applied',()=>{
 const s=setup();s.products[0].costCents=83000;
 const e=event(rule(.0007)),saved=commercialEventCommand(s,{id:'save',type:'pricing.event.save',payload:{event:e}},{now:'2026-11-12T12:00:00Z'});
 const p=previewCommercialEvent(s,{eventId:saved.eventId}),r=p.rows.find(x=>x.market==='Tienda Nube');
 assert.equal(r.campaignTransfer.traffic.color,'red');assert.equal(r.traffic.color,'red');assert.equal(r.defaultSelected,false);
 const target={sku:'TEST',market:'Tienda Nube'},payload={eventId:saved.eventId,previewFingerprint:p.fingerprint,targets:[target]};
 assert.throws(()=>commercialEventCommand(s,{id:'risk',type:'pricing.event.apply',payload}),/Reconoce/);
 const original=structuredClone(s.products);commercialEventCommand(s,{id:'apply',type:'pricing.event.apply',payload:{...payload,riskAcknowledgedTargets:[target]}},{now:'2026-11-12T12:00:00Z'});
 assert.deepEqual(s.products,original);assert.equal(s.productChannelPrices[0].discountCents,90000);
 assert.equal(s.pricePublicationQueue[0].result.campaignTransfer.priceCents,81000);assert.equal(s.commercialEventRuns[0].targets[0].campaignTransfer.priceCents,81000);
});
