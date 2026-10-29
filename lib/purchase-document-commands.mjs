/** Confirmed purchase document imports. Extraction remains evidence, never a stock/payment command. */
import {applyInventory} from './inventory-v28.mjs';
import {applyOperation,mexicoToday,purchaseReceiptStatus} from './operations-v28.mjs';
import {normalizeSupplier,normalizeSupplierOrder} from './purchase-document-parser.mjs';
import {validatePurchaseDocuments,purchaseDocumentIdentityKeys,conflictingPurchaseDocumentCopies} from './purchase-document-validation.mjs';

const text=value=>String(value??'').trim();
const normalized=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const itemKey=value=>text(value).toUpperCase().replace(/\s+/g,'');
const unique=values=>[...new Set(values.filter(Boolean))];
const has=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const fail=message=>{throw new Error(message);};
const hash=value=>text(value).toLowerCase();
const uuid=value=>text(value).toLowerCase();

function verifiedDocument(input,verified,existing,now){
  const id=hash(input?.id),metadata=verified.find(row=>hash(row.id)===id);
  const prior=existing.find(row=>hash(row.id)===id);
  if(!metadata&&!prior)fail('El documento no tiene un archivo verificado. Vuelve a cargarlo antes de confirmar.');
  const source=metadata||prior,sha256=hash(source.sha256);
  if(!/^[a-f0-9]{64}$/.test(id)||sha256!==id)fail('La identidad del documento no coincide con la huella del archivo verificado.');
  if(!input.parsed||typeof input.parsed!=='object'||Array.isArray(input.parsed))fail('Revisa la lectura del documento antes de confirmar.');
  const parsed=structuredClone(input.parsed);
  if(!['order','invoice','unknown'].includes(parsed.kind))fail('Selecciona un tipo válido de documento de compra.');
  if(parsed.uuid&&!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(text(parsed.uuid)))fail('El UUID de la factura no tiene un formato válido.');
  parsed.uuid=parsed.uuid?uuid(parsed.uuid):null;
  if(!Array.isArray(parsed.lines)||parsed.lines.length>1000)fail('Las partidas extraídas del documento no son válidas.');
  const extraction=input.extraction||'manual';
  if(!['pdf-text','ocr','manual'].includes(extraction))fail('El origen de lectura del documento no es válido.');
  return {id,sha256,name:text(source.name).slice(0,500),mime:text(source.mime),size:source.size,createdAt:source.createdAt||now,kind:parsed.kind,parsed,extraction};
}

function canonicalDocuments(state,inputs,verified,now,targetId){
  const existing=state.documents||[],planned=[],updates=[],aliases=new Map(),duplicates=[],owned=new Set();
  for(const input of inputs){
    const doc=verifiedDocument(input,verified,existing,now),rows=[...existing,...planned],keys=new Set(purchaseDocumentIdentityKeys(doc));
    const matches=rows.filter(row=>purchaseDocumentIdentityKeys(row).some(key=>keys.has(key)));
    const ids=unique(matches.map(row=>row.id));
    if(ids.length>1)fail('La huella y el UUID apuntan a documentos distintos. Revisa los archivos vinculados antes de continuar.');
    const prior=matches[0];
    if(prior){
      if(prior.purchaseId){owned.add(prior.purchaseId);if(targetId&&prior.purchaseId!==targetId)fail('La factura o documento ya está asociado a la compra '+prior.purchaseId+'. No puede vincularse a otra compra.');}
      const manualReference=targetId&&prior.purchaseId===targetId&&doc.id===prior.id&&doc.parsed.supplierOrderReviewed===true;
      if(manualReference){
        const reference=normalizeSupplierOrder(doc.parsed.supplierOrder);
        if(!reference)fail('Confirma un número de orden válido para el documento revisado.');
        const corrected=structuredClone(prior);
        corrected.parsed={...corrected.parsed,supplierOrder:reference,supplierOrderOriginal:prior.parsed.supplierOrderOriginal??prior.parsed.supplierOrder??null,supplierOrderReviewed:true,
          evidence:{...prior.parsed.evidence,supplierOrderReview:'Referencia revisada manualmente en AIMERKA.'}};
        corrected.referenceReviewedAt=now;
        const at=updates.findIndex(row=>row.id===prior.id);if(at<0)updates.push(corrected);else updates[at]=corrected;
      }else if(conflictingPurchaseDocumentCopies(prior,doc))fail('Un documento duplicado tiene número de orden, proveedor, partidas o importes distintos. Revisa las dos copias antes de continuar.');
      aliases.set(doc.id,prior.id);
      if(!manualReference)duplicates.push({id:doc.id,duplicateOf:prior.id,reason:hash(prior.sha256)===doc.sha256?'sha256':doc.parsed.uuid&&doc.parsed.uuid===uuid(prior.parsed?.uuid)?'uuid':'invoiceNumber'});
    }else{planned.push(doc);aliases.set(doc.id,doc.id);}
  }
  return {planned,updates,aliases,duplicates,owned};
}

