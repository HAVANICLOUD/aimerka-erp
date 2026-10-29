'use strict';
(function(){
 if(typeof icons==='object'){icons.file??='<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>';icons.upload??='<path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>';}
 let draft=null,parserPromise=null,parserModule=null,validationPromise=null,validationEngine=null;
 const parser=()=>parserPromise??=import('/erp/modules/purchase-document-parser.mjs?v=20261029-order-context-v3').then(engine=>(parserModule=engine));
 const validator=()=>validationPromise??=import('/erp/modules/purchase-document-validation.mjs?v=20261029-order-context-v3').then(engine=>(validationEngine=engine));
 const get=id=>document.getElementById(id);
 const value=id=>get(id)?.value??'';
 const cents=v=>String(v??'').trim()===''?null:Math.round(Number(v)*100);
 const number=v=>v==null?'':v/100;
 const kindName=k=>({order:'Orden de compra',invoice:'Factura',unknown:'Por clasificar'})[k]||'Documento';
 const docUrl=id=>'/api/documents/'+encodeURIComponent(id)+'?workspace='+encodeURIComponent(ERP.workspace);
 const idKey=line=>String(line.supplierItem||'')+'|'+String(line.name||'').toLocaleUpperCase('es-MX');
 const existingDocs=d=>d.storedDocuments||(state.documents||[]).filter(doc=>doc.purchaseId===d.purchaseId);
 const allDocs=d=>[...existingDocs(d),...d.documents];
 const related=(line,p)=>line.sku===p.sku||line.skuOrUpc===p.sku||p.upc&&line.skuOrUpc===p.upc;
 const blockers=d=>[...new Set((d.validation?.issues||[]).filter(issue=>issue.severity==='error').map(issue=>issue.message))];
 const hasChanges=d=>Boolean(d.documents.length||d.editedDocumentIds?.length);
 function referenceNeedsReview(parsed){
   if(!parsed)return false;
   const normalize=parserModule?.normalizeSupplierOrder||(value=>String(value??'').trim().toUpperCase());
   return Boolean((!parsed.supplierOrderReviewed||!parsed.supplierOrder)&&(parsed.supplierOrderNeedsReview||parsed.supplierOrderConflict)||
     parsed.supplierOrder&&(parserModule?.isTemporalSupplierOrder(parsed.supplierOrder,{context:parsed.evidence?.supplierOrder})||
       (parsed.supplierOrderRejectedCandidates||[]).some(candidate=>normalize(candidate.value)===normalize(parsed.supplierOrder)&&(candidate.reason!=='ambiguous_columns'||!parsed.supplierOrderReviewed))));
 }
 function validationFor(d){return validationEngine?.validatePurchaseDocuments(allDocs(d),{purchase:d.purchase,lines:d.lines,products:state.products||[],purchases:state.purchases||[],purchaseId:d.purchaseId||undefined});}
 function refreshDerivedOrder(d){
   if(!parserModule)return;
   const prior=d.purchaseId?state.purchases.find(p=>p.id===d.purchaseId):null;
   // Saved purchase identity and deliberate manual references are never replaced
   // to make a different invoice appear compatible.
   if(prior?.supplierOrder){d.orderReferenceMode='existing';return;}
   const current=String(d.purchase.supplierOrder||''),temporal=parserModule.isTemporalSupplierOrder(current);
   if(d.orderReferenceMode!=='auto'&&!temporal)return;
   const references=documents=>[...new Set(documents.filter(doc=>!referenceNeedsReview(doc.parsed)).map(doc=>doc.parsed?.supplierOrder)
     .filter(value=>value&&!parserModule.isTemporalSupplierOrder(value)).map(value=>parserModule.normalizeSupplierOrder(value)).filter(Boolean))];
   const orderDocuments=allDocs(d).filter(doc=>doc.parsed?.kind==='order'),orderReferences=references(orderDocuments);
   // An unreadable order must be reviewed, rather than inferred from its invoices.
   const candidates=orderDocuments.length?orderReferences:references(allDocs(d));
   const next=candidates.length===1?candidates[0]:'';
   d.purchase.supplierOrder=next;d.orderReferenceMode='auto';
   const input=get('docs-order');if(input&&input.value!==next)input.value=next;
   if(temporal&&next){d.progress='Se descartó una fecha u hora de la referencia anterior. La orden reconocida en el documento es '+next+'.';d.reviewed=false;const check=get('docs-reviewed');if(check)check.checked=false;}
 }
 function refreshValidation(d,paint=true){
   if(d!==draft)return;refreshDerivedOrder(d);d.validation=validationFor(d);
   if(!paint)return;
   const panel=get('docs-validation');if(panel)panel.innerHTML=validationPanel(d);
   for(const row of document.querySelectorAll('#document-import-form [data-doc-match]')){const check=d.validation?.documentChecks?.find(check=>check.id===row.dataset.docMatch),doc=allDocs(d).find(doc=>doc.id===row.dataset.docMatch);row.innerHTML=matchBadge(check,doc?.parsed);}
   for(const row of document.querySelectorAll('#document-import-form [data-doc-reference-notice]')){const doc=allDocs(d).find(doc=>doc.id===row.dataset.docReferenceNotice);row.innerHTML=referenceNotice(doc?.parsed);}
   const saveButton=get('docs-save');if(saveButton)saveButton.disabled=Boolean(d.busy||!hasChanges(d)||!d.lines.length||blockers(d).length||!d.validation);
   const warning=get('docs-blockers');if(warning){warning.hidden=!blockers(d).length;warning.innerHTML=blockerPanel(d);}
 }
 const checkColor=check=>({matched:'green',mismatch:'red',missing:'amber',duplicate:'amber',unverified:'slate'})[check?.status]||'slate';
 const matchBadge=(check,parsed)=>{if(referenceNeedsReview(parsed))return '<span>'+badge('Referencia por revisar','amber')+'</span>';const label=({matched:'Orden coincidente',mismatch:'No coincide',missing:'Sin referencia',duplicate:'Duplicado',unverified:'Por verificar'})[check?.status]||'Por verificar';return '<span title="'+esc(check?.label||label)+'">'+badge(label,checkColor(check))+'</span>';};
 function referenceNotice(parsed){
   const rejected=parsed?.supplierOrderRejectedCandidates||[],pending=referenceNeedsReview(parsed);
   if(!rejected.length&&!pending)return '';
   const reasons={date_time_context:'parece una hora sin separadores junto a la fecha de compra',ambiguous_columns:'no pudo distinguirse de otros números de las columnas'};
   return '<div class="document-warnings small-note" role="status"><strong>'+ (pending?'Confirma el número en el documento original':'Se revisó el contexto de la referencia')+'</strong>'+
     (rejected.length?'<ul>'+rejected.map(candidate=>'<li>Se descartó <strong>'+esc(candidate.value)+'</strong> en la lectura inicial: '+esc(reasons[candidate.reason]||'el contexto no permite identificarlo como una orden del proveedor')+'.'+(candidate.evidence?'<br><span>Contexto: '+esc(candidate.evidence)+'</span>':'')+'</li>').join('')+'</ul>':'')+
     (pending?'<p>La lectura no identifica una referencia segura. Revisa el original y corrige el número de orden de este documento antes de guardar.</p>':'')+'</div>';
 }
 function validationPanel(d){
   const report=d.validation;if(!allDocs(d).length)return '';
   if(!report)return '<div class="doc-match-panel" role="status">Comprobando la orden y todas sus facturas…</div>';
   const summary=report.summary||{},ref=report.expectedSupplierOrder||report.supplierOrder||d.purchase.supplierOrder;
   const issues=report.issues||[],failed=issues.some(issue=>issue.severity==='error'),warnings=issues.filter(issue=>issue.severity==='warning');
   return '<section class="doc-match-panel '+(failed?'has-errors':'')+'" aria-label="Validación de orden y facturas"><div class="doc-match-heading"><div><span class="small-note">ORDEN DEL PROVEEDOR</span><strong>'+esc(ref||'Pendiente de identificar')+'</strong></div>'+badge(failed?'Requiere corrección':warnings.length?'Revisar avisos':'Documentos compatibles',failed?'red':warnings.length?'amber':'green')+'</div><div class="doc-match-counts"><div><strong>'+Number(summary.orderedQty||0)+'</strong><span>Unidades ordenadas</span></div><div><strong>'+Number(summary.invoicedQty||0)+'</strong><span>Facturadas acumuladas</span></div><div class="'+(summary.excessQty?'has-excess':'')+'"><strong>'+Number(summary.excessQty||summary.pendingQty||0)+'</strong><span>'+(summary.excessQty?'Unidades de más':'Pendientes de facturar')+'</span></div></div><p class="small-note">Se comparan el proveedor, la orden, los artículos, las cantidades y los documentos anteriores y nuevos. '+Number(summary.invoiceCount||0)+' factura(s) revisada(s), sin contar duplicados.</p>'+
     (issues.length?'<ul class="doc-match-issues">'+issues.map(issue=>'<li class="'+(issue.severity==='error'?'is-error':'is-warning')+'">'+esc(issue.message)+'</li>').join('')+'</ul>':'<p class="doc-match-ok">Sin diferencias ni documentos repetidos detectados.</p>')+'</section>';
 }
 function blockerPanel(d){return '<strong>Resuelve las diferencias antes de guardar</strong><p>'+blockers(d).map(esc).join(' ')+'</p><p>Quita el documento incorrecto o revisa su lectura y la referencia original.</p>';}
 function setDocumentReference(d,doc,reference){
   const value=String(reference??'').trim();if(value===String(doc.parsed?.supplierOrder||''))return;
   const parsed=doc.parsed;parsed.supplierOrderOriginal??=parsed.supplierOrder||'';parsed.supplierOrder=value||null;parsed.supplierOrderReviewed=true;parsed.supplierOrderNeedsReview=!value;parsed.supplierOrderConflict=false;doc.extraction='manual';
   if(existingDocs(d).some(row=>row.id===doc.id)&&!d.editedDocumentIds.includes(doc.id))d.editedDocumentIds.push(doc.id);
   d.reviewed=false;const checkbox=get('docs-reviewed');if(checkbox)checkbox.checked=false;
 }
 function checkSession(d){if(d!==draft||d.workspace!==ERP.workspace)throw new Error('La lectura se cerró o cambió el espacio de trabajo. Abre de nuevo la importación.');}
 function progress(d,message){if(d!==draft||d.workspace!==ERP.workspace)return;message=typeof message==='string'?message:message?.message||'Procesando documento…';d.progress=message;const status=get('docs-progress');if(status)status.textContent=message;}
 function close(){if(draft){for(const doc of draft.documents)if(doc.previewUrl)URL.revokeObjectURL(doc.previewUrl);}draft=null;get('modal')?.classList.remove('documents-modal');}
 function rowsFromPurchase(p){return (p?.items||[]).map(l=>({...l,sku:l.sku||state.products.find(x=>related(l,x))?.sku||'',documentIds:l.documentIds||[]}));}
 async function recompute(d){
   checkSession(d);const [engine]=await Promise.all([parser(),validator()]);checkSession(d);const prior=d.purchaseId?state.purchases.find(p=>p.id===d.purchaseId):null;
   const originalDocs=allDocs(d),originalCombined=engine.combinePurchaseDocuments(originalDocs);
   refreshDerivedOrder(d);
   let sources=originalDocs;
   // Confirmed quantities are authoritative even when OCR evidence was corrected.
   // Keep original files and parsed evidence intact; use the reviewed order for coverage.
   if(prior?.items?.length){
     sources=sources.filter(doc=>doc.parsed?.kind!=='order');
     sources.unshift({id:'existing-order',parsed:{kind:'order',supplier:prior.supplier,supplierOrder:prior.supplierOrder,date:prior.date,
       currency:'MXN',totalCents:prior.amountCents,lines:prior.items.map(l=>({supplierItem:l.supplierItem,name:l.name,qty:l.qty,unitCostCents:l.unitCostCents,totalCents:l.totalCents}))}});
   }else if(d.lines.length&&d.lines.some(l=>l.manual||l.overrides?.qty||l.overrides?.cost)){
     const source=sources.find(doc=>doc.parsed?.kind==='order')?.parsed||sources[0]?.parsed||{};
     sources=sources.filter(doc=>doc.parsed?.kind!=='order');
     sources.unshift({id:'reviewed-order',parsed:{kind:'order',supplier:d.purchase.supplier||source.supplier,supplierOrder:d.purchase.supplierOrder||source.supplierOrder,
       date:d.purchase.date||source.date,currency:source.currency||'MXN',totalCents:d.totalEdited?d.purchase.amountCents:null,
       lines:d.lines.map(l=>({supplierItem:l.supplierItem,name:l.name,qty:l.qty,unitCostCents:l.unitCostCents,
         totalCents:l.unitCostCents==null?null:Math.round(l.qty*l.unitCostCents)}))}});
   }
   const combined=engine.combinePurchaseDocuments(sources),old=new Map(d.lines.map(l=>[idKey(l),l]));
   d.combined=combined;
   d.purchase={...(prior||{}),...d.purchase,supplier:d.purchase.supplier||originalCombined.supplier||combined.supplier||'',supplierOrder:d.purchase.supplierOrder||'',
     date:d.purchase.date||combined.date||ERP.today(),shippingStatus:d.purchase.shippingStatus||prior?.shippingStatus||'En tránsito',
     amountCents:d.totalEdited?d.purchase.amountCents:combined.totalCents??prior?.amountCents??null};
   const validIds=new Set(allDocs(d).map(x=>x.id));
   d.lines=(combined.lines||[]).map(line=>{
     const itemMatches=line.supplierItem?[...old.values()].filter(l=>l.supplierItem===line.supplierItem):[];
     const previous=old.get(idKey(line))||[...old.values()].find(l=>l.sourceKey===idKey(line))||(itemMatches.length===1?itemMatches[0]:null),matches=(prior?.items||[]).filter(l=>
       line.supplierItem&&l.supplierItem===line.supplierItem||l.name.toLocaleUpperCase('es-MX')===String(line.name).toLocaleUpperCase('es-MX'));
     const priorLine=matches.length===1?matches[0]:null;
     const match=engine.matchPurchaseLine(line,state.products,state.supplierEquivalences||[],d.purchase.supplier);
     const sku=previous?.sku||priorLine?.sku||state.products.find(p=>priorLine&&related(priorLine,p))?.sku||match.sku||'';
     const orderIds=allDocs(d).filter(doc=>doc.parsed?.kind==='order'&&(doc.parsed.lines||[]).some(l=>
       line.supplierItem&&l.supplierItem===line.supplierItem||idKey(l)===idKey(line))).map(doc=>doc.id);
     return {...line,name:previous?.name||priorLine?.name||line.name,id:priorLine?.id,sku,newProduct:previous?.newProduct||null,match,
       sourceKey:previous?.sourceKey||idKey(line),overrides:previous?.overrides||{},manual:previous?.manual||false,
       qty:previous?.overrides?.qty?previous.qty:priorLine?.qty??line.qty,
       unitCostCents:previous?.overrides?.cost?previous.unitCostCents:priorLine?.unitCostCents??line.unitCostCents,receivedQty:priorLine?.receivedQty||0,
       documentIds:[...new Set([...(priorLine?.documentIds||[]),...(line.documentIds||[]),...orderIds])].filter(id=>validIds.has(id))};
   });
   // Preserve manual lines and all already received lines when attaching files.
   for(const line of rowsFromPurchase(prior))if(!d.lines.some(row=>row.id===line.id)){
     d.lines.push({...line,match:{confidence:'existing',sku:line.sku},receivedQty:line.receivedQty||0});
   }
   for(const line of old.values())if(line.manual&&!d.lines.some(row=>idKey(row)===idKey(line)))d.lines.push(line);
   if(!d.lines.length)d.lines=old.size?[...old.values()]:[];
   refreshValidation(d,false);render(d);
 }
 async function open(options={}){
   close();const requestedId=options.purchaseId||options.purchaseDraft?.id,p=requestedId?state.purchases.find(x=>x.id===requestedId):null;
   const base={...(p||{}),...(options.purchaseDraft||{})},initialLines=rowsFromPurchase(base).map(line=>({...line,...(!p?{manual:true,overrides:{qty:true,cost:line.unitCostCents!=null}}:{})}));
   draft={workspace:ERP.workspace,purchaseId:p?.id||null,purchase:base,storedDocuments:structuredClone((state.documents||[]).filter(doc=>p&&doc.purchaseId===p.id)),documents:[],editedDocumentIds:[],uploadWarnings:[],orderReferenceMode:p?.supplierOrder?'existing':base.supplierOrder?'manual':'auto',lines:initialLines,combined:null,validation:null,busy:false,progress:'',reviewed:false};
   const d=draft;render(d);
   try{await Promise.all([parser(),validator()]);if(d!==draft)return;if(allDocs(d).length)await recompute(d);else refreshValidation(d);}
   catch(error){if(d===draft){d.progress='No se pudo cargar la validación: '+error.message;render(d);}}
 }
 function capture(d){
   if(!get('document-import-form'))return;
   for(const [field,id] of [['supplier','docs-supplier'],['supplierOrder','docs-order'],['date','docs-date'],['shippingStatus','docs-shipping'],['notes','docs-notes']])if(get(id)){const captured=value(id).trim();if(field==='supplierOrder'&&captured!==String(d.purchase.supplierOrder||''))d.orderReferenceMode='manual';d.purchase[field]=captured;}
   if(get('docs-total'))d.purchase.amountCents=cents(value('docs-total'));
   for(const input of document.querySelectorAll('[data-doc-order-reference]')){const doc=allDocs(d).find(doc=>doc.id===input.dataset.docOrderReference);if(doc)setDocumentReference(d,doc,input.value);}
   d.reviewed=!!get('docs-reviewed')?.checked;
   for(const row of document.querySelectorAll('[data-doc-line]')){
     const i=Number(row.dataset.docLine),line=d.lines[i];if(!line)continue;
     const val=field=>row.querySelector('[data-doc-field="'+field+'"]')?.value??'';
     line.name=val('name');line.qty=Number(val('qty'));line.unitCostCents=cents(val('cost'));line.supplierItem=val('item');
     const selected=val('sku');line.sku=selected==='__new__'?'':selected;
     if(selected==='__new__')line.newProduct={...(line.newProduct||{}),name:val('name'),brand:val('brand'),model:val('model'),color:val('color'),capacity:val('capacity'),
       upc:val('upc'),imageUrl:val('image'),category:val('category')||'Por clasificar'};
     else line.newProduct=null;
     line.documentIds=[...row.querySelectorAll('[data-doc-link]:checked')].map(input=>input.dataset.docLink);
   }
 }
 function documentCard(doc,stored=false,validation,editable=false){
   const p=doc.parsed||{},url=stored?docUrl(doc.id):doc.previewUrl,check=validation?.documentChecks?.find(check=>check.id===doc.id);
   return '<article class="document-card"><div class="document-card-icon">'+icon(p.kind==='invoice'?'wallet':'file')+'</div><div class="document-card-body"><strong>'+esc(doc.name)+'</strong>'+
     '<div class="document-card-meta">'+badge(kindName(p.kind),p.kind==='invoice'?'green':'blue')+'<span>'+esc(p.invoiceNumber||p.supplierOrder||'Sin referencia')+'</span><span>'+esc(doc.extraction==='ocr'?'OCR de imagen':doc.extraction==='manual'?'Revisión manual':'Lectura PDF')+'</span></div>'+
     '<div class="document-order-reference"><span>Número de orden en este documento</span>'+
     (editable?'<input data-doc-order-reference="'+esc(doc.id)+'" aria-label="Número de orden en '+esc(doc.name)+'" value="'+esc(p.supplierOrder||'')+'" maxlength="120" autocomplete="off" placeholder="Revisa el número en el original">':'<strong>'+esc(p.supplierOrder||'No identificado')+'</strong>')+
     '<div data-doc-match="'+esc(doc.id)+'">'+matchBadge(check,p)+'</div>'+
     (p.supplierOrderReviewed?'<small>Referencia revisada manualmente. Lectura inicial: '+esc(p.supplierOrderOriginal||'sin número')+'.</small>':p.evidence?.supplierOrder?'<small>Lectura: '+esc(p.evidence.supplierOrder)+'</small>':editable?'<small>Si la lectura falta o es incorrecta, escribe el número que aparece en este documento.</small>':'')+
     '<div data-doc-reference-notice="'+esc(doc.id)+'">'+referenceNotice(p)+'</div></div>'+
     (p.totalCents!=null?'<div class="document-card-total">'+money(p.totalCents)+'</div>':'<div class="small-note">Importe por confirmar</div>')+
     (p.uuid?'<div class="document-uuid">UUID '+esc(p.uuid)+'</div>':'')+
     '<div class="document-card-actions">'+(url?'<a class="btn small" target="_blank" rel="noopener" href="'+esc(url)+'">Ver original ↗</a>':'')+
     (!stored?'<button class="btn small" type="button" data-doc-remove="'+doc.id+'">Quitar</button>':'')+'</div>'+
     (!stored?'<details class="document-reading"><summary>Revisar lectura y clasificación</summary><label>Tipo de documento<select data-doc-kind="'+doc.id+'">'+['order','invoice','unknown'].map(k=>'<option value="'+k+'" '+(p.kind===k?'selected':'')+'>'+kindName(k)+'</option>').join('')+'</select></label><label>Texto extraído<textarea data-doc-text="'+doc.id+'" rows="6">'+esc(doc.text||'')+'</textarea></label><div class="document-card-actions"><button class="btn small" type="button" data-doc-reparse="'+doc.id+'">Volver a interpretar</button><button class="btn small" type="button" data-doc-ocr="'+doc.id+'">Leer con OCR</button></div></details>':'')+
     '</div></article>';
 }
 // Preview the whole batch in the same order as the server, including collisions between new lines.
 function proposedSkus(d){
   const reserved=[...(state.products||[])],byItem=new Map();
   const text=v=>String(v??'').trim();
   const normalized=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().replace(/\s+/g,' ');
   return d.lines.map(line=>{
     if(!line.newProduct)return '';
     const source={...line.newProduct,name:line.name},code=text(line.supplierItem).toUpperCase().replace(/\s+/g,'');
     const signature=JSON.stringify([normalized(source.name),normalized(source.brand),normalized(source.model),normalized(source.color),normalized(source.capacity),text(source.upc)]);
     const prior=code?byItem.get(code):null;
     if(prior&&prior.signature===signature)return prior.sku;
     const sku=ERP.engines.inventory.generateProductSku({...source,name:text(source.name).slice(0,250),brand:text(source.brand).slice(0,100)},reserved);
     reserved.push({sku,upc:text(source.upc).slice(0,80).replace(/[\s-]/g,'')});
     if(code&&!prior)byItem.set(code,{signature,sku});
     return sku;
   });
 }
 function refreshSkuPreviews(d){
   const skus=proposedSkus(d);
   for(const row of document.querySelectorAll('[data-doc-line]')){
     const preview=row.querySelector('[data-doc-sku-preview]');
     if(preview)preview.textContent=skus[Number(row.dataset.docLine)]||'';
   }
 }
 function lineCard(line,i,d,skus){
   const selected=line.newProduct?'__new__':line.sku||'';
   const matchLabel=({exact_upc:'UPC reconocido',supplier_item:'Equivalencia del proveedor',name:'Nombre coincidente',suggestion:'Sugerencia: confirmar producto',unmatched:'Asigna un producto',existing:'Producto de esta compra'})[line.match?.confidence]||'Asignación revisada';
   const p=state.products.find(p=>p.sku===line.sku),np=line.newProduct||{},field=(key,label,val,type='text',extra='')=>
     '<div class="field"><label>'+esc(label)+'<input data-doc-field="'+key+'" type="'+type+'" value="'+esc(val??'')+'" '+extra+'></label></div>';
   const readonly=line.receivedQty>0?'disabled':'';
   let html='<article class="doc-line" data-doc-line="'+i+'"><div class="doc-line-heading"><span class="doc-line-index">'+(i+1)+'</span>'+
     '<div><strong>'+esc(line.name||'Artículo por identificar')+'</strong><div class="small-note">'+esc(matchLabel)+(line.invoicedQty!=null?' · Facturado '+line.invoicedQty+' de '+line.qty:'')+'</div></div>'+
     (p?window.ProductTrace28?.thumb(p)||'':'')+
     (line.receivedQty?badge(line.receivedQty+' recibidas','green'):'<button type="button" class="btn small" data-doc-line-remove="'+i+'">Quitar partida</button>')+'</div>';
   html+='<div class="form-grid">'+field('name','Descripción del artículo *',line.name,'text','required')+field('item','Número de artículo del proveedor',line.supplierItem)+
     field('qty','Unidades ordenadas *',line.qty,'number','min="'+Math.max(1,line.receivedQty||0)+'" step="1" required')+
     field('cost','Costo unitario final (MXN)',number(line.unitCostCents),'number','min="0" step="0.01" placeholder="Por confirmar"')+
     '<div class="field doc-product-field"><label>Relacionar con inventario *<select data-doc-field="sku" required '+readonly+'><option value="">Selecciona el artículo correcto</option>'+
     state.products.map(p=>'<option value="'+esc(p.sku)+'" '+(selected===p.sku?'selected':'')+'>'+esc(p.name+' · '+p.sku+(p.upc?' · '+p.upc:''))+'</option>').join('')+
     '<option value="__new__" '+(selected==='__new__'?'selected':'')+'>＋ Crear producto y generar SKU interno</option></select></label></div></div>';
   if(!selected&&line.match?.candidates?.length)html+='<div class="small-note">Posibles coincidencias: '+line.match.candidates.slice(0,3).map(x=>esc(x.name||x.sku)).join(' · ')+'. Confirma el modelo antes de asignarlo.</div>';
   if(line.newProduct){
     const generated=skus[i];
     html+='<div class="doc-new-product"><h4>Nuevo producto · existencia inicial 0</h4><div class="form-grid">'+field('brand','Marca *',np.brand,'text','required')+
       field('model','Modelo',np.model)+field('color','Color',np.color)+field('capacity','Capacidad',np.capacity)+field('upc','UPC / EAN (opcional)',np.upc,'text','inputmode="numeric" placeholder="Asignar al recibir"')+
       field('category','Categoría',np.category)+field('image','URL HTTPS de imagen (opcional)',np.imageUrl,'text')+'</div><div class="doc-generated-sku"><span>SKU interno propuesto</span><code data-doc-sku-preview>'+esc(generated)+'</code></div><p class="small-note">Máximo 10 letras y números, sin espacios ni guiones. Se genera y verifica como único al guardar. El UPC puede incorporarse al recibir la mercancía.</p></div>';
   }
   html+='<fieldset class="doc-line-links"><legend>Documentos que corresponden a este artículo</legend>'+allDocs(d).map(doc=>
     '<label><input type="checkbox" data-doc-link="'+esc(doc.id)+'" '+(line.documentIds?.includes(doc.id)?'checked':'')+'> '+esc(kindName(doc.parsed?.kind)+' · '+(doc.parsed?.invoiceNumber||doc.name))+'</label>').join('')+'</fieldset></article>';
   return html;
 }
 function render(d){
   if(d!==draft||d.workspace!==ERP.workspace)return;
   refreshValidation(d,false);const docs=allDocs(d),p=d.purchase,combined=d.combined,hasFiles=docs.length>0,skus=proposedSkus(d);
   const warnings=[...new Set([...(combined?.warnings||[]).filter(warning=>!(combined?.blockingWarnings||[]).includes(warning)),...(d.uploadWarnings||[])])];
   const existing=d.purchaseId?[]:(state.purchases||[]).filter(x=>p.supplierOrder&&x.supplierOrder===p.supplierOrder);
   const blocked=blockers(d).length;
   const title=d.purchaseId?'Añadir documentos a '+esc(state.purchases.find(x=>x.id===d.purchaseId)?.number||d.purchaseId):'Importar orden y facturas';
   showModal('<form id="document-import-form"><div class="docs-modal-head"><div><span class="eyebrow">COMPRAS / LECTURA DOCUMENTAL</span><h2 id="modal-title">'+title+'</h2><p class="modal-subtitle">De tus documentos a una orden lista para recibir.</p></div><span class="docs-workspace">'+(ERP.workspace==='practice'?'Práctica':'Operación V28')+'</span></div>'+
     '<div class="doc-steps"><span class="'+(!hasFiles?'active':'done')+'"><b>1</b> Adjuntar</span><span class="'+(hasFiles?'active':'')+'"><b>2</b> Revisar y relacionar</span><span><b>3</b> Guardar sin recibir</span></div>'+
     '<div class="document-dropzone" id="document-dropzone"><div class="document-drop-icon">'+icon('upload')+'</div><strong>Orden de compra, facturas o capturas</strong><p>Puedes adjuntar la orden y sus facturas juntas, o agregar más facturas después. PDF, PNG o JPG · hasta 15 MB por archivo · máximo 12 archivos por importación.</p><label class="btn primary" for="document-files">'+icon('plus')+' Seleccionar documentos</label><input id="document-files" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" multiple '+(d.busy?'disabled':'')+'><span class="small-note">También puedes arrastrarlos aquí. La lectura y el OCR se procesan en este navegador.</span></div>'+
     '<div id="docs-progress" class="docs-progress" role="status" aria-live="polite">'+esc(d.progress||'')+'</div>'+
     (hasFiles?'<div class="document-grid">'+docs.map(doc=>documentCard(doc,!d.documents.some(x=>x.id===doc.id),d.validation,true)).join('')+'</div>':'')+
     '<div id="docs-validation" aria-live="polite">'+validationPanel(d)+'</div>'+
     (warnings.length?'<div class="document-warnings"><strong>Revisa antes de guardar</strong><ul>'+warnings.map(w=>'<li>'+esc(typeof w==='string'?w:w.message||String(w))+'</li>').join('')+'</ul></div>':'')+
     (existing.length?'<div class="info-box amber spacer-top">Ya existe '+existing.map(x=>esc(x.number||x.id)).join(', ')+' con la referencia '+esc(p.supplierOrder)+'. Abre esa compra para revisar sus artículos y anexar los documentos correspondientes.</div>':'')+
     (hasFiles?'<section class="doc-review-section"><div class="form-section-head"><h3>Datos de la compra</h3>'+badge(d.purchaseId?'Conservar folio':'Folio automático','blue')+'</div><div class="form-grid">'+
       ERP.field('docs-supplier','Proveedor *',p.supplier,'text','required list="docs-suppliers"')+
       ERP.field('docs-order','Orden original del proveedor',p.supplierOrder)+ERP.field('docs-date','Fecha de la orden *',p.date||ERP.today(),'date','required max="'+ERP.today()+'"')+
       ERP.select('docs-shipping','Estado de traslado',['Pendiente','En tránsito'],p.shippingStatus||'En tránsito')+
       ERP.field('docs-total','Importe total de la compra (MXN)',number(p.amountCents),'number','min="0.01" step="0.01" placeholder="Por confirmar"')+
       '<div class="doc-total-context">'+(combined?.invoiceTotals?.totalCents!=null?'<span>Facturas adjuntas</span><strong>'+money(combined.invoiceTotals.totalCents)+'</strong>':'<span>Puedes registrar la orden sin conocer aún su importe.</span>')+'</div></div><datalist id="docs-suppliers">'+(state.catalogs?.suppliers||[]).map(x=>'<option value="'+esc(typeof x==='string'?x:x.name||'')+'">').join('')+'</datalist>'+
       '<div class="field spacer-top"><label for="docs-notes">Observaciones</label><textarea id="docs-notes" rows="2">'+esc(p.notes||'')+'</textarea></div></section>'+
       '<section class="doc-review-section"><div class="form-section-head"><div><h3>Artículos y equivalencias</h3><span class="small-note">Cantidades ordenadas. Las facturas respaldan estas unidades y no las duplican.</span></div><button type="button" class="btn small" data-doc-add-line>＋ Añadir partida</button></div>'+
       (d.lines.length?d.lines.map((l,i)=>lineCard(l,i,d,skus)).join(''):'<div class="empty">No se identificaron partidas con suficiente confianza. Revisa el texto extraído o añade la mercancía manualmente.</div>')+'</section>'+
       '<div class="doc-confirm"><label><input id="docs-reviewed" type="checkbox" '+(d.reviewed?'checked':'')+' required> Confirmé productos, cantidades, documentos e importes. Las unidades entrarán al inventario únicamente al recibirlas en almacén.</label></div>'+
       '<div id="docs-blockers" class="document-warnings" '+(blocked?'':'hidden')+'>'+blockerPanel(d)+'</div>':'')+
     '<div class="modal-actions docs-sticky-actions"><button class="btn" type="button" data-action="close-modal">Cerrar</button>'+
     (hasFiles?'<button class="btn primary" id="docs-save" type="submit" '+(d.busy||!hasChanges(d)||!d.lines.length||blocked||!d.validation?'disabled':'')+'>'+icon('check')+(d.purchaseId?' Guardar documentos y actualizar orden':' Registrar orden documental')+'</button>':'')+'</div></form>');
   get('modal').classList.add('documents-modal');
 }
 async function addFiles(files){
   const d=draft;if(!d||d.busy)return;capture(d);
   const selected=[...files];if(!selected.length)return;
   if(d.documents.length+selected.length>12){toast('Adjunta un máximo de 12 archivos por importación.',true);return;}
   d.busy=true;d.reviewed=false;render(d);
   try{
     const engine=await parser();
     for(const file of selected){
       checkSession(d);
       if(!/\.(pdf|png|jpe?g)$/i.test(file.name)||!file.size||file.size>15*1024*1024)throw new Error(file.name+': utiliza PDF, PNG o JPG de hasta 15 MB.');
       progress(d,'Leyendo '+file.name+'…');
       const id=await DocumentHash29.digest(await file.arrayBuffer());
       if(allDocs(d).some(doc=>doc.id===id)){const warning=file.name+' ya está adjunto. El archivo duplicado se omitió y no sumó artículos.';d.uploadWarnings.push(warning);toast(warning);continue;}
       const read=await DocumentReader29.extract(file,message=>progress(d,file.name+' · '+(typeof message==='string'?message:message.message)));
       checkSession(d);const parsed=engine.parsePurchaseDocument(read.text,{fileName:file.name});
       parsed.warnings=[...new Set([...(parsed.warnings||[]),...(read.warnings||[])])];
       d.documents.push({id,sha256:id,name:file.name,mime:file.type,size:file.size,file,text:read.text,parsed,extraction:read.extraction,previewUrl:URL.createObjectURL(file)});
     }
     d.progress='Lectura terminada. Revisa la asignación de cada artículo.';
     await recompute(d);
   }catch(error){if(d===draft){d.progress=error.message;toast(error.message,true);}}
   finally{d.busy=false;if(d===draft)render(d);}
 }
 async function save(d){
   if(d.busy||ERP.busy)return;capture(d);
   if(!d.reviewed){toast('Confirma la revisión de los documentos.',true);return;}
   try{await validator();checkSession(d);if(d.busy||ERP.busy)return;refreshValidation(d);}catch(error){toast('No se pudo verificar la orden: '+error.message,true);return;}
   if(!d.reviewed){toast('Confirma de nuevo la revisión después de los cambios.',true);return;}
   if(blockers(d).length||!d.validation?.valid){toast('Resuelve las diferencias de la orden y sus facturas antes de guardar.',true);return;}
   if(d.documents.some(doc=>!doc.parsed.lines?.length&&!d.lines.some(line=>line.documentIds.includes(doc.id)))){toast('Relaciona los documentos sin lectura con sus partidas capturadas manualmente.',true);return;}
   if(d.lines.some(l=>!l.sku&&!l.newProduct)){toast('Asigna cada partida a un producto o genera uno nuevo.',true);return;}
   d.busy=true;render(d);
   try{
     const documents=existingDocs(d).filter(doc=>d.editedDocumentIds.includes(doc.id)).map(doc=>({id:doc.id,parsed:doc.parsed,extraction:'manual'}));
     for(const doc of d.documents){
       checkSession(d);progress(d,'Guardando archivo '+doc.name+'…');
       const form=new FormData();form.append('file',doc.file);
       const response=await fetch('/api/documents?workspace='+encodeURIComponent(d.workspace),{method:'POST',body:form}),data=await response.json();
       if(!response.ok)throw new Error(data.error||'No se pudo guardar '+doc.name);
       if(data.document.id!==doc.id)throw new Error('El archivo cambió durante la carga. Selecciónalo nuevamente.');
       documents.push({id:doc.id,parsed:doc.parsed,extraction:doc.extraction});
     }
     checkSession(d);progress(d,'Guardando orden, equivalencias y referencias…');
     const lines=d.lines.map(l=>({id:l.id,sku:l.sku||undefined,newProduct:l.newProduct?{...l.newProduct,name:l.name,costCents:l.unitCostCents??undefined,priceCents:0,
       review:l.unitCostCents==null?'Costo pendiente de confirmar. Artículo creado desde documento.':'Creado desde documento revisado.'}:undefined,
       name:l.name,supplierItem:l.supplierItem,qty:l.qty,unitCostCents:l.unitCostCents,documentIds:l.documentIds}));
     const purchase=Object.fromEntries(['supplier','supplierOrder','date','shippingStatus','notes','amountCents','lender','instrument','term','firstPaymentDate','sicar','taxInvoice','satReviewed'].filter(key=>d.purchase[key]!==undefined&&!(key==='taxInvoice'&&!d.purchase[key])).map(key=>[key,d.purchase[key]]));
     const result=await ERP.command('purchase.importDocuments',{purchaseId:d.purchaseId||undefined,purchase,lines,documents});
     if(!result.ok)throw new Error(result.error||'No se guardó la importación. Revisa y vuelve a intentar.');
     const id=result.result.purchaseId||result.result.id;get('modal').close();close();if(id)window.op28Detail?.('purchase',id);
   }catch(error){if(d===draft){d.progress=error.message;toast(error.message,true);}}
   finally{d.busy=false;if(d===draft)render(d);}
 }
 function section(p){
   const docs=(state.documents||[]).filter(doc=>doc.purchaseId===p.id),d={purchaseId:p.id,purchase:p,storedDocuments:docs,documents:[],lines:p.items||[]};d.validation=validationFor(d);
   if(docs.length&&!validationEngine){const workspace=ERP.workspace;validator().then(()=>{const node=get('purchase-documents-'+p.id),current=state.purchases.find(row=>row.id===p.id);if(node&&current&&ERP.workspace===workspace)node.outerHTML=section(current);}).catch(()=>{});}
   return '<section class="purchase-documents-section" id="purchase-documents-'+esc(p.id)+'"><div class="form-section-head"><div><h3>Orden y facturas</h3><span class="small-note">'+docs.length+' documentos conservados con esta compra</span></div><button class="btn small" data-doc-open="'+esc(p.id)+'">＋ Añadir o revisar documentos</button></div>'+
     (docs.length?validationPanel(d)+'<div class="document-grid">'+docs.map(doc=>documentCard(doc,true,d.validation)).join('')+'</div>':'<div class="doc-empty">'+icon('file')+'<p>Conserva aquí la orden del proveedor y sus facturas. Podrás consultarlas también desde cada producto.</p></div>')+'</section>';
 }
 document.addEventListener('change',e=>{
   if(e.target.id==='document-files'){addFiles(e.target.files);return;}
   if(e.target.id==='workspace-picker'){close();return;}
   if(!draft)return;
   if(e.target.matches('[data-doc-field="sku"]')){
     const d=draft;capture(d);const line=d.lines[Number(e.target.closest('[data-doc-line]').dataset.docLine)];
     if(e.target.value==='__new__'&&!line.newProduct?.brand){line.newProduct={...(line.newProduct||{}),name:line.name,brand:'',model:'',color:'',capacity:'',upc:''};}
     d.reviewed=false;refreshValidation(d,false);render(d);
   }
 });
 document.addEventListener('input',e=>{
   if(!draft)return;
   if(e.target.id==='docs-total')draft.totalEdited=true;
   if(e.target.hasAttribute('data-doc-order-reference')){capture(draft);refreshValidation(draft);return;}
   if(['docs-supplier','docs-order','docs-total'].includes(e.target.id)){if(e.target.id==='docs-order')draft.orderReferenceMode='manual';capture(draft);draft.reviewed=false;const check=get('docs-reviewed');if(check)check.checked=false;refreshValidation(draft);return;}
   if(!e.target.closest('[data-doc-line]'))return;
   const row=e.target.closest('[data-doc-line]'),i=Number(row.dataset.docLine),line=draft.lines[i];
   if(!line)return;
   if(['qty','cost'].includes(e.target.dataset.docField))(line.overrides??={})[e.target.dataset.docField]=true;
   capture(draft);refreshSkuPreviews(draft);draft.reviewed=false;const check=get('docs-reviewed');if(check)check.checked=false;refreshValidation(draft);
 });
 document.addEventListener('click',async e=>{
   const el=e.target.closest('button');if(!el)return;
   if(el.hasAttribute('data-doc-open')){open({purchaseId:el.dataset.docOpen});return;}
   const d=draft;if(!d||d.busy)return;
   if(el.hasAttribute('data-doc-remove')){
     capture(d);const doc=d.documents.find(x=>x.id===el.dataset.docRemove);if(doc?.previewUrl)URL.revokeObjectURL(doc.previewUrl);
     d.documents=d.documents.filter(x=>x.id!==el.dataset.docRemove);d.reviewed=false;await recompute(d);
   }else if(el.hasAttribute('data-doc-add-line')){
     capture(d);d.manualReview=true;d.lines.push({name:'',supplierItem:'',qty:1,unitCostCents:null,sku:'',newProduct:null,manual:true,documentIds:allDocs(d).map(x=>x.id),match:{confidence:'unmatched'}});
     d.reviewed=false;render(d);
   }else if(el.hasAttribute('data-doc-line-remove')){capture(d);d.lines.splice(Number(el.dataset.docLineRemove),1);d.reviewed=false;render(d);}
   else if(el.hasAttribute('data-doc-reparse')){
     capture(d);const doc=d.documents.find(x=>x.id===el.dataset.docReparse);if(!doc)return;
     doc.text=document.querySelector('[data-doc-text="'+doc.id+'"]').value;
     const kind=document.querySelector('[data-doc-kind="'+doc.id+'"]').value,engine=await parser();
     doc.parsed=engine.parsePurchaseDocument(doc.text,{fileName:doc.name,kind});doc.extraction='manual';d.reviewed=false;await recompute(d);
   }else if(el.hasAttribute('data-doc-ocr')){
     capture(d);const doc=d.documents.find(x=>x.id===el.dataset.docOcr);if(!doc)return;
     d.busy=true;d.reviewed=false;render(d);
     try{const read=await DocumentReader29.extract(doc.file,msg=>progress(d,doc.name+' · '+(typeof msg==='string'?msg:msg.message)),{forceOCR:true});checkSession(d);doc.text=read.text;doc.extraction='ocr';doc.parsed=(await parser()).parsePurchaseDocument(doc.text,{fileName:doc.name});d.progress='OCR terminado. Verifica los datos reconocidos.';await recompute(d);}
     catch(error){if(d===draft){d.progress=error.message;toast(error.message,true);}}finally{d.busy=false;if(d===draft)render(d);}
   }
 });
 document.addEventListener('submit',e=>{if(e.target.id==='document-import-form'){e.preventDefault();if(draft)save(draft);}});
 document.addEventListener('dragover',e=>{if(e.target.closest('#document-dropzone')){e.preventDefault();e.target.closest('#document-dropzone').classList.add('dragging');}});
 document.addEventListener('dragleave',e=>e.target.closest('#document-dropzone')?.classList.remove('dragging'));
 document.addEventListener('drop',e=>{if(e.target.closest('#document-dropzone')){e.preventDefault();addFiles(e.dataTransfer.files);}});
 get('modal')?.addEventListener('close',()=>{if(draft)close();});
 window.PurchaseDocs28={open,section,docUrl,close};
 validator().catch(()=>{});
})();
