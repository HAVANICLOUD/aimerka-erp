import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {applyInventory} from '../lib/inventory-v28.mjs';
import {productInCategories,taxonomy,categoryPath,brandsForCategory} from '../lib/product-taxonomy.mjs';
import {commercialEventProducts} from '../lib/commercial-events.mjs';
import {recommend,CHANNELS} from '../lib/pricing-v28.mjs';
test('a category-only correction preserves repeating-decimal costs, stock, channel calculations and history',()=>{
 const p={sku:'TESTPERFUME',upc:'7640496670139',name:'Perfume de prueba',brand:'Tommy Hilfiger',category:'PERFUMERIA DAMA',costCents:32369,averageCostMxn:323.6933333333333,priceCents:154000,good:4,reserved:1,safety:0,quarantine:0,damaged:0};
 const s={products:[p],orders:[{sku:p.sku}],commercialEventRuns:[{targets:[{sku:p.sku}]}],config:JSON.parse(fs.readFileSync(new URL('../data/pricing-config.json',import.meta.url)))};
 const before=structuredClone(s),route=taxonomy(s).nodes.find(n=>n.name==='Perfumes de Dama').id;
 const pricing=()=>CHANNELS.map(channel=>recommend(s.config,s.products[0],{channel,margin:.1}));const quotes=pricing();
 applyInventory(s,{id:'fix-route',type:'product.save',payload:{originalSku:p.sku,product:{...p,classification:{categoryIds:[route]}}}},{now:'2026-11-15',actor:'owner'});
 assert.equal(s.products[0].averageCostMxn,p.averageCostMxn);assert.equal(s.products[0].good,4);assert.equal(s.products[0].reserved,1);assert.deepEqual(s.orders,before.orders);assert.deepEqual(s.commercialEventRuns,before.commercialEventRuns);assert.deepEqual(pricing(),quotes);
 for(const node of categoryPath(s,route)){assert.ok(productInCategories(s,s.products[0],[node.id]));assert.deepEqual(commercialEventProducts(s,{categoryIds:[node.id],brands:['Tommy Hilfiger']} ).map(p=>p.sku),[p.sku]);assert.ok(brandsForCategory(s,node.id,s.products).includes('Tommy Hilfiger'));}
});
test('approving an imported route discards only a conflicting source category, retaining the other source data',()=>{
 const p={sku:'TABLET',name:'Tablet Samsung',brand:'Samsung',category:'TABLET',costCents:347718,averageCostMxn:3477.18,priceCents:579900,good:0,sicarSource:{sourceHash:'a'.repeat(64),exportedFields:{H:'AUDIFONOS',P:'3477.18',A:'12345678'}}};const s={products:[p],config:{}};const route=taxonomy(s).nodes.find(n=>n.name==='Tablet').id;
 applyInventory(s,{id:'approve-route',type:'product.save',payload:{originalSku:'TABLET',product:{...p,classification:{categoryIds:[route]}}}},{actor:'owner',now:'2026-11-15'});
 assert.equal(s.products[0].sicarSource.exportedFields.H,undefined);assert.equal(s.products[0].sicarSource.exportedFields.P,'3477.18');assert.equal(s.products[0].sicarSource.sourceHash,p.sicarSource.sourceHash);assert.equal(s.products[0].good,0);
});
