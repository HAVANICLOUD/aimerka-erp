import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePurchaseDocument,matchPurchaseLine,combinePurchaseDocuments,normalizeSupplier} from '../lib/purchase-document-parser.mjs';

// Synthetic fixtures retain the supplier's layout, without customer identity,
// tax IDs, addresses, actual invoice UUIDs, or financial document attachments.
const NAME='Aspiradora Prueba V12 Digital Slim';
const ORDER=`Detalles de Mi Orden 29/10/26, 5:17 a.m.
Oferta de otro producto: sensores a $3,699
Costco
Fecha de creación Número de orden Forma de pago
19/10/2026 02:17:18 600000001 Visa
PM
Estatus
Enviada
Total
${NAME}
# 700001
Estatus
Entregado (2 artículos)
Rastreo de la orden
Guía ENVIO_A - 1 artículo
Guía ENVIO_B - 1 artículo
Cantidad
2
Resumen de tu orden
Precio original
Ahorros
Total
Sub Total
IVA
https://www.costco.com.mx/my-account/order/600000001 Página 1 de 1`;

function invoiceText({number='90000001',uuid='11111111-1111-4111-8111-111111111111',order='600000001',item='700001',currency='MXN',qty='1.000',name=NAME}={}) {
  return `TIPO DE COMPROBANTE: I Ingreso
21 de Octubre de 2026
HORA DE EMISIÓN: 15:46:46
FOLIO FISCAL: PRU ${number}
${uuid}
Versión de CFDI 4.0
EMISOR RECEPTOR
COSTCO DE MEXICO
Clave No de Clave de Cantidad Descripción Valor Importe Descuento Objeto Base Impuesto Tipo Tasa Importe
identificación Unidad Unitario Imp Factor
47121602 ${item} H87 Pieza ${qty} ${name} 6,895.69 6,895.69 3,362.07 02 3,533.6250 002 Tasa 0.160000 565.38
W W W W W W W W W W W W W W W W
Orden: ${order} Folio: 780000000600000001_1 Fecha: 19/10/2026 Subtotal $6,895.69
Moneda ${currency} Descuento $3,362.07
Método de Pago: PUE Pago en una sola exhibición IVA al 16.00% $565.38
Forma de Pago: 04 Tarjeta de crédito Total $4,099.00
Uso CFDI: G01 Adquisición de mercancias`;
}

const orderDoc=()=>parsePurchaseDocument(ORDER,{fileName:'orden-costco.pdf'});
const invoice1=()=>parsePurchaseDocument(invoiceText(),{fileName:'factura-prueba-1.pdf'});
const invoice2=()=>parsePurchaseDocument(invoiceText({number:'90000002',uuid:'22222222-2222-4222-8222-222222222222'}),{fileName:'factura-prueba-2.pdf'});
const wrapper=(id,parsed,sha256)=>({id,parsed,...(sha256 ? {sha256} : {})});

test('Costco order takes quantity and creation date, never banner prices or supplier delivery as receipt',()=>{
  const result=orderDoc();
  assert.equal(result.kind,'order');
  assert.equal(result.parser,'costco_order');
  assert.equal(result.supplierOrder,'600000001');
  assert.equal(result.date,'2026-10-19');
  assert.equal(result.lines.length,1);
  assert.equal(result.lines[0].name,NAME);
  assert.equal(result.lines[0].supplierItem,'700001');
  assert.equal(result.lines[0].qty,2);
  assert.equal(result.lines[0].unitCostCents,null);
  assert.equal(result.lines[0].upc,null);
  assert.equal(result.totalCents,null);
  assert.equal(result.receiptStatus,undefined);
  assert.equal(result.receivedQty,undefined);
  assert.match(result.warnings.join(' '),/no confirma recepción/);
});

test('order still recognizes compact PDF.js whitespace; delivered count cannot replace missing Cantidad',()=>{
  const compact=parsePurchaseDocument(ORDER.replace(/\s+/g,' '),{fileName:'costco.pdf'});
  assert.equal(compact.lines[0].name,NAME);
  assert.equal(compact.lines[0].qty,2);
  const incomplete=parsePurchaseDocument(ORDER.replace('Cantidad\n2','Cantidad\nNo legible'),{fileName:'costco.pdf'});
  assert.equal(incomplete.lines[0].qty,null);
  assert.equal(combinePurchaseDocuments([incomplete]).canImport,false);
});

