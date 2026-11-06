import {installmentState} from './operations-v28.mjs?v=20261105-fiscal';
import {validatePurchaseDocuments} from './purchase-document-validation.mjs?v=20261105-fiscal';
const key=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLocaleLowerCase('es-MX');
const supplierKey=v=>key(v).replace(/[^a-z0-9&]/g,'');
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export function purchaseSuppliers(state){return [...([...(state.catalogs?.suppliers||[]).map(s=>typeof s==='string'?s:s.name),...(state.purchases||[]).map(p=>p.supplier),...(state.supplierProfiles||[]).map(p=>p.name)].filter(Boolean).reduce((map,name)=>{const id=supplierKey(name);if(!map.has(id))map.set(id,name);return map;},new Map())).values()].sort((a,b)=>a.localeCompare(b,'es'));}
export function purchaseView(p,state){
 const documents=(state.documents||[]).filter(d=>d.purchaseId===p.id),receipts=(state.purchaseReceipts||[]).filter(r=>r.purchaseId===p.id),physical=p.receiptMode==='physical'||receipts.length>0;
 const report=(p.items||[]).length?validatePurchaseDocuments(documents,{purchase:p,lines:p.items,products:state.products||[],purchases:state.purchases||[],purchaseId:p.id}):null;
 const lines=(p.items||[]).map((line,index)=>{const coverage=report?.lines[index],received=Number(line.receivedQty||0),invoiced=Number(coverage?.invoicedQty||0);return {...line,receivedQty:received,invoicedQty:invoiced,pendingReceiptQty:Math.max(0,line.qty-received),pendingInvoiceQty:Math.max(0,line.qty-invoiced),receivedUnbilledQty:Math.max(0,received-invoiced),invoiceDocumentIds:coverage?.invoiceDocumentIds||[],invoicedTotalCents:coverage?.invoicedTotalCents??null,invoicedNetCents:coverage?.invoicedNetCents??null,invoicedTaxCents:coverage?.invoicedTaxCents??null};});
 const goods=lines.filter(l=>l.kind!=='charge');
 const ordered=goods.reduce((s,l)=>s+l.qty,0),received=goods.reduce((s,l)=>s+l.receivedQty,0),invoiced=goods.reduce((s,l)=>s+l.invoicedQty,0),pendingInvoice=goods.reduce((s,l)=>s+l.pendingInvoiceQty,0),receivedUnbilled=goods.reduce((s,l)=>s+l.receivedUnbilledQty,0),historical=!physical&&p.receiptStatus==='Recibida completa';
 const stage=p.status==='Cancelada'||p.sicarHistory?.cancelled?'cancelled':historical?'historical':!lines.length?'draft':received>=ordered?'delivered':received>0?'partial':'pending';
 const billing=!lines.length?'unverified':!report?.valid?'review':report?.coverage==='complete'?'complete':invoiced>0?'partial':'pending';
 const invoicedAmountCents=report?.invoiceTotalCents??null,orderedAmountCents=p.amountSource==='invoices'?p.expectedAmountCents??(ordered>0&&invoiced>=ordered?invoicedAmountCents:null):p.amountCents??null;
 return {purchase:p,documents,receipts,report,orderedAmountCents,invoicedAmountCents,lines,ordered,received,invoiced,pendingReceipt:historical&&!p.sicarHistory?null:Math.max(0,ordered-received),pendingInvoice:lines.length?pendingInvoice:null,receivedUnbilled,physical,historical,stage,billing,canReceive:['pending','partial'].includes(stage),payment:installmentState(p,state.purchasePayments||[]),lastReceiptAt:receipts.map(r=>r.date).sort().at(-1)||null};
}
export function purchaseRows(state,f={}){return (state.purchases||[]).map(p=>purchaseView(p,state)).filter(r=>{
 const p=r.purchase,date=String(p.date||'').slice(0,10),text=key([p.id,p.number,p.sicar,p.supplier,p.supplierOrder,p.originalDocument,p.taxInvoice,...r.lines.map(l=>[l.name,l.sku,l.skuOrUpc,l.upc,l.supplierItem].join(' ')),...r.documents.map(d=>[d.name,d.parsed?.invoiceNumber,d.parsed?.uuid].join(' '))].join(' '));
 return (!f.query||text.includes(key(f.query)))&&(!f.supplier||supplierKey(p.supplier)===supplierKey(f.supplier))&&(!f.from||date>=f.from)&&(!f.to||date<=f.to)&&(!f.stage||f.stage==='all'||(f.stage==='delivered'?['delivered','historical'].includes(r.stage):r.stage===f.stage))&&(!f.billing||f.billing==='all'||f.billing==='missing'&&['pending','partial','review'].includes(r.billing)||f.billing==='received-unbilled'&&r.receivedUnbilled>0||r.billing===f.billing)&&(!f.payment||f.payment==='all'||f.payment==='pending'&&r.payment.balanceCents>0||f.payment==='paid'&&r.payment.balanceCents===0||f.payment==='unknown'&&r.payment.amountCents==null);
 }).sort((a,b)=>String(b.purchase.date||'').localeCompare(String(a.purchase.date||''))||String(b.purchase.id).localeCompare(String(a.purchase.id),undefined,{numeric:true}));}
