import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommand} from '../lib/commands.mjs';
import {applyOperation} from '../lib/operations-v28.mjs';

const context={now:'2026-10-29T15:00:00Z',today:'2026-10-29',actor:'QA',workspace:'practice'};
function fixture(){
 const state={products:[{sku:'DYSV12M03L',name:'Dyson V12',upc:'885609037998',supplierCodes:[{supplier:'Costco',item:'701577'}]}],purchases:[],documents:[],events:[],creditRules:[],purchasePayments:[],catalogs:{suppliers:['Costco'],lenders:[],instruments:[]}};
 const result=applyOperation(state,{id:'setup-edit-check',type:'purchase.create',payload:{supplier:'Costco',supplierOrder:'599633002',date:'2026-10-19',amountCents:819800,items:[{sku:'DYSV12M03L',supplierItem:'701577',name:'Dyson V12',qty:2,unitCostCents:409900}]}},context);
 const purchase=state.purchases.find(p=>p.id===result.id),line=purchase.items[0];
 const metadata=(id,kind,qty,total)=>({id,sha256:id,name:kind+'.pdf',purchaseId:purchase.id,kind,parsed:{kind,supplier:'Costco',supplierOrder:'599633002',currency:'MXN',invoiceNumber:kind==='invoice'?'BMG1234':null,uuid:kind==='invoice'?'12345678-1234-1234-1234-123456789012':null,totalCents:total,lines:[{supplierItem:'701577',name:'Dyson V12',qty,totalCents:total,unitCostCents:409900}]},lineLinks:[{lineId:line.id,sku:line.sku,qty}]});
 state.documents=[metadata('a'.repeat(64),'order',2,819800),metadata('b'.repeat(64),'invoice',1,409900)];
 purchase.documentIds=state.documents.map(d=>d.id);line.documentIds=[...purchase.documentIds];
 return state;
}
const update=(state,patch)=>applyCommand(state,{id:'edit-with-document-check',type:'purchase.update',payload:{id:state.purchases[0].id,...patch}},context);
test('ordinary purchase editor preserves matching attached documents when updating notes',()=>{
 const state=fixture(),documents=structuredClone(state.documents);
 update(state,{notes:'Segunda entrega pendiente'});
 assert.equal(state.purchases[0].notes,'Segunda entrega pendiente');assert.deepEqual(state.documents,documents);
});
test('ordinary editor cannot change a documented order reference without a matching documentary correction',()=>{
 const state=fixture(),before=structuredClone(state);
 assert.throws(()=>update(state,{supplierOrder:'599633999'}),/orden|referencia/i);assert.deepEqual(state,before);
});
test('ordinary editor cannot inflate a documented purchase to hide additional invoices',()=>{
 const state=fixture(),before=structuredClone(state);
 assert.throws(()=>update(state,{items:[{...state.purchases[0].items[0],qty:3}],amountCents:1229700}),/cantidad|partida|orden/i);assert.deepEqual(state,before);
});
test('ordinary editor cannot reduce ordered quantity below already invoiced units',()=>{
 const state=fixture();state.documents[1].parsed.lines[0].qty=2;state.documents[1].parsed.totalCents=819800;state.documents[1].parsed.lines[0].totalCents=819800;
 const before=structuredClone(state);
 assert.throws(()=>update(state,{items:[{...state.purchases[0].items[0],qty:1}],amountCents:409900}),/cantidad|partida|orden|unidades/i);assert.deepEqual(state,before);
});
