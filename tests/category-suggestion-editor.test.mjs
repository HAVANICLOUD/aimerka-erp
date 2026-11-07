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

test('creation shows proposal without selecting it; save requires explicit acceptance',async()=>{
  const h=harness();h.updateCategoryReview(h.form);
  assert.match(h.message.textContent,/LAPTOPS/);assert.equal(h.inputs.category.value,'');
  await h.saveProduct(h.form);assert.equal(h.commands.length,0);assert.match(h.error.textContent,/aprueba/);
  h.accept();assert.equal(h.inputs.category.value,'LAPTOPS');assert.equal(h.reviewed.checked,true);
  await h.saveProduct(h.form);assert.equal(h.commands.length,1);assert.equal(h.commands[0][1].product.category,'LAPTOPS');
});

test('manual choice is preserved and can be approved; later title/category edits revoke approval',async()=>{
  const h=harness();h.inputs.category.value='TABLET';h.change('category');
  h.reviewed.checked=true;h.change('categoryReviewed');
  h.updateCategoryReview(h.form);assert.equal(h.inputs.category.value,'TABLET');assert.equal(h.reviewed.checked,true);
  await h.saveProduct(h.form);assert.equal(h.commands[0][1].product.category,'TABLET');
  h.inputs.name.value='iPhone 17';h.updateCategoryReview(h.form);assert.equal(h.reviewed.checked,false);assert.equal(h.inputs.category.value,'TABLET');
  await h.saveProduct(h.form);assert.equal(h.commands.length,1);
  h.reviewed.checked=true;h.change('categoryReviewed');h.inputs.category.value='LAPTOPS';h.change('category');assert.equal(h.reviewed.checked,false);
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
