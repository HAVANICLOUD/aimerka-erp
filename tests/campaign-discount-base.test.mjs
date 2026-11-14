import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {previewCommercialEvent,commercialEventCommand} from '../lib/commercial-events.mjs';
const config=JSON.parse(readFileSync(new URL('../data/pricing-config.json',import.meta.url)));
const product={sku:'MAX',name:'AirPods Max',brand:'Apple',category:'AUDIFONOS',priceCents:1249900,costCents:858996,averageCostMxn:8589.956625,shippingType:'Pequeño',good:1};
const event=discount=>({name:'Apple',startDate:'2026-11-13',endDate:'2026-11-17',markets:['Tienda Nube'],selection:{},rules:{mode:'discount',discount,margin:.1}});
function state(){return {config:structuredClone(config),products:[structuredClone(product)],productChannelPrices:[{sku:'MAX',market:'Tienda Nube',regularCents:1409900,discountCents:1229900}]};}
test('discount campaigns use the updated general price rather than an older saved channel price by default',()=>{
 for(const [discount,expected] of [[.1,1124910],[.15,1062415]]){
  const s=state(),before=structuredClone(s),row=previewCommercialEvent(s,{event:event(discount)}).rows[0];assert.equal(row.regularCents,1249900);assert.equal(row.baselineCents,1249900);assert.equal(row.baselineSource,'general');assert.equal(row.channelRegularCents,1409900);assert.equal(row.discountCents,expected);assert.deepEqual(s,before);
 }
});
test('legacy queued proposals cannot mask a newly edited general price; legacy channel preference is ignored',()=>{
 const s=state();delete s.productChannelPrices;s.pricePublicationQueue=[{sku:'MAX',targetMarket:'Tienda Nube',regularCents:1429900,discountCents:1299900,status:'awaiting_connection'}];
 assert.equal(previewCommercialEvent(s,{event:event(.1)}).rows[0].regularCents,1249900);
 const e=event(.1);e.rules.discountBase='channel';assert.equal(previewCommercialEvent(s,{event:e}).rows[0].regularCents,1249900);
 delete s.pricePublicationQueue;assert.equal(previewCommercialEvent(s,{event:e}).rows[0].baselineSource,'general');
});
test('editing the product after preview invalidates the calculation and saving snapshots preserves baseline provenance',()=>{
 const s=state(),ctx={now:'2026-11-14T09:00:00Z',actor:'QA'},id=commercialEventCommand(s,{id:'save',type:'pricing.event.save',payload:{event:event(.1)}},ctx).eventId;
 const preview=previewCommercialEvent(s,{eventId:id});s.products[0].priceCents=1199900;
 assert.throws(()=>commercialEventCommand(s,{id:'stale',type:'pricing.event.apply',payload:{eventId:id,previewFingerprint:preview.fingerprint,targets:[{sku:'MAX',market:'Tienda Nube'}]}},ctx),/recalcula/);
 const fresh=previewCommercialEvent(s,{eventId:id});commercialEventCommand(s,{id:'apply',type:'pricing.event.apply',payload:{eventId:id,previewFingerprint:fresh.fingerprint,targets:[{sku:'MAX',market:'Tienda Nube'}],riskAcknowledgedTargets:[{sku:'MAX',market:'Tienda Nube'}]}},ctx);
 const saved=structuredClone(s.commercialEventRuns);assert.equal(saved[0].targets[0].baselineSource,'general');assert.equal(saved[0].targets[0].productGeneralCents,1199900);
 s.products[0].priceCents=999900;assert.deepEqual(s.commercialEventRuns,saved);
});
test('legacy price-base settings never override inventory or change records',()=>{const s=state(),before=structuredClone(s),e=event(.1);e.rules.discountBase='invented';assert.equal(previewCommercialEvent(s,{event:e}).rows[0].regularCents,1249900);assert.deepEqual(s,before);});