test('CFDI amounts include the documented discount and IVA; PUE remains informational',()=>{
  const result=invoice1(),line=result.lines[0];
  assert.equal(result.parser,'costco_invoice');
  assert.equal(result.invoiceNumber,'PRU 90000001');
  assert.equal(result.uuid,'11111111-1111-4111-8111-111111111111');
  assert.equal(result.date,'2026-10-21');
  assert.equal(result.orderDate,'2026-10-19');
  assert.equal(result.currency,'MXN');
  assert.equal(line.qty,1);
  assert.equal(line.supplierItem,'700001');
  assert.equal(line.listedUnitPriceCents,689569);
  assert.equal(line.subtotalCents,689569);
  assert.equal(line.discountCents,336207);
  assert.equal(line.taxCents,56538);
  assert.equal(line.taxBase,'3,533.6250');
  assert.equal(line.totalCents,409900);
  assert.equal(line.unitCostCents,409900);
  assert.equal(result.totalCents,409900);
  assert.equal(result.paymentMethod,'PUE');
  assert.equal(result.paymentForm,'04');
  assert.equal(result.paidCents,undefined);
  assert.equal(result.paymentStatus,undefined);
  assert.equal(line.upc,null);
  assert.equal(result.requiresReview,true);
  assert.match(result.evidence.totalCents,/4,099\.00/);
});

test('CFDI parser handles PDF text fragmented across many rows or completely flattened',()=>{
  const flat=invoiceText().replace(/\s+/g,' ');
  for (const source of [flat,flat.split(' ').join('\n'),flat.replace(/ /g,'\u00a0')]) {
    const result=parsePurchaseDocument(source);
    assert.equal(result.lines.length,1);
    assert.equal(result.lines[0].name,NAME);
    assert.equal(result.lines[0].qty,1);
    assert.equal(result.lines[0].unitCostCents,409900);
    assert.equal(result.totalCents,409900);
  }
});

test('Costco PDF.js header with labels before values retains the printed invoice series and folio',()=>{
  for (const [number,uuid] of [['90000001','11111111-1111-4111-8111-111111111111'],['90000002','22222222-2222-4222-8222-222222222222']]) {
    const header=`TIPO DE COMPROBANTE:
NO. SERIE DEL CERTIFICADO DEL CSD:
LUGAR Y FECHA DE EMISIÓN:
HORA DE EMISIÓN:
FOLIO FISCAL:
I Ingreso
00000000000000000000
Localidad Prueba
21 de Octubre de 2026
15:46:46
BMG ${number}
${uuid}
`;
    const source=invoiceText({number,uuid}).replace(/^[\s\S]*?(?=Versión de CFDI)/,header);
    for (const text of [source,source.replace(/\s+/g,' ')]) {
      const result=parsePurchaseDocument(text,{fileName:'CFD_BMG_99999999.pdf'});
      assert.equal(result.invoiceNumber,`BMG ${number}`);
      assert.equal(result.evidence.invoiceNumber,`BMG ${number}`);
      assert.equal(result.uuid,uuid);
      assert.equal(result.supplierOrder,'600000001');
      assert.equal(result.totalCents,409900);
    }
    const missing=parsePurchaseDocument(source.replace(`BMG ${number}\n`,''),{fileName:`CFD_BMG_${number}.pdf`});
    assert.equal(missing.invoiceNumber,null);
    assert.equal(missing.evidence.invoiceNumber,undefined);
  }
});

test('missing or unfamiliar text leaves unknown money null and asks for manual review',()=>{
  const result=parsePurchaseDocument('Texto borroso e incompleto. Precio promocional $1,234.00');
  assert.equal(result.kind,'unknown');
  assert.equal(result.totalCents,null);
  assert.equal(result.currency,null);
  assert.deepEqual(result.lines,[]);
  assert.equal(result.requiresReview,true);
  assert.match(result.warnings.join(' '),/No se reconocieron partidas/);
  assert.throws(()=>parsePurchaseDocument(null),TypeError);
});

