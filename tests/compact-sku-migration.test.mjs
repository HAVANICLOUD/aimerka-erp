import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCompactSkuMigration,compactSkuMigrationCandidates} from '../lib/compact-sku-migration.mjs';
import {generateProductSku} from '../lib/inventory-v28.mjs';

const old='DYSON-ASPIRADORA-INALAMBRICA-V12DIGITALSLIM-MORADO-03L';
const ctx={now:'2026-10-29T15:00:00.000Z',actor:'QA',requestId:'compact-skus-1',type:'product.compactGeneratedSkus'};
const product=()=>({sku:old,skuGenerated:true,name:'Dyson Aspiradora Inalámbrica V12 Digital Slim',brand:'Dyson',model:'V12 Digital Slim',color:'Morado',capacity:'0.3 L',upc:'885609037998',sellerSku:'SUPPLIER-V12',supplierCodes:[{supplier:'Costco',item:'701577',name:'Dyson V12'}],good:5,reserved:1,quarantine:2,damaged:1,safety:1,costCents:409900,priceCents:600000,updatedAt:'2026-10-28T00:00:00Z',createdAt:'2026-10-27T00:00:00Z'});
function fixture() {
  const line={id:'C000003-L1',sku:old,skuOrUpc:old,upc:'885609037998',name:'Dyson V12',qty:2,receivedQty:1,unitCostCents:409900,totalCents:819800,supplierItem:old,documentIds:['doc1']};
  const estimate={lines:[{sku:old,upc:'885609037998',baseCents:500000,profitCents:5000}],netCents:500000};
  return {
    products:[product(),{sku:'SKU-HISTORICO-LARGO',skuGenerated:false,upc:'111111111111',sellerSku:'VENDOR-1',good:10}],
    purchases:[{id:'C000003',number:'OC000003',supplier:'Costco',amountCents:819800,receiptStatus:'Recibida parcialmente',items:[line],documentIds:['doc1'],notes:old}],
    purchasePayments:[{id:'payment1',entityId:'C000003',amountCents:10000}],
    purchaseReceipts:[{id:'rec1',purchaseId:'C000003',items:[{lineId:line.id,sku:old,upc:line.upc,qty:1,unitCostCents:409900,documentIds:['doc1']}]}],
    orders:[{id:'sale1',sku:old,items:[{id:'sale1-1',sku:old,upc:line.upc,qty:1,returnedQty:1,restockedQty:1}],reconciliation:{estimate:structuredClone(estimate),draft:{estimate:structuredClone(estimate)},history:[{before:structuredClone(estimate),message:old}]},history:[{label:old}],comments:old}],
    movements:[{id:'movement1',sku:old,upc:line.upc,pool:'good',delta:1,before:4,after:5,reference:'C000003',purchaseId:'C000003',lineId:line.id,receiptId:'rec1',documentIds:['doc1']}],
    supplierEquivalences:[{supplier:'Costco',item:old,name:'Dyson V12',sku:old}],
    documents:[{id:'doc1',sha256:'sha-unchanged',name:'factura.pdf',purchaseId:'C000003',parsed:{supplier:'Costco',uuid:'uuid-unchanged',lines:[{sku:old,supplierItem:old,name:'Dyson V12',qty:1}]},lineLinks:[{lineId:line.id,sku:old,qty:1}]}],
    stockSyncQueue:[{id:'stock-'+old,sku:old,upc:line.upc,availableQty:3,status:'awaiting_connection',reference:old,updatedAt:'2026-10-28T00:00:00Z'}],
    pricingScenarios:[{id:'price1',productSku:old,input:{sku:old,productSku:old,price:5000},result:{product:{sku:old,upc:line.upc},lines:[{sku:old,price:5000}]},configSnapshot:{note:old}}],
    events:[{id:'create1',type:'product.save',message:old,changes:{sku:old},createdSkus:[old]}],
    sicarMovements:[{skuLiteral:old,sku:old}],sourceAudit:[{sku:old,message:old}],
    expenses:[],expensePayments:[],nextOrder:8
  };
}

