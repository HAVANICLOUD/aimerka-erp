import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDocumentImport} from '../lib/purchase-document-commands.mjs';
import {applyInventory} from '../lib/inventory-v28.mjs';
import {applyOperation} from '../lib/operations-v28.mjs';

const clock={now:'2026-10-29T16:00:00Z',today:'2026-10-29',actor:'QA'};
const id=n=>n.toString(16).padStart(64,'0');
const uid=n=>'12345678-1234-1234-1234-'+String(n).padStart(12,'0');
let sequence=0;
const state=()=>({products:[],orders:[],purchases:[],purchasePayments:[],expenses:[],expensePayments:[],documents:[],supplierEquivalences:[],creditRules:[],movements:[],events:[],catalogs:{suppliers:['Costco'],lenders:['Empresa'],instruments:['Tarjeta']}});
const createProduct=(s,name='Dyson V12')=>applyInventory(s,{id:'product-'+(++sequence),type:'product.save',payload:{product:{name,brand:'Dyson',model:'V12',costCents:123400,priceCents:599900}}},clock).sku;
const parsed=(kind,qty=2,n=1)=>({kind,supplier:'Costco',supplierOrder:'599633002',date:'2026-10-19',invoiceNumber:kind==='invoice'?'BMG'+n:null,uuid:kind==='invoice'?uid(n):null,totalCents:kind==='invoice'?409900:null,paymentMethod:'PUE',deliveryStatus:'Entregado',lines:[{supplierItem:'701577',name:'Dyson V12 Digital Slim',qty,unitCostCents:kind==='invoice'?409900:null,totalCents:kind==='invoice'?409900:null}]});
const doc=(n,kind='order',qty=2,uuidNumber=n)=>({id:id(n),parsed:parsed(kind,qty,uuidNumber),extraction:'pdf-text'});
const metadata=docs=>docs.map(d=>({id:d.id,sha256:d.id,name:d.id+'.pdf',mime:'application/pdf',size:500,createdAt:clock.now}));
const importDocs=(s,documents,lines,purchase={},purchaseId,commandId)=>applyDocumentImport(s,{id:commandId||'import-'+(++sequence),type:'purchase.importDocuments',payload:{purchaseId,purchase:{supplier:'Costco',date:'2026-10-19',shippingStatus:'En tránsito',...purchase},lines,documents}},{...clock,verifiedDocuments:metadata(documents)});
const line=(sku,documents,patch={})=>({sku,name:'Dyson V12 Digital Slim',supplierItem:'701577',qty:2,unitCostCents:null,documentIds:documents.map(d=>d.id),...patch});

test('one order and two invoices keep two ordered units, link each invoice quantity, and do not create receipts or payments',()=>{
  const s=state(),sku=createProduct(s),docs=[doc(1),doc(2,'invoice',1),doc(3,'invoice',1)];
  const result=importDocs(s,docs,[line(sku,docs,{unitCostCents:409900})],{amountCents:819800});
  const purchase=s.purchases[0];
  assert.equal(purchase.items[0].qty,2);assert.equal(purchase.amountCents,819800);assert.equal(purchase.receiptStatus,'Pendiente');assert.equal(purchase.receiptMode,'physical');
  assert.equal(s.products[0].good,0);assert.equal(s.products[0].costCents,123400);assert.equal(s.products[0].priceCents,599900);assert.equal(s.movements.length,0);assert.equal(s.purchasePayments.length,0);
  assert.equal(s.documents.length,3);assert.deepEqual(s.documents.map(d=>d.lineLinks[0].qty),[2,1,1]);assert.ok(s.documents.every(d=>d.purchaseId===purchase.id&&d.lineLinks[0].sku===sku));
  assert.deepEqual(purchase.items[0].documentIds,docs.map(d=>d.id));assert.equal(result.createdSkus.length,0);assert.equal(purchase.taxInvoice,'BMG2, BMG3');
  assert.equal(s.supplierEquivalences[0].item,'701577');assert.equal(s.supplierEquivalences[0].sku,sku);
});