function findConfirmedProduct(state,sku){
  const candidates=state.products.filter(product=>text(product.sku).toUpperCase()===text(sku).toUpperCase());
  if(candidates.length!==1)fail(candidates.length?'El SKU seleccionado es ambiguo. Revisa el catálogo.':'Selecciona un SKU existente o confirma el alta del producto nuevo.');
  return candidates[0];
}

function confirmEquivalence(state,supplier,item,name,sku){
  const canonicalSupplier=normalizeSupplier(supplier),code=itemKey(item),normalizedName=normalized(name);
  if(!canonicalSupplier||(!code&&!normalizedName))return;
  const aliases=[...(state.supplierEquivalences||[]),...state.products.flatMap(product=>(product.supplierCodes||[]).map(alias=>({...alias,sku:product.sku})))];
  const conflicting=aliases.some(alias=>normalizeSupplier(alias.supplier)===canonicalSupplier&&alias.sku!==sku&&(code?itemKey(alias.item||alias.supplierItem)===code:normalized(alias.name)===normalizedName));
  if(conflicting)fail('La equivalencia del proveedor '+supplier+' para '+(item||name)+' ya corresponde a otro SKU. Revisa la asignación.');
  const equivalences=state.supplierEquivalences??=[];
  const prior=equivalences.find(alias=>normalizeSupplier(alias.supplier)===canonicalSupplier&&(code?itemKey(alias.item||alias.supplierItem)===code:!itemKey(alias.item||alias.supplierItem)&&normalized(alias.name)===normalizedName));
  if(!prior)equivalences.push({supplier,item:text(item),name:text(name),sku});
  // Product-level aliases let the existing catalog and the parser share the confirmed mapping.
  if(code){
    const product=findConfirmedProduct(state,sku),codes=product.supplierCodes??=[];
    if(!codes.some(alias=>normalizeSupplier(alias.supplier)===canonicalSupplier&&itemKey(alias.item)===code))codes.push({supplier,item:text(item),name:text(name)});
  }
}

function documentLineQuantity(document,line,allLines,products){
  const source=document.parsed?.lines||[];
  const candidateLines=parsedLine=>{
    if(parsedLine.supplierItem){const found=allLines.filter(row=>itemKey(row.supplierItem)===itemKey(parsedLine.supplierItem));if(found.length)return found;}
    if(parsedLine.sku){const found=allLines.filter(row=>row.sku===parsedLine.sku);if(found.length)return found;}
    if(parsedLine.upc){const matchedProducts=products.filter(p=>p.upc&&text(p.upc).padStart(14,'0')===text(parsedLine.upc).padStart(14,'0')),found=allLines.filter(row=>matchedProducts.some(p=>p.sku===row.sku));if(found.length)return found;}
    return allLines.filter(row=>normalized(row.name)===normalized(parsedLine.name));
  };
  const matches=source.filter(parsedLine=>{const candidates=candidateLines(parsedLine);return candidates.length===1&&candidates[0].id===line.id;});
  if(matches.length&&matches.every(row=>Number.isFinite(row.qty)&&row.qty>0))return matches.reduce((sum,row)=>sum+row.qty,0);
  // A manually reviewed order line has a confirmed ordered quantity; an unreadable invoice does not.
  return document.kind==='order'?line.qty:null;
}