test('shortens generated SKU and preserves purchases, invoices, stock and original identifiers',()=>{
  const state=fixture(),before=structuredClone(state);
  const result=applyCompactSkuMigration(state,ctx),next=result.mappings[0].to;
  assert.equal(result.migrated,1);assert.match(next,/^[A-Z0-9]{1,10}$/);
  assert.equal(next,'DYSV12M03L');
  assert.deepEqual(result.mappings,[{from:old,to:next,name:before.products[0].name,upc:before.products[0].upc}]);
  assert.equal(state.products[0].sku,next);assert.deepEqual(state.products[0].skuAliases,[old]);
  for(const field of ['upc','sellerSku','supplierCodes','good','reserved','quarantine','damaged','safety','costCents','priceCents','createdAt'])assert.deepEqual(state.products[0][field],before.products[0][field]);
  assert.deepEqual(state.products[1],before.products[1]);
  assert.deepEqual(state.purchases[0],{...before.purchases[0],items:[{...before.purchases[0].items[0],sku:next,skuOrUpc:next}]});
  assert.deepEqual(state.purchasePayments,before.purchasePayments);
  assert.deepEqual(state.purchaseReceipts[0].items[0],{...before.purchaseReceipts[0].items[0],sku:next});
  assert.equal(state.orders[0].sku,next);assert.equal(state.orders[0].items[0].sku,next);
  assert.deepEqual(state.orders[0].reconciliation.estimate,{...before.orders[0].reconciliation.estimate,lines:[{...before.orders[0].reconciliation.estimate.lines[0],sku:next}]});
  assert.equal(state.orders[0].reconciliation.draft.estimate.lines[0].sku,next);
  assert.deepEqual(state.orders[0].reconciliation.history,before.orders[0].reconciliation.history);
  assert.deepEqual(state.orders[0].history,before.orders[0].history);assert.equal(state.orders[0].comments,old);
  assert.deepEqual(state.movements[0],{...before.movements[0],sku:next});
  assert.deepEqual(state.supplierEquivalences[0],{...before.supplierEquivalences[0],sku:next});
  assert.deepEqual(state.documents[0],{...before.documents[0],lineLinks:[{...before.documents[0].lineLinks[0],sku:next}]});
  assert.deepEqual(state.stockSyncQueue[0],{...before.stockSyncQueue[0],sku:next,id:'stock-'+next,reference:next});
  assert.equal(state.pricingScenarios[0].productSku,next);assert.equal(state.pricingScenarios[0].input.sku,next);assert.equal(state.pricingScenarios[0].input.productSku,next);assert.equal(state.pricingScenarios[0].result.product.sku,next);assert.equal(state.pricingScenarios[0].result.lines[0].sku,next);
  assert.deepEqual(state.pricingScenarios[0].configSnapshot,before.pricingScenarios[0].configSnapshot);
  assert.deepEqual(state.events.slice(1),before.events);assert.equal(state.events[0].type,'product.compactGeneratedSkus');
  assert.deepEqual(state.events[0].changes.mappings,result.mappings);
  assert.deepEqual(state.sicarMovements,before.sicarMovements);assert.deepEqual(state.sourceAudit,before.sourceAudit);
  assert.equal(state.nextOrder,before.nextOrder);
});

test('a repeated migration is a no-op without duplicate aliases or audit events',()=>{
  const state=fixture();applyCompactSkuMigration(state,ctx);const before=structuredClone(state);
  const result=applyCompactSkuMigration(state,{...ctx,requestId:'second-attempt'});
  assert.equal(result.migrated,0);assert.deepEqual(result.mappings,[]);assert.deepEqual(state,before);
});

test('only generated nonconforming SKUs are migrated; legacy/manual/compact entries stay intact',()=>{
  const products=[{sku:old,name:'Legacy'},{sku:old+'-manual',skuGenerated:false},{sku:'DYSV12M03L',skuGenerated:true},{sku:'MANUAL',skuGenerated:false}];
  const state={products},before=structuredClone(state);
  assert.deepEqual(compactSkuMigrationCandidates(state),[]);
  assert.equal(applyCompactSkuMigration(state,ctx).migrated,0);assert.deepEqual(state,before);
});

test('multiple products and existing canonical/external/alias collisions get distinct short identifiers',()=>{
  const original=product(),base=generateProductSku(original,[]);
  const state={products:[original,{...product(),sku:old+'-002',upc:'',sellerSku:'',skuAliases:['OLD-ALIAS']},{sku:base,name:'Pre-existing',skuGenerated:false,sellerSku:'external'}, {sku:'KEEP1',skuAliases:['DYSV12M001'],upc:'12345678',sellerSku:'DYSV12M002'}],events:[]};
  const before=structuredClone(state),result=applyCompactSkuMigration(state,ctx);
  assert.equal(result.migrated,2);assert.equal(new Set(result.mappings.map(m=>m.to)).size,2);
  for(const row of result.mappings){assert.match(row.to,/^[A-Z0-9]{1,10}$/);assert.notEqual(row.to,base);assert.notEqual(row.to,'DYSV12M001');assert.notEqual(row.to,'DYSV12M002');}
  assert.deepEqual(state.products[2],before.products[2]);assert.deepEqual(state.products[3],before.products[3]);
  assert.deepEqual(state.products[1].skuAliases,['OLD-ALIAS',old+'-002']);
  const again={products:before.products.slice().reverse(),events:[]};
  assert.deepEqual(applyCompactSkuMigration(again,ctx).mappings,result.mappings);
});

test('an invalid or ambiguous origin rolls back the entire batch',()=>{
  for(const bad of [{...product(),sku:''},{...product(),sku:old,skuGenerated:false},{...product(),sku:old+'-002',skuAliases:'invalid'}]){
    const state={products:[product(),bad],events:[]},before=structuredClone(state);
    assert.throws(()=>applyCompactSkuMigration(state,ctx));assert.deepEqual(state,before);
  }
});

test('a purchase matched by UPC keeps that UPC while its confirmed SKU changes',()=>{
  const state=fixture();state.purchases[0].items[0].skuOrUpc=state.products[0].upc;
  const result=applyCompactSkuMigration(state,ctx);
  assert.equal(state.purchases[0].items[0].sku,result.mappings[0].to);
  assert.equal(state.purchases[0].items[0].skuOrUpc,'885609037998');
});
