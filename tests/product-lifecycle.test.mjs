import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {applyProductLifecycle,discontinuationEligibility,isDiscontinued,isHidden,catalogVisible,commerciallySelectable} from '../lib/product-lifecycle.mjs';
import {applyCommand} from '../lib/commands.mjs';
import {available} from '../lib/inventory-v28.mjs';
import {recommend} from '../lib/pricing-v28.mjs';
import {previewCommercialEvent} from '../lib/commercial-events.mjs';
import {permissionFor,assertPermission} from '../lib/access-control.mjs';
const config=JSON.parse(fs.readFileSync(new URL('../data/pricing-config.json',import.meta.url)));
const ctx={workspace:'v43',actor:'QA',now:'2026-11-10T12:00:00Z'};
const state=()=>({products:[{sku:'ABC',upc:'195949543906',name:'AirPods',brand:'Apple',category:'AUDIFONOS',categories:{'T1 Comercios':'Todas las categorías'},status:'OK',good:0,reserved:0,quarantine:0,damaged:0,safety:2,costCents:10000,priceCents:20000}],orders:[{id:'OLD',number:'KEEP',sku:'ABC',stockMode:'historical',status:'delivered',commercialStatus:'Activa',qty:1,unitPriceCents:20000,reconciliation:{depositCents:17200}}],purchases:[{id:'OLD-P',items:[{sku:'ABC'}]}],documents:[{id:'PDF',lineLinks:[{sku:'ABC'}]}],movements:[{sku:'ABC',delta:-1}],events:[],config:structuredClone(config)});
const run=(s,type,payload)=>applyCommand(s,{id:crypto.randomUUID(),type,workspace:'v43',payload:{sku:'ABC',reason:'Fin de comercialización',...payload}},ctx);
test('zero-stock discontinue/hide preserves every historical association and monetary value',()=>{
 const s=state(),before=structuredClone(s);run(s,'inventory.product.discontinue',{hide:true});
 assert.equal(isDiscontinued(s.products[0]),true);assert.equal(isHidden(s.products[0]),true);assert.equal(catalogVisible(s.products[0]),false);assert.equal(commerciallySelectable(s.products[0]),false);assert.equal(available(s.products[0]),0);
 for(const key of ['orders','purchases','documents','movements','config'])assert.deepEqual(s[key],before[key]);
 for(const key of Object.keys(before.products[0]))if(key!=='status')assert.deepEqual(s.products[0][key],before.products[0][key]);
 run(s,'inventory.product.visibility',{hidden:false});assert.equal(catalogVisible(s.products[0]),true);assert.equal(commerciallySelectable(s.products[0]),false);
 run(s,'inventory.product.reactivate',{});assert.equal(commerciallySelectable(s.products[0]),true);assert.equal(s.products[0].lifecycle.history.length,3);assert.equal(s.products[0].sku,'ABC');assert.equal(s.products[0].upc,before.products[0].upc);
});
test('each nonzero physical pool, reservation, deficit and offsetting warehouse balance blocks retirement atomically',()=>{
 for(const pool of ['good','reserved','quarantine','damaged'])for(const n of [1,-1,NaN]){
  const s=state();s.products[0][pool]=n;const before=structuredClone(s);assert.equal(discontinuationEligibility(s,s.products[0]).eligible,false);assert.throws(()=>run(s,'inventory.product.discontinue',{hide:true}),/cero/);assert.deepEqual(s,before);
 }
 const s=state();s.warehouseStock=[{warehouseId:'a',sku:'ABC',good:2},{warehouseId:'b',sku:'ABC',good:-2}];const before=structuredClone(s);assert.throws(()=>run(s,'inventory.product.discontinue',{hide:true}),/almacenes/);assert.deepEqual(s,before);
});
test('lifecycle validates reason, flags, missing SKU and protects the dedicated reactivation path',()=>{
 for(const payload of [{reason:''},{hide:'true'},{reason:'x'.repeat(1001)},{sku:'missing'}]){const s=state(),before=structuredClone(s);assert.throws(()=>run(s,'inventory.product.discontinue',payload));assert.deepEqual(s,before);}
 const s=state();assert.throws(()=>run(s,'inventory.product.visibility',{hidden:true}),/descontinuados/);run(s,'inventory.product.discontinue',{hide:true});
 const before=structuredClone(s);for(const status of ['OK',undefined])assert.throws(()=>run(s,'product.save',{originalSku:'ABC',product:{...s.products[0],status}}),/Reactiva/);assert.deepEqual(s,before);
});
test('archives are excluded from new pricing/campaigns, but historical sale notes and refund still work',()=>{
 const s=state();run(s,'inventory.product.discontinue',{hide:true});
 assert.equal(recommend(s.config,s.products[0],{channel:'T1 Comercios'}).valid,false);
 assert.throws(()=>run(s,'pricing.publication.prepare',{productSku:'ABC',targets:['Sears'],input:{mode:'automatico',margin:.1}}),/activo/);
 const e={name:'Campaña',startDate:'2026-11-10',endDate:'2026-11-20',markets:['Sears'],selection:{},rules:{mode:'margin',margin:.1}};assert.equal(previewCommercialEvent(s,{event:e}).rows.length,0);
 run(s,'sale.note',{orderId:'OLD',comments:'Historial conservado'});assert.equal(s.orders[0].comments,'Historial conservado');
 run(s,'sale.refund',{orderId:'OLD',amountCents:20000,reason:'Reembolso histórico'});assert.equal(s.orders[0].refundCents,20000);assert.equal(s.orders[0].reconciliation.depositCents,17200);assert.equal(isHidden(s.products[0]),true);
});
test('a real return of an archived historical sale makes received stock visible and retains its order',()=>{
 const s=state();s.orders[0].returnStatus='requested';run(s,'inventory.product.discontinue',{hide:true});
 run(s,'sale.return_receive',{orderId:'OLD',confirmPhysical:true});assert.equal(s.products[0].quarantine,1);assert.equal(isHidden(s.products[0]),false);assert.equal(isDiscontinued(s.products[0]),false);assert.equal(s.orders[0].id,'OLD');assert.ok(s.events.some(e=>e.type==='inventory.product.autoReactivate'));
});
test('a new physical receipt reveals the archived product and recalculates its prepared stock quantity',()=>{
 const s=state();run(s,'inventory.product.discontinue',{hide:true});
 run(s,'inventory.adjust',{pool:'good',quantity:5,reason:'Entrada física comprobada'});
 assert.equal(isHidden(s.products[0]),false);assert.equal(available(s.products[0]),3);assert.equal(s.stockSyncQueue.find(r=>r.sku==='ABC').availableQty,3);
});
test('only inventory permission can retire, hide, and reactivate products',()=>{
 for(const type of ['inventory.product.discontinue','inventory.product.visibility','inventory.product.reactivate']){assert.equal(permissionFor(type),'inventory');for(const permissions of [[],['pricing'],['finance_read']])assert.throws(()=>assertPermission({active:true,permissions},type));assert.doesNotThrow(()=>assertPermission({active:true,permissions:['inventory']},type));}
});