/** Mutations are committed only once every product, purchase, document and equivalence validates. */
export function applyDocumentImport(state,command,context={}){
  if(!state||command?.type!=='purchase.importDocuments')fail('La operación de importación documental no es válida.');
  const requestId=command.id||context.requestId||crypto.randomUUID();
  if((state.operationIds||[]).includes(requestId)){
    const prior=(state.events||[]).find(event=>event.id===requestId&&event.type==='purchase.importDocuments');
    return {ok:true,duplicate:true,id:prior?.entityId||null,createdSkus:[],message:'La importación ya se registró; no se repitió.'};
  }
  const payload=command.payload||{},now=context.now||new Date().toISOString(),ctx={...context,now,today:context.today||mexicoToday(now)};
  const inputs=payload.documents,lines=payload.lines;
  if(!Array.isArray(inputs)||!inputs.length||inputs.length>100)fail('Adjunta entre 1 y 100 documentos verificados para importar.');
  if(!Array.isArray(lines)||lines.length>1000)fail('Revisa la lista completa de artículos de la orden antes de confirmar.');
  if(!payload.purchase||typeof payload.purchase!=='object'||Array.isArray(payload.purchase))fail('Revisa los datos de la compra antes de confirmar.');
  const targetId=text(payload.purchaseId),original=targetId?(state.purchases||[]).find(p=>p.id===targetId):null;
  if(targetId&&!original)fail('La compra seleccionada no existe.');
  if(original?.status==='Cancelada')fail('La compra está cancelada. Selecciona una compra activa para anexar documentos.');
  const docs=canonicalDocuments(state,inputs,context.verifiedDocuments||[],now,targetId);
  if(!targetId&&docs.owned.size){
    if(docs.owned.size>1)fail('Los documentos ya pertenecen a compras distintas. Selecciona una compra y sus documentos.');
    const existingId=[...docs.owned][0];
    if(docs.planned.length)fail('Un documento ya está asociado a la compra '+existingId+'. Selecciona esa compra para anexar los archivos nuevos.');
    return {ok:true,duplicate:true,id:existingId,createdSkus:[],documentIds:unique([...docs.aliases.values()]),duplicateDocuments:docs.duplicates,message:'Estos documentos ya están registrados en la compra '+existingId+'. No se creó otra orden.'};
  }
  const draft=structuredClone(state);
  draft.products??=[];draft.purchases??=[];draft.documents??=[];draft.events??=[];draft.catalogs??={};draft.catalogs.suppliers??=[];
  const prior=targetId?draft.purchases.find(p=>p.id===targetId):null;
  for(const update of docs.updates){const at=draft.documents.findIndex(doc=>doc.id===update.id);if(at>=0)draft.documents[at]=update;}
  const purchaseData={};
  // Parsed PUE, delivery, totals and dates are never applied implicitly. Only the reviewed fields enter here.
  for(const key of ['supplier','supplierOrder','date','shippingStatus','notes','amountCents','lender','instrument','term','firstPaymentDate','sicar','taxInvoice','satReviewed'])if(has(payload.purchase,key)&&payload.purchase[key]!==undefined)purchaseData[key]=payload.purchase[key];
  // Attaching a document does not reconfigure an already agreed financing schedule.
  if(prior)for(const key of ['lender','instrument','term','firstPaymentDate'])delete purchaseData[key];
  const supplier=text(purchaseData.supplier||prior?.supplier);
  if(!supplier)fail('Confirma el proveedor de esta compra.');
  const catalogSupplier=draft.catalogs.suppliers.find(value=>normalizeSupplier(value)===normalizeSupplier(supplier));
  purchaseData.supplier=catalogSupplier||supplier;
  if(!catalogSupplier)draft.catalogs.suppliers.push(supplier);
  const allowedDocs=new Set([...draft.documents.filter(doc=>doc.purchaseId===targetId&&targetId).map(doc=>doc.id),...docs.aliases.values()]);
  const canonicalId=value=>docs.aliases.get(hash(value))||text(value);
  const filteredIds=values=>unique((Array.isArray(values)?values:[]).map(canonicalId).filter(id=>allowedDocs.has(id)));
  const previousLines=new Map((prior?.items||[]).map(line=>[line.id,line])),createdSkus=[],newByItem=new Map();
  const resolvedLines=lines.map((input,index)=>{
    if(!input||typeof input!=='object'||Array.isArray(input))fail('Una partida revisada no es válida.');
    if(input.documentIds!=null&&!Array.isArray(input.documentIds))fail('Las referencias de documentos de una partida no son válidas.');
    const previous=input.id?previousLines.get(input.id):null;
    if(input.id&&!previous)fail('Una partida no pertenece a la compra seleccionada.');
    if(input.sku&&input.newProduct)fail('Cada partida debe usar un SKU existente o un producto nuevo, no ambos.');
    const supplierItem=text(input.supplierItem??previous?.supplierItem),name=text(input.name||previous?.name||input.newProduct?.name);
    if(!name)fail('Confirma la descripción de cada artículo.');
    const qty=input.qty??previous?.qty;
    if(!Number.isSafeInteger(qty)||qty<1)fail('La cantidad revisada debe ser un entero mayor que cero.');
    const unitCostCents=has(input,'unitCostCents')?input.unitCostCents:previous?.unitCostCents??null;
    if(unitCostCents!=null&&(!Number.isSafeInteger(unitCostCents)||unitCostCents<0))fail('El costo debe quedar por confirmar o expresarse en centavos no negativos.');
    let product;
    if(input.newProduct){
      if(previous?.receivedQty>0)fail('Conserva el SKU de las partidas con mercancía recibida.');
      const source=input.newProduct;
      if(!source||typeof source!=='object'||Array.isArray(source))fail('Revisa los datos del producto nuevo.');
      const signature=JSON.stringify([normalized(source.name||name),normalized(source.brand),normalized(source.model),normalized(source.color),normalized(source.capacity),text(source.upc)]),code=itemKey(supplierItem),created=code?newByItem.get(code):null;
      if(created){if(created.signature!==signature)fail('El mismo artículo del proveedor tiene datos de producto distintos. Revisa sus equivalencias.');product=findConfirmedProduct(draft,created.sku);}
      else{
        const creation={name:source.name||name,brand:source.brand,model:source.model||'',color:source.color||'',capacity:source.capacity||'',upc:source.upc||'',costCents:source.costCents??unitCostCents??0,priceCents:source.priceCents??0};
        for(const key of ['imageUrl','category','department','generalCategory','commercialDepartment','satCode','shippingType','shippingException','shippingSuggested','categories','categoryOverrides'])if(has(source,key))creation[key]=source[key];
        const result=applyInventory(draft,{id:requestId+':product:'+index,type:'product.save',payload:{product:creation}},ctx);
        product=findConfirmedProduct(draft,result.sku);createdSkus.push(product.sku);
        if(source.costCents==null&&unitCostCents==null){product.costStatus='Por confirmar';product.review='Costo pendiente de confirmar con documentos de compra.';}
        if(code)newByItem.set(code,{sku:product.sku,signature});
      }
    }else product=findConfirmedProduct(draft,input.sku||previous?.sku||previous?.skuOrUpc);
    if(previous?.receivedQty>0&&previous.sku!==product.sku)fail('Conserva el SKU de las partidas con mercancía recibida.');
    confirmEquivalence(draft,purchaseData.supplier,supplierItem,name,product.sku);
    const sameProduct=previous&&(previous.sku===product.sku||previous.skuOrUpc===product.sku||previous.skuOrUpc===product.upc);
    return {id:previous?.id,sku:product.sku,skuOrUpc:sameProduct?(previous.skuOrUpc||product.sku):product.sku,name,qty,unitCostCents,supplierItem,documentIds:filteredIds([...(previous?.documentIds||[]),...(input.documentIds||[])]),receivedQty:previous?.receivedQty||0};
  });
  const documentIds=filteredIds([...(prior?.documentIds||[]),...docs.aliases.values()]);
  const validationDocuments=[...draft.documents.filter(doc=>targetId&&doc.purchaseId===targetId),...docs.planned];
  const validation=validatePurchaseDocuments(validationDocuments,{purchase:{...(prior||{}),...purchaseData},lines:resolvedLines,products:draft.products,purchases:state.purchases||[],purchaseId:targetId||null});
  if(!validation.valid)fail(validation.issues.filter(issue=>issue.severity==='error').map(issue=>issue.message).join(' '));
  if(validation.supplierOrder)purchaseData.supplierOrder=validation.supplierOrder;
  const data={...purchaseData,id:targetId||undefined,items:resolvedLines,documentIds};
  if(!prior||prior.receiptMode==='physical')data.receiptStatus=purchaseReceiptStatus(resolvedLines);
  const result=applyOperation(draft,{id:requestId+':purchase',type:prior?'purchase.update':'purchase.create',payload:data},ctx);
  const purchase=draft.purchases.find(row=>row.id===result.id);
  for(const doc of docs.planned)draft.documents.push({...doc,purchaseId:purchase.id,lineLinks:[]});
  for(const doc of draft.documents.filter(row=>documentIds.includes(row.id))){
    if(doc.purchaseId&&doc.purchaseId!==purchase.id)fail('Un documento ya está asociado a otra compra.');
    doc.purchaseId=purchase.id;
    doc.lineLinks=purchase.items.filter(line=>(line.documentIds||[]).includes(doc.id)).map(line=>({lineId:line.id,sku:line.sku,qty:documentLineQuantity(doc,line,purchase.items,draft.products)}));
  }
  const invoiceNumbers=unique(draft.documents.filter(doc=>documentIds.includes(doc.id)&&doc.kind==='invoice').map(doc=>text(doc.parsed?.invoiceNumber)).filter(Boolean));
  if(!has(payload.purchase,'taxInvoice')&&invoiceNumbers.length)purchase.taxInvoice=unique([...(purchase.taxInvoice?purchase.taxInvoice.split(',').map(text):[]),...invoiceNumbers]).join(', ');
  const message='Documentos guardados en '+purchase.number+'. '+purchase.items.length+' partida(s) revisadas; la mercancía queda sujeta a recepción en almacén.';
  draft.events.unshift({id:requestId,type:'purchase.importDocuments',entityId:purchase.id,message,date:now,actor:context.actor||context.user||'Operador',result:'ok',source:'AIMERKA',documentIds,createdSkus,reviewedReferences:docs.updates.map(doc=>({id:doc.id,from:doc.parsed.supplierOrderOriginal,to:doc.parsed.supplierOrder}))});
  draft.operationIds??=[];draft.operationIds.push(requestId);
  // State is a JSON ledger; swapping its top-level collections is the single commit point.
  Object.assign(state,draft);
  return {ok:true,id:purchase.id,number:purchase.number,createdSkus,documentIds,duplicateDocuments:docs.duplicates,documentValidation:validation,message};
}
