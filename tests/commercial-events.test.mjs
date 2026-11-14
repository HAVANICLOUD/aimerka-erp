import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {commercialEventCommand as command,previewCommercialEvent as preview,eventTemplates} from '../lib/commercial-events.mjs';
import {recommend} from '../lib/pricing-v28.mjs';
import {applyCommand} from '../lib/commands.mjs';
import {assertPermission,permissionFor} from '../lib/access-control.mjs';
const config=JSON.parse(readFileSync(new URL('../data/pricing-config.json',import.meta.url)));
const ctx={now:'2026-11-10T12:00:00Z',actor:'QA'};
const product={sku:'A',upc:'123',name:'Laptop',brand:'APPLE',department:'COMPUTO',category:'LAPTOPS',categoryOverrides:{'Mercado Libre':'Laptops'},shippingType:'Pequeño',costCents:1200000,priceCents:2100000,status:'OK',good:3,reserved:1,safety:1};
function setup(){return {config:structuredClone(config),products:[structuredClone(product)],orders:[{id:'order',status:'reserved'}],movements:[{id:'movement'}],payments:[{id:'payment'}]};}
function event(overrides={}){return {name:'Buen Fin',startDate:'2026-11-13',endDate:'2026-11-16',markets:['Sears','Sanborns'],selection:{},rules:{mode:'margin',margin:.1},...overrides};}
function save(state,e=event(),id='save'){return command(state,{id,type:'pricing.event.save',payload:{event:e}},ctx).eventId;}
function apply(state,id,targets,extras={},commandId='apply'){return command(state,{id:commandId,type:'pricing.event.apply',payload:{eventId:id,previewFingerprint:preview(state,{eventId:id}).fingerprint,targets,...extras}},ctx);}
const target=(sku='A',market='Sears')=>({sku,market});
function unchangedOnThrow(state,fn,match){const before=structuredClone(state);assert.throws(fn,match);assert.deepEqual(state,before);}

test('margin campaign delegates exact formulas and category overrides; no preview mutation',()=>{
 const s=setup(),before=structuredClone(s),e=event({markets:['Sears','Mercado Libre']});
 const p=preview(s,{event:e});assert.deepEqual(s,before);assert.equal(p.rows.length,2);
 for(const row of p.rows){const expected=recommend(s.config,s.products[0],{channel:row.market==='Sears'?'T1 Comercios':row.market,mode:'automatico',margin:.1,retentionTreatment:'pass_through',mlType:'CLASICA',msi:'Sin MSI',t1CommissionMode:'configured',alternateMarketPrice:21000});assert.equal(row.discountCents,Math.round(expected.discount.price*100));assert.equal(row.regularCents,Math.round(expected.regular.price*100));assert.equal(row.actualMargin,expected.discount.objectiveProfit/expected.discount.price);assert.equal(row.discountCents%10000,9900);}
 assert.equal(p.rows.find(r=>r.market==='Mercado Libre').result.category,'Laptops');
});

test('discount always uses the inventory regular baseline, integer cent rounding and manual pricing',()=>{
 const s=setup();s.productChannelPrices=[{sku:'A',market:'Sears',regularCents:2500001,discountCents:2200000}];
 const p=preview(s,{event:event({rules:{mode:'discount',discount:.12345,discountBase:'channel'}})});
 for(const row of p.rows){const baseline=2100000;assert.equal(row.regularCents,baseline);assert.equal(row.discountCents,Math.round(baseline*(1-.12345)));assert.equal(row.result.mode,'precios');assert.equal(row.result.marketPrice,baseline/100);}
});

test('selection intersects brands departments SKUs and nonzero real warehouse balances',()=>{
 const s=setup();s.products.push({...product,sku:'B',brand:'OTHER'},{...product,sku:'C',department:'OTHER'},{...product,sku:'D',status:'INACTIVO'},{...product,sku:'E'});
 s.warehouses=[{id:'north',active:true},{id:'empty',active:true}];s.warehouseStock=[{warehouseId:'north',sku:'A',good:0,quarantine:1},{warehouseId:'north',sku:'B',good:5},{warehouseId:'north',sku:'C',good:5},{warehouseId:'north',sku:'D',good:5}];
 const selection={brands:['APPLE'],departments:['COMPUTO'],skus:['A','B','C','D','E'],warehouseId:'north'};
 assert.deepEqual(preview(s,{event:event({selection})}).rows.map(r=>r.sku),['A','A']);
 assert.equal(preview(s,{event:event({selection:{warehouseId:'empty'}})}).rows.length,0);
 assert.throws(()=>preview(s,{event:event({selection:{warehouseId:'invented'}})}),/almacén/);
});

