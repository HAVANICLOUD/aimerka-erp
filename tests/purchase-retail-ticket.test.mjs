import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parsePurchaseDocument,combinePurchaseDocuments,matchPurchaseLine} from '../lib/purchase-document-parser.mjs';
import {recognitionProfile,readSupplierTicket,saveRecognitionProfile} from '../lib/purchase-recognition-profiles.mjs';
import {applyDocumentImport} from '../lib/purchase-document-commands.mjs';
const invoice=`TIPO DE COMPROBANTE: I Ingreso
24 de Noviembre de 2026
FOLIO FISCAL: QA 90001
11111111-1111-4111-8111-111111111111
Versión de CFDI 4.0
EMISOR RECEPTOR
COSTCO DE MEXICO
R.F.C. BBB010101BBB Régimen Fiscal: 601 Nombre: EMPRESA DE PRUEBA
R.F.C. AAA010101AAA Domicilio fiscal: 01000 Régimen Fiscal: 626
Uso CFDI: G01 Adquisición de mercancías
Clave No de Clave de Cantidad Descripción Valor Importe Descuento Objeto Base Impuesto Tipo Tasa Importe
identificación Unidad Unitario Imp Factor
52161525 696161 H87 Pieza 4.000 INALAMBRICO PARA PS5 NEGRO O ROJO DUALSENSE CONTROL 1,189.67 4,758.68 796.64 02 3,962.0400 002 Tasa 0.160000 633.96
43191600 701954 H87 Pieza 2.000 AIRTAG 2 4 PIEZAS APPLE 1,586.53 3,173.06 588.58 02 2,584.4800 002 Tasa 0.160000 413.52
54111501 707095 H87 Pieza 6.000 GPS 40MM ALUMINIO BLANCO ESTELAR APPLE WATCH SE 3 4,673.17 28,039.03 7,354.54 02 20,684.4900 002 Tasa 0.160000 3,309.51
54111501 707097 H87 Pieza 5.000 GPS 44MM ALUMINIO MEDIANOCHE APPLE WATCH SE 3 5,290.50 26,452.50 6,629.23 02 19,823.2700 002 Tasa 0.160000 3,171.73
SUBTOTAL 62,423.27
DESCUENTO 15,368.99
IVA 7,528.72
TOTAL 54,583.00
Moneda: MXN
Número de Ticket: 00070200906841118262106
Fecha de la transacción: 18/11/2026`;

test('Costco retail CFDI starts an order using its exact ticket and four discounted purchase lines',()=>{
 const p=parsePurchaseDocument(invoice);assert.equal(p.kind,'invoice');assert.equal(p.supplierReferenceType,'ticket');assert.equal(p.supplierOrder,'00070200906841118262106');assert.equal(p.ticketNumber,p.supplierOrder);assert.equal(p.orderDate,'2026-11-18');assert.equal(p.date,'2026-11-24');assert.equal(p.recipientRfc,'AAA010101AAA');assert.equal(p.recipientTaxRegime,'626');assert.equal(p.totalCents,5458300);
 assert.deepEqual(p.lines.map(l=>[l.supplierItem,l.qty,l.unitCostCents]),[['696161',4,114900],['701954',2,149900],['707095',6,399900],['707097',5,459900]]);
 const c=combinePurchaseDocuments([{id:'retail',parsed:p}]);assert.equal(c.date,'2026-11-18');assert.equal(c.supplierOrder,p.supplierOrder);assert.equal(c.canImport,true);
 const products=[{sku:'EXISTING',name:'Control de juego',supplierCodes:[{supplier:'Costco',item:'696161'}]}];assert.equal(matchPurchaseLine(p.lines[0],products,[],'Costco').sku,'EXISTING');for(const line of p.lines.slice(1))assert.equal(matchPurchaseLine(line,products,[],'Costco').sku,null);
});

