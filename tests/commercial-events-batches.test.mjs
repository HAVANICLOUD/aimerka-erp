import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {commercialEventCommand as command,previewCommercialEvent as preview,commercialEventPriceRows as exportRows} from '../lib/commercial-events.mjs';
import {applyCommand} from '../lib/commands.mjs';
import {permissionFor,assertPermission} from '../lib/access-control.mjs';
const config=JSON.parse(readFileSync(new URL('../data/pricing-config.json',import.meta.url)));
const ctx={now:'2026-11-13T18:00:00Z',actor:'QA'};
const event={name:'Buen Fin',startDate:'2026-11-13',endDate:'2026-11-16',markets:['Sears'],selection:{brands:['Apple']},rules:{mode:'discount',discount:.25,margin:0}};
function setup(){return {config:structuredClone(config),products:['Apple','Dyson'].map((brand,i)=>({sku:'SKU'+i,upc:'123456789'+i,name:'Producto '+brand,brand,department:'Audio',category:'Todas las categorías',shippingType:'Pequeño',costCents:10000,priceCents:1000000,good:1})),orders:[{id:'keep'}],movements:[{id:'keep'}]};}
function save(s,e,id){return command(s,{id,type:'pricing.event.save',payload:{event:e}},ctx).eventId;}
function apply(s,id,op){const p=preview(s,{eventId:id});return command(s,{id:op,type:'pricing.event.apply',payload:{eventId:id,previewFingerprint:p.fingerprint,targets:p.rows.filter(r=>r.valid).map(r=>({sku:r.sku,market:r.market}))}},ctx);}
test('one campaign retains different brand/discount batches and exports exact saved snapshots',()=>{
 const s=setup(),id=save(s,event,'save1');apply(s,id,'batch25');
 const first=structuredClone(s.commercialEventRuns[0]);
 save(s,{...s.commercialEvents[0],selection:{brands:['Dyson']},rules:{mode:'discount',discount:.1,margin:0}},'save2');apply(s,id,'batch10');
 assert.equal(s.commercialEventRuns.length,2);assert.deepEqual(s.commercialEventRuns[1],first);
 assert.equal(exportRows(s,{runId:'batch25'})[0].discountCents,750000);
 assert.equal(exportRows(s,{runId:'batch25'})[0].rules.discount,.25);
 assert.equal(exportRows(s,{runId:'batch10'})[0].discountCents,900000);
 assert.equal(exportRows(s,{eventId:id}).length,2);
 s.products[0].priceCents=999999;s.products[0].name='Changed';s.products[0].upc='Changed';s.config={};
 assert.equal(exportRows(s,{runId:'batch25'})[0].name,'Producto Apple');assert.equal(exportRows(s,{runId:'batch25'})[0].upc,'1234567890');assert.equal(exportRows(s,{runId:'batch25'})[0].discountCents,750000);
});
test('consolidated export selects newest SKU/channel before applying the green filter',()=>{
 const s={commercialEventRuns:[{id:'new',eventId:'e',targets:[{sku:'A',market:'Sears',discountCents:500,traffic:{color:'yellow'}}]},{id:'old',eventId:'e',targets:[{sku:'A',market:'Sears',discountCents:700,traffic:{color:'green'}},{sku:'B',market:'Sears',discountCents:800,traffic:{color:'green'}}]}]};
 const before=structuredClone(s);assert.equal(exportRows(s,{eventId:'e'}).length,2);assert.equal(exportRows(s,{eventId:'e'})[0].discountCents,500);assert.deepEqual(exportRows(s,{eventId:'e',greenOnly:true}).map(r=>r.sku),['B']);assert.equal(exportRows(s,{runId:'old',greenOnly:true}).length,2);assert.deepEqual(s,before);
 assert.throws(()=>exportRows(s,{runId:'missing'}),/No hay/);assert.throws(()=>exportRows(s,{}),/Selecciona/);
});
test('deleting is recoverable, blocks editing/application, and preserves all saved prices and history',()=>{
 const s=setup(),id=save(s,event,'save');apply(s,id,'batch');
 const preserved=structuredClone({runs:s.commercialEventRuns,prices:s.productChannelPrices,queue:s.pricePublicationQueue,products:s.products,orders:s.orders,movements:s.movements});
 applyCommand(s,{id:'delete',type:'pricing.event.delete',payload:{eventId:id,expectedRevision:1}},ctx);
 assert.ok(s.commercialEvents[0].deletedAt);assert.throws(()=>preview(s,{eventId:id}),/no encontrada/);
 assert.throws(()=>save(s,{...event,id},'bad'),/Recupera/);
 assert.equal(exportRows(s,{eventId:id})[0].discountCents,750000);
 assert.deepEqual({runs:s.commercialEventRuns,prices:s.productChannelPrices,queue:s.pricePublicationQueue,products:s.products,orders:s.orders,movements:s.movements},preserved);
 assert.throws(()=>applyCommand(s,{id:'stale',type:'pricing.event.restore',payload:{eventId:id,expectedRevision:1}},ctx),/cambió/);
 command(s,{id:'restore',type:'pricing.event.restore',payload:{eventId:id,expectedRevision:2}},ctx);assert.equal(s.commercialEvents[0].deletedAt,undefined);assert.equal(preview(s,{eventId:id}).rows.length,1);
 for(const type of ['pricing.event.delete','pricing.event.restore']){assert.equal(permissionFor(type),'pricing');assert.throws(()=>assertPermission({active:true,permissions:['read']},type),/rol/);}
});