test('principal fallback uses the warehouse read adapter; onlyPublished requires explicit declaration',()=>{
 const s=setup();s.products[0].channelIdentifiers={Sanborns:{publicationId:'registered'}};s.products[0].channelListings={Sears:{status:'published',publicationId:'manual'}};
 const p=preview(s,{event:event({selection:{warehouseId:'principal',onlyPublished:true}})});assert.deepEqual(p.rows.map(r=>r.market),['Sears']);assert.equal(s.warehouseStock,undefined);
});

test('civil calendar validates leap years and order; presets have names and no invented dates',()=>{
 const s=setup();for(const date of ['2026-02-29','2026-04-31','2026-13-01','2026-1-01','2026-11-10T00:00:00Z','0000-01-01'])unchangedOnThrow(s,()=>save(s,event({startDate:date})),/fechas/);
 assert.throws(()=>save(s,event({startDate:'2026-11-17'})),/fechas/);
 assert.doesNotThrow(()=>preview(s,{event:event({startDate:'2028-02-29',endDate:'2028-02-29'})}));
 assert.deepEqual(eventTemplates.map(preset=>preset.name),['Buen Fin','Hot Sale','Decembrino','Pre-navideño','Navidad','Día de la Madre','Día del Padre','Black Friday','Cyber Monday']);for(const preset of eventTemplates)assert.deepEqual(Object.keys(preset),['name']);
 const id=save(s,event({startDate:'2020-01-01',endDate:'2020-01-01'}));assert.equal(s.commercialEvents[0].id,id);assert.equal(s.pricePublicationQueue,undefined);
});

test('malformed fractions, targets and nonpositive baseline cannot become saved prices',()=>{
 for(const rules of [{mode:'margin',margin:-.1},{mode:'margin',margin:1},{mode:'discount',discount:-.1},{mode:'discount',discount:1},{mode:'margin',margin:NaN},{mode:'margin',margin:'0.1'}])assert.throws(()=>save(setup(),event({rules})));
 const s=setup();assert.throws(()=>save(s,event({markets:['Sears','Sears']})));assert.throws(()=>save(s,event({markets:['invented']})));
 s.products[0].priceCents=-1;const id=save(s);assert.equal(preview(s,{eventId:id}).rows[0].valid,false);unchangedOnThrow(s,()=>apply(s,id,[target()]),/inválido/);
});

test('competitive references are real supplied values; missing, malformed and duplicate references fail closed',()=>{
 const s=setup(),e=event({rules:{mode:'competitive',margin:.2}});const p=preview(s,{event:e});assert.ok(p.rows.every(r=>!r.valid&&/referencia/.test(r.reason)));
 const ref={sku:'A',market:'Sears',price:21000,store:'Tienda real',url:'https://example.com/product'};
 for(const r of [{...ref,url:'javascript:alert(1)'},{...ref,price:0},{...ref,store:''}])assert.throws(()=>preview(s,{event:{...e,rules:{...e.rules,marketReferences:[r]}}}));
 assert.throws(()=>preview(s,{event:{...e,rules:{...e.rules,marketReferences:[ref,ref]}}}));
 s.competitorReferences=[ref];const result=preview(s,{event:e}).rows.find(r=>r.market==='Sears');assert.equal(result.discountCents,2099900);assert.deepEqual(result.reference,ref);assert.equal(result.result.competitive.maximumAllowed,21000);
});

