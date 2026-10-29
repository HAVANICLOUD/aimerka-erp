import test from 'node:test';
import assert from 'node:assert/strict';
import {applyInventory,available,generateProductSku,validateProductUpc} from '../lib/inventory-v28.mjs';
import {applyOperation,financialSummary,installmentState} from '../lib/operations-v28.mjs';

const ctx={today:'2026-10-29',now:'2026-10-29T14:00:00Z',actor:'QA',user:'QA'};
const state=()=>({products:[],orders:[],purchases:[],purchasePayments:[],expenses:[],expensePayments:[],creditRules:[],movements:[],events:[],catalogs:{lenders:['Empresa'],instruments:['Tarjeta'],suppliers:['Proveedor'],expenseCategories:['Servicios']}});
let sequence=0;
const inventory=(s,type,payload,id='inventory-'+(++sequence))=>applyInventory(s,{id,type,payload},ctx);
const operation=(s,type,payload,id='operation-'+(++sequence))=>applyOperation(s,{id,type,payload},ctx);
const product=(s,name,patch={})=>{
 const result=inventory(s,'product.save',{product:{name,brand:'Marca',model:'Modelo 12',color:'Azul',capacity:'256 GB',costCents:0,priceCents:0,...patch}});
 return s.products.find(p=>p.sku===result.sku);
};
const buy=(s,items=[],patch={})=>{
 const result=operation(s,'purchase.create',{date:'2026-10-28',supplier:'Proveedor',items,shippingStatus:'En tránsito',...patch});
 return s.purchases.find(p=>p.id===result.id);
};

test('document-only purchase gets a sequential internal number and does not fabricate SICAR, costs, credit or inventory',()=>{
 const s=state(),p=product(s,'Producto documental'),before={stock:p.good,movements:s.movements.length};
 const purchase=buy(s,[{name:p.name,skuOrUpc:p.sku,qty:2,unitCostCents:null,supplierItem:'ART-15',documentIds:['doc-1']}]);
 assert.equal(purchase.id,'C000001');assert.equal(purchase.number,'OC000001');assert.equal(purchase.sicar,'');
 assert.equal(purchase.amountCents,null);assert.equal(purchase.items[0].unitCostCents,null);assert.equal(purchase.items[0].totalCents,null);
 assert.equal(purchase.linesTotalCents,null);assert.equal(purchase.lineDifferenceCents,null);
 assert.equal(purchase.lender,'');assert.equal(purchase.instrument,'');assert.equal(purchase.term,1);
 assert.equal(purchase.receiptStatus,'Pendiente');assert.equal(purchase.receiptMode,'physical');assert.equal(purchase.shippingStatus,'En tránsito');
 assert.deepEqual({stock:p.good,movements:s.movements.length},before);
 assert.equal(financialSummary(s,'purchase',{},ctx.today).unknownAmountCount,1);
 assert.equal(buy(s,[{name:'Otro',qty:1,unitCostCents:5000}]).number,'OC000002');
 const beforeEdit=purchase.number;operation(s,'purchase.update',{id:purchase.id,sicar:'EXT-15',notes:'Orden recibida'});
 assert.equal(purchase.number,beforeEdit);assert.equal(purchase.sicar,'EXT-15');assert.deepEqual(purchase.items[0].documentIds,['doc-1']);
 const unchanged=JSON.stringify(s);assert.throws(()=>buy(s,[],{sicar:'EXT-15'}),/ya está registrado/);assert.equal(JSON.stringify(s),unchanged);
});

test('auto purchase numbers continue existing imported IDs and supplied numbers cannot take ownership',()=>{
 const s=state();s.purchases.push({id:'C000049',sicar:'597',amountCents:null,items:[],status:'Activa',receiptStatus:'Recibida completa',source:'V28'});
 const purchase=buy(s,[{name:'Artículo',qty:1,unitCostCents:null}],{number:'OC000001'});
 assert.equal(purchase.id,'C000050');assert.equal(purchase.number,'OC000050');
 operation(s,'purchase.update',{id:purchase.id,number:'OC999999'});assert.equal(purchase.number,'OC000050');
});

