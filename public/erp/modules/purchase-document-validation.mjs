import {validateInvoiceFiscal} from './purchase-catalogs.mjs?v=20261125-wizard';
/** Shared, side-effect-free validation of the complete documentary purchase file. */
import {normalizeSupplier,normalizeSupplierOrder,isTemporalSupplierOrder} from './purchase-document-parser.mjs?v=20261105-fiscal';

const text=value=>String(value??'').trim();
const norm=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const item=value=>text(value).toUpperCase().replace(/\s+/g,'');
const unique=values=>[...new Set(values.filter(Boolean))];
const money=value=>Number.isSafeInteger(value)&&value>=0;
const qty=value=>Number.isSafeInteger(value)&&value>0;
const barcode=value=>/^\d{8}$|^\d{12,14}$/.test(text(value))?text(value).padStart(14,'0'):'';
const invoiceKey=value=>text(value).toUpperCase().replace(/\s+/g,'');
const orderReference=value=>isTemporalSupplierOrder(value)?'':normalizeSupplierOrder(value);
const contextualTemporalReference=(value,parsed)=>isTemporalSupplierOrder(value,{context:text(parsed?.evidence?.supplierOrder)});
const rejectedReference=(value,parsed)=>Boolean(normalizeSupplierOrder(value)&&(Array.isArray(parsed?.supplierOrderRejectedCandidates)?parsed.supplierOrderRejectedCandidates:[]).some(candidate=>
  candidate&&typeof candidate==='object'&&normalizeSupplierOrder(candidate.value)===normalizeSupplierOrder(value)&&(text(candidate.reason)||text(candidate.evidence))
  &&!(candidate.reason==='ambiguous_columns'&&parsed.supplierOrderReviewed===true&&normalizeSupplierOrder(value)===normalizeSupplierOrder(parsed.supplierOrder))));
const unresolvedReference=parsed=>Boolean(parsed?.supplierOrderNeedsReview&&!(parsed.supplierOrderReviewed&&text(parsed.supplierOrder)));
const documentOrderReference=parsed=>unresolvedReference(parsed)||contextualTemporalReference(parsed.supplierOrder,parsed)||rejectedReference(parsed.supplierOrder,parsed)?'':orderReference(parsed.supplierOrder);