test('generic table recognizes UPC only in a labeled column and does not invent final costs from quoted prices',()=>{
  const result=parsePurchaseDocument(`Orden de compra
Proveedor: Proveedor Prueba
Orden: OC-10001
Fecha: 19/10/2026
Moneda: MXN
Artículo | Descripción | Cantidad | UPC | Precio unitario | Importe
P100 | Audífonos Prueba Azul | 2 | 012345678905 | 100.00 | 232.00
P200 | Cargador Prueba | 1 | | 300.00 | 
Total: $532.00`);
  assert.equal(result.parser,'generic_table');
  assert.equal(result.supplier,'Proveedor Prueba');
  assert.equal(result.lines[0].upc,'012345678905');
  assert.equal(result.lines[0].unitCostCents,11600);
  assert.equal(result.lines[0].listedUnitPriceCents,10000);
  assert.equal(result.lines[1].upc,null);
  assert.equal(result.lines[1].unitCostCents,null);
  assert.equal(result.lines[1].listedUnitPriceCents,30000);
  assert.equal(result.totalCents,53200);
});

test('subtotal is not misread as total and invalid dates remain null',()=>{
  const result=parsePurchaseDocument('Orden de compra\nFecha: 31/02/2026\nSub Total $100.00');
  assert.equal(result.subtotalCents,10000);
  assert.equal(result.totalCents,null);
  assert.equal(result.date,null);
});

test('explicit UPC in a CFDI description is preserved, never inferred from SAT/item/folio',()=>{
  const result=parsePurchaseDocument(invoiceText({name:`${NAME} UPC: 012345678905`}));
  assert.equal(result.lines[0].upc,'012345678905');
  assert.equal(invoice1().lines[0].upc,null);
});

test('order plus two complementary invoices is two units, with documents linked, not four',()=>{
  const documents=[wrapper('order-1',orderDoc()),wrapper('invoice-1',invoice1()),wrapper('invoice-2',invoice2())];
  const before=structuredClone(documents),result=combinePurchaseDocuments(documents);
  assert.equal(result.canImport,true);
  assert.equal(result.invoiceCoverage,'complete');
  assert.equal(result.lines.length,1);
  assert.equal(result.lines[0].qty,2);
  assert.equal(result.lines[0].orderedQty,2);
  assert.equal(result.lines[0].invoicedQty,2);
  assert.equal(result.lines[0].unitCostCents,409900);
  assert.equal(result.lines[0].totalCents,819800);
  assert.equal(result.totalCents,819800);
  assert.equal(result.invoiceTotals.totalCents,819800);
  assert.equal(result.subtotalCents,1379138);
  assert.equal(result.discountCents,672414);
  assert.equal(result.taxCents,113076);
  assert.deepEqual(result.lines[0].documentIds,['order-1','invoice-1','invoice-2']);
  assert.deepEqual(result.lines[0].invoiceDocumentIds,['invoice-1','invoice-2']);
  assert.equal(result.lines[0].upc,null);
  assert.deepEqual(documents,before);
});

test('partial invoice coverage preserves unknown purchase and unit costs',()=>{
  const result=combinePurchaseDocuments([wrapper('o',orderDoc()),wrapper('i',invoice1())]);
  assert.equal(result.canImport,true);
  assert.equal(result.lines[0].qty,2);
  assert.equal(result.lines[0].invoicedQty,1);
  assert.equal(result.lines[0].invoicedTotalCents,409900);
  assert.equal(result.lines[0].unitCostCents,null);
  assert.equal(result.totalCents,null);
  assert.equal(result.invoiceTotals.totalCents,409900);
  assert.equal(result.invoiceCoverage,'partial');
});

test('invoices alone aggregate units once per distinct invoice and preserve cost',()=>{
  const result=combinePurchaseDocuments([invoice1(),invoice2()]);
  assert.equal(result.canImport,true);
  assert.equal(result.lines.length,1);
  assert.equal(result.lines[0].qty,2);
  assert.equal(result.lines[0].totalCents,819800);
  assert.equal(result.lines[0].unitCostCents,409900);
  assert.equal(result.totalCents,819800);
});

