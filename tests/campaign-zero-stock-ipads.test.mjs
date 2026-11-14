import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {previewCommercialEvent,commercialEventProducts} from '../lib/commercial-events.mjs';
const config=JSON.parse(readFileSync(new URL('../data/pricing-config.json',import.meta.url)));
const skus=['IPDAIRAPP13M3256GBAZ','IPDAIRAPP13M3512GBAZ','IPDAIRAPP13M3256GBBE','IPDAIRPP13M3128GBMOR','IPDAIRAPP13M3128GBBE','IPDAIRAPP13M3256GBGE'];
const product=(sku,extra={})=>({sku,name:'iPad Air Apple 13 M3 '+sku,brand:'Apple',department:'APPLE',category:'TABLET',status:'OK',good:0,reserved:0,safety:0,quarantine:0,damaged:0,priceCents:2499900,costCents:1900000,shippingType:'Pequeño',...extra});
const event={id:'apple',name:'Buen Fin Tienda Nube Ding Dong Apple',startDate:'2026-11-13',endDate:'2026-11-17',markets:['Tienda Nube'],selection:{brands:['Apple'],departments:[],skus:[],warehouseId:'principal',onlyAvailable:false,onlyPublished:false},rules:{mode:'discount',discount:.1,margin:.1}};
function state(){return {config:structuredClone(config),products:skus.map(sku=>product(sku)),warehouseStock:[{warehouseId:'principal',sku:'old',good:2}],commercialEvents:[structuredClone(event)],commercialEventRuns:[],orders:[],purchases:[]};}
test('regression: all six new zero-stock iPads remain in saved Apple lot despite principal warehouse and no balance rows',()=>{
 const s=state(),before=structuredClone(s),rows=previewCommercialEvent(s,{eventId:'apple'}).rows;assert.deepEqual(rows.map(r=>r.sku).sort(),skus.slice().sort());assert.equal(rows.length,6);assert.ok(rows.every(r=>r.regularCents===2499900));assert.deepEqual(s,before);
 assert.deepEqual(commercialEventProducts(s,event.selection).map(p=>p.sku).sort(),skus.slice().sort());
});
test('onlyAvailable true restricts selected warehouse and never silently uses another warehouse stock',()=>{
 const s=state();s.products.push(product('STOCK',{good:3}),product('OTHER',{good:4}));s.warehouseStock.push({warehouseId:'principal',sku:'STOCK',good:3,reserved:0,safety:0},{warehouseId:'secondary',sku:'OTHER',good:4});s.commercialEvents[0].selection.onlyAvailable=true;
 assert.deepEqual(previewCommercialEvent(s,{eventId:'apple'}).rows.map(r=>r.sku),['STOCK']);s.commercialEvents[0].selection.warehouseId='';assert.deepEqual(previewCommercialEvent(s,{eventId:'apple'}).rows.map(r=>r.sku),['OTHER','STOCK']);
});
test('all catalogue without stock filter respects brand department lifecycle explicit selection and saved campaign targets',()=>{
 const s=state();s.products[0].brand=' APPLE ';s.products.push(product('OTHER-BRAND',{brand:'Dyson'}),product('OTHER-DEPT',{department:'Accesorios'}),product('HIDDEN',{lifecycle:{hidden:true}}));s.commercialEvents[0].selection.departments=['apple'];s.commercialEventRuns=[{id:'saved',eventId:'apple',targets:[{sku:skus[0],market:'Tienda Nube',regularCents:2499900,discountCents:2200000}]}];assert.deepEqual(previewCommercialEvent(s,{eventId:'apple'}).rows.map(r=>r.sku).sort(),skus.slice(1).sort());
 s.commercialEvents[0].selection.skus=[skus[2]];assert.deepEqual(previewCommercialEvent(s,{eventId:'apple'}).rows.map(r=>r.sku),[skus[2]]);assert.equal(commercialEventProducts(s,s.commercialEvents[0].selection,{ignoreSkus:true}).length,6);
});
test('principal fallback includes zero balances without creating warehouse records or inventory movements',()=>{
 const s=state();delete s.warehouseStock;const before=structuredClone(s);assert.equal(previewCommercialEvent(s,{eventId:'apple'}).rows.length,6);assert.deepEqual(s,before);
});
