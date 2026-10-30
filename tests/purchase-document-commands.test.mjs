import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDocumentImport} from '../lib/purchase-document-commands.mjs';
import {applyInventory} from '../lib/inventory-v28.mjs';
import {applyOperation} from '../lib/operations-v28.mjs';
import {productInvoiceCosts} from '../lib/purchase-document-validation.mjs';

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

test('separate invoice upload accumulates Costco costs and preserves the order and inventory',()=>{
  const ledger=state(),sku=createProduct(ledger),order=doc(201);
  const created=importDocs(ledger,[order],[line(sku,[order])]);
  const stock=structuredClone(ledger.products),receipts=structuredClone(ledger.purchaseReceipts),movements=structuredClone(ledger.movements);
  const lineId=ledger.purchases[0].items[0].id;
  for(const [index,folio] of ['37144420','37144423'].entries()){
    const invoice=doc(202+index,'invoice',1,202+index);
    Object.assign(invoice.parsed,{invoiceNumber:'BMG '+folio,subtotalCents:689569,discountCents:336207,taxCents:56538});
    Object.assign(invoice.parsed.lines[0],{subtotalCents:689569,discountCents:336207,taxCents:56538});
    const purchase=ledger.purchases[0];
    applyDocumentImport(ledger,{id:'separate-'+folio,type:'purchase.importDocuments',payload:{mode:'invoice',purchaseId:created.id,purchase:{supplier:'Wrong supplier',notes:'Do not replace'},lines:structuredClone(purchase.items),documents:[invoice]}},{...clock,verifiedDocuments:metadata([invoice])});
    const saved=ledger.purchases[0],item=saved.items[0];
    assert.equal(saved.amountCents,409900*(index+1));assert.equal(saved.taxInvoice,['BMG 37144420','BMG 37144423'].slice(0,index+1).join(', '));
    assert.equal(saved.supplier,'Costco');assert.equal(saved.items.length,1);assert.equal(item.id,lineId);assert.equal(item.qty,2);
    assert.equal(item.invoicedQty,index+1);assert.equal(item.pendingInvoiceQty,1-index);assert.equal(item.invoicedNetCents,353362*(index+1));
    assert.equal(item.invoicedTaxCents,56538*(index+1));assert.equal(item.invoiceAverageCostCents,409900);
    assert.equal(ledger.documents.at(-1).lineLinks[0].qty,1);assert.equal(ledger.documents.at(-1).lineLinks[0].sku,sku);
  }
  assert.deepEqual(productInvoiceCosts(ledger,sku),{units:2,totalCents:819800,averageCostCents:409900,averageNetCostCents:353362,averageTaxCents:56538});
  assert.equal(ledger.products[0].costCents,409900);assert.equal(ledger.products[0].averageCostMxn,4099);assert.equal(ledger.products[0].priceCents,stock[0].priceCents);
  for(const key of ['good','reserved','quarantine','damaged','safety'])assert.equal(ledger.products[0][key],stock[0][key]);
  assert.deepEqual(ledger.movements,movements);assert.deepEqual(ledger.purchaseReceipts,receipts);
  const before=structuredClone(ledger),extra=doc(204,'invoice',1);
  assert.throws(()=>applyDocumentImport(ledger,{type:'purchase.importDocuments',payload:{mode:'invoice',purchaseId:created.id,purchase:{},lines:[{...ledger.purchases[0].items[0],qty:3}],documents:[extra]}},{...clock,verifiedDocuments:metadata([extra])}),/conserva/);
  assert.deepEqual(ledger,before);
});

test('invoice upload refuses inconsistent tax arithmetic atomically',()=>{
  const ledger=state(),sku=createProduct(ledger),order=doc(210),created=importDocs(ledger,[order],[line(sku,[order])]);
  const invoice=doc(211,'invoice',1);Object.assign(invoice.parsed.lines[0],{subtotalCents:400000,discountCents:0,taxCents:56538});
  const before=structuredClone(ledger);
  assert.throws(()=>applyDocumentImport(ledger,{type:'purchase.importDocuments',payload:{mode:'invoice',purchaseId:created.id,purchase:{},lines:structuredClone(ledger.purchases[0].items),documents:[invoice]}},{...clock,verifiedDocuments:metadata([invoice])}),/IVA y total/);
  assert.deepEqual(ledger,before);
});

test('legacy OCR payload using the compact time from the user screenshot is rejected atomically',()=>{
  const s=state(),sku=createProduct(s),order=doc(170);
  order.extraction='ocr';order.parsed.supplierOrder='021718';
  order.parsed.evidence={supplierOrder:'Número de orden Forma de pago D Mis métodos de 19/10/2026 021718'};
  const before=structuredClone(s);
  assert.throws(()=>importDocs(s,[order],[line(sku,[order])],{supplierOrder:'021718'}),/hora|fecha|referencia/i);
  assert.deepEqual(s,before);
  order.parsed.supplierOrder='599633002';order.parsed.supplierOrderOriginal='021718';order.parsed.supplierOrderReviewed=true;
  const saved=importDocs(s,[order],[line(sku,[order])],{supplierOrder:'599633002'});
  assert.equal(s.purchases.find(p=>p.id===saved.id).supplierOrder,'599633002');
  assert.equal(s.documents[0].parsed.supplierOrderOriginal,'021718');
  assert.equal(s.products[0].good,0);
});

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
  document.parsed.supplier='Nuevo proveedor';
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

