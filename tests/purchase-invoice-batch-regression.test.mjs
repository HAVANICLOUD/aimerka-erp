import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as parserEngine from '../lib/purchase-document-parser.mjs';
import * as validationModule from '../lib/purchase-document-validation.mjs';

const ref='599633002',foreignRef='599633999';
const line={sku:'DYSON',supplierItem:'701577',name:'Dyson V12',qty:2,receivedQty:1,documentIds:[]};
const purchase={id:'C1',number:'OC1',supplier:'Costco',supplierOrder:'',originalDocument:'ORDEN '+ref,items:[line],amountCents:819800};
const invoice=(id,reference=ref)=>({id,name:id+'.pdf',parsed:{kind:'invoice',supplier:'Costco',supplierOrder:reference,currency:'MXN',invoiceNumber:'BMG-'+id,uuid:'uuid-'+id,totalCents:409900,taxCents:56538,lines:[{...line,qty:1,totalCents:409900,taxCents:56538}]}});
const validate=(documents,options={})=>validationModule.validatePurchaseDocuments(documents,{purchase,originalPurchase:purchase,lines:[line],...options});

test('historical order anchor requires supplierOrder or an explicitly labeled originalDocument',()=>{
 const get=validationModule.purchaseOrderReference;
 for(const label of ['ORDEN','PEDIDO','pedido:'])assert.equal(get({originalDocument:label+' 6000000-54154386'}),'6000000-54154386');
 assert.equal(get({supplierOrder:'000021718',originalDocument:'ORDEN '+ref}),'000021718');
 for(const value of [ref,'FACTURA '+ref,'PEAD '+ref,'Archivo ORDEN '+ref,'ORDEN '+ref+' FACTURA 123','ORDEN 19/10/2026'])assert.equal(get({originalDocument:value}),'',value);
 assert.equal(get({supplierOrder:'02:17:18',originalDocument:'ORDEN '+ref}),'');
});

test('foreign invoice leaves correct files matched and contributes no quantities, costs or equivalences',()=>{
 const good=[invoice('one'),invoice('two')],alien=invoice('alien',foreignRef),documents=[alien,...good],before=structuredClone(documents);
 const baseline=validate(good),report=validate(documents);
 assert.equal(baseline.valid,true);assert.equal(report.valid,false);assert.equal(report.expectedSupplierOrder,ref);
 assert.deepEqual(report.lines,baseline.lines);assert.equal(report.invoiceTotalCents,819800);
 assert.equal(report.summary.invoicedQty,2);assert.equal(report.summary.excessQty,0);
 assert.equal(report.summary.invoiceCount,3);assert.equal(report.summary.matchingInvoiceCount,2);assert.equal(report.summary.excludedInvoiceCount,1);
 for(const id of ['one','two']){const check=report.documentChecks.find(row=>row.id===id);assert.equal(check.referenceStatus,'matched');assert.equal(check.status,'matched');}
 const wrong=report.documentChecks.find(row=>row.id==='alien');assert.equal(wrong.referenceStatus,'mismatch');assert.equal(wrong.supplierOrder,foreignRef);assert.equal(wrong.expectedSupplierOrder,ref);
 assert.deepEqual(report.equivalences,baseline.equivalences);assert.deepEqual(documents,before);
 assert.equal(report.issues.some(row=>row.code==='INVOICE_QUANTITY_EXCESS'),false);
});

test('mixed invoice references without an explicit anchor never use the majority',()=>{
 const report=validate([invoice('one'),invoice('two'),invoice('alien',foreignRef)],{purchase:{supplier:'Costco'},originalPurchase:null});
 assert.equal(report.expectedSupplierOrder,null);assert.equal(report.valid,false);assert.equal(report.invoiceTotalCents,null);assert.equal(report.summary.invoicedQty,0);
 assert.equal(report.documentChecks.some(check=>check.referenceStatus==='matched'),false);
});

test('an explicit order PDF anchors the batch independently of invoice order and majority',()=>{
 const order={id:'order',parsed:{kind:'order',supplier:'Costco',supplierOrder:ref,lines:[line]}};
 const report=validate([invoice('alien',foreignRef),invoice('alien2',foreignRef),order,invoice('one')],{purchase:{supplier:'Costco'},originalPurchase:null});
 assert.equal(report.expectedSupplierOrder,ref);assert.equal(report.summary.invoicedQty,1);assert.equal(report.invoiceTotalCents,409900);
 assert.equal(report.documentChecks.find(check=>check.id==='one').status,'matched');
});

test('reference match stays independent of other document errors and quantity excess still blocks',()=>{
 const bad=invoice('one');bad.parsed.totalCents=null;
 const report=validate([bad]);assert.equal(report.valid,false);assert.equal(report.documentChecks[0].referenceStatus,'matched');assert.equal(report.documentChecks[0].status,'mismatch');
 const excess=validate([invoice('one'),invoice('two'),invoice('three')]);
 assert.equal(excess.valid,false);assert.equal(excess.summary.excessQty,1);assert.ok(excess.issues.some(issue=>issue.code==='INVOICE_QUANTITY_EXCESS'));
 assert.ok(excess.documentChecks.every(check=>check.referenceStatus==='matched'));
});

