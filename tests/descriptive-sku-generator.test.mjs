import test from 'node:test';
import assert from 'node:assert/strict';
import {generateProductSku,applyInventory} from '../lib/inventory-v28.mjs';

test('a populated model no longer replaces the product title',()=>{
 const input={name:'Dyson Aspiradora Inalámbrica V12 Digital Slim',brand:'Dyson',model:'V12 Digital Slim',color:'Morado',capacity:'0.3 L'};
 const before=structuredClone(input),sku=generateProductSku(input);
 assert.match(sku,/DYSASPIINAL/);assert.match(sku,/V12/);assert.match(sku,/MO03L$/);
 assert.match(sku,/^[A-Z0-9]{11,24}$/);assert.deepEqual(input,before);
 assert.equal(sku,generateProductSku(input));
});
test('title-only variants keep meaningful words beyond the old ten-character cut',()=>{
 const a=generateProductSku({name:'Apple AirPods Max Medianoche',brand:'Apple'});
 const b=generateProductSku({name:'Apple AirPods Max Plata',brand:'Apple'});
 assert.equal(a,'APPAIRPMAXMEDI');assert.equal(b,'APPAIRPMAXPLAT');
 assert.equal(generateProductSku({title:'Árbol de lámpara',brand:'Éléctrica'}),'ELEARBOLAMP');
});
test('new descriptive SKUs reserve current, old and external identifiers',()=>{
 const input={name:'Apple AirPods Max Medianoche',brand:'Apple'},base=generateProductSku(input);
 for(const field of ['sku','sellerSku','upc','skuAliases']){
  const next=generateProductSku(input,[{[field]:field==='skuAliases'?[base.toLowerCase()]:base.toLowerCase()}]);
  assert.notEqual(next,base);assert.match(next,/02$/);assert.ok(next.length<=24);
 }
 const products=[];for(let i=0;i<80;i++)products.push({sku:generateProductSku(input,products)});
 assert.equal(new Set(products.map(p=>p.sku)).size,80);
});
test('editing an existing generated product keeps SKU and all linked records intact',()=>{
 const p={sku:'DYSV12',skuGenerated:true,name:'Dyson V12',brand:'Dyson',costCents:100,priceCents:200,good:2,reserved:1};
 const state={products:[p],orders:[{items:[{sku:p.sku}]}],purchases:[{items:[{sku:p.sku}]}],movements:[{sku:p.sku}],events:[]};
 const links=structuredClone({orders:state.orders,purchases:state.purchases,movements:state.movements});
 applyInventory(state,{id:'edit-title',type:'product.save',payload:{originalSku:p.sku,product:{...p,name:'Dyson Aspiradora V12 Digital Slim'}}},{now:'2026-11-10T20:00:00Z',actor:'QA'});
 assert.equal(p.sku,'DYSV12');assert.equal(p.good,2);assert.equal(p.reserved,1);
 assert.deepEqual({orders:state.orders,purchases:state.purchases,movements:state.movements},links);
});