test('re-uploaded hash or UUID from a different PDF is deduplicated within the same purchase',()=>{
  const s=state(),sku=createProduct(s),first=doc(10,'invoice',1,10);
  const result=importDocs(s,[first],[line(sku,[first],{qty:1,unitCostCents:409900})],{amountCents:409900});
  const prior=s.purchases[0],second=doc(11,'invoice',1,10);
  const again=importDocs(s,[second],[{...prior.items[0],documentIds:[first.id,second.id]}],{},result.id);
  assert.equal(s.documents.length,1);assert.equal(s.purchases.length,1);assert.deepEqual(s.purchases[0].items[0].documentIds,[first.id]);assert.equal(again.duplicateDocuments[0].duplicateOf,first.id);
  const snapshot=JSON.stringify(s),duplicate=importDocs(s,[second],[line(sku,[second],{qty:1})]);
  assert.equal(duplicate.duplicate,true);assert.equal(duplicate.id,result.id);assert.equal(JSON.stringify(s),snapshot);
  const hashRepeat=importDocs(s,[first],[{...s.purchases[0].items[0]}],{},result.id);
  assert.equal(hashRepeat.duplicateDocuments[0].reason,'sha256');assert.equal(s.documents.length,1);
});

test('a UUID belonging to another purchase is blocked atomically even with a different file hash',()=>{
  const s=state(),sku=createProduct(s),first=doc(20,'invoice',1,20);
  importDocs(s,[first],[line(sku,[first],{qty:1,unitCostCents:409900})],{amountCents:409900});
  const other=applyOperation(s,{type:'purchase.create',payload:{supplier:'Costco',date:'2026-10-20',items:[{name:'Otro',sku,qty:1,unitCostCents:null}]}},clock);
  const snapshot=JSON.stringify(s),duplicate=doc(21,'invoice',1,20);
  assert.throws(()=>importDocs(s,[duplicate],[{...s.purchases.find(p=>p.id===other.id).items[0],documentIds:[duplicate.id]}],{},other.id),/ya está asociado/);
  assert.equal(JSON.stringify(s),snapshot);
});

test('an unknown product gets generated SKU, empty UPC and zero inventory while unknown monetary values stay null',()=>{
  const s=state(),document=doc(30);
  const result=importDocs(s,[document],[{name:'Aspiradora Dyson V12',supplierItem:'701577',qty:2,unitCostCents:null,documentIds:[document.id],newProduct:{name:'Aspiradora Dyson V12',brand:'Dyson',model:'V12',color:'Azul',capacity:'0.35 L',good:100}}],{supplier:'Nuevo proveedor',amountCents:null});
  const product=s.products[0],purchase=s.purchases[0];
  assert.equal(product.sku,'DYSV12A035');assert.match(product.sku,/^[A-Z0-9]{1,10}$/);assert.equal(product.skuGenerated,true);assert.equal(product.upc,'');assert.equal(product.good,0);assert.equal(product.reserved,0);assert.equal(product.quarantine,0);
  assert.equal(product.costStatus,'Por confirmar');assert.equal(purchase.amountCents,null);assert.equal(purchase.items[0].unitCostCents,null);assert.equal(purchase.items[0].totalCents,null);assert.deepEqual(result.createdSkus,[product.sku]);assert.ok(s.catalogs.suppliers.includes('Nuevo proveedor'));
});