test('duplicate invoice UUID ignores case and is excluded from quantities and totals',()=>{
  const original=invoice1(),copy=structuredClone(original);
  copy.uuid=copy.uuid.toUpperCase();
  const result=combinePurchaseDocuments([wrapper('o',orderDoc()),wrapper('i1',original),wrapper('i1-copy',copy),wrapper('i2',invoice2())]);
  assert.equal(result.totalCents,819800);
  assert.equal(result.lines[0].qty,2);
  assert.equal(result.lines[0].invoicedQty,2);
  assert.deepEqual(result.duplicates.map(({documentId,duplicateOf,reason})=>({documentId,duplicateOf,reason})),[{documentId:'i1-copy',duplicateOf:'i1',reason:'uuid'}]);
  assert.deepEqual(result.documentIds,['o','i1','i2']);
});

test('file hashes detect duplicate documents even without UUID; filenames alone never deduplicate',()=>{
  const first=invoice1(),second=invoice2();
  first.uuid=null;second.uuid=null;
  const duplicate=combinePurchaseDocuments([wrapper('a',first,'abc'),wrapper('b',structuredClone(first),'abc')]);
  assert.equal(duplicate.lines[0].qty,1);
  assert.equal(duplicate.duplicates[0].reason,'sha256');
  second.fileName=first.fileName;
  const distinct=combinePurchaseDocuments([wrapper('a',first,'abc'),wrapper('b',second,'def')]);
  assert.equal(distinct.lines[0].qty,2);
  assert.equal(distinct.duplicates.length,0);
});

test('conflicting duplicate amounts block import',()=>{
  const copy=invoice1();copy.totalCents=410000;
  const result=combinePurchaseDocuments([invoice1(),copy]);
  assert.equal(result.canImport,false);
  assert.match(result.blockingWarnings.join(' '),/importes distintos/);
});

test('different suppliers, order references, or currencies cannot be confirmed together',()=>{
  for (const change of [{supplier:'Otro proveedor'},{supplierOrder:'600000099'},{currency:'USD'}]) {
    const second={...invoice2(),...change};
    const result=combinePurchaseDocuments([orderDoc(),invoice1(),second]);
    assert.equal(result.canImport,false);
    assert.equal(result.totalCents,null);
    assert.ok(result.blockingWarnings.length>0);
  }
});

test('unmatched invoice items and over-invoiced units cannot silently expand the order',()=>{
  const wrong=invoice2();wrong.lines[0].supplierItem='700099';wrong.lines[0].name='Otro artículo';
  const mismatch=combinePurchaseDocuments([orderDoc(),wrong]);
  assert.equal(mismatch.canImport,false);
  assert.equal(mismatch.lines.length,1);
  assert.equal(mismatch.lines[0].qty,2);
  assert.equal(mismatch.unmatchedInvoiceLines.length,1);
  const third=invoice2();third.uuid='33333333-3333-4333-8333-333333333333';
  const excess=combinePurchaseDocuments([orderDoc(),invoice1(),invoice2(),third]);
  assert.equal(excess.canImport,false);
  assert.equal(excess.lines[0].qty,2);
  assert.equal(excess.lines[0].invoicedQty,3);
});

test('duplicate order snapshots do not double ordered quantity; conflicting snapshots require review',()=>{
  const original=orderDoc();
  const result=combinePurchaseDocuments([wrapper('o1',original),wrapper('o2',structuredClone(original)),invoice1(),invoice2()]);
  assert.equal(result.lines[0].qty,2);
  assert.equal(result.totalCents,819800);
  const changed=orderDoc();changed.lines[0].qty=3;
  assert.equal(combinePurchaseDocuments([original,changed]).canImport,false);
});

test('a known order total remains its own documented value during invoice reconciliation',()=>{
  const order=orderDoc();order.totalCents=820000;
  const result=combinePurchaseDocuments([order,invoice1(),invoice2()]);
  assert.equal(result.totalCents,820000);
  assert.match(result.warnings.join(' '),/total de la orden difiere/);
});

