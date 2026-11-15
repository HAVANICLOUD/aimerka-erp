import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as pricing from '../lib/pricing-v28.mjs';
const config=JSON.parse(readFileSync(new URL('../data/pricing-config.json',import.meta.url)));
const source=readFileSync(new URL('../public/erp/product-trace-ui.js',import.meta.url),'utf8');

function harness(previous=null){
  const handlers={},commands=[],error={textContent:'',scrollIntoView(){}},button={disabled:false,hidden:true},message={},reviewed={checked:false,focus(){}},values={name:'MacBook Air M4',sku:'TEST',category:'',brand:'Apple',cost:'1000',price:'2000',shipping:'Pequeño',shippingException:'Automático',status:'OK',minStock:'3'};
  if(previous)Object.assign(values,previous);
  const inputs=Object.fromEntries(Object.entries(values).map(([k,value])=>[k,{value}]));inputs.categoryReviewed=reviewed;
  const panel={querySelector(selector){return selector==='[data-pt29-accept-category]'?button:message;}};
  const form={dataset:{original:previous?.sku||''},elements:{namedItem:name=>inputs[name]},querySelector(selector){if(selector==='#pt29-category-review')return panel;if(selector==='.pt29-form-error')return error;if(selector==='[type="submit"]')return button;return null;},querySelectorAll(){return [];}};
  const context={state:{config:structuredClone(config),products:previous?[previous]:[]},ERP:{engines:{pricing,inventory:{}},async command(...args){commands.push(args);return {ok:false,error:'Test response'};}},window:{},document:{addEventListener(type,handler){(handlers[type]??=[]).push(handler);},getElementById(){return null;}},renderers:{},c28ProductForm:null,productDetails:null};
  vm.runInNewContext(source.replace('  c28ProductForm=showProductForm;', '  window.testHooks={updateCategoryReview,saveProduct};\n  c28ProductForm=showProductForm;'),context);
  function change(name){for(const handler of handlers.change||[])handler({target:{name,checked:reviewed.checked,closest(){return form;}}});}
  function accept(){for(const handler of handlers.click||[])handler({target:{closest(selector){return selector==='button'?{dataset:{},hasAttribute(name){return name==='data-pt29-accept-category';},closest(){return form;}}:null;}}});}
  return {...context.window.testHooks,form,inputs,reviewed,message,commands,error,change,accept,context};
}

test('new editor requires a classification route instead of the removed legacy profile approval',async()=>{
 const h=harness();let chosen=false;h.context.window.ProductTaxonomyUI={readProduct(form,p){if(!chosen)throw Error('Agrega una categoría comercial.');p.classification={categoryIds:['route']};p.marketCategories={Liverpool:'Telefonía'};}};
 await h.saveProduct(h.form);assert.equal(h.commands.length,0);assert.match(h.error.textContent,/categoría comercial/);
 chosen=true;await h.saveProduct(h.form);assert.equal(h.commands.length,1);const p=h.commands[0][1].product;assert.equal(p.category,'');assert.deepEqual(Array.from(p.classification.categoryIds),['route']);assert.equal(p.marketCategories.Liverpool,'Telefonía');
});

test('the removed legacy profile review cannot prevent saving a route-based product',async()=>{
 const h=harness();h.context.window.ProductTaxonomyUI={readProduct(form,p){p.classification={categoryIds:['tablet']};p.marketCategories={Liverpool:'Cómputo'};}};
 h.inputs.name.value='iPad';h.reviewed.checked=false;await h.saveProduct(h.form);assert.equal(h.commands.length,1);assert.equal(h.commands[0][1].product.name,'iPad');assert.equal(h.commands[0][1].product.category,'');
});

test('existing product saves stored category and marketplace overrides without creation review',async()=>{
  const previous={sku:'STORED',name:'MacBook Air M4',category:'TABLET',categories:{Coppel:'Electrónica'},categoryOverrides:{Liverpool:'Accesorios'},good:7};
  const before=structuredClone(previous),h=harness(previous);
  // Real editor renders each existing override as the selected option.
  pricing.CHANNELS.forEach((channel,i)=>h.inputs['override'+i]={value:previous.categoryOverrides[channel]||''});
  h.updateCategoryReview(h.form);assert.equal(h.form.dataset.categoryProposal,undefined);
  await h.saveProduct(h.form);assert.equal(h.commands.length,1);
  const saved=h.commands[0][1].product;
  assert.equal(saved.category,'TABLET');assert.equal(saved.categoryOverrides.Liverpool,'Accesorios');assert.equal(saved.categories.Coppel,'Electrónica');assert.equal(saved.good,7);
  assert.deepEqual(previous,before);
});
