import test from 'node:test';
import assert from 'node:assert/strict';
import {generateProductSku,applyInventory} from '../lib/inventory-v28.mjs';

const input={name:'Dyson Aspiradora Inalámbrica V12 Digital Slim',brand:'Dyson',model:'V12 Digital Slim',color:'Morado',capacity:'0.3 L'};
const makeState=()=>({products:[],orders:[],purchases:[],events:[],movements:[]});
const save=(state,product,originalSku)=>applyInventory(state,{id:'sku-test-'+state.products.length,type:'product.save',payload:{product:{name:'Producto de prueba',brand:'Marca',costCents:0,...product},originalSku}},{now:'2026-10-29T14:00:00Z',actor:'QA'});

test('SKU compacts product attributes into ten alphanumeric characters',()=>{
  assert.equal(generateProductSku(input),'DYSV12M03L');
  for(const value of [input,{}, {name:'Árbol & lámpara – edición núm. 2 ✨',brand:'Éléctrica'}, {brand:'M'.repeat(5000),model:'P'.repeat(5000),color:'R'.repeat(5000),capacity:'1'.repeat(5000)},{name:'Smartphone',brand:'Apple',model:'iPhone 16',color:'Negro',capacity:'128 GB'}]){
    const original=structuredClone(value),sku=generateProductSku(value);
    assert.match(sku,/^[A-Z0-9]{1,10}$/);
    assert.equal(sku,generateProductSku(value));
    assert.deepEqual(value,original);
  }
});

test('collisions reserve old aliases, external SKUs and barcodes without exceeding ten characters',()=>{
  const base=generateProductSku(input);
  for(const field of ['sku','sellerSku','upc','skuAliases']){
    const existing={sku:'OTHER', [field]:field==='skuAliases'?[base]:base};
    const generated=generateProductSku(input,[existing]);
    assert.notEqual(generated,base);assert.match(generated,/^[A-Z0-9]{1,10}$/);
  }
  const products=[];
  for(let i=0;i<1450;i++){
    const sku=generateProductSku(input,products);
    assert.match(sku,/^[A-Z0-9]{1,10}$/);
    products.push({sku});
  }
  assert.equal(new Set(products.map(p=>p.sku)).size,1450);
  assert.equal(products[1].sku,'DYSV12M002');
});

test('manual identifiers allow provider codes while rejecting whitespace and invalid characters',()=>{
  const state=makeState();
  for(const sku of ['X'.repeat(81),'SKU 001',' SKU001','SKU001 ','ÁRT001','ß123']){
    const before=structuredClone(state);
    assert.throws(()=>save(state,{sku,skuGenerated:true}),/hasta 80/);
    assert.deepEqual(state,before);
  }
  save(state,{sku:'SKU-001_12345678901'});
  const result=save(state,{sku:'abc1234567',skuGenerated:true});
  assert.equal(result.sku,'ABC1234567');assert.equal(state.products.find(p=>p.sku==='ABC1234567').skuGenerated,false);
  const auto=save(state,input),product=state.products.find(p=>p.sku===auto.sku);
  assert.equal(product.skuGenerated,true);assert.equal(product.good,0);assert.equal(product.upc,'');
});

test('new manual identifiers cannot reuse a previous alias; legacy product edits keep their stable identifier',()=>{
  const state=makeState();
  state.products.push({sku:'LEGACY-LONG-PRODUCT-ID',skuAliases:['OLDCODE123'],upc:'',name:'Legacy',brand:'Marca',costCents:0,priceCents:0,status:'OK',good:4,reserved:1});
  const before=structuredClone(state);
  assert.throws(()=>save(state,{sku:'oldcode123'}),/ya está registrado/);assert.deepEqual(state,before);
  const old=state.products[0];
  save(state,{...old,name:'Descripción actualizada'},old.sku);
  assert.equal(old.sku,'LEGACY-LONG-PRODUCT-ID');assert.equal(old.name,'Descripción actualizada');assert.equal(old.good,4);assert.equal(old.reserved,1);
  applyInventory(state,{id:'old-label',type:'inventory.adjust',payload:{sku:'oldcode123',quantity:5,pool:'good',reason:'Escaneo de una etiqueta anterior'}},{now:'2026-10-29T14:00:00Z',actor:'QA'});
  assert.equal(old.good,5);assert.equal(state.movements[0].sku,old.sku);assert.equal(state.stockSyncQueue[0].sku,old.sku);
});