const products=[
  {sku:'ASP-PRU-V12-MOR',name:NAME,upc:'012345678905',supplierCodes:[{supplier:'Costco de México, S.A. de C.V.',item:'700001',name:NAME}]},
  {sku:'ASP-PRU-V15-AZU',name:'Aspiradora Prueba V15 Azul',upc:'123456789012',supplierCodes:[]},
  {sku:'AUD-PRU-AZU',name:'Audífonos Prueba Azul',upc:null,supplierCodes:[]}
];

test('supplier normalization equates accents, punctuation and corporate suffixes without merging unrelated suppliers',()=>{
  for (const name of ['Costco','COSTCO DE MEXICO','Costco de México, S.A. de C.V.','Costco de México SA CV']) assert.equal(normalizeSupplier(name),'COSTCO');
  assert.equal(normalizeSupplier('Proveedor Prueba S. de R.L. de C.V.'),'PROVEEDOR PRUEBA');
  assert.notEqual(normalizeSupplier('Costco Outlet Ajeno'),'COSTCO');
});

test('UPC is the strongest exact match and accepts UPC/EAN leading zero equivalence',()=>{
  for (const upc of ['012345678905','0012345678905']) {
    const result=matchPurchaseLine({upc,name:'Nombre sin relación'},products);
    assert.equal(result.sku,products[0].sku);
    assert.equal(result.confidence,'exact_upc');
  }
});

test('supplier article equivalences and unique normalized names can auto-match',()=>{
  const byArticle=matchPurchaseLine({supplierItem:'700001',name:'Nombre del proveedor'},products,[],'COSTCO DE MEXICO SA CV');
  assert.equal(byArticle.sku,products[0].sku);
  assert.equal(byArticle.confidence,'supplier_item');
  const byName=matchPurchaseLine({name:'audifonos prueba AZUL'},products);
  assert.equal(byName.sku,'AUD-PRU-AZU');
  assert.equal(byName.confidence,'name');
  const equivalences=[{supplier:'Proveedor Prueba S.A. de C.V.',item:'AC-10',name:'Auricular proveedor',sku:'AUD-PRU-AZU'}];
  assert.equal(matchPurchaseLine({supplierItem:'AC-10'},products,equivalences,'Proveedor Prueba').sku,'AUD-PRU-AZU');
  assert.equal(matchPurchaseLine({name:'Auricular proveedor'},products,equivalences,'Proveedor Prueba').sku,'AUD-PRU-AZU');
  assert.equal(matchPurchaseLine({supplierItem:'AC-10'},products,equivalences,'Otro proveedor').sku,null);
});

test('ambiguity, conflicting barcodes, and fuzzy names always require manual selection',()=>{
  const duplicate=[...products,{sku:'DUPLICADO',name:NAME,upc:'012345678905'}];
  for (const line of [{upc:'012345678905'},{name:NAME}]) {
    const result=matchPurchaseLine(line,duplicate);
    assert.equal(result.sku,null);
    assert.equal(result.confidence,'suggestion');
    assert.equal(result.candidates.length,2);
  }
  const conflict=matchPurchaseLine({name:NAME,upc:'999999999999',supplierItem:'700001'},products,[],'Costco');
  assert.equal(conflict.sku,null);
  assert.equal(conflict.confidence,'suggestion');
  assert.match(conflict.candidates[0].reason,/no coincide/);
  const fuzzy=matchPurchaseLine({name:'Aspiradora Prueba V12 inalámbrica'},products);
  assert.equal(fuzzy.sku,null);
  assert.equal(fuzzy.confidence,'suggestion');
  const missing=matchPurchaseLine({name:'Mochila escolar'},products);
  assert.equal(missing.sku,null);
  assert.equal(missing.confidence,'unmatched');
});

test('ambiguous supplier equivalences do not silently choose an SKU and matching does not mutate inputs',()=>{
  const before=structuredClone(products);
  const result=matchPurchaseLine({supplierItem:'700001'},products,[{supplier:'Costco',item:'700001',sku:'ASP-PRU-V15-AZU'}],'Costco');
  assert.equal(result.sku,null);
  assert.equal(result.confidence,'suggestion');
  assert.deepEqual(products,before);
});