test('historical anchors do not bypass rejected or temporal evidence',()=>{
 for(const patch of [{supplierOrder:ref,supplierOrderRejectedCandidates:[{value:ref,reason:'ambiguous_columns',evidence:'Columnas ambiguas'}]},{supplierOrder:'021718',evidence:{supplierOrder:'Número de orden Forma de pago 19/10/2026 021718'}}]){
  const document=invoice('bad');Object.assign(document.parsed,patch);
  const report=validate([document],{purchase:{...purchase,originalDocument:'ORDEN '+patch.supplierOrder},originalPurchase:{...purchase,originalDocument:'ORDEN '+patch.supplierOrder}});
  assert.equal(report.valid,false);assert.equal(report.expectedSupplierOrder,null);assert.equal(report.summary.invoicedQty,0);
 }
});

const source=fs.readFileSync(new URL('../public/erp/purchase-documents-ui.js',import.meta.url),'utf8')
 .replace(/const parser=\(\)=>parserPromise\?\?=import\([^;]+;/,'const parser=async()=>(parserModule=parserEngine);')
 .replace(/const validator=\(\)=>validationPromise\?\?=import\([^;]+;/,'const validator=async()=>(validationEngine=validationModule);')
 .replace('window.PurchaseDocs28={open,section,docUrl,close,productCosts:sku=>validationEngine?.productInvoiceCosts(state,sku)};','window.PurchaseDocs28={open,__test:{draft:()=>draft,recompute,refreshValidation,save}};');
function setup(){
 const stored=invoice('stored');stored.purchaseId=purchase.id;
 const state={products:[],purchases:[structuredClone(purchase)],documents:[stored],catalogs:{suppliers:['Costco']}},events=new Map(),nodes=new Map();let html='';
 nodes.set('modal',{classList:{add(){},remove(){}},addEventListener(){}});
 const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 const context={state,parserEngine,validationModule,structuredClone,URL,FormData,console,window:{},icons:{},esc,icon:()=>'',badge:(label,color)=>'<span class="'+color+'">'+esc(label)+'</span>',money:value=>'$'+(value/100).toFixed(2),toast(){},
 document:{getElementById:id=>nodes.get(id)||null,querySelectorAll:()=>[],addEventListener:(name,handler)=>{if(!events.has(name))events.set(name,[]);events.get(name).push(handler);}},
 showModal:markup=>{html=markup;nodes.set('document-import-form',{});},
 ERP:{workspace:'practice',today:()=> '2026-11-05',engines:{},field:()=>'',select:()=>''}};
 vm.createContext(context);vm.runInContext(source,context);
 return {state,nodes,events,api:context.window.PurchaseDocs28,get html(){return html;}};
}

test('UI summary identifies every folio/reference and removes only the wrong draft file',async()=>{
 const ui=setup(),before=structuredClone(ui.state);await ui.api.open({purchaseId:purchase.id,mode:'invoice'});
 const d=ui.api.__test.draft();d.documents.push(invoice('correct'),invoice('alien',foreignRef));await ui.api.__test.recompute(d);
 assert.equal(d.purchase.supplierOrder,ref);assert.equal(d.validation.valid,false);assert.equal(d.validation.summary.invoicedQty,2);
 const summary=ui.html.match(/<ul class="doc-batch-summary">(.*?)<\/ul>/s)[1];
 assert.match(summary,/Fact|Folio/);assert.match(summary,/Orden esperada: 599633002/);assert.match(summary,/Orden del archivo: 599633999/);assert.match(summary,/BMG-alien/);
 assert.match(ui.html,/Facturas coincidentes: 2 · Excluidas del cálculo: 1/);
 for(const id of ['stored','correct'])assert.match(summary.match(new RegExp('<li data-doc-summary="'+id+'">(.*?)</li>','s'))[1],/Orden coincidente/);
 assert.doesNotMatch(summary,/data-doc-remove="stored"/);assert.match(summary,/data-doc-remove="alien"/);
 assert.match(ui.html,/docs-save[^>]*disabled/);
 const button={dataset:{docRemove:'alien'},hasAttribute:name=>name==='data-doc-remove'};
 for(const handler of ui.events.get('click'))await handler({target:{closest:()=>button}});
 assert.deepEqual(Array.from(d.documents,doc=>doc.id),['correct']);assert.deepEqual(Array.from(d.storedDocuments,doc=>doc.id),['stored']);
 assert.equal(d.validation.valid,true);assert.equal(d.validation.invoiceTotalCents,819800);assert.equal(d.validation.summary.invoicedQty,2);assert.equal(d.lines[0].qty,2);assert.equal(d.lines[0].receivedQty,1);
 assert.doesNotMatch(ui.html,/docs-save[^>]*disabled/);assert.deepEqual(ui.state,before);
});

test('a manual header change cannot rewrite the historical anchor or bypass current validation',async()=>{
 const ui=setup();await ui.api.open({purchaseId:purchase.id,mode:'invoice'});
 const d=ui.api.__test.draft();d.purchase.supplierOrder=foreignRef;d.orderReferenceMode='manual';
 ui.api.__test.refreshValidation(d,false);
 assert.equal(d.purchase.supplierOrder,foreignRef);assert.equal(d.validation.expectedSupplierOrder,ref);assert.equal(d.validation.valid,false);
 assert.ok(d.validation.issues.some(issue=>issue.code==='PURCHASE_ORDER_CHANGED'));
});