test('competitive below target keeps exact price, warns and is never automatically selected or green',()=>{
 const s=setup(),ref={sku:'A',market:'Sears',price:21000,store:'Real',url:'https://example.com/item'};
 const p=preview(s,{event:event({markets:['Sears'],rules:{mode:'competitive',margin:.4,marketReferences:[ref]}})}),r=p.rows[0];
 assert.equal(r.valid,true);assert.ok(r.actualMargin>0);assert.equal(r.belowTargetMargin,true);assert.equal(r.defaultSelected,false);assert.notEqual(r.traffic.color,'green');assert.match(r.reason,/margen objetivo/);assert.equal(r.discountCents,2099900);
});

test('red finite loss proposals require explicit per-SKU marketplace acknowledgement',()=>{
 const s=setup(),id=save(s,event({rules:{mode:'discount',discount:.8}}));const p=preview(s,{eventId:id});assert.ok(p.rows.every(r=>r.valid&&r.traffic.color==='red'&&!r.defaultSelected));
 unchangedOnThrow(s,()=>apply(s,id,[target()]),/explícitamente/);
 apply(s,id,[target()],{riskAcknowledgedTargets:[target()]});assert.equal(s.pricePublicationQueue[0].status,'review_required');assert.equal(s.pricePublicationQueue[0].riskAcknowledged,true);
});

test('apply validates every target before mutations and preserves unselected prices and queues',()=>{
 const s=setup();s.pricePublicationQueue=[{id:'other',sku:'A',targetMarket:'Sanborns',status:'awaiting_connection',regularCents:2100000,discountCents:2000000},{id:'old',sku:'A',targetMarket:'Sears',status:'awaiting_connection',regularCents:2100000,discountCents:2000000}];const id=save(s),before=structuredClone(s);
 for(const selected of [[target(),target('missing')],[target(),target()],[target('A','T1 Comercios')],[]])unchangedOnThrow(s,()=>apply(s,id,selected));
 unchangedOnThrow(s,()=>apply(s,id,[target()],{riskAcknowledgedTargets:[target('A','Sanborns')]}));
 const response=apply(s,id,[target()]);assert.equal(response.applied,1);assert.equal(s.productChannelPrices.length,1);assert.equal(s.productChannelPrices[0].market,'Sears');assert.equal(s.pricePublicationQueue.find(r=>r.id==='old').status,'superseded');assert.deepEqual(s.pricePublicationQueue.find(r=>r.id==='other'),before.pricePublicationQueue[0]);
 for(const k of ['products','orders','payments','movements','config'])assert.deepEqual(s[k],before[k],k);
 assert.equal(s.events[0].type,'campaign.applied');assert.equal(s.commercialEventRuns[0].targets.length,1);assert.equal(s.pricePublicationQueue[0].sourceId,s.commercialEventRuns[0].targets[0].sourceId);
});

test('fingerprint catches config, product, price, listing, warehouse, references and definition changes atomically',()=>{
 for(const mutate of [s=>s.config.parameters.priceEnding=98,s=>s.products[0].costCents++,s=>s.products[0].priceCents++,s=>s.products[0].categoryOverrides.Sears='other',s=>s.products[0].channelListings={Sears:{status:'published'}},s=>s.productChannelPrices=[{sku:'A',market:'Sears',regularCents:2200000}],s=>s.warehouseStock[0].good++,s=>s.commercialEvents[0].name='Editado',s=>s.competitorReferences[0].price++]){
  const s=setup();s.warehouses=[{id:'north',active:true}];s.warehouseStock=[{warehouseId:'north',sku:'A',good:1}];s.competitorReferences=[{sku:'A',market:'Sears',price:21000,store:'Real',url:'https://example.com/item'}];
  const id=save(s,event({markets:['Sears'],selection:{warehouseId:'north'},rules:{mode:'competitive',margin:.1}})),fingerprint=preview(s,{eventId:id}).fingerprint;mutate(s);
  unchangedOnThrow(s,()=>apply(s,id,[target()],{previewFingerprint:fingerprint}),/vista previa cambió/);
 }
});