test('ticket rules are tenant and supplier scoped; conflicting orders are not replaced by a ticket',()=>{
 const a={config:{purchaseRecognition:{profiles:[]}}},b={config:{}},profile={supplier:'Otro proveedor',acceptTicket:true,ticketLabels:['Recibo (caja)']};saveRecognitionProfile(a,{id:'a',type:'config.purchaseRecognition.save',payload:profile},{now:'2026-11-24'});
 assert.equal(readSupplierTicket('Recibo (caja): 00012345',recognitionProfile('Otro proveedor',a.config.purchaseRecognition)).value,'00012345');assert.equal(recognitionProfile('Otro proveedor',b.config.purchaseRecognition).acceptTicket,false);assert.equal(recognitionProfile('Costco',a.config.purchaseRecognition).acceptTicket,true);
 assert.equal(readSupplierTicket('Ticket: 12345 Ticket: 23456',recognitionProfile('Costco')).value,null);
 assert.equal(parsePurchaseDocument(invoice,{recognitionConfig:{profiles:[{supplier:'Costco',acceptTicket:false}]}}).supplierOrder,null);
 assert.notEqual(parsePurchaseDocument(invoice+'\nNúmero de orden: 600000001\nNúmero de orden: 600000002').supplierOrder,'00070200906841118262106');
});

test('rotated PDF coordinates retain displayed row and column order for text and streaming paths',async()=>{
 const context={window:{},console,URL,TextDecoder,setTimeout,clearTimeout};vm.runInNewContext(fs.readFileSync(new URL('../public/erp/document-reader.js',import.meta.url),'utf8'),context);
 for(const transform of [[1,0,0,-1,0,120],[0,1,1,0,0,0],[-1,0,0,1,120,0],[0,-1,-1,0,120,120]]){
  const [a,b,c,d,e,f]=transform,det=a*d-b*c,items=[['Item',0,10],['Cantidad',30,10],['701954',0,30],['2',30,30]].map(([str,x,y])=>({str,transform:[1,0,0,1,(d*(x-e)-c*(y-f))/det,(-b*(x-e)+a*(y-f))/det]}));
  const page={getViewport:()=>({transform}),getTextContent:async()=>({items})};
  for(const stream of [false,true]){if(stream)page.streamTextContent=()=>({getReader:()=>{let done=false;return {read:async()=>done?{done:true}:(done=true,{value:{items},done:false}),releaseLock(){}};}});const rows=(await context.window.DocumentReader29.readPDFText(page,true)).split('\n').map(s=>s.trim().replace(/\s+/g,' '));assert.deepEqual(rows,['Item Cantidad','701954 2']);}
 }
});

test('invoice-origin purchase stores ticket and PDFs without receiving stock or changing average cost',()=>{
 const p=parsePurchaseDocument(invoice),state={products:p.lines.map((l,i)=>({sku:'P'+i,name:l.name,brand:'QA',upc:'',physical:3,reserved:0,safety:0,costCents:77700,averageCostMxn:777,supplierCodes:[{supplier:'Costco',item:l.supplierItem}]})),orders:[],purchases:[],purchasePayments:[],expenses:[],expensePayments:[],documents:[],supplierEquivalences:[],creditRules:[],movements:[],events:[],catalogs:{suppliers:['Costco'],lenders:['Empresa'],instruments:['Tarjeta']}};
 const id='a'.repeat(64),document={id,sha256:id,parsed:p,extraction:'pdf-text'},before=structuredClone(state.products);
 const r=applyDocumentImport(state,{id:'retail-order',type:'purchase.importDocuments',payload:{purchase:{supplier:'Costco',supplierOrder:p.supplierOrder,date:p.orderDate,shippingStatus:'Pendiente'},documents:[document],lines:p.lines.map((l,i)=>({...l,sku:'P'+i,documentIds:[id]}))}},{now:'2026-11-24T18:00:00Z',today:'2026-11-24',actor:'QA',verifiedDocuments:[{id,sha256:id,name:'test.pdf',mime:'application/pdf',size:500}]});
 assert.ok(r);assert.equal(state.purchases[0].supplierReferenceType,'ticket');assert.equal(state.purchases[0].ticketNumber,p.ticketNumber);assert.equal(state.documents[0].lineLinks.length,4);assert.deepEqual(state.products.map(p=>[p.physical,p.costCents,p.averageCostMxn]),before.map(p=>[p.physical,p.costCents,p.averageCostMxn]));assert.equal(state.movements.length,0);
});
