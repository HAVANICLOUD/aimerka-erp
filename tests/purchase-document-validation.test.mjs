import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePurchaseDocuments} from '../lib/purchase-document-validation.mjs';

const line=(qty=2,patch={})=>({supplierItem:'701577',name:'Dyson V12',qty,...patch});
const doc=(id,kind='invoice',patch={})=>({id,name:id+'.pdf',sha256:id,parsed:{kind,supplier:'Costco',supplierOrder:'599633002',currency:'MXN',invoiceNumber:kind==='invoice'?'BMG'+id:null,uuid:kind==='invoice'?'uuid-'+id:null,totalCents:kind==='invoice'?409900:null,lines:[line(kind==='invoice'?1:2)],...patch}});
const order=()=>doc('order','order');
const options=(patch={})=>({purchase:{supplier:'Costco',supplierOrder:'599633002',amountCents:819800},lines:[line()],...patch});
const validate=(documents,patch={})=>validatePurchaseDocuments(documents,options(patch));
const has=(report,code)=>report.issues.some(issue=>issue.code===code);

test('the full file validates initial and later invoices against the same order',()=>{
 const documents=[order(),doc('one'),doc('two')],before=structuredClone(documents);
 let report=validate(documents.slice(0,2));
 assert.equal(report.valid,true);assert.equal(report.summary.pendingQty,1);assert.equal(report.coverage,'partial');
 report=validate(documents);assert.equal(report.valid,true);assert.equal(report.summary.invoicedQty,2);assert.equal(report.summary.pendingQty,0);assert.equal(report.coverage,'complete');
 assert.ok(report.documentChecks.every(check=>check.status==='matched'));assert.deepEqual(documents,before);
 report=validate([...documents,doc('extra')]);assert.equal(report.valid,false);assert.ok(has(report,'INVOICE_QUANTITY_EXCESS'));assert.equal(report.summary.excessQty,1);
});

test('order reference, supplier and currency are checked on every original document',()=>{
 for(const [patch,code] of [[{supplierOrder:'599633003'},'ORDER_NUMBER_MISMATCH'],[{supplier:'Otro proveedor'},'SUPPLIER_MISMATCH'],[{currency:'USD'},'CURRENCY_MISMATCH']]){
  const report=validate([order(),doc('wrong','invoice',patch)]);assert.equal(report.valid,false);assert.ok(has(report,code));
 }
 const report=validate([order(),doc('one','invoice',{supplier:'COSTCO DE MÉXICO S.A. DE C.V.'})]);assert.equal(report.valid,true);
});

test('a missing or ambiguous invoice order is held for explicit review, and manual reference evidence is retained',()=>{
 for(const patch of [{supplierOrder:null},{supplierOrder:null,supplierOrderConflict:true,supplierOrderCandidates:['599633002','599633003']}]){
  const report=validate([order(),doc('missing','invoice',patch)]);assert.equal(report.valid,false);assert.ok(has(report,'DOCUMENT_ORDER_MISSING'));
 }
 const reviewed=doc('review','invoice',{supplierOrder:'599633002',supplierOrderConflict:true,supplierOrderOriginal:null,supplierOrderReviewed:true});
 const report=validate([order(),reviewed]);assert.equal(report.valid,true);assert.ok(has(report,'ORDER_REFERENCE_REVIEWED'));
 const unknown=validate([doc('unknown','invoice',{supplierOrder:null})],{purchase:{supplier:'Costco'},lines:[line(1)]});assert.equal(unknown.valid,false);assert.ok(has(unknown,'ORDER_REFERENCE_REQUIRED'));
});

test('duplicate copies by hash, UUID or supplier plus invoice number are counted once',()=>{
 const original=doc('one');
 for(const duplicate of [{...structuredClone(original),name:'renamed.pdf'},doc('copy','invoice',{uuid:original.parsed.uuid,invoiceNumber:original.parsed.invoiceNumber}),doc('copy','invoice',{uuid:null,invoiceNumber:original.parsed.invoiceNumber})]){
  const report=validate([order(),original,duplicate,doc('two')]);assert.equal(report.valid,true);assert.equal(report.summary.invoiceCount,2);assert.equal(report.summary.invoicedQty,2);assert.ok(has(report,'DUPLICATE_DOCUMENT'));
 }
});