test('canonical fingerprint ignores object property order and snapshots remain immutable after config edits',()=>{
 const s=setup(),id=save(s);const fingerprint=preview(s,{eventId:id}).fingerprint;
 s.config=Object.fromEntries(Object.entries(s.config).reverse());assert.equal(preview(s,{eventId:id}).fingerprint,fingerprint);
 apply(s,id,[target()]);const snapshot=structuredClone(s.commercialEventRuns[0]);s.config.parameters.priceEnding=17;s.products[0].costCents=1;assert.deepEqual(s.commercialEventRuns[0],snapshot);
 const old=structuredClone(s.commercialEvents[0]);save(s,{...old,name:'Revisión'},'edit');assert.equal(s.commercialEvents[0].revision,2);assert.equal(s.commercialEvents[0].history[0].name,old.name);
});

test('full catalog supports 327 by 7 and new products; rejects only beyond 2000 selected products',()=>{
 const s=setup();s.products=Array.from({length:327},(_,i)=>({...product,sku:'SKU'+i}));const markets=['Sears','Sanborns','Coppel','Mercado Libre','Liverpool','Tienda Nube','Elektra'];
 const p=preview(s,{event:event({markets})});assert.equal(p.rows.length,2289);assert.equal(p.summary.total,2289);assert.ok(p.rows.every(r=>r.result));
 s.products.push({...product,sku:'NEW'});assert.equal(preview(s,{event:event({markets})}).rows.length,328*7);
 s.products=Array.from({length:2000},(_,i)=>({...product,sku:'SKU'+i}));assert.equal(preview(s,{event:event({markets:['Sears']})}).rows.length,2000);
 s.products.push({...product,sku:'OVERFLOW'});assert.throws(()=>preview(s,{event:event({markets:['Sears']})}),/2000/);
 assert.equal(preview(s,{event:event({markets:['Sears'],selection:{skus:['OVERFLOW']}})}).rows.length,1);
});

test('campaign permissions follow parent pricing gate, denying readers, inventory and finance roles',()=>{
 for(const type of ['pricing.event.save','pricing.event.apply']){assert.equal(permissionFor(type),'pricing');for(const permissions of [[],['inventory'],['finance']])assert.throws(()=>assertPermission({active:true,permissions},type),/rol/);assert.doesNotThrow(()=>assertPermission({active:true,permissions:['pricing']},type));assert.throws(()=>assertPermission({active:false,permissions:['pricing']},type),/suspendido/);}
});

test('definition revisions stay bounded while all application and proposal history is preserved',()=>{
 const s=setup(),id=save(s,event({markets:['Sears']}));for(let i=0;i<24;i++)save(s,{...s.commercialEvents[0],name:'Version '+i},'save'+i);assert.equal(s.commercialEvents[0].history.length,20);
 for(let i=0;i<12;i++){const campaignId=i===0?id:save(s,event({markets:['Sears']}),'new-campaign'+i);apply(s,campaignId,[target()],{},'apply'+i);}assert.equal(s.commercialEventRuns.length,12);assert.equal(s.pricePublicationQueue.length,12);assert.equal(s.commercialEventRuns.at(-1).id,'apply0');assert.equal(s.pricePublicationQueue.at(-1).runId,'apply0');assert.equal(s.productChannelPriceHistory.length,11);assert.equal(s.commercialEventRuns[0].targets[0].baselineCents,s.products[0].priceCents);
});


test('invalid cost, commission and rounded-zero discount are not overridable by risk acknowledgement',()=>{
 for(const mutate of [s=>s.products[0].costCents=-1,s=>s.products[0].costCents=NaN,s=>s.config.commissions['T1 Comercios'][0].rate=0,s=>s.products[0].priceCents=1]){
  const s=setup();mutate(s);const id=save(s,event({markets:['Sears'],rules:{mode:'discount',discount:.9}}));
  assert.equal(preview(s,{eventId:id}).rows[0].valid,false);
  unchangedOnThrow(s,()=>apply(s,id,[target()],{riskAcknowledgedTargets:[target()]}),/inválido/);
 }
});


test('only valid green rows are selected by default; yellow requires deliberate selection',()=>{
 const s=setup(),e=event({markets:['Sears']});
 const green=preview(s,{event:e}).rows[0];assert.equal(green.valid,true);assert.equal(green.traffic.color,'green');assert.equal(green.defaultSelected,true);
 s.config.pricingSignals={minCashMargin:.5,peerCashRatio:.5};const id=save(s,e);
 const yellow=preview(s,{eventId:id}).rows[0];assert.equal(yellow.traffic.color,'yellow');assert.equal(yellow.belowTargetMargin,false);assert.equal(yellow.defaultSelected,false);
 assert.equal(apply(s,id,[target()]).applied,1);
});