test('cumulative invoices are checked at each attachment, and a third invoice cannot enlarge the purchase',()=>{
  const s=state(),sku=createProduct(s),order=doc(100),first=importDocs(s,[order],[line(sku,[order])]);
  assert.equal(s.purchases[0].supplierOrder,'599633002');
  for(const n of [101,102]){
    const invoice=doc(n,'invoice',1),purchase=s.purchases[0];
    importDocs(s,[invoice],[{...purchase.items[0],documentIds:[invoice.id],unitCostCents:n===102?409900:null}],{amountCents:n===102?819800:null},first.id);
  }
  assert.equal(s.documents.length,3);assert.equal(s.purchases[0].items[0].qty,2);
  const snapshot=JSON.stringify(s),extra=doc(103,'invoice',1);
  assert.throws(()=>importDocs(s,[extra],[{...s.purchases[0].items[0],qty:3,documentIds:[extra.id]}],{amountCents:1229700},first.id),/unidades facturadas|revisión indica 3/);
  assert.equal(JSON.stringify(s),snapshot);
});

test('wrong order, provider, product, missing reference and completed amount mismatch cannot be bypassed by reviewed fields',()=>{
  for(const kind of ['order','supplier','product','missing','amount']){
    const s=state(),sku=createProduct(s),order=doc(110),first=importDocs(s,[order],[line(sku,[order])]);
    const invoice=doc(111,'invoice',2);invoice.parsed.totalCents=819800;invoice.parsed.lines[0].totalCents=819800;
    if(kind==='order')invoice.parsed.supplierOrder='999999999';
    if(kind==='supplier')invoice.parsed.supplier='Otro proveedor';
    if(kind==='product')invoice.parsed.lines[0].supplierItem='999999';
    if(kind==='missing')invoice.parsed.supplierOrder=null;
    const snapshot=JSON.stringify(s),purchase=s.purchases[0];
    assert.throws(()=>importDocs(s,[invoice],[{...purchase.items[0],unitCostCents:409900,documentIds:[invoice.id]}],{supplierOrder:kind==='order'?'999999999':'599633002',amountCents:kind==='amount'?819900:819800},first.id));
    assert.equal(JSON.stringify(s),snapshot);
  }
});

test('same supplier and order in a different purchase is rejected even if the files are new',()=>{
  const s=state(),sku=createProduct(s),original=doc(120);importDocs(s,[original],[line(sku,[original])]);
  const second=doc(121),snapshot=JSON.stringify(s);
  assert.throws(()=>importDocs(s,[second],[line(sku,[second])]),/ya está registrada/);assert.equal(JSON.stringify(s),snapshot);
});

test('invoice without UUID is deduplicated by supplier and folio; conflicting duplicate evidence is rejected',()=>{
  const s=state(),sku=createProduct(s),first=doc(130,'invoice',1);first.parsed.uuid=null;
  const created=importDocs(s,[first],[line(sku,[first],{qty:1,unitCostCents:409900})],{amountCents:409900});
  const copy=doc(131,'invoice',1,130);copy.parsed.uuid=null;
  const result=importDocs(s,[copy],[{...s.purchases[0].items[0],documentIds:[copy.id]}],{},created.id);
  assert.equal(result.duplicateDocuments[0].reason,'invoiceNumber');assert.equal(s.documents.length,1);
  const wrong=doc(132,'invoice',1,130);wrong.parsed.uuid=null;wrong.parsed.supplierOrder='OTHER';const snapshot=JSON.stringify(s);
  assert.throws(()=>importDocs(s,[wrong],[{...s.purchases[0].items[0]}],{},created.id),/duplicado.*distintos/);assert.equal(JSON.stringify(s),snapshot);
});

test('an explicit reference correction on a stored document preserves immutable parsed evidence and its file',()=>{
  const s=state(),sku=createProduct(s),order=doc(140);order.parsed.supplierOrder=null;
  const created=importDocs(s,[order],[line(sku,[order])]);
  const stored=structuredClone(s.documents[0]),corrected={...order,parsed:{...order.parsed,supplierOrder:'599633002',supplierOrderReviewed:true,lines:[{supplierItem:'EVIL',name:'Changed',qty:999}]}},invoice=doc(141,'invoice',1);
  const result=importDocs(s,[corrected,invoice],[{...s.purchases[0].items[0],documentIds:[order.id,invoice.id]}],{supplierOrder:'599633002'},created.id);
  const saved=s.documents.find(doc=>doc.id===order.id);
  assert.equal(saved.parsed.supplierOrder,'599633002');assert.equal(saved.parsed.supplierOrderOriginal,null);assert.equal(saved.parsed.supplierOrderReviewed,true);
  assert.deepEqual(saved.parsed.lines,stored.parsed.lines);assert.equal(saved.sha256,stored.sha256);assert.equal(saved.name,stored.name);
  assert.equal(result.documentValidation.valid,true);assert.equal(s.purchases[0].items[0].qty,2);
});

test('an added order PDF must match the existing purchase items, even with the same supplier order number',()=>{
  const s=state(),sku=createProduct(s);
  const created=applyOperation(s,{type:'purchase.create',payload:{supplier:'Costco',supplierOrder:'599633002',date:'2026-10-19',items:[{sku,name:'MacBook Air',qty:2,unitCostCents:null}]}},clock);
  const order=doc(150),snapshot=JSON.stringify(s);
  assert.throws(()=>importDocs(s,[order],[{...s.purchases[0].items[0]}],{},created.id),/PDF de orden.*no corresponde|PDF de orden no contiene/);
  assert.equal(JSON.stringify(s),snapshot);
});
