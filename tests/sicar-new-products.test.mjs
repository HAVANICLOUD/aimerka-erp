import test from 'node:test';import assert from 'node:assert/strict';import {importSicarNewProducts} from '../lib/sicar-new-products.mjs';
const ctx={actor:'owner@test',ownerEmail:'owner@test',workspace:'v43',now:'2026-11-14T06:00:00Z'};
const row={sku:'APPLEIPADNEW',upc:'195949976193',codes:['195949976193','APPLEIPADNEW'],name:'iPad Air',brand:'Apple',category:'TABLET',department:'APPLE',unit:'PIEZA',satCode:'43211509',averageCostMxn:16784,priceCents:2679900,quantity:0,sourceRow:329,images:[]};
const command=(products=[row])=>({id:'sicar-new-import-test',type:'inventory.importSicarNewProducts',payload:{manifest:{format:'AIMERKA-SICAR-NEW-1',sourceHash:'a'.repeat(64),fileName:'source.xlsx',products}}});
const state=()=>({config:{},products:[{sku:'OLD',upc:'12345678',good:5,reserved:2,costCents:10000,averageCostMxn:100}],orders:[{id:'sale',sku:'OLD'}],purchases:[{id:'buy',items:[{sku:'OLD'}]}],commercialEventRuns:[{id:'run',targets:[{sku:'OLD'}]}],settlementLedger:{keep:true},movements:[{id:'old'}]});
test('new SICAR records retain zero stock, alphanumeric SKU, UPC, precise costs and SAT data while preserving other modules',()=>{
 const s=state(),before=structuredClone(s);const result=importSicarNewProducts(s,command(),ctx);assert.deepEqual(result.added,['APPLEIPADNEW']);const p=s.products[0];assert.equal(p.sku,row.sku);assert.equal(p.upc,row.upc);assert.equal(p.averageCostMxn,16784);assert.equal(p.good,0);assert.equal(p.reserved,0);assert.equal(p.satCode,row.satCode);assert.equal(p.source,'SICAR');assert.ok(p.skuAliases.includes(row.upc));
 for(const key of ['orders','purchases','commercialEventRuns','settlementLedger','movements'])assert.deepEqual(s[key],before[key]);assert.deepEqual(s.products.find(p=>p.sku==='OLD'),before.products[0]);
 const again=importSicarNewProducts(s,command(),ctx);assert.equal(again.added.length,0);assert.equal(s.products.length,2);
});
test('a failed record rolls back the entire import, and only the owner may perform it',()=>{
 const s=state(),before=structuredClone(s);assert.throws(()=>importSicarNewProducts(s,command([row,{...row,sku:'BAD',upc:'',codes:['BAD'],quantity:1}]),ctx),/stock cero/);assert.deepEqual(s,before);assert.throws(()=>importSicarNewProducts(s,command(),{...ctx,actor:'other@test'}),/propietario/);assert.deepEqual(s,before);
});
test('unverified image references cannot be linked to imported products',()=>{
 const s=state(),before=structuredClone(s);assert.throws(()=>importSicarNewProducts(s,command([{...row,images:[{id:'fake',primary:true}]}]),ctx),/cargar la imagen/);assert.deepEqual(s,before);
});