test('margin mode preserves nearest-99 rounding below target without a below-target warning',()=>{
 const s=setup();s.products[0].costCents=1200500;
 const row=preview(s,{event:event({markets:['Sears']})}).rows[0];
 const expected=recommend(s.config,s.products[0],{channel:'T1 Comercios',mode:'automatico',margin:.1});
 assert.equal(row.discountCents,Math.round(expected.discount.price*100));assert.ok(row.actualMargin<.1);assert.equal(row.belowTargetMargin,false);
 assert.equal(row.warnings.some(w=>w.includes('margen objetivo')),false);assert.equal(row.traffic.color,'green');assert.equal(row.defaultSelected,true);
});

test('campaign writes preserve preexisting global audit and price history beyond prior truncation limits',()=>{
 const s=setup();s.events=Array.from({length:1005},(_,i)=>({id:'legacy-event-'+i,type:'inventory.received'}));
 s.productChannelPriceHistory=Array.from({length:5005},(_,i)=>({sku:'OTHER-'+i,market:'Liverpool',revision:i}));
 const events=structuredClone(s.events),history=structuredClone(s.productChannelPriceHistory);
 const id=save(s);apply(s,id,[target()]);
 assert.deepEqual(s.events.slice(2),events);assert.deepEqual(s.productChannelPriceHistory,history);
});

// The server owns authentication. Exercise its permission gate before dispatching the real command.
function dispatch(state,action,permissions=['pricing']){
 assertPermission({active:true,permissions},action.type);return applyCommand(state,action,ctx);
}
test('parent command dispatch saves channel metadata and campaigns under pricing permission atomically',()=>{
 const s=setup(),inventoryBefore=structuredClone({orders:s.orders,movements:s.movements,payments:s.payments,product:s.products[0]});
 const profile={title:'Título Sears',description:'Descripción comercial',categoryId:'external-category',categoryName:'Categoría comercial',condition:'Nuevo',warranty:'12 meses',sellerSku:'SELLER-A',publicationId:'PUB-A',publicationStatus:'published',attributes:[{name:'Color',value:'Azul'}]};
 const profileAction={id:'profile-save',type:'pricing.productChannel.save',payload:{sku:'A',market:'Sears',profile}};
 const eventAction={id:'event-save',type:'pricing.event.save',payload:{event:event({selection:{onlyPublished:true}})}};
 for(const action of [profileAction,eventAction,{id:'event-apply',type:'pricing.event.apply',payload:{}}]){
  assert.equal(permissionFor(action.type),'pricing');for(const permissions of [[],['inventory'],['finance']])unchangedOnThrow(s,()=>dispatch(s,action,permissions),/rol/);
 }
 assert.equal(dispatch(s,profileAction).ok,true);
 assert.equal(s.products[0].channelProfiles.Sears.title,profile.title);assert.equal(s.products[0].channelProfiles.Sears.categoryName,profile.categoryName);
 assert.deepEqual(s.products[0].channelProfiles.Sears.attributes,profile.attributes);assert.equal(s.products[0].channelIdentifiers.Sears.publicationId,'PUB-A');
 assert.deepEqual(s.products[0].categoryOverrides,inventoryBefore.product.categoryOverrides);
 const saved=dispatch(s,eventAction);assert.equal(saved.id,saved.eventId);assert.equal(saved.event.id,saved.eventId);
 const p=preview(s,{eventId:saved.eventId});assert.deepEqual(p.rows.map(r=>r.market),['Sears']);
 const action={id:'event-apply',type:'pricing.event.apply',payload:{eventId:saved.eventId,previewFingerprint:p.fingerprint,targets:[target()]}};
 unchangedOnThrow(s,()=>dispatch(s,{...action,payload:{...action.payload,targets:[target(),target('missing')]}}),/inválido/);
 const profileBefore=structuredClone(s.products[0]);assert.equal(dispatch(s,action).applied,1);assert.deepEqual(s.products[0],profileBefore);
 assert.equal(s.pricePublicationQueue[0].status,'awaiting_connection');assert.equal(s.events[0].type,'campaign.applied');
 for(const k of ['orders','movements','payments'])assert.deepEqual(s[k],inventoryBefore[k]);
 const before=structuredClone(s);unchangedOnThrow(s,()=>dispatch(s,{...profileAction,id:'bad-profile',payload:{...profileAction.payload,profile:{title:'Changed',publicationStatus:'invented'}}}),/estado/);assert.deepEqual(s,before);
});

