import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as operations from '../lib/operations-v28.mjs';
const source=fs.readFileSync(new URL('../public/erp/purchase-form-ui.js',import.meta.url),'utf8');
function setup(){
 const nodes=new Map([['op28-purchase-date-result',{textContent:''}]]),state={products:[],creditRules:[{lender:'Empresa QA',instrument:'Tarjeta QA',cutoffDay:15,paymentDay:25,active:true}]},draft={};
 const context={document:{getElementById:id=>nodes.get(id),addEventListener(){}},window:{},icons:{},op28RenderPurchaseForm(){},op28engine:()=>operations,op28date:date=>date,op28draft:draft,state};
 vm.runInNewContext(source,context);return {api:context.window.PurchaseFormUI,state,draft,nodes};
}
test('purchase unit costs convert both ways at 16%, retain unknown costs and round to cents',()=>{
 const {api}=setup();assert.deepEqual(JSON.parse(JSON.stringify(api.costPair('1160'))),{gross:'1160.00',net:'1000.00'});
 assert.deepEqual(JSON.parse(JSON.stringify(api.costPair('2000','net'))),{gross:'2320.00',net:'2000.00'});
 assert.equal(api.costPair('4099').net,'3533.62');assert.equal(api.costPair('').gross,'');assert.equal(api.costPair('0').net,'0.00');assert.equal(api.costPair('-1'),null);assert.equal(api.costPair('NaN'),null);
});
test('inventory explorer includes zero-stock products and searches the entire eligible catalog without mutating it',()=>{
 const {api,state}=setup();state.products=Array.from({length:80},(_,n)=>({sku:'SKU'+n,name:'Artículo '+n,upc:'UPC'+n,good:0}));
 state.products.push({sku:'hidden',lifecycle:{hidden:true}},{sku:'discontinued',lifecycle:{discontinued:true}});const before=JSON.stringify(state);
 assert.equal(api.pickerProducts('').length,80);assert.equal(api.pickerProducts('SKU79')[0].sku,'SKU79');assert.equal(api.pickerProducts('UPC79')[0].sku,'SKU79');assert.equal(JSON.stringify(state),before);
});
test('automatic first payment follows configured cutoff and payment days, recalculates on date changes and preserves manual input',()=>{
 const {api,draft,nodes}=setup(),field={value:'',dataset:{}},form={elements:{date:{value:'2026-11-13'},lender:{value:'Empresa QA'},instrument:{value:'Tarjeta QA'},firstPaymentDate:field}};
 api.automaticDate(form);assert.equal(field.value,'2026-11-25');assert.equal(draft.buyDateMode,'auto');
 form.elements.date.value='2026-11-16';api.automaticDate(form,true);assert.equal(field.value,'2026-12-25');
 field.dataset.manual='true';field.value='2026-12-01';api.automaticDate(form,true);assert.equal(field.value,'2026-12-01');
 delete field.dataset.manual;form.elements.instrument.value='Sin regla';api.automaticDate(form,true);assert.equal(field.value,'');assert.match(nodes.get('op28-purchase-date-result').textContent,/Configura/);
});