export function purchaseSummary(rows){const s={count:rows.length,amountCents:0,balanceCents:0,unknownAmounts:0,receivableCount:0,pendingUnits:0,deliveredCount:0,historicalCount:0,missingInvoicesCount:0,pendingInvoiceUnits:0,receivedUnbilledUnits:0,detailedCount:0,unverifiedCount:0,stages:{all:rows.length,draft:0,pending:0,partial:0,delivered:0,historical:0,cancelled:0}};
 for(const r of rows){s.stages[r.stage]++;if(r.stage==='cancelled')continue;if(r.lines.length)s.detailedCount++;else s.unverifiedCount++;if(finite(r.payment.amountCents))s.amountCents+=r.payment.amountCents;else s.unknownAmounts++;if(finite(r.payment.balanceCents))s.balanceCents+=r.payment.balanceCents;if(r.canReceive){s.receivableCount++;s.pendingUnits+=r.pendingReceipt;}if(r.stage==='delivered')s.deliveredCount++;if(r.historical)s.historicalCount++;if(['pending','partial','review'].includes(r.billing)){s.missingInvoicesCount++;s.pendingInvoiceUnits+=r.pendingInvoice||0;}s.receivedUnbilledUnits+=r.receivedUnbilled;}return s;}
export function savePurchaseSupplier(state,command,ctx={}){
 const p=command.payload||{},name=String(p.name||'').trim().replace(/\s+/g,' '),email=String(p.email||'').trim(),rfc=String(p.rfc||'').trim().toUpperCase();
 if(!name||name.length>180)throw new Error('Escribe un nombre de proveedor de hasta 180 caracteres.');
 if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Revisa el correo del proveedor.');
 if(rfc&&!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc))throw new Error('Revisa el formato del RFC o déjalo pendiente.');
 if(purchaseSuppliers(state).some(s=>supplierKey(s)===supplierKey(name)))throw new Error('Ese proveedor ya existe. Selecciónalo en la compra.');
 const supplier={id:'PROV-'+command.id,name,rfc,email,phone:String(p.phone||'').trim().slice(0,60),notes:String(p.notes||'').trim().slice(0,2000),createdAt:ctx.now,actor:ctx.actor};
 state.catalogs??={};state.catalogs.suppliers??=[];state.catalogs.suppliers.push(name);(state.supplierProfiles??=[]).push(supplier);
 (state.events??=[]).unshift({id:command.id,type:command.type,date:ctx.now,actor:ctx.actor,result:'ok',message:'Proveedor registrado: '+name});return {ok:true,id:supplier.id,name,message:'Proveedor registrado. Ya puedes seleccionarlo en tus compras.'};
}

