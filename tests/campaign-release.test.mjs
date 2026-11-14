import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {commercialEventCommand as cmd,previewCommercialEvent as preview,commercialEventPriceRows as saved,commercialEventCompletedTargets as completed,commercialCampaignCoverage as coverage} from '../lib/commercial-events.mjs';
import {restoreExpiredCampaignPrices} from '../lib/campaign-lifecycle.mjs';
import {renameProductSkus} from '../lib/product-identity.mjs';
const config=JSON.parse(readFileSync(new URL('../data/pricing-config.json',import.meta.url)));
const ctx={now:'2026-11-14T12:00:00Z',actor:'QA'},pair={sku:'MAX',market:'Tienda Nube'};
const event={id:'root',isParent:true,name:'Buen Fin',startDate:'2026-11-13',endDate:'2026-11-17',markets:['Tienda Nube','Sears'],selection:{},rules:{mode:'discount',discount:.1,margin:.1}};
function setup(){return {config:structuredClone(config),products:[{sku:'MAX',name:'AirPods Max',brand:'Apple',category:'AUDIFONOS',priceCents:1249900,costCents:858996,shippingType:'Pequeño',good:1}],commercialEvents:[structuredClone(event),{...structuredClone(event),id:'lot',isParent:false,parentId:'root'}],orders:[{id:'preserved'}]};}
function apply(s,id='run',eventId='lot',targets=[pair]){const p=preview(s,{eventId});cmd(s,{id,type:'pricing.event.apply',payload:{eventId,previewFingerprint:p.fingerprint,targets,riskAcknowledgedTargets:targets}},ctx);}
function release(s,runId='run',eventId='root',id='release'){return cmd(s,{id,type:'pricing.event.release',payload:{eventId,runId,...pair}},ctx);}
test('release returns only selected product/channel to pending across family and preserves original snapshots',()=>{
 const s=setup();apply(s,'run','lot',[pair,{sku:'MAX',market:'Sears'}]);const runs=structuredClone(s.commercialEventRuns),products=structuredClone(s.products),orders=structuredClone(s.orders);
 release(s);assert.deepEqual(s.commercialEventRuns,runs);assert.deepEqual(s.products,products);assert.deepEqual(s.orders,orders);
 assert.equal(completed(s,'root').has(JSON.stringify(['MAX','Tienda Nube'])),false);assert.equal(completed(s,'lot').size,1);
 assert.equal(preview(s,{eventId:'lot'}).rows.length,1);assert.equal(coverage(s,'root').find(r=>r.market==='Tienda Nube').pending,1);
 assert.deepEqual(saved(s,{eventId:'root'}).map(r=>r.market),['Sears']);assert.equal(saved(s,{runId:'run'}).length,1);assert.equal(saved(s,{runId:'run',includeReleased:true})[0].released,true);
 assert.equal(s.pricePublicationQueue.find(q=>q.runId==='run'&&q.targetMarket==='Tienda Nube').status,'withdrawn');assert.equal(s.campaignPriceRestorations.find(r=>r.market==='Tienda Nube').status,'released');
});
test('released assignment can be replaced with another discount and new snapshot exports exactly once',()=>{
 const s=setup();apply(s);release(s);s.commercialEvents[1].rules.discount=.15;apply(s,'new');
 const rows=saved(s,{eventId:'root'});assert.equal(rows.length,1);assert.equal(rows[0].runId,'new');assert.equal(rows[0].discountCents,1062415);assert.equal(completed(s,'root').size,1);assert.equal(saved(s,{runId:'run',includeReleased:true})[0].discountCents,1124910);
});
test('restores an earlier virtual price only when removed assignment still owns current price',()=>{
 const s=setup();const original={...pair,regularCents:1409900,discountCents:1229900,commandId:'calculator',revision:3};s.productChannelPrices=[original];apply(s);release(s);
 assert.equal(s.productChannelPrices[0].commandId,'calculator');assert.equal(s.productChannelPrices[0].regularCents,1409900);assert.equal(s.productChannelPriceHistory[0].commandId,'run');
 const t=setup();apply(t);t.productChannelPrices[0]={...t.productChannelPrices[0],commandId:'new-manual',regularCents:999900};const newer=structuredClone(t.productChannelPrices);release(t);assert.deepEqual(t.productChannelPrices,newer);assert.equal(t.pricePublicationQueue.some(q=>q.source==='campaign-release'),false);
});
test('rejects stale run, unknown family, other channel and repeated withdrawal without mutations',()=>{
 const s=setup();apply(s);for(const payload of [{eventId:'root',runId:'stale',...pair},{eventId:'missing',runId:'run',...pair},{eventId:'root',runId:'run',sku:'MAX',market:'Elektra'}]){const before=structuredClone(s);assert.throws(()=>cmd(s,{id:'bad',type:'pricing.event.release',payload},ctx));assert.deepEqual(s,before);}
 release(s);const before=structuredClone(s);assert.throws(()=>release(s),/registrada/);assert.deepEqual(s,before);
});
test('legacy duplicate family snapshots all become inactive, without reviving older assignment',()=>{
 const s=setup();apply(s);const older=structuredClone(s.commercialEventRuns[0]);older.id='old';s.commercialEventRuns.push(older);release(s);assert.equal(completed(s,'root').size,0);assert.equal(saved(s,{eventId:'root'}).length,0);assert.equal(s.commercialEventReleases[0].runIds.length,2);
});
test('closing another campaign never revives a previously withdrawn price',()=>{
 const s=setup();s.productChannelPrices=[{...pair,regularCents:1500000,discountCents:1400000,commandId:'original'}];apply(s);
 s.commercialEvents.push({...structuredClone(event),id:'other',isParent:false});apply(s,'other-run','other');release(s);
 assert.equal(s.productChannelPrices[0].commandId,'other-run');restoreExpiredCampaignPrices(s,'2026-11-19T12:00:00Z');assert.equal(s.productChannelPrices[0].commandId,'original');assert.equal(s.productChannelPrices[0].regularCents,1500000);
});
test('SKU edits preserve withdrawn status and pending eligibility',()=>{
 const s=setup();apply(s);release(s);renameProductSkus(s,[{from:'MAX',to:'AIRPODSMAX'}],ctx);assert.equal(completed(s,'root').size,0);assert.equal(s.commercialEventReleases[0].sku,'AIRPODSMAX');assert.equal(preview(s,{eventId:'root'}).rows.length,2);
});