test('a later invoice preserves line identity, partial receiving, stock, payments and financing',()=>{
  const s=state(),sku=createProduct(s),order=doc(40);
  const first=importDocs(s,[order],[line(sku,[order],{unitCostCents:409900})],{amountCents:819800,lender:'Empresa',instrument:'Tarjeta',term:3,firstPaymentDate:'2026-10-25'});
  let purchase=s.purchases.find(p=>p.id===first.id),lineId=purchase.items[0].id;
  applyInventory(s,{id:'receipt-before-invoice',type:'inventory.receivePurchase',payload:{purchaseId:purchase.id,items:[{lineId,sku,qty:1}],reason:'Paquete 1'}},clock);
  applyOperation(s,{id:'payment-before-invoice',type:'purchase.payment',payload:{entityId:purchase.id,mode:'Otro monto',amountCents:10000,date:'2026-10-25'}},clock);
  const payments=structuredClone(s.purchasePayments),receipts=structuredClone(s.purchaseReceipts),invoice=doc(41,'invoice',1,41);
  importDocs(s,[invoice],[{...purchase.items[0],documentIds:[invoice.id]}],{amountCents:819800,lender:'',instrument:'',term:1,firstPaymentDate:''},purchase.id);
  purchase=s.purchases.find(p=>p.id===first.id);
  assert.equal(purchase.items[0].id,lineId);assert.equal(purchase.items[0].receivedQty,1);assert.equal(purchase.items[0].qty,2);assert.equal(purchase.receiptStatus,'Recibida parcialmente');assert.equal(s.products[0].good,1);
  assert.deepEqual(s.purchasePayments,payments);assert.deepEqual(s.purchaseReceipts,receipts);assert.equal(purchase.lender,'Empresa');assert.equal(purchase.instrument,'Tarjeta');assert.equal(purchase.term,3);assert.equal(purchase.firstPaymentDate,'2026-10-25');assert.equal(purchase.paidCents,10000);
  assert.deepEqual(purchase.items[0].documentIds,[order.id,invoice.id]);assert.equal(s.documents.find(d=>d.id===invoice.id).lineLinks[0].qty,1);
});

test('failure after a preceding new product was created rolls back products, supplier catalog, documents and events',()=>{
  const s=state(),document=doc(50),snapshot=JSON.stringify(s);
  assert.throws(()=>importDocs(s,[document],[{name:'Primero',qty:1,unitCostCents:null,documentIds:[document.id],supplierItem:'P1',newProduct:{name:'Primero',brand:'Marca'}},{name:'Segundo',qty:1,unitCostCents:null,documentIds:[document.id],supplierItem:'P2',newProduct:{name:'Segundo',brand:'Marca',upc:'123'}}],{supplier:'Proveedor nuevo'}),/UPC/);
  assert.equal(JSON.stringify(s),snapshot);
});

test('a conflicting confirmed supplier item cannot be reassigned to a different SKU',()=>{
  const s=state(),a=createProduct(s,'Equipo A'),b=createProduct(s,'Equipo B'),first=doc(60);
  importDocs(s,[first],[line(a,[first])]);
  const snapshot=JSON.stringify(s),second=doc(61);
  assert.throws(()=>importDocs(s,[second],[line(b,[second])]),/equivalencia.*otro SKU/);
  assert.equal(JSON.stringify(s),snapshot);
});

test('unverified files and mismatched verified hashes cannot be persisted',()=>{
  const s=state(),sku=createProduct(s),document=doc(70),command={id:'unverified',type:'purchase.importDocuments',payload:{purchase:{supplier:'Costco',date:'2026-10-19'},lines:[line(sku,[document])],documents:[document]}},snapshot=JSON.stringify(s);
  assert.throws(()=>applyDocumentImport(s,command,clock),/archivo verificado/);
  assert.throws(()=>applyDocumentImport(s,command,{...clock,verifiedDocuments:[{...metadata([document])[0],sha256:id(71)}]}),/huella/);
  assert.equal(JSON.stringify(s),snapshot);
});

test('the same import command is idempotent and foreign document IDs are filtered from reviewed lines',()=>{
  const s=state(),sku=createProduct(s),document=doc(80),result=importDocs(s,[document],[line(sku,[document],{documentIds:[document.id,'not-a-verified-document']})],{},undefined,'import-same');
  assert.deepEqual(s.purchases[0].items[0].documentIds,[document.id]);
  const snapshot=JSON.stringify(s),again=importDocs(s,[document],[line(sku,[document])],{},undefined,'import-same');
  assert.equal(again.duplicate,true);assert.equal(again.id,result.id);assert.equal(JSON.stringify(s),snapshot);
});