/** Import only independently consulted SICAR history. This never posts warehouse entries. */
export function previewSicarHistory(state,manifest){
 const fail=message=>{throw new Error(message);},money=n=>Number.isSafeInteger(n)&&n>=0;
 if(manifest?.format!=='AIMERKA-SICAR-HISTORY-1'||!Array.isArray(manifest.entries)||!manifest.entries.length||manifest.entries.length>200)fail('Archivo de cotejo SICAR inválido.');
 const products=structuredClone(state.products||[]),additions=[],seen=new Set(),entries=[];
 for(const p of manifest.newProducts||[]){
  if(!/^[A-Z0-9]{1,10}$/.test(p.sku||'')||!/^\d{12,14}$/.test(p.upc||'')||!p.name||!p.brand||!/^https:\/\/app\.sicarx\.com\/product\/detail\/[A-Za-z0-9]+$/.test(p.sourceUrl||''))fail('Producto nuevo de SICAR inválido.');
  const existing=products.find(q=>q.sku===p.sku||q.upc===p.upc);if(existing){if(existing.sku!==p.sku||existing.upc!==p.upc||existing.name!==p.name)fail('El producto nuevo coincide con otro SKU o UPC.');continue;}
  const product={sku:p.sku,upc:p.upc,name:String(p.name).slice(0,250),brand:String(p.brand).slice(0,100),model:String(p.model||'').slice(0,100),good:0,reserved:0,quarantine:0,damaged:0,safety:0,minStock:0,icon:'box',costCents:0,costStatus:'Por confirmar',priceCents:0,status:'OK',source:'SICAR histórico',sourceStock:null,sourceUrl:p.sourceUrl,review:'Alta documental histórica; confirmar existencia inicial y costo antes de vender.',categories:{},categoryOverrides:{}};
  products.push(product);additions.push(product);
 }
 for(const input of manifest.entries){
  const p=(state.purchases||[]).find(p=>p.id===input.purchaseId);
  if(!p||String(p.sicar)!==String(input.sicar)||seen.has(p.id))fail('Compra SICAR no encontrada o repetida.');seen.add(p.id);
  if(!/^https:\/\/app\.sicarx\.com\/queries\/purchases\/purchase-detail\?uuid=[a-zA-Z0-9-]+$/.test(input.sourceUrl||'')||!/^\d{4}-\d{2}-\d{2}$/.test(input.documentDate||'')||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(input.creationDate||'')||!/^[a-f0-9]{64}$/.test(input.sourceHash||''))fail('Falta la procedencia o fecha del documento SICAR '+p.sicar+'.');
  if(![input.sourceTotalCents,input.sourceSubtotalCents,input.sourceTaxCents].every(money)||input.sourceSubtotalCents+input.sourceTaxCents!==input.sourceTotalCents)fail('Subtotal, IVA y total no cuadran en SICAR '+p.sicar+'.');
  if(!Array.isArray(input.lines)||!input.lines.length||input.lines.length>200)fail('Faltan partidas en SICAR '+p.sicar+'.');
  const lines=input.lines.map((l,index)=>{
   const charge=l.kind==='charge',product=products.find(p=>p.sku===l.sku),pending=l.costStatus==='pending';
   if(!l.name||!Number.isSafeInteger(l.qty)||l.qty<=0||!money(l.unitCostCents)||!money(l.totalCents)||(!charge&&!product)||!['product','charge'].includes(l.kind)||!['pending','verified-sicar'].includes(l.costStatus)||![null,0,.16].includes(l.taxRate))fail('Revisa las partidas de SICAR '+p.sicar+'.');
   if(!/^\d+(?:\.\d+)?$/.test(l.sourceUnitCostMxn||'')||Math.round(Number(l.sourceUnitCostMxn)*100)!==l.unitCostCents)fail('Costo de origen inválido.');
   return {id:p.id+'-SICAR-'+(index+1),kind:l.kind,sku:charge?'':product.sku,skuOrUpc:charge?'':product.sku,upc:charge?'':product.upc||'',name:String(l.name).slice(0,500),supplierItem:String(l.sicarCode||'').slice(0,100),qty:l.qty,receivedQty:input.cancelled||charge?0:l.qty,unitCostCents:pending?null:l.unitCostCents,totalCents:pending?null:l.totalCents,sourceUnitCostMxn:l.sourceUnitCostMxn,sourceUnitCostCents:l.unitCostCents,sourceTotalCents:l.totalCents,taxRate:l.taxRate,costStatus:l.costStatus,sourceMatchMethod:String(l.matchMethod||'').slice(0,100),documentIds:[]};
  });
  if(lines.reduce((sum,l)=>sum+l.sourceTotalCents,0)!==input.sourceTotalCents)fail('Las partidas no suman el total de SICAR '+p.sicar+'.');
  const source={sicar:String(p.sicar),sourceUrl:input.sourceUrl,documentDate:input.documentDate,creationDate:input.creationDate,sourceSupplier:String(input.sourceSupplier||'').slice(0,250),sourceTotalCents:input.sourceTotalCents,sourceSubtotalCents:input.sourceSubtotalCents,sourceTaxCents:input.sourceTaxCents,sourceHash:input.sourceHash,cancelled:!!input.cancelled,cancellationReason:String(input.cancellationReason||'').slice(0,1000),costPending:lines.some(l=>l.costStatus==='pending')};
  const signature=JSON.stringify({source,lines});
  if(p.sicarHistory){if(p.sicarHistory.signature!==signature)fail('SICAR '+p.sicar+' ya fue cotejada con datos diferentes. Requiere revisión individual.');entries.push({purchase:p,duplicate:true,source,lines});continue;}
  if(p.items?.length||p.receiptMode==='physical'||(state.purchaseReceipts||[]).some(r=>r.purchaseId===p.id)||(state.documents||[]).some(d=>d.purchaseId===p.id))fail('La compra '+p.id+' ya tiene partidas o documentos; no se puede sobrescribir.');
  if((p.amountCents??null)!==(input.originalAmountCents??null)||(p.date??null)!==(input.originalDate??null))fail('La compra '+p.id+' cambió desde el cotejo. Actualiza el archivo.');
  if(p.status==='Cancelada'&&!source.cancelled)fail('El estado de cancelación no coincide en SICAR '+p.sicar+'.');
  entries.push({purchase:p,source,lines,signature,differenceCents:p.amountCents==null?null:source.sourceTotalCents-p.amountCents,duplicate:false});
 }
 if(additions.some(p=>!entries.some(e=>e.lines.some(l=>l.sku===p.sku))))fail('Un producto nuevo no corresponde a las compras del archivo.');
 return {entries,additions,count:entries.length,lineCount:entries.reduce((s,e)=>s+e.lines.length,0),importCount:entries.filter(e=>!e.duplicate).length,reviewCount:entries.filter(e=>e.source.costPending||Math.abs(e.differenceCents||0)>3).length};
}
export function importSicarHistory(state,command,ctx={}){
 if(!ctx.actor||String(ctx.actor).toLowerCase()!==String(ctx.ownerEmail||'').toLowerCase())throw new Error('Solo el propietario puede cotejar el histórico SICAR.');
 const plan=previewSicarHistory(state,command.payload?.manifest);
 for(const p of plan.additions)(state.products??=[]).push({...p,createdAt:ctx.now,updatedAt:ctx.now});
 for(const e of plan.entries){if(e.duplicate)continue;const p=e.purchase;
  p.sicarHistory={...e.source,signature:e.signature,differenceCents:e.differenceCents,original:{date:p.date??null,amountCents:p.amountCents??null,supplier:p.supplier,receiptStatus:p.receiptStatus??null,status:p.status},verifiedAt:ctx.now,actor:ctx.actor};
  p.items=e.lines;p.documentDate=e.source.documentDate;p.creationDate=e.source.creationDate;p.date=e.source.documentDate;p.receiptMode='historical-sicar';
  if(!p.supplier)p.supplier=e.source.sourceSupplier;
  if(e.source.cancelled){p.status='Cancelada';p.receiptStatus='Pendiente';}else p.receiptStatus='Recibida completa';
  p.updatedAt=ctx.now;
 }
 if(plan.importCount)(state.events??=[]).unshift({id:command.id,type:command.type,date:ctx.now,actor:ctx.actor,result:'ok',message:`${plan.importCount} compras cotejadas en SICAR; sin movimientos de inventario.`,purchaseIds:plan.entries.filter(e=>!e.duplicate).map(e=>e.purchase.id)});
 return {ok:true,count:plan.importCount,duplicates:plan.count-plan.importCount,lineCount:plan.lineCount,reviewCount:plan.reviewCount,message:`${plan.importCount} compras cotejadas. Inventario y pagos conservados.`};
}