/** Historical references must be explicit; invoice batches never establish a majority anchor. */
export function purchaseOrderReference(purchase={}){
  if(text(purchase?.supplierOrder))return orderReference(purchase.supplierOrder);
  const labeled=text(purchase?.originalDocument).match(/^(?:ORDEN|PEDIDO)\s*[:#]?\s+([A-Z0-9]+(?:[-/][A-Z0-9]+)*)$/i);
  return labeled?orderReference(labeled[1]):'';
}

/** A folio may be used as a duplicate identity only within its explicit supplier. */
export function purchaseDocumentIdentityKeys(doc){
  const p=doc.parsed||doc,supplier=normalizeSupplier(p.supplier),folio=invoiceKey(p.invoiceNumber);
  return unique([text(doc.id)&&'id:'+text(doc.id).toLowerCase(),text(doc.sha256||doc.hash)&&'sha256:'+text(doc.sha256||doc.hash).toLowerCase(),
    text(p.uuid)&&'uuid:'+text(p.uuid).toLowerCase(),p.kind==='invoice'&&supplier&&folio&&'invoice:'+supplier+':'+folio]);
}

/** Compare only known facts; missing OCR evidence does not contradict a known value. */
export function conflictingPurchaseDocumentCopies(a,b){
  const x=a.parsed||a,y=b.parsed||b;
  const values=[['supplier',normalizeSupplier],['supplierOrder',normalizeSupplierOrder],['currency',v=>text(v).toUpperCase()],['invoiceNumber',invoiceKey],['uuid',v=>text(v).toLowerCase()]];
  if(x.kind&&y.kind&&x.kind!==y.kind)return true;
  for(const [key,normalize] of values)if(text(x[key])&&text(y[key])&&normalize(x[key])!==normalize(y[key]))return true;
  for(const key of ['totalCents','subtotalCents','discountCents','taxCents'])if(money(x[key])&&money(y[key])&&x[key]!==y[key])return true;
  if(x.lines?.length&&y.lines?.length){
    const signature=rows=>JSON.stringify(rows.map(line=>[item(line.supplierItem),text(line.sku).toUpperCase(),barcode(line.upc),norm(line.name),line.qty,line.totalCents??null]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
    if(signature(x.lines)!==signature(y.lines))return true;
  }
  return false;
}

export function validatePurchaseDocuments(documents=[],options={}){
  const {purchase={},lines=[],products=[],purchases=[],purchaseId=null}=options;
  const original=options.originalPurchase||(purchaseId?purchases.find(row=>row.id===purchaseId):null);
  // A standalone purchase may genuinely have no supplier order number.
  // Require explicit review, and never use this exception to bypass an existing
  // order, a conflicting reference, or an ambiguous OCR candidate.
  const withoutOrder=!purchaseOrderReference(purchase)&&!purchaseOrderReference(original)&&!documents.some(doc=>{
    const p=doc.parsed||doc;
    return text(p.supplierOrder)||p.supplierOrderConflict||p.supplierOrderCandidates?.length||p.supplierOrderRejectedCandidates?.length;
  });
  const absentConfirmed=parsed=>withoutOrder&&parsed.supplierOrderAbsentConfirmed===true;
  const issues=[],documentChecks=[],seen=new Map(),docs=[];
  const issue=(code,severity,message,documentIds=[],extra={})=>issues.push({code,severity,message,documentIds:unique(documentIds),...extra});
  for(const [index,container] of (Array.isArray(documents)?documents:[]).entries()){
    if(!container||typeof container!=='object')continue;
    const parsed=container.parsed||container,id=text(container.id)||'document-'+(index+1),doc={...container,id,parsed};
    const check={id,status:'unverified',referenceStatus:'unverified',label:'Pendiente de validar',supplierOrder:normalizeSupplierOrder(parsed.supplierOrder)||null,expectedSupplierOrder:null};
    documentChecks.push(check);
    if(contextualTemporalReference(parsed.supplierOrder,parsed))issue('TEMPORAL_ORDER_REFERENCE','error','Se detectó una hora/fecha («'+text(parsed.supplierOrder)+'») como número de orden en '+(parsed.invoiceNumber||container.name||id)+'. Revisa el original y captura el número de orden del proveedor.',[id],{source:'document',actual:text(parsed.supplierOrder)});
    if(rejectedReference(parsed.supplierOrder,parsed))issue('REJECTED_ORDER_REFERENCE','error','El valor «'+text(parsed.supplierOrder)+'» fue descartado por su contexto en '+(parsed.invoiceNumber||container.name||id)+'. Revisa el número de orden del proveedor; no se puede confirmar ese candidato automáticamente.',[id],{source:'document',actual:text(parsed.supplierOrder)});
    if(unresolvedReference(parsed)&&!absentConfirmed(parsed))issue('ORDER_REFERENCE_NEEDS_REVIEW','error','La lectura del número de orden de '+(parsed.invoiceNumber||container.name||id)+' es ambigua o no ofrece suficiente certeza. Revisa el original y confirma una referencia válida antes de guardar.',[id],{source:'document'});
    const keys=purchaseDocumentIdentityKeys(doc),duplicate=keys.map(key=>seen.get(key)).find(Boolean);
    if(duplicate){
      check.status='duplicate';check.referenceStatus='duplicate';check.label='Documento duplicado; no se vuelve a sumar';
      if(conflictingPurchaseDocumentCopies(duplicate,doc))issue('DUPLICATE_CONFLICT','error','Dos copias de la misma factura o documento tienen datos distintos. Revisa su número de orden, partidas e importes.',[duplicate.id,id]);
      else issue('DUPLICATE_DOCUMENT','warning','Documento duplicado: '+(parsed.invoiceNumber||container.name||id)+'. Se conserva una sola copia y no se suman nuevamente sus artículos.',[id],{duplicateOf:duplicate.id});
      for(const key of keys)if(!seen.has(key))seen.set(key,duplicate);
      continue;
    }
    docs.push(doc);for(const key of keys)seen.set(key,doc);
  }
  const orders=docs.filter(doc=>doc.parsed.kind==='order'),invoices=docs.filter(doc=>doc.parsed.kind==='invoice');
  const references=unique(docs.map(doc=>documentOrderReference(doc.parsed)));
  const rejectedByEvidence=value=>docs.some(doc=>contextualTemporalReference(value,doc.parsed)||rejectedReference(value,doc.parsed));
  const requestedReference=purchaseOrderReference(purchase),originalReference=purchaseOrderReference(original);
  const requested=rejectedByEvidence(requestedReference)?'':requestedReference,priorRef=rejectedByEvidence(originalReference)?'':originalReference;
  if(isTemporalSupplierOrder(purchase.supplierOrder))issue('TEMPORAL_ORDER_REFERENCE','error','Se detectó una hora/fecha («'+text(purchase.supplierOrder)+'») en el campo número de orden de la compra. Captura el número de orden del proveedor.',docs.map(doc=>doc.id),{source:'purchase',actual:text(purchase.supplierOrder)});
  if(isTemporalSupplierOrder(original?.supplierOrder))issue('TEMPORAL_ORDER_REFERENCE','error','Se detectó una hora/fecha («'+text(original.supplierOrder)+'») como número de orden en la compra registrada. Corrige su referencia antes de adjuntar documentos.',docs.map(doc=>doc.id),{source:'original',actual:text(original.supplierOrder)});
  for(const [source,value] of [['purchase',purchase.supplierOrder],['original',original?.supplierOrder]])if(!isTemporalSupplierOrder(value)&&rejectedByEvidence(value))issue('REJECTED_ORDER_REFERENCE','error','El valor «'+text(value)+'» no es una referencia de orden confiable según el contexto del documento. Corrige el número de orden antes de guardar.',docs.map(doc=>doc.id),{source,actual:text(value)});
  const orderReferences=unique(orders.map(doc=>documentOrderReference(doc.parsed)));
  const expected=priorRef||requested||(orderReferences.length===1?orderReferences[0]:references.length===1?references[0]:'');
  const supplier=normalizeSupplier(purchase.supplier||original?.supplier)||normalizeSupplier(orders[0]?.parsed.supplier||invoices[0]?.parsed.supplier);
  const suppliedCurrencies=unique(docs.map(doc=>text(doc.parsed.currency).toUpperCase()));
  const currency=text(purchase.currency||original?.currency).toUpperCase()||(suppliedCurrencies.length===1?suppliedCurrencies[0]:'MXN');
  for(const check of documentChecks)check.expectedSupplierOrder=expected||null;
  if(priorRef&&requested&&priorRef!==requested)issue('PURCHASE_ORDER_CHANGED','error','La compra registrada corresponde a la orden '+priorRef+'. Anexar documentos no puede cambiarla por '+requested+'.',docs.map(doc=>doc.id),{expected:priorRef,actual:requested});
  if(original?.supplier&&purchase.supplier&&normalizeSupplier(original.supplier)!==normalizeSupplier(purchase.supplier))issue('PURCHASE_SUPPLIER_CHANGED','error','Anexar documentos no puede cambiar el proveedor de la compra registrada.',docs.map(doc=>doc.id));
  if(references.length>1)issue('ORDER_REFERENCES_CONFLICT','error','Los documentos pertenecen a números de orden distintos: '+references.join(', ')+'. Adjunta únicamente los de la misma orden.',expected?docs.filter(doc=>documentOrderReference(doc.parsed)!==expected).map(doc=>doc.id):[]);
  if(invoices.length&&!expected&&!invoices.every(doc=>absentConfirmed(doc.parsed)))issue('ORDER_REFERENCE_REQUIRED','error','No se pudo confirmar el número de orden de estas facturas. Revisa la referencia en cada documento antes de guardar.',invoices.map(doc=>doc.id));
  if(suppliedCurrencies.length>1)issue('CURRENCY_MISMATCH','error','Los documentos usan monedas distintas; no se suman como una sola compra.',docs.map(doc=>doc.id));
  for(const doc of docs){
    const p=doc.parsed,ref=documentOrderReference(p),check=documentChecks.find(row=>row.id===doc.id),ids=[doc.id];
    if(!['order','invoice'].includes(p.kind)){issue('DOCUMENT_KIND_UNKNOWN','error','Clasifica el documento '+(doc.name||doc.id)+' como orden de compra o factura.',ids);continue;}
    if(p.supplierOrderConflict&&!p.supplierOrderReviewed)issue('AMBIGUOUS_ORDER_REFERENCE','error','El documento '+(doc.name||p.invoiceNumber||doc.id)+' contiene referencias de orden contradictorias. Revisa y confirma la referencia correcta.',ids);
    if(p.supplierOrderReviewed)issue('ORDER_REFERENCE_REVIEWED','warning','Referencia revisada manualmente en '+(p.invoiceNumber||doc.name||doc.id)+'.',ids);
    if(!ref){
      check.referenceStatus='missing';check.status='missing';check.label='Número de orden sin reconocer';
      issue('DOCUMENT_ORDER_MISSING',p.kind==='invoice'&&!absentConfirmed(p)?'error':'warning',absentConfirmed(p)?'Confirmaste que '+(p.invoiceNumber||doc.name||'el documento')+' no tiene número de orden. Se vincula por compra, proveedor y artículos revisados.':'No se reconoció el número de orden en '+(p.invoiceNumber||doc.name||'el documento')+'. Revísalo en el original y confirma su referencia.',ids);
    }else if(expected&&ref!==expected){
      check.referenceStatus='mismatch';check.status='mismatch';check.label='Orden distinta: '+ref+'; se esperaba '+expected;
      issue('ORDER_NUMBER_MISMATCH','error','La '+(p.kind==='invoice'?'factura':'orden')+' '+(p.invoiceNumber||doc.name||doc.id)+' corresponde a '+ref+', pero esta compra es de la orden '+expected+'.',ids,{expected,actual:ref});
    }else{check.referenceStatus=expected?'matched':'unverified';check.status=check.referenceStatus;check.label=expected?'Coincide con la orden '+ref:'Orden por confirmar: '+ref;}
    check.referenceLabel=check.label;
    const docSupplier=normalizeSupplier(p.supplier);
    if(supplier&&docSupplier&&supplier!==docSupplier)issue('SUPPLIER_MISMATCH','error','El proveedor del documento '+(p.invoiceNumber||doc.name||doc.id)+' no coincide con el de la compra.',ids);
    else if(!docSupplier)issue('SUPPLIER_UNVERIFIED','warning','No se reconoció el proveedor en '+(p.invoiceNumber||doc.name||doc.id)+'. Confirma su identidad en el original.',ids);
    if(text(p.currency)&&currency&&text(p.currency).toUpperCase()!==currency)issue('CURRENCY_MISMATCH','error','La moneda de '+(p.invoiceNumber||doc.name||doc.id)+' no coincide con '+currency+'.',ids);
    if(p.kind==='invoice'&&!p.lines?.length)issue('INVOICE_LINES_MISSING','error','La factura '+(p.invoiceNumber||doc.name||doc.id)+' no tiene partidas legibles. Revisa la extracción antes de vincularla.',ids);
    if(p.kind==='invoice'&&!text(p.uuid)&&!text(p.invoiceNumber))issue('INVOICE_IDENTITY_MISSING','error','No se reconoció el UUID ni el folio fiscal de '+(doc.name||doc.id)+'. Revisa la lectura para poder detectar facturas duplicadas.',ids);
    if(p.kind==='invoice'&&!money(p.totalCents))issue('INVOICE_TOTAL_MISSING','error','No se reconoció el total de la factura '+(p.invoiceNumber||doc.name||doc.id)+'. Revisa la lectura antes de actualizar los costos.',ids);
    if(p.kind==='invoice'&&['subtotalCents','discountCents','taxCents','totalCents'].every(key=>money(p[key]))&&Math.abs(p.subtotalCents-p.discountCents+p.taxCents-p.totalCents)>1)issue('INVOICE_TAX_MISMATCH','error','Subtotal, descuento, IVA y total no coinciden en la factura '+(p.invoiceNumber||doc.name||doc.id)+'. Revisa la lectura antes de guardar.',ids);
    if(p.kind==='invoice'&&money(p.totalCents)&&p.lines?.length&&p.lines.every(line=>money(line.totalCents))&&Math.abs(p.lines.reduce((sum,line)=>sum+line.totalCents,0)-p.totalCents)>1)issue('INVOICE_LINE_TOTAL_MISMATCH','error','Las partidas de la factura '+(p.invoiceNumber||doc.name||doc.id)+' no suman su importe total. Revisa la lectura de impuestos, descuentos y cargos.',ids);
  }
  if(orders.length>1){
    const signature=doc=>JSON.stringify((doc.parsed.lines||[]).map(line=>[item(line.supplierItem),barcode(line.upc),norm(line.name),line.qty]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
    const first=signature(orders[0]);
    for(const extra of orders.slice(1)){
      if(signature(extra)!==first||money(extra.parsed.totalCents)&&money(orders[0].parsed.totalCents)&&extra.parsed.totalCents!==orders[0].parsed.totalCents)issue('ORDER_VERSION_CONFLICT','error','Hay documentos de la misma orden con partidas, cantidades o importes distintos. Selecciona la versión correcta.',[orders[0].id,extra.id]);
      else issue('DUPLICATE_ORDER','warning','Se adjuntó otra copia de la misma orden. Sus artículos no se suman nuevamente.',[extra.id]);
    }
  }
  if(expected&&supplier)for(const row of purchases){
    if(row.id===purchaseId)continue;
    if(normalizeSupplier(row.supplier)===supplier&&purchaseOrderReference(row)===expected)issue('PURCHASE_ALREADY_EXISTS','error','La orden '+expected+' del proveedor ya está registrada en '+(row.number||row.id)+'. Abre esa compra para adjuntar documentos; revisa sus artículos si no corresponden.',docs.map(doc=>doc.id),{purchaseId:row.id,number:row.number||row.id});
  }

  const productFor=line=>{const explicit=products.find(p=>[p.sku,...(p.skuAliases||[])].some(code=>code&&item(code)===item(line.sku||line.skuOrUpc)))||products.find(p=>barcode(p.upc)&&barcode(p.upc)===barcode(line.upc||line.skuOrUpc));if(explicit)return explicit;const aliases=products.filter(p=>line.supplierItem&&(p.supplierCodes||[]).some(c=>normalizeSupplier(c.supplier)===supplier&&item(c.item)===item(line.supplierItem)));return aliases.length===1?aliases[0]:null;};
  const normalizedLine=line=>{
    const p=productFor(line);
    // SICAR catalog codes (UPC/SKU) are not the supplier's invoice item number.
    const catalogCode=Boolean(original?.sicarHistory&&line.sourceMatchMethod&&p&&(!line.sicarCode||item(line.supplierItem)===item(line.sicarCode)));
    return {...line,sku:p?.sku||line.sku||'',upc:line.upc||p?.upc||'',supplierItem:catalogCode?'':line.supplierItem||''};
  };
  const match=(line,targets)=>{
    const a=normalizedLine(line),aUpc=barcode(a.upc),aItem=item(a.supplierItem),aSku=item(a.sku),aName=norm(a.name);
    return targets.filter(raw=>{
      const b=normalizedLine(raw),bUpc=barcode(b.upc),bItem=item(b.supplierItem),bSku=item(b.sku);
      if(aUpc&&bUpc&&aUpc!==bUpc)return false;
      if(aSku&&bSku&&aSku!==bSku)return false;
      if(aItem&&bItem&&aItem!==bItem&&!(aSku&&bSku&&aSku===bSku))return false;
      return Boolean(aUpc&&bUpc&&aUpc===bUpc||aItem&&bItem&&aItem===bItem||aSku&&bSku&&aSku===bSku||aName&&aName===norm(b.name));
    });
  };
  const rawOrderLines=orders[0]?.parsed.lines||[];
  const authority=original?.items?.length?original.items:rawOrderLines.length?rawOrderLines:lines;
  const expectedLines=(authority||[]).map((line,index)=>({...line,_key:index,invoicedQty:0,invoiceDocumentIds:[],invoicedTotalCents:0,invoicedNetCents:0,invoicedTaxCents:0,invoiceAmountsKnown:true,invoiceTaxKnown:true}));
  if(invoices.length&&!expectedLines.length)issue('ORDER_LINES_MISSING','error','Confirma los artículos y las cantidades ordenadas antes de adjuntar facturas.',invoices.map(doc=>doc.id));
  for(const doc of orders){
    const source=doc.parsed.lines||[];
    if(!source.length){issue('ORDER_LINES_UNVERIFIED','warning','No se reconocieron partidas en la orden '+(doc.name||doc.id)+'. Revisa la lista de compra contra el original.',[doc.id]);continue;}
    const matched=new Set();
    for(const line of source){
      const targets=match(line,expectedLines);
      if(targets.length!==1){issue('ORDER_DOCUMENT_LINES_MISMATCH','error','El artículo '+(line.supplierItem||line.name)+' del PDF de orden no corresponde de forma única a los artículos de la compra.',[doc.id]);continue;}
      matched.add(targets[0]._key);
      if(line.qty!==targets[0].qty)issue('ORDER_DOCUMENT_QUANTITY_MISMATCH','error','El PDF de orden indica '+line.qty+' unidades de '+(line.supplierItem||line.name)+' y la compra '+targets[0].qty+'. Revisa la versión correcta antes de vincularlo.',[doc.id],{expected:targets[0].qty,actual:line.qty});
    }
    if(source.length!==expectedLines.length||matched.size!==expectedLines.length)issue('ORDER_DOCUMENT_COVERAGE_MISMATCH','error','El PDF de orden no contiene exactamente las partidas de la compra registrada.',[doc.id]);
  }
  // A documentary attachment may not silently enlarge or replace an existing order.
  if((original?.items?.length||rawOrderLines.length)&&lines.length){
    for(const line of lines){
      const targets=match(line,expectedLines);
      if(targets.length!==1)issue('REVIEWED_LINE_MISMATCH','error','El artículo revisado '+(line.supplierItem||line.name)+' no corresponde de forma única a la orden original.',orders.map(doc=>doc.id));
      else if(line.qty!==targets[0].qty)issue('ORDER_QUANTITY_CHANGED','error','La orden contiene '+targets[0].qty+' unidades de '+(line.supplierItem||line.name)+', pero la revisión indica '+line.qty+'. Corrige la lectura de la orden; una factura no debe aumentar lo ordenado.',orders.map(doc=>doc.id),{expected:targets[0].qty,actual:line.qty});
    }
    if(lines.length!==expectedLines.length)issue('ORDER_LINES_CHANGED','error','La lista revisada no conserva todas las partidas de la orden original.',orders.map(doc=>doc.id));
  }
  for(const target of expectedLines)if(!qty(target.qty))issue('ORDER_QUANTITY_INVALID','error','La cantidad ordenada de '+(target.supplierItem||target.name)+' no es válida.',orders.map(doc=>doc.id));
  const matchingInvoices=invoices.filter(doc=>documentChecks.find(check=>check.id===doc.id)?.referenceStatus==='matched');
  let unmatchedInvoiceQty=0;const equivalences=[];
  for(const doc of matchingInvoices)for(const line of doc.parsed.lines||[]){
    if(!qty(line.qty)){issue('INVOICE_QUANTITY_INVALID','error','La factura '+(doc.parsed.invoiceNumber||doc.name||doc.id)+' tiene una cantidad inválida.',[doc.id]);continue;}
    const targets=match(line,expectedLines);
    if(targets.length!==1){unmatchedInvoiceQty+=line.qty;issue('INVOICE_ITEM_MISMATCH','error','El artículo '+(line.supplierItem||line.name)+' de la factura '+(doc.parsed.invoiceNumber||doc.name||doc.id)+' no corresponde de forma única a los artículos ordenados.',[doc.id]);continue;}
    const target=targets[0];if(line.supplierItem&&target.sku&&!equivalences.some(e=>e.supplierItem===line.supplierItem&&e.sku===target.sku))equivalences.push({supplierItem:line.supplierItem,name:line.name,sku:target.sku,lineId:target.id});target.invoicedQty+=line.qty;target.invoiceDocumentIds.push(doc.id);
    const single=doc.parsed.lines.length===1;
    const total=money(line.totalCents)?line.totalCents:single?doc.parsed.totalCents:null;
    const tax=money(line.taxCents)?line.taxCents:single?doc.parsed.taxCents:null;
    const subtotal=money(line.subtotalCents)?line.subtotalCents:single?doc.parsed.subtotalCents:null;
    const discount=money(line.discountCents)?line.discountCents:single&&money(doc.parsed.discountCents)?doc.parsed.discountCents:0;
    if(money(total))target.invoicedTotalCents+=total;else target.invoiceAmountsKnown=false;
    if(money(total)&&money(tax)&&tax<=total){target.invoicedTaxCents+=tax;target.invoicedNetCents+=total-tax;}else target.invoiceTaxKnown=false;
    if(money(total)&&money(tax)&&(tax>total||money(subtotal)&&Math.abs(subtotal-discount+tax-total)>1))issue('INVOICE_TAX_MISMATCH','error','Subtotal, descuento, IVA y total no coinciden en la factura '+(doc.parsed.invoiceNumber||doc.name||doc.id)+'. Revisa la lectura antes de guardar.',[doc.id]);
  }
  for(const target of expectedLines)if(target.invoicedQty>target.qty)issue('INVOICE_QUANTITY_EXCESS','error','El artículo '+(target.supplierItem||target.name)+' tiene '+target.invoicedQty+' unidades facturadas y solo '+target.qty+' ordenadas. Hay una factura de más o una cantidad incorrecta.',target.invoiceDocumentIds,{expected:target.qty,actual:target.invoicedQty,lineId:target.id||null});
  const complete=Boolean(matchingInvoices.length&&expectedLines.length&&!unmatchedInvoiceQty&&expectedLines.every(line=>qty(line.qty)&&line.invoicedQty===line.qty));
  const invoiceTotal=matchingInvoices.length&&matchingInvoices.every(doc=>money(doc.parsed.totalCents))?matchingInvoices.reduce((sum,doc)=>sum+doc.parsed.totalCents,0):null;
  const orderTotal=money(orders[0]?.parsed.totalCents)?orders[0].parsed.totalCents:original?.amountSource==='invoices'?original.expectedAmountCents??null:money(original?.amountCents)?original.amountCents:money(purchase.amountCents)?purchase.amountCents:null;
  if(complete&&invoiceTotal!=null&&orderTotal!=null&&Math.abs(invoiceTotal-orderTotal)>1)issue('INVOICE_TOTAL_MISMATCH','error','Las facturas suman $'+(invoiceTotal/100).toFixed(2)+' y la compra $'+(orderTotal/100).toFixed(2)+'. Revisa importes, descuentos o cargos antes de guardar.',invoices.map(doc=>doc.id),{expected:orderTotal,actual:invoiceTotal});
  if(invoices.length&&!complete&&!issues.some(row=>row.severity==='error'))issue('INVOICE_COVERAGE_PARTIAL','warning','Facturación parcial: todavía faltan unidades por respaldar con factura.',invoices.map(doc=>doc.id));
  for(const check of documentChecks){
    const error=issues.find(row=>row.severity==='error'&&row.code!=='ORDER_REFERENCES_CONFLICT'&&row.documentIds.includes(check.id));
    if(error){check.status='mismatch';check.label=error.message;}
  }
  const fiscal=options.requireFiscal||options.fiscalConfig?validateInvoiceFiscal(docs,options.fiscalConfig,{profileId:purchase.buyerCompanyId,required:true,allowStoredSnapshots:options.allowFiscalSnapshots===true}):null;
  if(fiscal)issues.push(...fiscal.issues);
  const orderedQty=expectedLines.reduce((sum,line)=>sum+(qty(line.qty)?line.qty:0),0),invoicedQty=expectedLines.reduce((sum,line)=>sum+line.invoicedQty,unmatchedInvoiceQty);
  return {valid:!issues.some(row=>row.severity==='error'),fiscal,equivalences,issues,documentChecks,supplierOrder:expected||null,expectedSupplierOrder:expected||null,
    summary:{orderedQty,receivedQty:expectedLines.reduce((n,l)=>n+(Number(l.receivedQty)||0),0),invoicedQty,pendingQty:expectedLines.reduce((sum,line)=>sum+Math.max(0,(qty(line.qty)?line.qty:0)-line.invoicedQty),0),unmatchedInvoiceQty,excessQty:expectedLines.reduce((sum,line)=>sum+Math.max(0,line.invoicedQty-(qty(line.qty)?line.qty:0)),0),invoiceCount:invoices.length,matchingInvoiceCount:matchingInvoices.length,excludedInvoiceCount:invoices.length-matchingInvoices.length,orderCount:orders.length},
    coverage:complete?'complete':invoices.length?'partial':'none',invoiceTotalCents:invoiceTotal,lines:expectedLines.map(({_key,invoiceAmountsKnown,invoiceTaxKnown,...line})=>({...line,
      pendingInvoiceQty:Math.max(0,line.qty-line.invoicedQty),
      invoicedTotalCents:line.invoicedQty&&invoiceAmountsKnown?line.invoicedTotalCents:null,
      invoicedNetCents:line.invoicedQty&&invoiceTaxKnown?line.invoicedNetCents:null,
      invoicedTaxCents:line.invoicedQty&&invoiceTaxKnown?line.invoicedTaxCents:null,
      invoiceAverageCostCents:line.invoicedQty&&invoiceAmountsKnown?Math.round(line.invoicedTotalCents/line.invoicedQty):null,
      invoiceAverageNetCostCents:line.invoicedQty&&invoiceTaxKnown?Math.round(line.invoicedNetCents/line.invoicedQty):null}))};
}

export function productInvoiceCosts(state,sku){
  let units=0,total=0,net=0,tax=0,taxKnown=true;
  for(const purchase of state.purchases||[]){
    if(purchase.status==='Cancelada')continue;
    const documents=(state.documents||[]).filter(doc=>doc.purchaseId===purchase.id);
    const report=validatePurchaseDocuments(documents,{purchase,originalPurchase:purchase,lines:purchase.items||[],products:state.products||[],purchaseId:purchase.id});
    if(!report.valid)continue;
    for(const line of report.lines.filter(line=>line.sku===sku&&line.invoicedQty>0&&line.invoicedTotalCents!=null)){
      units+=line.invoicedQty;total+=line.invoicedTotalCents;
      if(line.invoicedNetCents==null||line.invoicedTaxCents==null)taxKnown=false;
      else{net+=line.invoicedNetCents;tax+=line.invoicedTaxCents;}
    }
  }
  return {units,totalCents:units?total:null,averageCostCents:units?Math.round(total/units):null,
    averageNetCostCents:units&&taxKnown?Math.round(net/units):null,averageTaxCents:units&&taxKnown?Math.round(tax/units):null};
}