test('contradictory duplicate copies are not silently ignored',()=>{
 const original=doc('one');
 for(const patch of [{uuid:original.parsed.uuid,invoiceNumber:original.parsed.invoiceNumber,totalCents:1},{invoiceNumber:original.parsed.invoiceNumber},{uuid:original.parsed.uuid,supplierOrder:'OTHER'}]){
  const report=validate([order(),original,doc('copy','invoice',patch)]);assert.equal(report.valid,false);assert.ok(has(report,'DUPLICATE_CONFLICT'));
 }
});

test('extra or mismatching articles and quantities block the attachment even when totals match',()=>{
 for(const invoice of [doc('wrong','invoice',{lines:[line(1,{supplierItem:'999999'})]}),doc('wrong','invoice',{lines:[line(3)]}),doc('wrong','invoice',{lines:[line(0)]}),doc('wrong','invoice',{lines:[]})])assert.equal(validate([order(),invoice]).valid,false);
 const orderWithUpc=order();orderWithUpc.parsed.lines[0].upc='885609037998';
 const wrong=doc('wrong','invoice',{lines:[line(1,{upc:'96385074'})]});assert.ok(has(validate([orderWithUpc,wrong]),'INVOICE_ITEM_MISMATCH'));
});

test('fully invoiced totals must match a known order amount; partial amounts are not treated as the full order',()=>{
 const complete=validate([order(),doc('one'),doc('two','invoice',{totalCents:100})]);assert.equal(complete.valid,false);assert.ok(has(complete,'INVOICE_TOTAL_MISMATCH'));
 const partial=validate([order(),doc('one')]);assert.equal(partial.valid,true);assert.equal(has(partial,'INVOICE_TOTAL_MISMATCH'),false);
});

test('invoice-only creation still requires a shared order and does not double-count units',()=>{
 const report=validate([doc('one'),doc('two')]);assert.equal(report.valid,true);assert.equal(report.summary.orderCount,0);assert.equal(report.summary.orderedQty,2);assert.equal(report.summary.invoicedQty,2);
});

test('a supplier order already registered in another purchase is rejected with its purchase reference',()=>{
 const purchase={id:'C000001',number:'OC000001',supplier:'Costco de México SA de CV',supplierOrder:'599633002',items:[line()]};
 let report=validate([order()],{purchases:[purchase]});assert.equal(report.valid,false);assert.equal(report.issues.find(row=>row.code==='PURCHASE_ALREADY_EXISTS').purchaseId,'C000001');
 report=validate([order()],{purchases:[purchase],purchaseId:purchase.id});assert.equal(report.valid,true);
});

test('editing review fields cannot move attachments to a different order or enlarge existing quantities',()=>{
 const prior={id:'C1',supplier:'Costco',supplierOrder:'599633002',items:[line()]};
 const report=validate([order(),doc('one'),doc('two'),doc('three')],{purchaseId:'C1',purchases:[prior],purchase:{supplier:'Costco',supplierOrder:'OTHER'},lines:[line(3)]});
 assert.equal(report.valid,false);for(const code of ['PURCHASE_ORDER_CHANGED','ORDER_QUANTITY_CHANGED','INVOICE_QUANTITY_EXCESS'])assert.ok(has(report,code));
});

test('unknown types, ambiguous articles and preserved leading zeros do not pass as a match',()=>{
 assert.equal(validate([doc('unknown','unknown')]).valid,false);
 const ambiguous=validate([doc('one')],{lines:[line(1),line(1)]});assert.ok(has(ambiguous,'INVOICE_ITEM_MISMATCH'));
 const zeros=validate([order(),doc('one','invoice',{supplierOrder:'0599633002'})]);assert.ok(has(zeros,'ORDER_NUMBER_MISMATCH'));
});
