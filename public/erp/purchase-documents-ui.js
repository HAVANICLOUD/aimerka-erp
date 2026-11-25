'use strict';
(function(){
 if(typeof icons==='object'){icons.file??='<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>';icons.upload??='<path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>';}
 let draft=null,parserPromise=null,parserModule=null,validationPromise=null,validationEngine=null;
 const parser=()=>parserPromise??=import('/erp/modules/purchase-document-parser.mjs?v=20261124-retail').then(engine=>(parserModule=engine));
 const validator=()=>validationPromise??=import('/erp/modules/purchase-document-validation.mjs?v=20261125-wizard').then(engine=>(validationEngine=engine));
 const get=id=>document.getElementById(id);
 const value=id=>get(id)?.value??'';
 const cents=v=>String(v??'').trim()===''?null:Math.round(Number(v)*100);
 const number=v=>v==null?'':v/100;
 const kindName=k=>({order:'Orden de compra',invoice:'Factura',unknown:'Por clasificar'})[k]||'Documento';
 const fiscalText=(kind,code)=>ERP.engines.fiscalCatalog?.fiscalLabel(kind,code)||String(code||'Por identificar');
 function help(text,id){return '<span class="doc-help-wrap"><button type="button" class="doc-help" data-doc-help aria-expanded="false" aria-describedby="'+id+'" aria-label="Información: '+esc(text)+'">'+icon('info')+'</button><span class="doc-help-tip" id="'+id+'" role="tooltip">'+esc(text)+'</span></span>';}
 function heading(title,svg,subtitle=''){return '<div class="doc-section-title"><span>'+icon(svg)+'</span><div><h3>'+esc(title)+'</h3>'+(subtitle?'<p>'+esc(subtitle)+'</p>':'')+'</div></div>';}
 function readValue(label,value,svg,extra=''){return '<div class="doc-read-value '+extra+'"><dt>'+icon(svg)+esc(label)+'</dt><dd>'+esc(value??'Por identificar')+'</dd></div>';}
 function formField(id,label,value,svg,tip,{type='text',extra=''}={}){return '<div class="field"><label for="'+id+'"><span>'+icon(svg)+esc(label)+'</span>'+help(tip,id+'-help')+'</label><input id="'+id+'" type="'+type+'" value="'+esc(value??'')+'" '+extra+'></div>';}
 const selectedProduct=line=>state.products.find(p=>p.sku===line.sku);
 const productThumb=p=>p?(window.ProductTrace28?.thumb?.(p)||icon('box')):icon('box');
 function numericFacts(line){return '<dl class="doc-quantity-grid">'+[['Ordenadas',line.qty,'bag'],['Recibidas',line.receivedQty||0,'truck'],['Facturadas',line.invoicedQty||0,'file'],['Pendientes de factura',line.pendingInvoiceQty??Math.max(0,line.qty-(line.invoicedQty||0)),'clock']].map(([label,value,svg])=>readValue(label,value,svg)).join('')+'</dl>';}
 function invoiceLineSummary(line,d,index){const p=selectedProduct(line)||selectedProduct(d.lines[index]||{});return '<article class="doc-invoice-item"><header><span class="doc-product-photo">'+productThumb(p)+'</span><div><strong>'+esc(p?.name||line.name)+'</strong><small>'+esc(p?.sku||line.sku||'Producto por identificar')+(p?.upc?' · UPC '+esc(p.upc):'')+'</small></div></header>'+numericFacts(line)+'<dl class="doc-cost-grid">'+[['Costo sin IVA / unidad',costLabel(line.invoiceAverageNetCostCents)],['IVA acumulado',costLabel(line.invoicedTaxCents)],['Costo con IVA / unidad',costLabel(line.invoiceAverageCostCents)],['Total facturado',costLabel(line.invoicedTotalCents)]].map(([label,value])=>readValue(label,value,'wallet')).join('')+'</dl></article>';}
 function correctionPanel(d){const issues=d.validation?.issues||[],errors=issues.filter(i=>i.severity==='error');if(!errors.length)return '<div class="doc-verification-ok">'+icon('check')+'<span>Validaciones documentales sin diferencias detectadas. Revisa y confirma los artículos.</span></div>';return '<section class="doc-corrections" role="region" aria-label="Datos por corregir">'+heading('Datos por corregir','alert','Resuelve estas diferencias antes de guardar. Los documentos aceptados permanecen adjuntos.')+'<ul>'+errors.map((i,index)=>'<li><strong>'+esc(i.message)+'</strong>'+(i.actual!=null||i.expected!=null?'<dl><div><dt>En el documento</dt><dd>'+esc(i.field==='recipientTaxRegime'?fiscalText('regimes',i.actual):i.field==='cfdiUse'?fiscalText('usages',i.actual):i.actual??'No reconocido')+'</dd></div><div><dt>Dato esperado</dt><dd>'+esc(i.field==='recipientTaxRegime'?fiscalText('regimes',i.expected):i.field==='cfdiUse'?fiscalText('usages',i.expected):i.expected??'Por configurar')+'</dd></div></dl>':'')+'</li>').join('')+'</ul></section>';}
 function wizardValidation(d){if(!allDocs(d).length)return '';const report=d.validation;if(!report)return '<p role="status">Validando documentos…</p>';const summary=report.summary||{};return '<div class="doc-check-summary"><span>'+icon('file')+Number(summary.matchingInvoiceCount||0)+' factura'+(Number(summary.matchingInvoiceCount||0)===1?' coincidente':'s coincidentes')+'</span><span>'+icon('shield')+Number(summary.excludedInvoiceCount||0)+' documento'+(Number(summary.excludedInvoiceCount||0)===1?' excluido':'s excluidos')+'</span><span>'+icon('box')+Number(summary.orderedQty||0)+' unidades documentales</span></div>'+correctionPanel(d);}
 const docUrl=id=>'/api/documents/'+encodeURIComponent(id)+'?workspace='+encodeURIComponent(ERP.workspace);
 const idKey=line=>String(line.supplierItem||'')+'|'+String(line.name||'').toLocaleUpperCase('es-MX');
 const existingDocs=d=>d.storedDocuments||(state.documents||[]).filter(doc=>doc.purchaseId===d.purchaseId);
 const allDocs=d=>[...existingDocs(d),...d.documents];
 const related=(line,p)=>line.sku===p.sku||line.skuOrUpc===p.sku||p.upc&&line.skuOrUpc===p.upc;
 const blockers=d=>[...new Set((d.validation?.issues||[]).filter(issue=>issue.severity==='error').map(issue=>issue.message))];
 const hasChanges=d=>Boolean(d.documents.length||d.editedDocumentIds?.length);
 function referenceNeedsReview(parsed){
   if(!parsed)return false;
   if(parsed.supplierOrderAbsentConfirmed&&!parsed.supplierOrder&&!parsed.supplierOrderConflict&&!parsed.supplierOrderCandidates?.length&&!parsed.supplierOrderRejectedCandidates?.length)return false;
   const normalize=parserModule?.normalizeSupplierOrder||(value=>String(value??'').trim().toUpperCase());
   return Boolean((!parsed.supplierOrderReviewed||!parsed.supplierOrder)&&(parsed.supplierOrderNeedsReview||parsed.supplierOrderConflict)||
     parsed.supplierOrder&&(parserModule?.isTemporalSupplierOrder(parsed.supplierOrder,{context:parsed.evidence?.supplierOrder})||
       (parsed.supplierOrderRejectedCandidates||[]).some(candidate=>normalize(candidate.value)===normalize(parsed.supplierOrder)&&(candidate.reason!=='ambiguous_columns'||!parsed.supplierOrderReviewed))));
 }
 function validationFor(d){return validationEngine?.validatePurchaseDocuments(allDocs(d),{purchase:d.purchase,lines:d.lines,products:state.products||[],purchases:state.purchases||[],purchaseId:d.purchaseId||undefined,fiscalConfig:state.config?.purchaseFiscal,requireFiscal:Boolean(ERP.engines.purchaseCatalogs),allowFiscalSnapshots:true});}
 function refreshDerivedOrder(d){
   if(!parserModule)return;
   const prior=d.purchaseId?state.purchases.find(p=>p.id===d.purchaseId):null;
   // Saved purchase identity and deliberate manual references are never replaced
   // to make a different invoice appear compatible.
   const historicalReference=validationEngine?.purchaseOrderReference(prior);
   if(prior?.supplierOrder){d.orderReferenceMode='existing';return;}
   if(historicalReference){if(d.orderReferenceMode==='auto')d.purchase.supplierOrder=historicalReference;d.orderReferenceMode='existing';return;}
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
   const panel=get('docs-validation');if(panel)panel.innerHTML=wizardValidation(d);
   for(const row of document.querySelectorAll('#document-import-form [data-doc-match]')){const check=d.validation?.documentChecks?.find(check=>check.id===row.dataset.docMatch),doc=allDocs(d).find(doc=>doc.id===row.dataset.docMatch);row.innerHTML=matchBadge(check,doc?.parsed);}
   for(const row of document.querySelectorAll('#document-import-form [data-doc-reference-notice]')){const doc=allDocs(d).find(doc=>doc.id===row.dataset.docReferenceNotice);row.innerHTML=referenceNotice(doc?.parsed);}
   const saveButton=get('docs-save');if(saveButton)saveButton.disabled=Boolean(d.busy||!hasChanges(d)||!d.lines.length||blockers(d).length||!d.validation||d.lines.some(l=>!selectedProduct(l)&&!(d.mode==='invoice'&&l.sku)));
   const warning=get('docs-blockers');if(warning){warning.hidden=!blockers(d).length;warning.innerHTML=correctionPanel(d);}
 }
 const checkColor=check=>({matched:'green',mismatch:'red',missing:'amber',duplicate:'amber',unverified:'slate'})[check?.referenceStatus||check?.status]||'slate';
 const matchBadge=(check,parsed)=>{if(referenceNeedsReview(parsed))return '<span>'+badge('Referencia por revisar','amber')+'</span>';const label=({matched:parsed?.supplierReferenceType==='ticket'?'Ticket coincidente':'Orden coincidente',mismatch:'No coincide',missing:'Sin referencia',duplicate:'Duplicado',unverified:'Por verificar'})[check?.referenceStatus||check?.status]||'Por verificar';return '<span title="'+esc(check?.referenceLabel||check?.label||label)+'">'+badge(label,checkColor(check))+'</span>';};
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
   const fiscal=report.fiscal;
   const issues=report.issues||[],failed=issues.some(issue=>issue.severity==='error'),warnings=issues.filter(issue=>issue.severity==='warning');
   return '<section class="doc-match-panel '+(failed?'has-errors':'')+'" aria-label="Validación de orden y facturas"><div class="doc-match-heading"><div><span class="small-note">REFERENCIA DEL PROVEEDOR</span><strong>'+esc(ref||'Pendiente de identificar')+'</strong></div>'+badge(failed?'Requiere corrección':warnings.length?'Revisar avisos':'Documentos compatibles',failed?'red':warnings.length?'amber':'green')+'</div><div class="doc-match-counts"><div><strong>'+Number(summary.orderedQty||0)+'</strong><span>Unidades de la orden</span></div><div><strong>'+Number(summary.receivedQty||0)+'</strong><span>Recibidas · sin cambios</span></div><div><strong>'+Number(summary.invoicedQty||0)+'</strong><span>Facturadas acumuladas</span></div><div class="'+(summary.excessQty?'has-excess':'')+'"><strong>'+Number(summary.excessQty||summary.pendingQty||0)+'</strong><span>'+(summary.excessQty?'Unidades de más':'Pendientes de facturar')+'</span></div>'+(summary.unmatchedInvoiceQty?'<div class="has-excess"><strong>'+summary.unmatchedInvoiceQty+'</strong><span>Sin identificar · revisar artículo</span></div>':'')+'</div><p class="small-note">Se comparan el proveedor, la orden, los artículos, las cantidades y los documentos anteriores y nuevos. '+Number(summary.invoiceCount||0)+' factura(s) revisada(s), sin contar duplicados.</p>'+
     '<p class="small-note">Facturas coincidentes: '+Number(summary.matchingInvoiceCount||0)+' · Excluidas del cálculo: '+Number(summary.excludedInvoiceCount||0)+'.</p><ul class="doc-batch-summary">'+allDocs(d).map(doc=>{
       const check=report.documentChecks?.find(row=>row.id===doc.id),p=doc.parsed||{};
       const removable=d.documents.some(row=>row.id===doc.id)&&!existingDocs(d).some(row=>row.id===doc.id);
       return '<li data-doc-summary="'+esc(doc.id)+'"><strong>'+esc(doc.name||doc.id)+'</strong> · Folio: '+esc(p.invoiceNumber||'Sin folio')+' · Orden esperada: '+esc(check?.expectedSupplierOrder||ref||'Por confirmar')+' · Orden del archivo: '+esc(check?.supplierOrder||'Sin referencia')+' '+matchBadge(check,p)+(removable?'<button class="btn small" type="button" data-doc-remove="'+esc(doc.id)+'">Quitar este archivo</button>':'')+'</li>';
     }).join('')+'</ul>'+
     ((report.equivalences||[]).length?'<div class="doc-equivalence-confirm">'+icon('link')+'<span>Equivalencias que se conservarán: '+report.equivalences.map(e=>'<b>'+esc(e.supplierItem)+' → '+esc(e.sku)+'</b>').join(' · ')+'. Se reutilizarán al subir documentos del mismo proveedor.</span></div>':'')+
     (issues.length?'<ul class="doc-match-issues">'+issues.map(issue=>'<li class="'+(issue.severity==='error'?'is-error':'is-warning')+'">'+esc(issue.message)+'</li>').join('')+'</ul>':'<p class="doc-match-ok">Sin diferencias ni documentos repetidos detectados.</p>')+
     '<div class="table-wrap"><table><thead><tr><th>Producto</th><th>Ordenadas / recibidas / facturadas / pendientes</th><th>Costo sin IVA / unidad</th><th>IVA acumulado</th><th>Costo con IVA / unidad</th><th>Total facturado</th></tr></thead><tbody>'+(report.lines||[]).map(line=>'<tr><td>'+esc(line.name)+'</td><td>'+line.qty+' / '+(line.receivedQty||0)+' / '+line.invoicedQty+' / '+line.pendingInvoiceQty+'</td><td>'+costLabel(line.invoiceAverageNetCostCents)+'</td><td>'+costLabel(line.invoicedTaxCents)+'</td><td>'+costLabel(line.invoiceAverageCostCents)+'</td><td>'+costLabel(line.invoicedTotalCents)+'</td></tr>').join('')+'</tbody></table></div><p class="small-note">Costo de esta compra calculado con las unidades facturadas; el costo promedio se actualiza al recibir mercancía y se ajusta con su facturación posterior. Total facturado: <strong>'+costLabel(report.invoiceTotalCents)+'</strong>. La recepción y las existencias se conservan.</p>'+(fiscal?'<div class="doc-fiscal-status">'+badge(fiscal.valid?'Datos fiscales coincidentes':'Datos fiscales por corregir',fiscal.valid?'green':'red')+'<p>Empresa: '+esc(fiscal.profile?.legalName||'Por configurar')+' · Uso fiscal validado por documento. Este cotejo no consulta la vigencia del CFDI en el SAT.</p></div>':'')+'</section>';
 }
 const costLabel=value=>value==null?'Por confirmar':money(value);
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
   if(d.mode==='invoice'&&d.lines.length){
     d.combined={...originalCombined,warnings:originalDocs.filter(doc=>doc.parsed?.kind==='invoice').flatMap(doc=>doc.parsed.warnings||[])};d.validation=validationFor(d);
     for(const [index,line] of d.lines.entries()){
       const coverage=d.validation?.lines[index];
       line.documentIds=[...new Set([...(line.documentIds||[]),...(coverage?.invoiceDocumentIds||[])])];
     }
     render(d);return;
   }
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
     date:!prior&&!d.dateEdited?(originalCombined.date||combined.date||d.purchase.date||ERP.today()):(d.purchase.date||combined.date||ERP.today()),shippingStatus:d.purchase.shippingStatus||prior?.shippingStatus||'En tránsito',
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
       sourceReceivedQty:previous?.sourceReceivedQty??priorLine?.sourceReceivedQty??line.sourceReceivedQty??null,
       sourcePendingQty:previous?.sourcePendingQty??priorLine?.sourcePendingQty??line.sourcePendingQty??null,
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
   draft={step:1,maxStep:1,lineTab:'pending',dateEdited:Boolean(base.date&&base.date!==ERP.today()),mode:options.mode||'review',workspace:ERP.workspace,purchaseId:p?.id||null,purchase:base,storedDocuments:structuredClone((state.documents||[]).filter(doc=>p&&doc.purchaseId===p.id)),documents:[],editedDocumentIds:[],uploadWarnings:[],orderReferenceMode:p?.supplierOrder?'existing':base.supplierOrder?'manual':'auto',lines:initialLines,combined:null,validation:null,busy:false,progress:'',reviewed:false};
   const d=draft;render(d);
   try{await Promise.all([parser(),validator()]);if(d!==draft)return;if(allDocs(d).length)await recompute(d);else refreshValidation(d);}
   catch(error){if(d===draft){d.progress='No se pudo cargar la validación: '+error.message;render(d);}}
 }
 function capture(d){
   if(!get('document-import-form'))return;
   for(const [field,id] of [['supplier','docs-supplier'],['supplierOrder','docs-order'],['date','docs-date'],['shippingStatus','docs-shipping'],['notes','docs-notes'],['buyerCompanyId','docs-buyer']])if(get(id)){const captured=value(id).trim();if(field==='supplierOrder'&&captured!==String(d.purchase.supplierOrder||''))d.orderReferenceMode='manual';d.purchase[field]=captured;}
   if(get('docs-total')&&d.mode!=='invoice')d.purchase.amountCents=cents(value('docs-total'));
   for(const input of document.querySelectorAll('[data-doc-order-reference]')){const doc=allDocs(d).find(doc=>doc.id===input.dataset.docOrderReference);if(doc)setDocumentReference(d,doc,input.value);}
   for(const input of document.querySelectorAll('[data-doc-no-reference]')){const doc=d.documents.find(doc=>doc.id===input.dataset.docNoReference);if(doc)doc.parsed.supplierOrderAbsentConfirmed=input.checked;}
   d.reviewed=!!get('docs-reviewed')?.checked;
   for(const row of document.querySelectorAll('[data-doc-line]')){
     if(d.mode==='invoice')continue;
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
  const p=doc.parsed||{},url=stored?docUrl(doc.id):doc.previewUrl,check=validation?.documentChecks?.find(c=>c.id===doc.id),index=draft?Math.max(0,allDocs(draft).findIndex(d=>d.id===doc.id)):0,refId='doc-reference-'+index;
  return '<article class="document-card doc-document-detail" data-doc-summary="'+esc(doc.id)+'"><header class="doc-document-heading"><span class="document-card-icon">'+icon('file')+'</span><div><span class="eyebrow">'+esc(kindName(p.kind))+' detectada</span><h3>'+esc(p.invoiceNumber||doc.name)+'</h3><small>'+esc(doc.name)+'</small></div><div data-doc-match="'+esc(doc.id)+'">'+matchBadge(check,p)+'</div></header>'+
   '<div class="doc-document-overview"><div class="document-order-reference"><label for="'+refId+'">'+icon('tag')+' Referencia en este documento · orden o ticket</label>'+(editable?'<input id="'+refId+'" data-doc-order-reference="'+esc(doc.id)+'" aria-label="Referencia en '+esc(doc.name||doc.id)+'" value="'+esc(p.supplierOrder||'')+'" autocomplete="off" placeholder="Número de orden o ticket">':'<strong>'+esc(p.supplierOrder||'Sin referencia')+'</strong>')+'<small>'+esc(p.supplierReferenceType==='ticket'?'Ticket de compra en tienda':'Referencia original del proveedor')+'</small></div><div class="doc-document-amount"><span>'+icon('wallet')+' Importe del documento</span><strong>'+costLabel(p.totalCents)+'</strong><small>MXN · total con impuestos</small></div></div>'+
   (p.kind==='invoice'?'<section class="doc-receiver">'+heading('Receptor de la factura','shield')+'<strong class="doc-legal-name">'+esc(p.recipientName||'Razón social sin lectura')+'</strong><dl class="doc-fiscal-grid">'+readValue('RFC',p.recipientRfc,'tag')+readValue('Código postal fiscal',p.recipientPostalCode,'box')+readValue('Régimen fiscal',fiscalText('regimes',p.recipientTaxRegime),'layers','doc-long-value')+readValue('Uso CFDI',fiscalText('usages',p.cfdiUse),'file','doc-long-value')+'</dl></section><section class="doc-identification">'+heading('Identificación fiscal','file')+'<dl class="doc-fiscal-grid">'+readValue('UUID · folio fiscal',p.uuid,'shield','doc-uuid-value')+readValue('Serie y folio de factura',p.invoiceNumber,'tag')+'</dl></section><dl class="doc-document-totals">'+[['Subtotal',p.subtotalCents],['Descuento',p.discountCents],['IVA',p.taxCents],['Total',p.totalCents]].map(([name,value])=>readValue(name,costLabel(value),'wallet')).join('')+'</dl>':'')+
   '<div class="document-card-actions">'+(url?'<a class="btn" href="'+esc(url)+'" target="_blank" rel="noopener">'+icon('file')+' Ver original</a>':'')+(!stored?'<button type="button" class="btn doc-remove" data-doc-remove="'+esc(doc.id)+'">'+icon('close')+' Quitar este archivo</button>':'')+'</div>'+
   '<div data-doc-reference-notice="'+esc(doc.id)+'">'+referenceNotice(p)+'</div>'+
   (editable&&!stored&&!p.supplierOrder?'<label class="doc-no-reference"><input type="checkbox" data-doc-no-reference="'+esc(doc.id)+'" '+(p.supplierOrderAbsentConfirmed?'checked':'')+'> Revisé el original: este documento no tiene orden ni ticket. No sustituye una compra que sí tenga referencia registrada.</label>':'')+
   (!stored?'<details class="document-reading"><summary>'+icon('search')+' Revisar texto y clasificación de la lectura</summary><label>Tipo de documento<select data-doc-kind="'+esc(doc.id)+'">'+['order','invoice','unknown'].map(k=>'<option value="'+k+'" '+(p.kind===k?'selected':'')+'>'+kindName(k)+'</option>').join('')+'</select></label><label>Texto extraído<textarea data-doc-text="'+esc(doc.id)+'" rows="6">'+esc(doc.text||'')+'</textarea></label><div class="document-card-actions"><button type="button" class="btn" data-doc-reparse="'+esc(doc.id)+'">Volver a interpretar</button><button type="button" class="btn" data-doc-ocr="'+esc(doc.id)+'">Leer con OCR</button></div></details>':'')+'</article>';
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
  const p=selectedProduct(line),np=line.newProduct||{},selected=np.name?'__new__':line.sku||'',label=({exact_upc:'UPC reconocido',exact_sku:'SKU reconocido',supplier_item:'Equivalencia del proveedor',name:'Nombre coincidente',suggestion:'Sin equivalencia confirmada · alta o selección manual',unmatched:'Producto nuevo · sin coincidencia en el catálogo',existing:'Producto de esta compra'})[line.match?.confidence]||'Asignación revisada';
  const field=(key,title,value,svg,tip,type='text',extra='')=>'<div class="field"><label for="doc-line-'+i+'-'+key+'"><span>'+icon(svg)+esc(title)+'</span>'+help(tip,'doc-line-'+i+'-'+key+'-help')+'</label><input id="doc-line-'+i+'-'+key+'" data-doc-field="'+key+'" type="'+type+'" value="'+esc(value??'')+'" '+extra+'></div>';
  const group=p?'matched':'pending',hidden=(d.lineTab||'pending')!==group;
  return '<article class="doc-line" data-doc-line="'+i+'" '+(hidden?'hidden':'')+'><fieldset '+(hidden?'disabled':'')+'><header class="doc-line-heading"><span class="doc-product-photo">'+productThumb(p)+'</span><div><span class="eyebrow">'+(p?'IDENTIFICADO EN AIMERKA':'POR IDENTIFICAR')+'</span><strong>'+esc(p?.name||line.name||'Artículo por identificar')+'</strong><small>'+esc(label)+'</small></div>'+(!line.receivedQty?'<button type="button" class="btn small doc-remove" data-doc-line-remove="'+i+'">'+icon('close')+' Quitar partida</button>':badge(line.receivedQty+' recibidas','green'))+'</header>'+
   (p?'<dl class="doc-line-identity">'+readValue('SKU interno',p.sku,'tag')+readValue('UPC / EAN',p.upc||'Sin registrar','box')+readValue('Artículo del proveedor',line.supplierItem||'Por identificar','link')+'</dl>':'<p class="doc-unmatched-note">'+icon('alert')+'Selecciona un producto del catálogo o abre su ficha completa para darlo de alta con fotografías.</p>')+
   '<div class="form-grid">'+field('name','Descripción del artículo',line.name,'file','Descripción impresa en el documento; se conserva junto al producto del ERP.','text','required maxlength="250"')+field('item','Artículo / equivalencia del proveedor',line.supplierItem,'link','Código con el que este proveedor identifica el producto. La equivalencia se conserva al guardar.')+field('qty','Unidades ordenadas',line.qty,'bag','Cantidad comprada. No registra entradas de inventario.','number','min="'+Math.max(1,line.receivedQty||0)+'" step="1" required')+field('cost','Costo unitario con IVA (MXN)',number(line.unitCostCents),'wallet','Costo final por unidad después de descuentos e impuestos. Se incorpora al promedio al recibir la mercancía.','number','min="0" step="0.01"')+'</div>'+
   '<input type="hidden" data-doc-field="sku" value="'+esc(selected)+'"><div class="doc-product-choice"><div><strong>'+icon('link')+' Relacionar con inventario</strong><p>'+esc(p?'Vinculado: '+p.name+' · '+p.sku:'No hay un producto confirmado para esta partida.')+'</p></div><button type="button" class="btn '+(!p?'primary':'')+'" data-doc-choose-product="'+i+'" '+(line.receivedQty?'disabled':'')+'>'+icon('search')+(p?' Cambiar producto':' Explorar inventario')+'</button>'+help('Abre el catálogo con fotografías, existencias, SKU, UPC, costo promedio y precio general. Elegir un producto no recibe mercancía.','doc-product-'+i+'-help')+'</div>'+
   (!p?'<div class="doc-product-new-actions"><button type="button" class="btn" data-doc-create-product="'+i+'">'+icon('plus')+' Dar de alta · ficha completa y fotos</button></div>':'')+
   (line.newProduct?'<div class="doc-new-product"><h4>Alta pendiente de producto</h4><div class="form-grid">'+field('brand','Marca',np.brand,'tag','Fabricante del producto.','text','required')+field('model','Modelo',np.model,'tag','Modelo específico.')+field('color','Color',np.color,'box','Variante de color.')+field('capacity','Capacidad',np.capacity,'box','Capacidad o presentación.')+field('upc','UPC / EAN',np.upc,'tag','Código de barras original del artículo.')+field('category','Categoría',np.category,'layers','Categoría comercial.')+field('image','URL de imagen',np.imageUrl,'file','La ficha completa permite subir archivos de imagen.')+'</div><code data-doc-sku-preview>'+esc(skus[i])+'</code></div>':'')+
   '<fieldset class="doc-line-links"><legend>'+icon('file')+' Documentos de esta partida</legend>'+allDocs(d).map(doc=>'<label><input type="checkbox" data-doc-link="'+esc(doc.id)+'" '+(line.documentIds?.includes(doc.id)?'checked':'')+'> '+esc(kindName(doc.parsed?.kind)+' · '+(doc.parsed?.invoiceNumber||doc.name))+'</label>').join('')+'</fieldset></fieldset></article>';
 }
 function openNewProduct(d,index){
   capture(d);const line=d.lines[index];if(!line||!window.ProductTrace28?.form)return;
   d.productFormOpen=true;get('modal')?.classList.remove('documents-modal');
   const resume=()=>{if(d!==draft)return;d.productFormOpen=false;render(d);};
   window.ProductTrace28.form(null,{initialProduct:{...(line.newProduct||{}),name:line.name,upc:line.upc||line.newProduct?.upc||'',costCents:line.unitCostCents||0,satCode:line.satCode||'',unitSat:line.unitSat||'',supplierCodes:line.supplierItem?[{supplier:d.purchase.supplier,item:line.supplierItem,name:line.name}]:[]},onCancel:resume,onSaved:async sku=>{if(d!==draft)return;line.sku=sku;line.newProduct=null;d.reviewed=false;await recompute(d);d.productFormOpen=false;render(d);}});
 }
 function fiscalBuyerField(d){if(!ERP.engines.purchaseCatalogs)return '';const config=state.config?.purchaseFiscal||{profiles:[]},selected=d.purchase.buyerCompanyId||config.defaultProfileId||'',locked=Boolean(state.purchases.find(p=>p.id===d.purchaseId)?.buyerCompanyId);return '<section class="doc-buyer-card"><div>'+icon('shield')+'<span><strong>Empresa que compra</strong><small>Los datos fiscales se comparan con cada factura, además de la orden y sus artículos.</small></span></div><label>Empresa fiscal<select id="docs-buyer" '+(locked?'disabled':'')+'><option value="">Selecciona la empresa compradora</option>'+config.profiles.filter(p=>p.active!==false).map(p=>'<option value="'+esc(p.id)+'" '+(p.id===selected?'selected':'')+'>'+esc(p.label+' · '+p.rfc)+'</option>').join('')+'</select></label><button class="btn small" type="button" data-buy-fiscal-setup>Configurar datos fiscales</button></section>'; }
 const WIZARD_STEPS=[['Adjuntar','upload','Sube tus documentos'],['Revisar lectura','file','Comprueba datos fiscales'],['Datos de compra','bag','Confirma el proveedor'],['Artículos y equivalencias','link','Relaciona cada producto']];
 function canonicalSupplier(value){const normalize=parserModule?.normalizeSupplier||(v=>String(v).toUpperCase()),catalog=(state.catalogs?.suppliers||[]).map(v=>typeof v==='string'?v:v.name||v.value||'');return catalog.find(v=>normalize(v)===normalize(value))||value||'';}
 function stepFrame(step,current,content){return '<section class="docs-stage" data-doc-stage="'+step+'" '+(step!==current?'hidden':'')+'><fieldset '+(step!==current?'disabled':'')+'>'+content+'</fieldset></section>';}
 function render(d){
  if(d!==draft||d.workspace!==ERP.workspace)return;
  d.step??=1;d.maxStep??=1;d.lineTab??='pending';d.stageScroll??={};const oldBody=get('docs-stage-body');if(oldBody&&d.renderedStep)d.stageScroll[d.renderedStep]=oldBody.scrollTop;
  if(!d.purchaseId)d.purchase.supplier=canonicalSupplier(d.purchase.supplier);
  refreshValidation(d,false);const docs=allDocs(d),p=d.purchase,hasFiles=!!docs.length,skus=proposedSkus(d),report=d.validation,blocked=blockers(d).length,known=d.lines.filter(l=>selectedProduct(l)||d.mode==='invoice'&&l.sku).length,pending=d.lines.length-known;
  if(d.lineTab==='pending'&&!pending&&known)d.lineTab='matched';
  if(!docs.some(doc=>doc.id===d.activeDoc))d.activeDoc=docs[0]?.id;
  const warnings=[...new Set([...(d.combined?.warnings||[]).filter(w=>!d.combined?.blockingWarnings?.includes(w)),...(d.uploadWarnings||[])])];
  const title=(d.mode==='invoice'?'Subir facturación':'Importar orden o listado')+(d.purchaseId?' · '+(state.purchases.find(x=>x.id===d.purchaseId)?.number||d.purchaseId):'');
  const attach=heading('Adjuntar documentos','upload','Puedes iniciar una compra con una orden, un listado de productos o una factura; el ticket también es una referencia válida.')+'<div class="document-dropzone" id="document-dropzone"><span class="document-drop-icon">'+icon('upload')+'</span><strong>Sube el documento de tu compra</strong><p>PDF, PNG o JPG · hasta 15 MB por archivo · máximo 12 documentos.</p><label class="btn primary" for="document-files">'+icon('plus')+' Seleccionar documentos</label><input id="document-files" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" multiple '+(d.busy?'disabled':'')+'><small>También puedes arrastrarlos aquí. La lectura se realiza en este navegador.</small></div><div class="doc-uploaded-files">'+docs.map(doc=>'<article><span>'+icon('file')+'</span><div><strong>'+esc(doc.name)+'</strong><small>'+esc(kindName(doc.parsed?.kind))+(doc.parsed?.invoiceNumber?' · '+esc(doc.parsed.invoiceNumber):'')+' · '+(doc.parsed?.lines?.length||0)+' partidas leídas</small></div>'+(!existingDocs(d).some(x=>x.id===doc.id)?'<button class="btn small" type="button" data-doc-remove="'+esc(doc.id)+'">'+icon('close')+' Quitar</button>':badge('Guardado','blue'))+'</article>').join('')+'</div>';
  const reading=heading('Revisar lectura del documento','file','Comprueba la referencia, los importes y el receptor. Los datos por corregir se señalan por separado.')+fiscalBuyerField(d)+'<div id="docs-validation" aria-live="polite">'+wizardValidation(d)+'</div>'+(docs.length>1?'<div class="doc-document-tabs" role="tablist" aria-label="Documentos adjuntos">'+docs.map((doc,i)=>'<button type="button" role="tab" aria-selected="'+(d.activeDoc===doc.id)+'" data-doc-active="'+esc(doc.id)+'">'+icon('file')+esc(doc.parsed?.invoiceNumber||doc.name)+'</button>').join('')+'</div>':'')+docs.map(doc=>'<div '+(doc.id!==d.activeDoc?'hidden':'')+'>'+documentCard(doc,existingDocs(d).some(x=>x.id===doc.id),report,true)+'</div>').join('')+(warnings.length?'<details class="doc-reading-notes"><summary>'+icon('info')+' Avisos de lectura ('+warnings.length+')</summary><ul>'+warnings.map(w=>'<li>'+esc(typeof w==='string'?w:w.message||String(w))+'</li>').join('')+'</ul></details>':'');
  const suppliers=[...new Set([...(state.catalogs?.suppliers||[]).map(v=>typeof v==='string'?v:v.name||v.value||''),p.supplier].filter(Boolean))],locked=d.mode==='invoice'&&d.purchaseId;
  const purchase=heading('Datos de la compra','bag','Confirma los datos que se guardarán en la orden. Recibir mercancía es un proceso independiente.')+'<div class="doc-generated-folio">'+icon('tag')+'<span>Folio AIMERKA<strong>'+esc(d.purchaseId?(state.purchases.find(x=>x.id===d.purchaseId)?.number||d.purchaseId):'Se generará automáticamente al guardar la orden de compra')+'</strong></span></div><div class="form-grid doc-purchase-fields"><div class="field"><label for="docs-supplier"><span>'+icon('box')+' Proveedor</span>'+help('Se propone el proveedor de tu catálogo que coincide con el documento. Selecciona otro solo si corresponde a esta compra.','docs-supplier-help')+'</label><select id="docs-supplier" required '+(locked?'disabled':'')+'><option value="">Selecciona proveedor</option>'+suppliers.map(s=>'<option value="'+esc(s)+'" '+(s===p.supplier?'selected':'')+'>'+esc(s)+'</option>').join('')+'</select><small>'+esc(canonicalSupplier(p.supplier)===p.supplier?'Proveedor reconocido / seleccionado':'Revisa la correspondencia con tu catálogo')+'</small></div>'+formField('docs-order','Referencia del proveedor · orden o ticket',p.supplierOrder,'tag','Número original del proveedor. Se compara con los documentos; los tickets largos conservan todos sus dígitos.',{extra:locked?'readonly':''})+formField('docs-date','Fecha de compra',p.date||ERP.today(),'calendar','Fecha documental de la compra. La emisión de la factura puede ser posterior.',{type:'date',extra:'required max="'+ERP.today()+'"'})+'<div class="field"><label for="docs-shipping"><span>'+icon('truck')+' Estado del traslado</span>'+help('Pendiente o en tránsito describe el envío del proveedor. No confirma recepción física.','docs-shipping-help')+'</label><select id="docs-shipping">'+['Pendiente','En tránsito'].map(v=>'<option '+(v===(p.shippingStatus||'En tránsito')?'selected':'')+'>'+v+'</option>').join('')+'</select></div>'+formField('docs-total',d.mode==='invoice'?'Total facturado acumulado (MXN)':'Importe total de la compra (MXN)',number(d.mode==='invoice'?report?.invoiceTotalCents:p.amountCents),'wallet','Total final con impuestos y descuentos. Puede quedar pendiente si la orden no contiene importes.',{type:'number',extra:d.mode==='invoice'?'readonly':'min="0.01" step="0.01" placeholder="Por confirmar"'})+'<div class="doc-total-context"><span>'+icon('file')+' Total de facturas coincidentes</span><strong>'+costLabel(report?.invoiceTotalCents)+'</strong></div><div class="field wide"><label for="docs-notes"><span>'+icon('file')+' Observaciones</span>'+help('Notas opcionales de la compra. No cambian cantidades, pagos ni importes.','docs-notes-help')+'</label><textarea id="docs-notes" rows="3">'+esc(p.notes||'')+'</textarea></div></div>';
  const articles=heading('Artículos y equivalencias','link','Identifica cada producto antes de guardar. Esta revisión no agrega existencias.')+'<div class="doc-item-tabs" role="tablist" aria-label="Estado de identificación de artículos"><button type="button" role="tab" data-doc-line-tab="matched" aria-selected="'+(d.lineTab==='matched')+'">'+icon('check')+' Identificados en AIMERKA <b>'+known+'</b></button><button type="button" role="tab" data-doc-line-tab="pending" aria-selected="'+(d.lineTab==='pending')+'">'+icon('search')+' Por identificar <b>'+pending+'</b></button></div>'+(d.mode!=='invoice'?'<div class="doc-item-tools"><span>'+d.lines.length+' partidas · '+d.lines.reduce((n,l)=>n+Number(l.qty||0),0)+' unidades ordenadas</span><button type="button" class="btn small" data-doc-add-line>'+icon('plus')+' Añadir partida</button></div>':'<p>Las cantidades y los artículos de la compra registrada se conservan.</p>')+(d.mode==='invoice'?(report?.lines||[]).map((line,i)=>invoiceLineSummary(line,d,i)).join(''):d.lines.map((line,i)=>lineCard(line,i,d,skus)).join(''))+(!d.lines.length?'<div class="doc-empty">'+icon('box')+'No se identificaron partidas. Revisa el texto del documento o añade la mercancía manualmente.</div>':'')+(d.lineTab==='pending'&&!pending?'<div class="doc-empty">'+icon('check')+'Todos los artículos ya están identificados.</div>':'')+(d.lineTab==='matched'&&!known?'<div class="doc-empty">'+icon('search')+'Aún no hay productos confirmados. Trabaja en la pestaña Por identificar.</div>':'')+'<details class="doc-cost-review"><summary>'+icon('wallet')+' Cantidades e importes por producto</summary>'+(report?.lines||[]).map((line,i)=>invoiceLineSummary(line,d,i)).join('')+'</details><div id="docs-blockers" '+(blocked?'':'hidden')+'>'+correctionPanel(d)+'</div><div class="doc-confirm"><label><input id="docs-reviewed" type="checkbox" '+(d.reviewed?'checked':'')+' required> Confirmé productos, cantidades, importes y datos fiscales del receptor. Guardar documentos no recibe mercancía; el promedio se actualiza al confirmar su recepción.</label></div>';
  showModal('<form id="document-import-form" novalidate><header class="docs-modal-head"><span class="docs-title-icon">'+icon('bag')+'</span><div><span class="eyebrow">COMPRAS / ASISTENTE DE IMPORTACIÓN</span><h2 id="modal-title">'+esc(title)+'</h2><p>Un documento, una revisión ordenada y una compra sin duplicar mercancía.</p></div><span class="docs-workspace">Paso '+d.step+' de 4</span></header><nav class="doc-steps" aria-label="Pasos de importación">'+WIZARD_STEPS.map(([label,svg,sub],i)=>'<button type="button" data-doc-step="'+(i+1)+'" '+(i+1>d.maxStep?'disabled':'')+' aria-current="'+(d.step===i+1?'step':'false')+'" class="'+(d.step===i+1?'active':i+1<d.step?'done':'')+'"><b>'+icon(i+1<d.step?'check':svg)+'</b><span><strong>'+label+'</strong><small>'+sub+'</small></span></button>').join('')+'</nav><div id="docs-stage-body" class="docs-stage-body">'+stepFrame(1,d.step,attach)+stepFrame(2,d.step,reading)+stepFrame(3,d.step,purchase)+stepFrame(4,d.step,articles)+'</div><footer class="modal-actions docs-sticky-actions"><div id="docs-progress" class="docs-progress" role="status" aria-live="polite">'+esc(d.progress||'Adjunta tus documentos para comenzar.')+'</div><button type="button" class="btn" data-action="close-modal">Cerrar</button><button type="button" class="btn" data-doc-previous '+(d.step===1||d.busy?'disabled':'')+'>Anterior</button><button type="button" class="btn primary" data-doc-next '+(d.step===4?'hidden':'')+' '+(!hasFiles||d.busy?'disabled':'')+'>Siguiente</button><button type="submit" id="docs-save" class="btn primary" '+(d.step!==4?'hidden':'')+' '+(!hasFiles||d.busy||!hasChanges(d)||!d.lines.length||blocked||!report||pending?'disabled':'')+'>'+icon('check')+(d.mode==='invoice'?' Guardar facturación':d.purchaseId?' Guardar documentos':' Registrar orden documental')+'</button></footer></form>');
  get('modal')?.classList.remove('doc-fiscal-profile-modal');get('modal')?.classList.add('documents-modal');const body=get('docs-stage-body');if(body)body.scrollTop=d.resetScroll?0:d.stageScroll[d.step]||0;d.resetScroll=false;d.renderedStep=d.step;
 }
 function goStep(d,step){if(d.busy)return;capture(d);if(step<1||step>4||(!allDocs(d).length&&step>1))return;if(step>d.step&&d.step===3){const section=get('document-import-form')?.querySelector?.('[data-doc-stage="3"]');const invalid=section?.querySelector?.('input:invalid,select:invalid');if(invalid){invalid.reportValidity?.();invalid.focus?.();return;}if(!d.purchase.supplier){toast('Selecciona el proveedor de la compra.',true);return;}}d.step=step;d.maxStep=Math.max(d.maxStep||1,step);d.resetScroll=true;render(d);}
 function pickerRows(d){const normalize=ERP.engines.productSearch?.productSearchScore,query=d.pickerQuery||'',rows=state.products.filter(p=>!p.lifecycle?.hidden&&!p.lifecycle?.discontinued||p.sku===d.lines[d.pickerLine]?.sku).map(p=>({p,score:normalize?normalize(state,p,query):(!query||[p.name,p.sku,p.upc,p.brand].join(' ').toLowerCase().includes(query.toLowerCase())?1:0)})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score);const pages=Math.max(1,Math.ceil(rows.length/24));d.pickerPage=Math.min(pages,Math.max(1,d.pickerPage||1));return '<div class="doc-picker-count">'+rows.length+' productos · incluye artículos sin existencias</div><div class="doc-picker-grid">'+rows.slice((d.pickerPage-1)*24,d.pickerPage*24).map(({p})=>'<button type="button" class="doc-picker-product" data-doc-pick-sku="'+esc(p.sku)+'"><span class="doc-product-photo">'+productThumb(p)+'</span><strong>'+esc(p.name)+'</strong><dl>'+readValue('SKU',p.sku,'tag')+readValue('UPC',p.upc||'Sin registrar','box')+readValue('Físico vendible',Number(p.good||0),'box')+readValue('Disponible',ERP.engines.inventory?.available?.(p)??Math.max(0,(p.good||0)-(p.reserved||0)-(p.safety||0)),'check')+readValue('Costo promedio',costLabel(p.costCents),'wallet')+readValue('Precio general',costLabel(p.priceCents),'tag')+'</dl></button>').join('')+'</div><div class="doc-picker-pagination"><button type="button" class="btn" data-doc-picker-page="'+(d.pickerPage-1)+'" '+(d.pickerPage<=1?'disabled':'')+'>Anterior</button><span>Página '+d.pickerPage+' de '+pages+'</span><button type="button" class="btn" data-doc-picker-page="'+(d.pickerPage+1)+'" '+(d.pickerPage>=pages?'disabled':'')+'>Siguiente</button></div>';}
 function openProductPicker(d,index){capture(d);if(d.lines[index]?.receivedQty)return;d.pickerLine=index;d.pickerQuery='';d.pickerPage=1;const dialog=document.createElement('dialog');dialog.id='docs-inventory-picker';dialog.className='docs-inventory-picker';dialog.setAttribute('aria-labelledby','docs-picker-title');dialog.innerHTML='<header>'+heading('Relacionar producto del inventario','search','Busca por nombre, marca, SKU, UPC o categoría. Seleccionar no modifica existencias.')+'<button type="button" class="btn" data-doc-picker-close>'+icon('close')+' Cerrar</button></header><label class="doc-picker-search" for="docs-picker-query">'+icon('search')+' Buscar producto<input id="docs-picker-query" type="search" placeholder="Nombre, SKU, UPC, marca o categoría" autocomplete="off"></label><div id="docs-picker-results">'+pickerRows(d)+'</div>';const title=dialog.querySelector('h3');if(title)title.id='docs-picker-title';dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();get('docs-picker-query')?.focus();}
 function selectProduct(d,sku){const line=d.lines[d.pickerLine],p=state.products.find(p=>p.sku===sku);if(!line||!p||line.receivedQty)return;line.sku=p.sku;line.newProduct=null;line.manual=true;line.match={sku:p.sku,confidence:'existing'};d.reviewed=false;get('docs-inventory-picker')?.close();refreshValidation(d,false);render(d);}
 async function addFiles(files){
   const d=draft;if(!d||d.busy)return;capture(d);
   const selected=[...files];if(!selected.length)return;
   if(d.mode==='invoice'&&!d.lines.length){toast('Importa la orden o captura sus artículos antes de subir facturación.',true);return;}
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
       const read=await DocumentReader29.extract(file,message=>progress(d,file.name+' · '+(typeof message==='string'?message:message.message)),{layout:true});
       checkSession(d);const parsed=engine.preparePurchaseImportDocument(engine.parsePurchaseDocument(read.text,{fileName:file.name,recognitionConfig:state.config?.purchaseRecognition}),{mode:d.mode});
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
   if(!d.purchase.supplier||!d.purchase.date||d.purchase.date>ERP.today()){d.step=3;render(d);toast('Revisa el proveedor y la fecha de compra.',true);return;}
   if(d.lines.some(l=>!String(l.name||'').trim()||!Number.isSafeInteger(l.qty)||l.qty<Math.max(1,l.receivedQty||0))){d.step=4;render(d);toast('Revisa nombres y cantidades de los artículos.',true);return;}
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
       name:l.name,supplierItem:l.supplierItem,qty:l.qty,sourceReceivedQty:l.sourceReceivedQty,sourcePendingQty:l.sourcePendingQty,unitCostCents:l.unitCostCents,documentIds:l.documentIds}));
     const purchase=Object.fromEntries(['buyerCompanyId','supplier','supplierOrder','date','shippingStatus','notes','amountCents','lender','instrument','term','firstPaymentDate','sicar','taxInvoice','satReviewed'].filter(key=>d.purchase[key]!==undefined&&!(key==='taxInvoice'&&!d.purchase[key])).map(key=>[key,d.purchase[key]]));
     const result=await ERP.command('purchase.importDocuments',{mode:d.mode,purchaseId:d.purchaseId||undefined,purchase,lines,documents});
     if(!result.ok)throw new Error(result.error||'No se guardó la importación. Revisa y vuelve a intentar.');
     const id=result.result.purchaseId||result.result.id;get('modal').close();close();if(id)window.op28Detail?.('purchase',id);
   }catch(error){if(d===draft){d.progress=error.message;toast(error.message,true);}}
   finally{d.busy=false;if(d===draft)render(d);}
 }
 function section(p){
   const docs=(state.documents||[]).filter(doc=>doc.purchaseId===p.id),d={purchaseId:p.id,purchase:p,storedDocuments:docs,documents:[],lines:p.items||[]};d.validation=validationFor(d);
   if(docs.length&&!validationEngine){const workspace=ERP.workspace;validator().then(()=>{const node=get('purchase-documents-'+p.id),current=state.purchases.find(row=>row.id===p.id);if(node&&current&&ERP.workspace===workspace)node.outerHTML=section(current);}).catch(()=>{});}
   return '<section class="purchase-documents-section" id="purchase-documents-'+esc(p.id)+'"><div class="form-section-head"><div><h3>Orden y facturas</h3><span class="small-note">'+docs.length+' documentos conservados con esta compra</span></div><div class="head-actions"><button class="btn small" data-doc-open="'+esc(p.id)+'" data-mode="order">Importar orden</button><button class="btn small primary" data-doc-open="'+esc(p.id)+'" data-mode="invoice">Subir facturación</button></div></div>'+
     (docs.length?validationPanel(d)+'<div class="document-grid">'+docs.map(doc=>documentCard(doc,true,d.validation)).join('')+'</div>':'<div class="doc-empty">'+icon('file')+'<p>Conserva aquí la orden del proveedor y sus facturas. Podrás consultarlas también desde cada producto.</p></div>')+'</section>';
 }
 document.addEventListener('change',e=>{
   if(e.target.hasAttribute('data-doc-no-reference')&&draft){capture(draft);draft.reviewed=false;refreshValidation(draft,false);render(draft);return;}
   if(e.target.id==='docs-supplier'&&draft){capture(draft);draft.reviewed=false;refreshValidation(draft);return;}
   if(e.target.id==='docs-buyer'&&draft){capture(draft);draft.reviewed=false;refreshValidation(draft,false);render(draft);return;}
   if(e.target.id==='docs-date'&&draft)draft.dateEdited=true;
   if(e.target.id==='document-files'){addFiles(e.target.files);return;}
   if(e.target.id==='workspace-picker'){close();return;}
   if(!draft)return;
   if(e.target.matches('[data-doc-field="sku"]')){
     const d=draft;capture(d);const line=d.lines[Number(e.target.closest('[data-doc-line]').dataset.docLine)];
     if(e.target.value==='__new__'&&window.ProductTrace28?.form){openNewProduct(d,d.lines.indexOf(line));return;}
   if(e.target.value==='__new__'&&!line.newProduct?.brand){line.newProduct={...(line.newProduct||{}),name:line.name,brand:'',model:'',color:'',capacity:'',upc:''};}
     d.reviewed=false;refreshValidation(d,false);render(d);
   }
 });
 document.addEventListener('input',e=>{
   if(!draft)return;
   if(e.target.id==='docs-picker-query'){draft.pickerQuery=e.target.value;draft.pickerPage=1;const results=get('docs-picker-results');if(results)results.innerHTML=pickerRows(draft);return;}
   if(e.target.id==='docs-date')draft.dateEdited=true;
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
   if(el.hasAttribute('data-doc-open')){open({purchaseId:el.dataset.docOpen,mode:el.dataset.mode});return;}
   const d=draft;if(!d||d.busy)return;
   if(el.hasAttribute('data-doc-help')){el.setAttribute('aria-expanded',el.getAttribute('aria-expanded')==='true'?'false':'true');return;}
   if(el.hasAttribute('data-doc-next')){goStep(d,d.step+1);return;}
   if(el.hasAttribute('data-doc-previous')){goStep(d,d.step-1);return;}
   if(el.hasAttribute('data-doc-step')){goStep(d,Number(el.dataset.docStep));return;}
   if(el.hasAttribute('data-doc-line-tab')){capture(d);d.lineTab=el.dataset.docLineTab;d.resetScroll=true;render(d);return;}
   if(el.hasAttribute('data-doc-active')){capture(d);d.activeDoc=el.dataset.docActive;d.resetScroll=true;render(d);return;}
   if(el.hasAttribute('data-doc-choose-product')){openProductPicker(d,Number(el.dataset.docChooseProduct));return;}
   if(el.hasAttribute('data-doc-picker-close')){get('docs-inventory-picker')?.close();return;}
   if(el.hasAttribute('data-doc-pick-sku')){selectProduct(d,el.dataset.docPickSku);return;}
   if(el.hasAttribute('data-doc-picker-page')){d.pickerPage=Number(el.dataset.docPickerPage);get('docs-picker-results').innerHTML=pickerRows(d);return;}
   if(el.hasAttribute('data-doc-create-product')){openNewProduct(d,Number(el.dataset.docCreateProduct));return;}
   if(el.hasAttribute('data-doc-mode')){capture(d);if(el.dataset.docMode==='invoice'&&!d.lines.length){toast('Importa la orden o captura sus artículos antes de subir facturación.',true);return;}d.mode=el.dataset.docMode;d.reviewed=false;render(d);return;}
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
     doc.parsed=engine.preparePurchaseImportDocument(engine.parsePurchaseDocument(doc.text,{fileName:doc.name,kind,recognitionConfig:state.config?.purchaseRecognition}),{mode:d.mode});doc.extraction='manual';d.reviewed=false;await recompute(d);
   }else if(el.hasAttribute('data-doc-ocr')){
     capture(d);const doc=d.documents.find(x=>x.id===el.dataset.docOcr);if(!doc)return;
     d.busy=true;d.reviewed=false;render(d);
     try{const read=await DocumentReader29.extract(doc.file,msg=>progress(d,doc.name+' · '+(typeof msg==='string'?msg:msg.message)),{forceOCR:true,layout:true});checkSession(d);doc.text=read.text;doc.extraction='ocr';const engine=await parser();doc.parsed=engine.preparePurchaseImportDocument(engine.parsePurchaseDocument(doc.text,{fileName:doc.name,recognitionConfig:state.config?.purchaseRecognition}),{mode:d.mode});d.progress='OCR terminado. Verifica los datos reconocidos.';await recompute(d);}
     catch(error){if(d===draft){d.progress=error.message;toast(error.message,true);}}finally{d.busy=false;if(d===draft)render(d);}
   }
 });
 document.addEventListener('submit',e=>{if(e.target.id==='document-import-form'){e.preventDefault();if(draft){if(draft.step<4)goStep(draft,draft.step+1);else save(draft);}}});
 document.addEventListener('dragover',e=>{if(e.target.closest('#document-dropzone')){e.preventDefault();e.target.closest('#document-dropzone').classList.add('dragging');}});
 document.addEventListener('dragleave',e=>e.target.closest('#document-dropzone')?.classList.remove('dragging'));
 document.addEventListener('drop',e=>{if(e.target.closest('#document-dropzone')){e.preventDefault();addFiles(e.dataTransfer.files);}});
 get('modal')?.addEventListener('close',()=>{if(draft&&!draft.productFormOpen&&!get('modal')?.open)close();});
 window.PurchaseDocs28={open,section,docUrl,close,productCosts:sku=>validationEngine?.productInvoiceCosts(state,sku)};
 window.PurchaseDocs28.resume=()=>{if(draft)render(draft);};window.PurchaseDocs28.captureCurrent=()=>{if(draft)capture(draft);};
 validator().catch(()=>{});
})();