test('profile publication status integration includes only exact published and invalidates previous preview',()=>{
 const s=setup(),id=save(s,event({markets:['Sears'],selection:{onlyPublished:true}}));
 for(const status of ['unknown','not_published','paused','pending_approval','published']){
  const old=preview(s,{eventId:id});
  dispatch(s,{id:'profile-'+status,type:'pricing.productChannel.save',payload:{sku:'A',market:'Sears',profile:{publicationStatus:status,publicationId:'PUB-A'}}});
  const p=preview(s,{eventId:id});assert.equal(p.rows.length,status==='published'?1:0);
  if(status==='published')unchangedOnThrow(s,()=>dispatch(s,{id:'stale-profile',type:'pricing.event.apply',payload:{eventId:id,previewFingerprint:old.fingerprint,targets:[target()]}}),/vista previa cambió/);
 }
});


test('warehouse filter includes each nonzero stock pool but excludes zero balances and other warehouses',()=>{
 const s=setup(),pools=['good','reserved','quarantine','damaged','safety'];
 s.products=pools.map(pool=>({...product,sku:pool,good:10}));s.products.push({...product,sku:'ZERO',good:10},{...product,sku:'OTHER',good:10},{...product,sku:'MISSING',good:10});
 s.warehouses=[{id:'north',active:true},{id:'south',active:true}];
 s.warehouseStock=pools.map(pool=>({warehouseId:'north',sku:pool,...Object.fromEntries(pools.map(p=>[p,p===pool?1:0]))}));
 s.warehouseStock.push({warehouseId:'north',sku:'ZERO',good:0,reserved:0,quarantine:0,damaged:0,safety:0},{warehouseId:'south',sku:'OTHER',good:5});
 const before=structuredClone(s),e=event({markets:['Sears'],selection:{warehouseId:'north'}});
 assert.deepEqual(preview(s,{event:e}).rows.map(r=>r.sku).sort(),pools.slice().sort());assert.deepEqual(s,before);
 assert.equal(preview(s,{event:event({markets:['Sears']})}).rows.length,8);
 const fallback=setup();fallback.products[0]={...product,good:0,reserved:0,safety:0};
 assert.equal(preview(fallback,{event:event({selection:{warehouseId:'principal'}})}).rows.length,0);
 fallback.products[0].damaged=1;assert.equal(preview(fallback,{event:event({selection:{warehouseId:'principal'}})}).rows.length,2);assert.equal(fallback.warehouseStock,undefined);
});

test('applying preserves every preexisting run snapshot and superseded campaign proposal',()=>{
 const s=setup(),id=save(s,event({markets:['Sears']}));
 s.commercialEventRuns=Array.from({length:25},(_,i)=>({id:'old-run-'+i,eventId:id,targets:[{sku:'A',market:'Sears',regularCents:1000000+i}],configSnapshot:{version:i}}));
 s.pricePublicationQueue=Array.from({length:25},(_,i)=>({id:'old-proposal-'+i,source:'commercial-event',runId:'old-run-'+i,sku:'A',targetMarket:'Sears',status:'superseded',regularCents:2100000,discountCents:2000000}));
 const runs=structuredClone(s.commercialEventRuns),queue=structuredClone(s.pricePublicationQueue);
 apply(s,id,[target()],{},'new-application');
 assert.equal(s.commercialEventRuns.length,26);assert.deepEqual(s.commercialEventRuns.slice(1),runs);assert.deepEqual(s.pricePublicationQueue.slice(1),queue);
 unchangedOnThrow(s,()=>apply(s,id,[target()],{},'old-run-24'),/ya fue registrada/);
});
