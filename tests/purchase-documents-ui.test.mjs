import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as parserEngine from '../lib/purchase-document-parser.mjs';
import * as validationModule from '../lib/purchase-document-validation.mjs';
import {generateProductSku} from '../lib/inventory-v28.mjs';

const source=fs.readFileSync(new URL('../public/erp/purchase-documents-ui.js',import.meta.url),'utf8')
  .replace(/const parser=\(\)=>parserPromise\?\?=import\([^;]+;/,'const parser=async()=>(parserModule=parserEngine);')
  .replace(/const validator=\(\)=>validationPromise\?\?=import\([^;]+;/,'const validator=()=>{validationEngine=validationModule;return Promise.resolve(validationModule);};')
  .replace('window.PurchaseDocs28={open,section,docUrl,close};','window.PurchaseDocs28={open,section,docUrl,close,__test:{getDraft:()=>draft,capture,recompute,refreshValidation,validationFor,setDocumentReference,save,blockers,refreshDerivedOrder}};');
const product={sku:'DYSV12M03L',upc:'885609037998',name:'Dyson V12',brand:'Dyson',supplierCodes:[{supplier:'Costco',item:'701577'}]};
const line={sku:product.sku,name:product.name,supplierItem:'701577',qty:2,unitCostCents:null,totalCents:null,documentIds:[]};
const order=(id='order')=>({id,name:'orden.pdf',parsed:{kind:'order',supplier:'Costco',supplierOrder:'599633002',currency:'MXN',date:'2026-10-19',totalCents:null,lines:[{supplierItem:'701577',name:'Dyson V12',qty:2}]}});
const invoice=(id,n=1,ref='599633002')=>({id,name:'factura-'+id+'.pdf',parsed:{kind:'invoice',supplier:'Costco',supplierOrder:ref,currency:'MXN',invoiceNumber:'BMG'+n,uuid:String(n).padStart(8,'0')+'-1111-4111-8111-111111111111',totalCents:409900,lines:[{supplierItem:'701577',name:'Dyson V12',qty:1,totalCents:409900,unitCostCents:409900}]}});
function setup(state={products:[structuredClone(product)],purchases:[],documents:[],catalogs:{suppliers:['Costco']}}){
  const nodes=new Map(),events=new Map(),toasts=[];let html='',uploads=0,commands=0;
  nodes.set('modal',{classList:{add(){},remove(){}},addEventListener(){},close(){}});
  const document={getElementById:id=>nodes.get(id)||null,querySelectorAll:()=>[],querySelector:()=>null,addEventListener:(name,fn)=>{const list=events.get(name)||[];list.push(fn);events.set(name,list);}};
  const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const context={document,window:{},icons:{},state,parserEngine,validationModule,structuredClone,URL,FormData,console,
    esc,icon:()=>'<svg></svg>',badge:(label,color)=>'<span class="'+color+'">'+esc(label)+'</span>',money:cents=>'$'+(cents/100).toFixed(2),toast:(message,error)=>toasts.push({message,error}),
    showModal:markup=>{html=markup;nodes.set('document-import-form',{});},fetch:async()=>{uploads++;throw new Error('Unexpected upload');},
    ERP:{workspace:'practice',busy:false,today:()=> '2026-10-29',engines:{inventory:{generateProductSku}},field:(id,label,value)=>'<input id="'+id+'" value="'+esc(value)+'">',select:()=>'<select></select>',command:async()=>{commands++;throw new Error('Unexpected command');}}};
  vm.createContext(context);vm.runInContext(source,context);
  const api=context.window.PurchaseDocs28;
  return {api,helpers:api.__test,state,nodes,events,toasts,context,get html(){return html;},get uploads(){return uploads;},get commands(){return commands;}};
}

test('capture preserves the purchase header before file controls are rendered',async()=>{
  const ui=setup();
  await ui.api.open({purchaseDraft:{supplier:'Costco',supplierOrder:'599633002',date:'2026-10-19',lender:'Empresa',instrument:'Tarjeta',term:3,items:[structuredClone(line)]}});
  const draft=ui.helpers.getDraft(),before=structuredClone(draft.purchase);
  ui.helpers.capture(draft);
  assert.equal(JSON.stringify(draft.purchase),JSON.stringify(before));assert.equal(draft.lines[0].qty,2);
});

test('attaching an order to a pre-existing purchase retains the original PDF order reference',async()=>{
  const purchase={id:'C1',number:'OC1',supplier:'Costco',supplierOrder:'',date:'2026-10-19',items:[{...structuredClone(line),id:'L1',receivedQty:1}],amountCents:null};
  const ui=setup({products:[structuredClone(product)],purchases:[purchase],documents:[],catalogs:{suppliers:['Costco']}});
  await ui.api.open({purchaseId:purchase.id});
  const draft=ui.helpers.getDraft();draft.documents.push(order());
  await ui.helpers.recompute(draft);
  assert.equal(draft.purchase.supplierOrder,'599633002');assert.equal(draft.lines[0].qty,2);assert.equal(draft.lines[0].receivedQty,1);
  assert.equal(draft.validation.valid,true);assert.match(ui.html,/Número de orden en este documento/);assert.match(ui.html,/599633002/);
  assert.equal(purchase.supplierOrder,'');
});

test('original documents remain validated when existing quantities use a synthetic order',async()=>{
  const purchase={id:'C1',number:'OC1',supplier:'Costco',supplierOrder:'599633002',date:'2026-10-19',items:[{...structuredClone(line),id:'L1'}],amountCents:null};
  const badOrder=order();badOrder.parsed.supplierOrder='599633999';
  const ui=setup({products:[structuredClone(product)],purchases:[purchase],documents:[],catalogs:{suppliers:['Costco']}});
  await ui.api.open({purchaseId:purchase.id});const draft=ui.helpers.getDraft();draft.documents.push(badOrder);
  await ui.helpers.recompute(draft);
  assert.equal(draft.validation.valid,false);assert.ok(draft.validation.issues.some(issue=>issue.code==='ORDER_NUMBER_MISMATCH'));
  assert.match(ui.html,/docs-save[^>]*disabled/);
});

test('live edits recalculate cumulative invoice excess and order mismatch without stale combination blockers',async()=>{
  const ui=setup();await ui.api.open();const draft=ui.helpers.getDraft();
  draft.documents.push(order(),invoice('one',1),invoice('two',2));await ui.helpers.recompute(draft);
  assert.equal(draft.validation.valid,true);assert.equal(draft.validation.summary.invoicedQty,2);
  draft.documents.push(invoice('three',3));ui.helpers.refreshValidation(draft,false);
  assert.ok(draft.validation.issues.some(issue=>issue.code==='INVOICE_QUANTITY_EXCESS'));
  draft.documents.pop();draft.orderReferenceMode='manual';draft.purchase.supplierOrder='599633999';ui.helpers.refreshValidation(draft,false);
  assert.ok(draft.validation.issues.some(issue=>issue.code==='ORDER_NUMBER_MISMATCH'));
  draft.purchase.supplierOrder='599633002';draft.combined.blockingWarnings=['Stale error'];ui.helpers.refreshValidation(draft,false);
  assert.equal(draft.validation.valid,true);assert.equal(ui.helpers.blockers(draft).length,0);
});

test('editing a stored reference works on a copy and preserves its original reading',async()=>{
  const purchase={id:'C1',number:'OC1',supplier:'Costco',supplierOrder:'599633002',date:'2026-10-19',items:[{...structuredClone(line),id:'L1'}],amountCents:null};
  const doc=invoice('one');doc.purchaseId='C1';doc.parsed.supplierOrder=null;
  const ui=setup({products:[structuredClone(product)],purchases:[purchase],documents:[doc],catalogs:{suppliers:['Costco']}});
  await ui.api.open({purchaseId:'C1'});const draft=ui.helpers.getDraft();
  ui.helpers.setDocumentReference(draft,draft.storedDocuments[0],'599633002');ui.helpers.refreshValidation(draft,false);
  assert.equal(doc.parsed.supplierOrder,null);assert.equal(draft.storedDocuments[0].parsed.supplierOrder,'599633002');
  assert.equal(draft.storedDocuments[0].parsed.supplierOrderOriginal,'');assert.equal(draft.storedDocuments[0].parsed.supplierOrderReviewed,true);
  assert.equal(draft.editedDocumentIds[0],'one');assert.equal(draft.validation.valid,true);
});

test('save revalidates the current header and blocks before any upload or mutation',async()=>{
  const ui=setup();await ui.api.open();const draft=ui.helpers.getDraft();draft.documents.push(order(),invoice('one'));await ui.helpers.recompute(draft);
  ui.nodes.set('docs-order',{value:'999999999'});ui.nodes.set('docs-reviewed',{checked:true});
  await ui.helpers.save(draft);
  assert.equal(draft.validation.valid,false);assert.equal(ui.uploads,0);assert.equal(ui.commands,0);
  assert.ok(ui.toasts.some(toast=>toast.error&&/diferencias/.test(toast.message)));
});

test('a stale time in an unsaved header is replaced by the uniquely recognized document order',async()=>{
  const ui=setup();await ui.api.open({purchaseDraft:{supplier:'Costco',supplierOrder:'02:17:18',date:'2026-10-19'}});
  const draft=ui.helpers.getDraft();draft.documents.push(order());
  await ui.helpers.recompute(draft);
  assert.equal(draft.purchase.supplierOrder,'599633002');assert.equal(draft.orderReferenceMode,'auto');
  assert.equal(draft.validation.valid,true);assert.doesNotMatch(ui.html,/value="02:17:18"/);
});

test('a re-read updates an automatically derived numeric header instead of retaining the previous extraction',async()=>{
  const ui=setup();await ui.api.open();const draft=ui.helpers.getDraft(),doc=order();
  doc.parsed.supplierOrder='021718';draft.documents.push(doc);await ui.helpers.recompute(draft);
  assert.equal(draft.purchase.supplierOrder,'021718');assert.equal(draft.orderReferenceMode,'auto');
  doc.parsed.supplierOrder='599633002';await ui.helpers.recompute(draft);
  assert.equal(draft.purchase.supplierOrder,'599633002');assert.equal(draft.validation.valid,true);
});

test('a valid manual reference stays intact and a conflicting PDF remains blocked',async()=>{
  const ui=setup();await ui.api.open({purchaseDraft:{supplier:'Costco',supplierOrder:'MANUAL0001'}});
  const draft=ui.helpers.getDraft();draft.documents.push(order());await ui.helpers.recompute(draft);
  assert.equal(draft.purchase.supplierOrder,'MANUAL0001');assert.equal(draft.orderReferenceMode,'manual');
  assert.equal(draft.validation.valid,false);assert.ok(draft.validation.issues.some(issue=>issue.code==='ORDER_NUMBER_MISMATCH'));
});

test('a saved purchase reference is not silently rewritten by a new attachment',async()=>{
  const purchase={id:'C1',number:'OC1',supplier:'Costco',supplierOrder:'02:17:18',date:'2026-10-19',items:[{...structuredClone(line),id:'L1'}],amountCents:null};
  const ui=setup({products:[structuredClone(product)],purchases:[purchase],documents:[],catalogs:{suppliers:['Costco']}});
  await ui.api.open({purchaseId:'C1'});const draft=ui.helpers.getDraft();draft.documents.push(order());await ui.helpers.recompute(draft);
  assert.equal(draft.purchase.supplierOrder,'02:17:18');assert.equal(purchase.supplierOrder,'02:17:18');
  assert.equal(draft.orderReferenceMode,'existing');assert.equal(draft.validation.valid,false);
});

test('clearing the header for a manual correction does not restore a stale automatic value',async()=>{
  const ui=setup();await ui.api.open();const draft=ui.helpers.getDraft();draft.documents.push(order());await ui.helpers.recompute(draft);
  ui.nodes.set('docs-order',{value:''});ui.helpers.capture(draft);ui.helpers.refreshValidation(draft);
  assert.equal(draft.orderReferenceMode,'manual');assert.equal(draft.purchase.supplierOrder,'');assert.equal(ui.nodes.get('docs-order').value,'');
});

test('an unrelated invoice cannot displace the automatic reference from the actual order PDF',async()=>{
  const ui=setup();await ui.api.open();const draft=ui.helpers.getDraft();draft.documents.push(order(),invoice('wrong',1,'999999999'));
  await ui.helpers.recompute(draft);
  assert.equal(draft.purchase.supplierOrder,'599633002');assert.equal(draft.validation.valid,false);
  assert.ok(draft.validation.issues.some(issue=>issue.code==='ORDER_NUMBER_MISMATCH'&&issue.actual==='999999999'));
});
