import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {migrateBuenFinFamily,restoreExpiredCampaignPrices,backfillCampaignRestorations} from '../lib/campaign-lifecycle.mjs';
import {commercialEventCommand as command,previewCommercialEvent,commercialEventPriceRows,commercialCampaignCoverage} from '../lib/commercial-events.mjs';
const config=JSON.parse(readFileSync(new URL('../data/pricing-config.json',import.meta.url)));
const ctx={now:'2026-11-13T18:00:00Z',actor:'QA'};
const event=(name,selection={})=>({name,startDate:'2026-11-13',endDate:'2026-11-16',markets:['Tienda Nube'],selection,rules:{mode:'discount',discount:.25,margin:0,transfer:{enabled:true,discount:.1,commissionRate:.0007}}});
function setup(){return {config:structuredClone(config),products:['Apple','Consolas','Other'].map((brand,i)=>({sku:'SKU'+i,upc:'upc'+i,name:brand,brand,department:'Audio',costCents:10000,priceCents:1000000,good:1,reserved:0,safety:0,shippingType:'Pequeño'}))};}
function save(s,e,id){return command(s,{id,type:'pricing.event.save',payload:{event:e}},ctx).eventId;}
function apply(s,id,op){const p=previewCommercialEvent(s,{eventId:id});command(s,{id:op,type:'pricing.event.apply',payload:{eventId:id,previewFingerprint:p.fingerprint,targets:p.rows.filter(r=>r.valid).map(r=>({sku:r.sku,market:r.market}))}},ctx);}
test('the requested two named lots link idempotently to Buen Fin 2026 without altering saved snapshots',()=>{
 const s=setup(),a=save(s,event('Buen Fin Tienda Nube DingDong Apple',{brands:['Apple']}),'a'),b=save(s,event('Buen Fin Tienda Nube Consolas y Videojuegos',{brands:['Consolas']}),'b');
 apply(s,a,'run-a');apply(s,b,'run-b');const history=structuredClone(s.commercialEventRuns),products=structuredClone(s.products);
 assert.equal(migrateBuenFinFamily(s,{...ctx,requestId:'migration'}),true);const root=s.commercialEvents.find(e=>e.isParent);assert.equal(root.name,'Buen Fin 2026');assert.equal(s.commercialEvents.find(e=>e.id===a).parentId,root.id);assert.equal(s.commercialEvents.find(e=>e.id===b).parentId,root.id);
 assert.equal(previewCommercialEvent(s,{eventId:root.id}).rows.length,1);assert.equal(commercialEventPriceRows(s,{eventId:root.id}).length,2);assert.deepEqual(s.commercialEventRuns,history);assert.deepEqual(s.products,products);assert.equal(migrateBuenFinFamily(s,{...ctx,requestId:'again'}),false);
 assert.equal(commercialCampaignCoverage(s,root.id)[0].pending,1);apply(s,root.id,'root-remaining');assert.equal(commercialCampaignCoverage(s,root.id)[0].complete,true);
});
test('parent name creates a reusable root and sibling lots cannot recalculate already assigned pairs',()=>{
 const s=setup(),a=save(s,{...event('Apple',{brands:['Apple']}),parentName:'Hot Sale 2027'},'a');apply(s,a,'apple');const root=s.commercialEvents.find(e=>e.isParent);
 const b=save(s,{...event('All'),parentId:root.id},'b');assert.equal(previewCommercialEvent(s,{eventId:b}).rows.length,2);assert.equal(s.commercialEvents.filter(e=>e.isParent).length,1);
 const empty=setup();empty.products.forEach(p=>{p.good=0;});empty.commercialEvents=[root];assert.equal(commercialCampaignCoverage(empty,root.id)[0].complete,false);
});
test('closure is inclusive in Mexico, restores exact original assignments, keeps history, and is idempotent',()=>{
 const s=setup();const original={sku:'SKU0',market:'Tienda Nube',regularCents:1200000,discountCents:1100000,commandId:'original',revision:3};s.productChannelPrices=[structuredClone(original)];
 const id=save(s,event('Close',{skus:['SKU0']}),'close');apply(s,id,'sale');const history=structuredClone(s.commercialEventRuns),products=structuredClone(s.products);
 assert.equal(restoreExpiredCampaignPrices(s,'2026-11-17T05:59:59Z'),false);assert.equal(restoreExpiredCampaignPrices(s,'2026-11-17T06:00:00Z'),true);
 const restored=s.productChannelPrices[0];assert.equal(restored.regularCents,original.regularCents);assert.equal(restored.discountCents,original.discountCents);assert.equal(restored.commandId,'original');assert.equal(s.campaignPriceRestorations[0].status,'restored');assert.equal(s.pricePublicationQueue[0].source,'campaign-closure');assert.deepEqual(s.commercialEventRuns,history);assert.deepEqual(s.products,products);assert.equal(restoreExpiredCampaignPrices(s,'2026-11-18T12:00:00Z'),false);
});
test('closure leaves subsequent manual prices intact and unwinds overlapping expired campaigns',()=>{
 const s=setup(),a=save(s,event('A',{skus:['SKU0']}),'a');apply(s,a,'run-a');const b=save(s,event('B',{skus:['SKU0']}),'b');apply(s,b,'run-b');restoreExpiredCampaignPrices(s,'2026-11-18T12:00:00Z');assert.equal(s.productChannelPrices.length,0);assert.equal(s.pricePublicationQueue[0].regularCents,s.products[0].priceCents);
 const manual=setup(),id=save(manual,event('manual',{skus:['SKU0']}),'m');apply(manual,id,'run-m');manual.productChannelPrices[0].commandId='manual-new';manual.productChannelPrices[0].discountCents=999000;restoreExpiredCampaignPrices(manual,'2026-11-18T12:00:00Z');assert.equal(manual.productChannelPrices[0].discountCents,999000);
});
test('existing runs acquire closure backups without changing their original snapshots',()=>{
 const s=setup(),id=save(s,event('Legacy',{skus:['SKU0']}),'legacy');apply(s,id,'old');delete s.campaignPriceRestorations;const snapshot=structuredClone(s.commercialEventRuns);assert.equal(backfillCampaignRestorations(s,ctx.now),true);assert.equal(backfillCampaignRestorations(s,ctx.now),false);assert.deepEqual(s.commercialEventRuns,snapshot);
});

test('expired campaigns cannot assign new prices without extending their validity',()=>{
 const s=setup(),id=save(s,event('Expired'),'expired'),preview=previewCommercialEvent(s,{eventId:id}),before=structuredClone(s);
 assert.throws(()=>command(s,{id:'too-late',type:'pricing.event.apply',payload:{eventId:id,previewFingerprint:preview.fingerprint,targets:[{sku:'SKU0',market:'Tienda Nube'}]}},{...ctx,now:'2026-11-18T18:00:00Z'}),/ya cerró/);assert.deepEqual(s,before);
});