test('partial receiving only adds selected quantities and completes after remaining items; receipts and sync are traceable',()=>{
 const s=state(),a=product(s,'Equipo A'),b=product(s,'Equipo B');
 const purchase=buy(s,[{name:a.name,skuOrUpc:a.sku,qty:2,unitCostCents:10000,documentIds:['invoice-1']},{name:b.name,skuOrUpc:b.sku,qty:1,unitCostCents:null}]);
 const request={purchaseId:purchase.id,items:[{lineId:purchase.items[0].id,sku:a.sku,qty:1,upc:'885609037998'}],reason:'Primer paquete'};
 const first=inventory(s,'inventory.receivePurchase',request,'receipt-first');
 assert.equal(purchase.receiptStatus,'Recibida parcialmente');assert.equal(a.good,1);assert.equal(b.good,0);
 assert.equal(purchase.items[1].receivedQty,0);assert.equal(a.upc,'885609037998');
 assert.equal(first.receiptId,'receipt-first');assert.equal(s.purchaseReceipts[0].items[0].lineId,purchase.items[0].id);
 assert.deepEqual(s.purchaseReceipts[0].items[0].documentIds,['invoice-1']);
 assert.equal(s.movements[0].receiptId,'receipt-first');assert.equal(s.movements[0].purchaseId,purchase.id);
 assert.equal(s.stockSyncQueue.find(r=>r.sku===a.sku).availableQty,1);
 assert.equal(s.stockSyncQueue.find(r=>r.sku===a.sku).status,'awaiting_connection');
 const repeated=JSON.stringify(s);assert.equal(inventory(s,'inventory.receivePurchase',request,'receipt-first').duplicate,true);assert.equal(JSON.stringify(s),repeated);
 inventory(s,'inventory.receivePurchase',{purchaseId:purchase.id,items:[{lineId:purchase.items[0].id,sku:a.sku,qty:1},{lineId:purchase.items[1].id,sku:b.sku,qty:1}]},'receipt-second');
 assert.equal(purchase.receiptStatus,'Recibida completa');assert.equal(a.good,2);assert.equal(b.good,1);assert.equal(s.purchaseReceipts.length,2);
 assert.equal(s.stockSyncQueue.filter(row=>row.sku===a.sku).length,1);assert.equal(s.stockSyncQueue.find(row=>row.sku===a.sku).availableQty,2);
 const done=JSON.stringify(s);assert.throws(()=>inventory(s,'inventory.receivePurchase',request,'receipt-third'),/supera/);assert.equal(JSON.stringify(s),done);
 operation(s,'purchase.update',{id:purchase.id,notes:'Facturación terminada'});assert.equal(purchase.receiptStatus,'Recibida completa');
});

test('a failed barcode or quantity in any selected line leaves the whole receipt unchanged',()=>{
 const s=state(),a=product(s,'Equipo A'),b=product(s,'Equipo B');
 const purchase=buy(s,[{name:a.name,skuOrUpc:a.sku,qty:1,unitCostCents:null},{name:b.name,skuOrUpc:b.sku,qty:1,unitCostCents:null}]);
 const first={lineId:purchase.items[0].id,sku:a.sku,qty:1,upc:'885609037998'};
 for(const second of [{lineId:purchase.items[1].id,sku:b.sku,qty:1,upc:'885609037998'},{lineId:purchase.items[1].id,sku:b.sku,qty:2},{lineId:purchase.items[1].id,sku:b.sku,qty:1,upc:'123'}]){
   const before=JSON.stringify(s);assert.throws(()=>inventory(s,'inventory.receivePurchase',{purchaseId:purchase.id,items:[first,second]}));assert.equal(JSON.stringify(s),before);
 }
});

test('new physical orders cannot be marked received manually and legacy documentary status remains intact until physical receipt',()=>{
 const s=state(),p=product(s,'Equipo');
 assert.throws(()=>buy(s,[{name:p.name,qty:1,unitCostCents:null}],{receiptStatus:'Recibida completa'}),/no se marca manualmente/);
 const purchase=buy(s,[{name:p.name,skuOrUpc:p.sku,qty:1,unitCostCents:null}]);
 assert.throws(()=>operation(s,'purchase.receipt',{id:purchase.id,receiptStatus:'Recibida completa'}),/Recibir mercancía/);
 delete purchase.receiptMode;purchase.receiptStatus='Recibida completa';
 operation(s,'purchase.update',{id:purchase.id,notes:'Histórico documental'});assert.equal(purchase.receiptStatus,'Recibida completa');assert.equal(p.good,0);
 inventory(s,'inventory.receivePurchase',{purchaseId:purchase.id,items:[{lineId:purchase.items[0].id,qty:1}]});
 assert.equal(purchase.receiptMode,'physical');assert.equal(purchase.receiptStatus,'Recibida completa');assert.equal(p.good,1);
});

test('generated SKUs include descriptive attributes and remain unique even without UPC; scanner can assign the barcode later',()=>{
 const s=state(),input={name:'Equipo versión Ágil',brand:'Marca',model:'M12',color:'Azul',capacity:'256 GB'};
 const sku=generateProductSku(input,s.products);assert.match(sku,/MARCA/);assert.match(sku,/M12/);assert.match(sku,/AZUL/);assert.match(sku,/256GB/);assert.match(sku,/^[A-Z0-9-]+$/);
 const a=product(s,input.name,{...input,good:900}),b=product(s,input.name,input);
 assert.equal(a.sku,sku);assert.equal(b.sku,sku+'-002');assert.equal(a.upc,'');assert.equal(a.good,0);
 const result=inventory(s,'product.assignUpc',{sku:a.sku,upc:'885609037998'});assert.equal(result.sku,a.sku);assert.equal(result.upc,'885609037998');assert.equal(a.good,0);
 const before=JSON.stringify(s);assert.throws(()=>inventory(s,'product.assignUpc',{sku:b.sku,upc:'0885609037998'}),/otro producto/);assert.equal(JSON.stringify(s),before);
 inventory(s,'product.save',{originalSku:a.sku,product:{...a,name:'Nombre comercial actualizado'}});assert.equal(a.sku,sku);
 assert.equal(validateProductUpc('885609037998'),'885609037998');assert.throws(()=>validateProductUpc('885609037997'),/control/);
});

test('supplier equivalences and image URLs are validated without mutating existing records',()=>{
 const s=state(),p=product(s,'Equipo',{imageUrl:'/erp/assets/equipo.png',supplierCodes:[{supplier:'Proveedor',item:'2310',name:'Título del proveedor'}]});
 assert.equal(p.supplierCodes[0].item,'2310');assert.equal(p.imageUrl,'/erp/assets/equipo.png');
 for(const patch of [{imageUrl:'javascript:alert(1)'},{imageUrl:'data:image/svg+xml,<svg/>'},{supplierCodes:[{supplier:'',item:'2310'}]}]){
   const before=JSON.stringify(s);assert.throws(()=>inventory(s,'product.save',{originalSku:p.sku,product:{...p,...patch}}));assert.equal(JSON.stringify(s),before);
 }
 assert.throws(()=>product(s,'Otro',{supplierCodes:[{supplier:'Proveedor',item:'2310'}]}),/asociado/);
});

test('confirmed invoices may complete unknown amounts but paid documents cannot lose their confirmed total',()=>{
 const s=state(),purchase=buy(s,[{name:'Equipo',qty:2,unitCostCents:null}]);
 assert.equal(installmentState(purchase,s.purchasePayments).balanceCents,null);
 assert.throws(()=>operation(s,'purchase.payment',{entityId:purchase.id,date:'2026-10-29',mode:'Recomendado'}),/confirmado/);
 operation(s,'purchase.update',{id:purchase.id,amountCents:20000,items:[{...purchase.items[0],unitCostCents:10000}],documentIds:['invoice-1']});
 operation(s,'purchase.payment',{entityId:purchase.id,date:'2026-10-29',mode:'Otro monto',amountCents:5000});
 assert.equal(purchase.balanceCents,15000);
 const before=JSON.stringify(s);assert.throws(()=>operation(s,'purchase.update',{id:purchase.id,amountCents:null,items:[{...purchase.items[0],unitCostCents:null}]}),/abonos/);assert.equal(JSON.stringify(s),before);
});

test('stock queue reflects availability after reservation, shipment and physical return without pretending to publish',()=>{
 const s=state(),p=product(s,'Equipo',{upc:'885609037998'}),purchase=buy(s,[{name:p.name,skuOrUpc:p.sku,qty:1,unitCostCents:10000}]);
 inventory(s,'inventory.receivePurchase',{purchaseId:purchase.id,items:[{lineId:purchase.items[0].id,qty:1}]});
 const created=inventory(s,'sale.create',{market:'Sears',number:'TEST-1',documentDate:'2026-10-29',items:[{sku:p.sku,qty:1,unitPriceCents:20000}]});
 assert.equal(available(p),0);assert.equal(s.stockSyncQueue[0].availableQty,0);
 inventory(s,'sale.ship',{orderId:created.orderId});assert.equal(s.stockSyncQueue[0].availableQty,0);
 inventory(s,'sale.return_request',{orderId:created.orderId,reason:'Prueba'});inventory(s,'sale.return_receive',{orderId:created.orderId});
 assert.equal(available(p),0);inventory(s,'sale.return_restock',{orderId:created.orderId});
 assert.equal(available(p),1);assert.equal(s.stockSyncQueue[0].availableQty,1);assert.equal(s.stockSyncQueue[0].status,'awaiting_connection');
});
