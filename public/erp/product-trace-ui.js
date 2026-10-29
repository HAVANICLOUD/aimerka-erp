'use strict';

/* Product identity and traceability extend the existing V28 catalogue. */
(function () {
  const trace = {sku:'', tab:'movements', limit:60};
  const tabLabels = {movements:'Movimientos',purchases:'Compras',receipts:'Recepciones',sales:'Ventas y devoluciones',documents:'Facturas y archivos'};
  const poolLabels = {good:'Vendible',reserved:'Reservado',quarantine:'Inspección',damaged:'No vendible',safety:'Seguridad'};
  const movementLabels = {
    'inventory.receivePurchase':'Entrada de compra','inventory.adjust':'Ajuste de inventario',
    'sale.create':'Reserva de venta','sale.ship':'Salida de venta','sale.cancel':'Cancelación',
    'sale.return_receive':'Devolución recibida','sale.return_restock':'Reintegro aprobado',
    'sale.return_reject':'Devolución no vendible'
  };
  const getProduct = sku => (state.products||[]).find(p=>p.sku===sku)||(state.products||[]).find(p=>(p.skuAliases||[]).some(alias=>normal(alias)===normal(sku)));
  const normal = value => String(value??'').trim().toUpperCase();
  const val = (form,name) => form.elements.namedItem(name)?.value?.trim()||'';
  const date = value => typeof c28Date==='function'?c28Date(value):String(value||'').slice(0,10)||'—';
  const currency = value => value==null?'Por confirmar':money(value);
  const productCost = p => p.costStatus==='Por confirmar'?'Por confirmar':money(p.costCents);
  const empty = message => `<div class="pt29-empty">${icon('box')}<p>${esc(message)}</p></div>`;
  const amount = (form,name) => Math.round(Number(val(form,name))*100);
  const itemCount = rows => rows.reduce((sum,row)=>sum+Number(row.qty||0),0);
  const sortDate = (a,b) => String(b.date||b.createdAt||'').localeCompare(String(a.date||a.createdAt||''));

  function safeImage(value) {
    const source=String(value||'').trim();
    if (!source||source.length>2000||/[\\\u0000-\u001f]/.test(source)) return '';
    if (source.startsWith('/')&&!source.startsWith('//')) return source;
    try { const url=new URL(source);return url.protocol==='https:'&&!url.username&&!url.password?url.href:''; } catch { return ''; }
  }

  function thumb(p,options={}) {
    const source=safeImage(p?.imageUrl),large=options.large===true;
    return `<span class="pt29-thumb${large?' pt29-thumb-large':''}${source?' pt29-has-image':''}" aria-label="${esc(p?.name||'Producto')}">${source?`<img src="${esc(source)}" alt="${esc(p?.name||'Producto')}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:''}<span class="pt29-thumb-fallback" aria-hidden="true">${icon('box')}</span></span>`;
  }

  function sameCode(code,p) {
    const clean=normal(code);
    if(!clean)return false;
    if([p.sku,p.sellerSku,p.upc,...(p.skuAliases||[])].some(value=>value&&normal(value)===clean))return true;
    return /^\d{8,14}$/.test(clean)&&/^\d{8,14}$/.test(p.upc||'')&&clean.padStart(14,'0')===String(p.upc).padStart(14,'0');
  }

  function matchesLine(line,p,purchase) {
    if([line.sku,line.skuOrUpc,line.upc].some(code=>sameCode(code,p)))return true;
    return !!(purchase&&line.supplierItem&&(p.supplierCodes||[]).some(code=>normal(code.supplier)===normal(purchase.supplier)&&normal(code.item)===normal(line.supplierItem)));
  }

  function purchasesFor(p) {
    return (state.purchases||[]).map(purchase=>({purchase,lines:(purchase.items||[]).filter(line=>matchesLine(line,p,purchase))}))
      .filter(record=>record.lines.length).sort((a,b)=>sortDate(a.purchase,b.purchase));
  }

  function ordersFor(p) {
    return (state.orders||[]).map(order=>({order,lines:ERP.engines.inventory.orderItems(order).filter(line=>matchesLine(line,p))}))
      .filter(record=>record.lines.length).sort((a,b)=>sortDate(a.order,b.order));
  }

  function documents(sku) {
    const p=getProduct(sku);if(!p)return [];
    const purchases=purchasesFor(p),lineIds=new Set(purchases.flatMap(r=>r.lines.map(l=>l.id)).filter(Boolean)),lineDocs=new Set(purchases.flatMap(r=>r.lines.flatMap(l=>l.documentIds||[]))),purchaseIds=new Set(purchases.map(r=>r.purchase.id)),headerDocs=new Set(purchases.flatMap(r=>r.purchase.documentIds||[]));
    return (state.documents||[]).filter(doc=>{
      const links=doc.lineLinks||[];
      return lineDocs.has(doc.id)||links.some(link=>sameCode(link.sku,p)||lineIds.has(link.lineId))||(!links.length&&(purchaseIds.has(doc.purchaseId)||headerDocs.has(doc.id)));
    }).slice().sort(sortDate);
  }

  function documentUrl(id) {
    return '/api/documents/'+encodeURIComponent(id)+'?workspace='+encodeURIComponent(ERP.workspace);
  }

  function documentLinks(ids) {
    return [...new Set(ids||[])].map(id=>(state.documents||[]).find(doc=>doc.id===id)).filter(Boolean).map(doc=>`<a class="pt29-file-chip" href="${esc(documentUrl(doc.id))}" target="_blank" rel="noopener">${icon('download')}${esc(doc.name||'Documento')}</a>`).join('');
  }

  function dataFor(p) {
    return {
      movements:(state.movements||[]).filter(row=>sameCode(row.sku,p)).slice().sort(sortDate),
      purchases:purchasesFor(p),
      receipts:(state.purchaseReceipts||[]).map(receipt=>({receipt,lines:(receipt.items||[]).filter(line=>matchesLine(line,p))})).filter(row=>row.lines.length).sort((a,b)=>sortDate(a.receipt,b.receipt)),
      sales:ordersFor(p),documents:documents(p.sku)
    };
  }

  function quantity(value,label) {return `<div><span>${esc(label)}</span><strong>${Number(value||0).toLocaleString('es-MX')}</strong></div>`;}
  function referenceButton(purchase) {return `<button type="button" class="pt29-reference" data-pt29-purchase="${esc(purchase.id)}">${esc(purchase.number||purchase.sicar||purchase.id)}${icon('arrow')}</button>`;}

  function movementPanel(rows) {
    if(!rows.length)return empty('Todavía no hay movimientos de este producto. La primera recepción creará su entrada al inventario.');
    return `<div class="pt29-table-wrap"><table class="pt29-table"><thead><tr><th>Movimiento</th><th>Cantidad</th><th>Existencia</th><th>Referencia</th></tr></thead><tbody>${rows.map(m=>`<tr><td><strong>${esc(movementLabels[m.type]||m.type||'Movimiento')}</strong><small>${esc(date(m.date))} · ${esc(poolLabels[m.pool]||m.pool)}</small></td><td><span class="pt29-delta ${m.delta>0?'pt29-positive':m.delta<0?'pt29-negative':''}">${m.delta>0?'+':''}${Number(m.delta||0)}</span></td><td>${Number(m.before||0)} → ${Number(m.after||0)}</td><td>${m.purchaseId?`<button type="button" class="pt29-reference" data-pt29-purchase="${esc(m.purchaseId)}">${esc((state.purchases||[]).find(p=>p.id===m.purchaseId)?.number||m.purchaseId)}</button>`:esc(m.reference||'—')}<small>${esc(m.actor||'Operador')}</small>${documentLinks(m.documentIds)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function purchasePanel(rows,p) {
    if(!rows.length)return empty('Aún no hay órdenes de compra vinculadas a este producto. Puedes cargar una orden desde Compras.');
    const linkedDocs=new Set(documents(p.sku).map(doc=>doc.id));
    return rows.map(({purchase,lines})=>{
      const ordered=itemCount(lines),received=lines.reduce((n,l)=>n+Number(l.receivedQty||0),0),hasCosts=lines.every(l=>l.totalCents!=null||l.unitCostCents!=null),lineTotal=hasCosts?lines.reduce((n,l)=>n+(l.totalCents??l.unitCostCents*l.qty),0):null;
      const mode=purchase.receiptMode==='physical';
      return `<article class="pt29-record"><div class="pt29-record-head"><div>${referenceButton(purchase)}<small>${esc(purchase.supplier)} · ${esc(date(purchase.date))}</small></div>${badge(purchase.receiptStatus||'Pendiente',purchase.receiptStatus==='Recibida completa'?'green':received?'blue':'amber')}</div><div class="pt29-record-values"><span>De este producto<strong>${ordered} ${ordered===1?'unidad':'unidades'}</strong></span><span>${mode?'Recibido físicamente':'Recepción física registrada'}<strong>${received} / ${ordered}</strong></span><span>Importe de las partidas<strong>${currency(lineTotal)}</strong></span></div>${!mode?'<p class="pt29-help">Registro histórico documental. Su estado original no acredita una entrada física en AIMERKA.</p>':''}${purchase.shippingStatus==='En tránsito'?'<span class="pt29-transit">En tránsito al almacén</span>':''}<div class="pt29-file-links">${documentLinks([...lines.flatMap(l=>l.documentIds||[]),...(purchase.documentIds||[])].filter(id=>linkedDocs.has(id)))}</div></article>`;
    }).join('');
  }

  function receiptPanel(rows) {
    if(!rows.length)return empty('Sin recepciones físicas registradas para este producto. Registrar una orden de compra no suma existencias.');
    return rows.map(({receipt,lines})=>`<article class="pt29-record"><div class="pt29-record-head"><div><strong>${esc(receipt.number||receipt.id)}</strong><small>${esc(date(receipt.date))} · ${esc(receipt.actor||'Operador')}</small></div><span class="pt29-received">+${itemCount(lines)} ${itemCount(lines)===1?'unidad':'unidades'}</span></div><p class="pt29-help">Compra <button type="button" class="pt29-reference" data-pt29-purchase="${esc(receipt.purchaseId)}">${esc((state.purchases||[]).find(p=>p.id===receipt.purchaseId)?.number||receipt.purchaseId)}</button> · ${esc(receipt.receiptStatus||'Recepción registrada')}</p>${receipt.reason?`<p class="pt29-help">${esc(receipt.reason)}</p>`:''}<div class="pt29-file-links">${documentLinks(lines.flatMap(l=>l.documentIds||[]))}</div></article>`).join('');
  }

  function salesPanel(rows) {
    if(!rows.length)return empty('Este producto todavía no tiene ventas registradas en este espacio.');
    return rows.map(({order,lines})=>{
      const returned=lines.reduce((n,l)=>n+Number(l.returnedQty||0),0),restocked=lines.reduce((n,l)=>n+Number(l.restockedQty||0),0),rejected=lines.reduce((n,l)=>n+Number(l.rejectedQty||0),0),soldTotal=lines.every(l=>l.totalCents!=null||l.unitPriceCents!=null)?lines.reduce((n,l)=>n+(l.totalCents??l.unitPriceCents*l.qty),0):null;
      return `<article class="pt29-record"><div class="pt29-record-head"><div><button type="button" class="pt29-reference" data-order="${esc(order.id)}">${esc(order.number||order.id)}${icon('arrow')}</button><small>${esc(order.market)} · ${esc(date(order.documentDate||order.date))}</small></div>${orderBadge(order)}</div><div class="pt29-record-values"><span>Unidades vendidas<strong>${itemCount(lines)}</strong></span><span>Importe del producto<strong>${currency(soldTotal)}</strong></span><span>Pago<strong>${esc(typeof c28Payment==='function'?c28Payment(order):order.paymentStatus||'Sin informar')}</strong></span></div>${returned||restocked||rejected||['requested','inspection'].includes(order.returnStatus)?`<div class="pt29-return-strip"><span>Devolución recibida <strong>${returned}</strong></span><span>Reintegrado <strong>${restocked}</strong></span><span>No vendible <strong>${rejected}</strong></span></div>`:''}${order.refundCents?`<p class="pt29-help">Reembolso del pedido: ${money(order.refundCents)}. El reembolso no genera una entrada física.</p>`:''}</article>`;
    }).join('');
  }

  function documentsPanel(rows,p) {
    if(!rows.length)return empty('Las facturas y órdenes que vincules a este artículo aparecerán aquí. Puedes cargarlas desde Compras → Documentos.');
    const purchaseRecords=purchasesFor(p);
    return `<div class="pt29-document-grid">${rows.map(doc=>{
      const purchase=(state.purchases||[]).find(row=>row.id===doc.purchaseId),lineIds=new Set(purchaseRecords.flatMap(row=>row.lines.map(l=>l.id)).filter(Boolean)),exact=(doc.lineLinks||[]).some(l=>sameCode(l.sku,p)||lineIds.has(l.lineId))||purchaseRecords.some(row=>row.lines.some(l=>(l.documentIds||[]).includes(doc.id)));
      return `<article class="pt29-document"><span class="pt29-document-icon">${icon('download')}</span><div><span class="pt29-document-kind">${doc.kind==='invoice'?'Factura':doc.kind==='order'?'Orden de compra':'Documento'}</span><a href="${esc(documentUrl(doc.id))}" target="_blank" rel="noopener">${esc(doc.name||'Documento')}</a><small>${esc(date(doc.createdAt))}${doc.size?' · '+Math.max(1,Math.round(doc.size/1024))+' KB':''} · ${exact?'Vinculado al artículo':'Documento de la compra'}</small>${purchase?`<small>${esc(purchase.number||purchase.id)} · ${esc(purchase.supplier)}</small>`:''}</div><a class="btn small" href="${esc(documentUrl(doc.id))}" target="_blank" rel="noopener" aria-label="Abrir ${esc(doc.name||'documento')}">Abrir</a></article>`;
    }).join('')}</div>`;
  }

  function panel(p,data) {
    const all=data[trace.tab]||[],rows=all.slice(0,trace.limit),renderPanel={movements:movementPanel,purchases:purchasePanel,receipts:receiptPanel,sales:salesPanel,documents:documentsPanel}[trace.tab];
    return `<div class="pt29-history-header"><h3>${esc(tabLabels[trace.tab])}</h3><span>${all.length} ${all.length===1?'registro':'registros'}</span></div>${renderPanel(rows,p)}${all.length>trace.limit?`<button type="button" class="btn pt29-load-more" data-pt29-more>Mostrar siguientes ${Math.min(60,all.length-trace.limit)} registros</button>`:''}`;
  }

  function showProduct(sku,tab) {
    const p=getProduct(sku);if(!p)return;sku=p.sku;
    if(trace.sku!==sku){trace.sku=sku;trace.tab='movements';trace.limit=60;}
    if(tab&&tab in tabLabels){trace.tab=tab;trace.limit=60;}
    drawerOrder=null;
    const data=dataFor(p),queued=(state.stockSyncQueue||[]).find(row=>row.sku===sku),available=ERP.engines.inventory.available(p);
    showDrawer(`<section class="pt29-product-detail"><div class="drawer-header"><div><div class="eyebrow">FICHA CENTRAL · TRAZABILIDAD</div><h2 id="drawer-title">${esc(p.name)}</h2></div><button type="button" class="icon-button" data-action="close-drawer" aria-label="Cerrar ficha">${icon('close')}</button></div><div class="pt29-product-hero">${thumb(p,{large:true})}<div><div class="pt29-brand-line">${esc(p.brand||'Sin marca')} ${p.status==='INACTIVO'?badge('Inactivo','slate'):badge('Activo','green')}</div><strong class="pt29-variant">${esc([p.model,p.color,p.capacity].filter(Boolean).join(' · ')||p.category||'Ficha de producto')}</strong><dl class="pt29-identifiers"><div><dt>SKU interno</dt><dd>${esc(p.sku)}</dd></div><div><dt>UPC / EAN</dt><dd>${p.upc?esc(p.upc):'<span class="pt29-pending">Pendiente de escanear</span>'}</dd></div></dl>${!p.upc?`<button type="button" class="btn small" data-pt29-upc="${esc(sku)}">${icon('plus')} Asignar UPC con escáner</button>`:''}</div></div><div class="pt29-stock-grid">${quantity(p.good,'Físico vendible')}${quantity(p.reserved,'Reservado')}${quantity(available,'Disponible')}${quantity(p.quarantine,'En inspección')}${quantity(p.damaged,'No vendible')}${quantity(p.safety,'Seguridad')}</div><p class="pt29-stock-formula">Disponible = físico vendible − reservas − seguridad.</p><div class="pt29-sync-note">${icon('refresh')}<div><strong>${queued?'Pendiente de conexión':'Canales sin conexión activa'}</strong><span>${queued?`${Number(queued.availableQty||0)} unidades disponibles en la cola local.`:'El inventario disponible se calcula en AIMERKA.'} La publicación a los marketplaces se habilitará al conectar el integrador.</span></div></div><div class="detail-actions pt29-detail-actions"><button type="button" class="btn primary" data-c28-product-edit="${esc(sku)}">Actualizar ficha</button><button type="button" class="btn" data-c28-adjust="${esc(sku)}">Ajustar inventario</button><button type="button" class="btn" data-c28-recommend="${esc(sku)}">Recomendar precio</button></div>${p.review?`<div class="info-box spacer-top">${esc(p.review)}</div>`:''}<details class="pt29-commercial"><summary>Datos comerciales y categorías</summary><div class="detail-grid">${detailItem('CATEGORÍA INTERNA',p.category||'Por configurar')}${detailItem('DEPARTAMENTO',p.department||'Por configurar')}${detailItem('COSTO PROMEDIO',productCost(p))}${detailItem('PRECIO DE MERCADO',money(p.priceCents))}${detailItem('CLAVE SAT',p.satCode||'Sin informar')}${detailItem('ENVÍO',p.shippingType||'Por configurar')}${detailItem('MÍNIMO DE ALERTA',p.minStock??3)}${detailItem('EXISTENCIA DE ORIGEN',p.sourceStock==null?'Sin informar':p.sourceStock)}</div><h4>Categorías por marketplace</h4>${ERP.engines.pricing.CHANNELS.map(channel=>{const category=ERP.engines.pricing.resolveCategory(state.config,p,channel);return `<div class="calc-line"><span>${esc(channel)}</span><strong>${esc(typeof category==='object'?(category?.category||category?.value||'Por configurar'):category||'Por configurar')}</strong></div>`;}).join('')}${(p.supplierCodes||[]).length?`<h4>Equivalencias de proveedor</h4>${p.supplierCodes.map(code=>`<div class="calc-line"><span>${esc(code.supplier)}<small class="subtext">${esc(code.name||'')}</small></span><strong>${esc(code.item)}</strong></div>`).join('')}`:''}</details><div class="pt29-history"><div class="pt29-tabs" role="tablist" aria-label="Historial de producto">${Object.entries(tabLabels).map(([key,label])=>`<button type="button" id="pt29-tab-${key}" class="pt29-tab ${trace.tab===key?'active':''}" role="tab" aria-selected="${trace.tab===key}" aria-controls="pt29-history-panel" data-pt29-tab="${key}">${esc(label)}<span>${data[key].length}</span></button>`).join('')}</div><div id="pt29-history-panel" role="tabpanel" aria-labelledby="pt29-tab-${trace.tab}">${panel(p,data)}</div></div></section>`);
  }

  function field(name,label,value='',type='text',extra='',hint='') {
    return `<div class="field"><label for="pt29-${name}">${esc(label)}</label><input id="pt29-${name}" name="${name}" type="${type}" value="${esc(value??'')}" ${extra}>${hint?`<small>${esc(hint)}</small>`:''}</div>`;
  }

  function select(name,label,values,current='',placeholder) {
    const options=[...new Set([...(placeholder!=null?['']:[]),...(values||[]),...(current?[current]:[])])];
    return `<div class="field"><label for="pt29-${name}">${esc(label)}</label><select id="pt29-${name}" name="${name}">${options.map(v=>`<option value="${esc(v)}" ${v===current?'selected':''}>${esc(v||placeholder||'Sin configurar')}</option>`).join('')}</select></div>`;
  }

  function supplierRow(code={}) {
    return `<div class="pt29-supplier-row"><label><span>Proveedor</span><input name="supplier" value="${esc(code.supplier||'')}" list="pt29-suppliers" maxlength="250" aria-label="Proveedor de la equivalencia"></label><label><span>Item / artículo</span><input name="supplierItem" value="${esc(code.item||'')}" maxlength="100" aria-label="Número de artículo del proveedor"></label><label><span>Nombre del proveedor</span><input name="supplierName" value="${esc(code.name||'')}" maxlength="250" aria-label="Nombre del producto usado por el proveedor"></label><button type="button" class="icon-button" data-pt29-remove-supplier aria-label="Quitar equivalencia">${icon('close')}</button></div>`;
  }

  function showProductForm(sku) {
    const existing=sku?getProduct(sku):null;if(sku&&!existing)return;if(existing)sku=existing.sku;
    const p=existing||{sku:'',upc:'',name:'',brand:'',category:'',costCents:0,priceCents:0,shippingType:'Pequeño',shippingException:'Automático',safety:0,minStock:3,status:'OK'},categories=(state.config.categoryMappings||[]).map(row=>row.category);
    showModal(`<div class="pt29-form-heading"><span class="pt29-form-symbol">${icon('box')}</span><div><div class="eyebrow">CATÁLOGO CENTRAL</div><h2 id="modal-title">${existing?'Actualizar producto':'Registrar producto'}</h2></div></div><p class="modal-subtitle">${existing?'La identidad y su historial permanecen ligados al mismo SKU.':'Genera su SKU ahora. El UPC puede incorporarse al recibir la mercancía.'}</p><form id="pt29-product-form" data-original="${esc(sku||'')}"><div class="pt29-form-error" role="alert" hidden></div><div class="pt29-form-preview"><div id="pt29-preview-photo">${thumb(p,{large:true})}</div><div><span class="pt29-section-kicker">IDENTIFICACIÓN INTERNA</span><label for="pt29-sku">SKU ${existing?'registrado':'generado'}</label><div class="pt29-sku-control"><input id="pt29-sku" name="sku" value="${esc(p.sku)}" readonly ${existing?'':'maxlength="10" pattern="[A-Za-z0-9]{1,10}"'} placeholder="Completa nombre y atributos…" aria-describedby="pt29-sku-help">${!existing?'<button type="button" class="btn small" data-pt29-generate>Generar SKU</button>':''}</div><small id="pt29-sku-help">${existing?'El SKU es permanente; no cambia al agregar un UPC.':'Máximo 10 letras y números, sin espacios ni guiones. Resume nombre, marca, modelo, color y capacidad; se verifica que sea único al guardar.'}</small></div></div><div class="form-grid"><div class="field wide"><label for="pt29-name">Nombre del producto *</label><input id="pt29-name" name="name" value="${esc(p.name)}" required maxlength="250" autocomplete="off"></div>${field('brand','Marca *',p.brand,'text','required maxlength="100" list="pt29-brands"')}${field('model','Modelo',p.model,'text','maxlength="100"')}${field('color','Color',p.color,'text','maxlength="100"')}${field('capacity','Capacidad / variante',p.capacity,'text','maxlength="100"')}${field('upc','UPC / EAN · opcional',p.upc,'text',p.upc?'readonly':'inputmode="numeric" maxlength="14" pattern="[0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14}"',p.upc?'Código original registrado.':'Escanea o captura 8, 12, 13 o 14 dígitos; también puedes dejarlo pendiente.')}${select('category','Categoría de inventario',categories,p.category,'Por configurar')}<div class="field wide"><label for="pt29-imageUrl">Imagen del producto</label><input id="pt29-imageUrl" name="imageUrl" value="${esc(p.imageUrl||'')}" placeholder="https://… o /erp/assets/products/…" maxlength="2000"><small>Usa una URL HTTPS o una imagen guardada en AIMERKA.</small></div></div><details class="pt29-form-section" open><summary>Costos, precios y operación</summary><div class="form-grid">${field('cost','Costo promedio (MXN)',p.averageCostMxn??p.costCents/100,'number','min="0" step="0.000001" required',p.costStatus==='Por confirmar'?'Costo por confirmar. Captura el costo comprobado cuando tengas la factura.':'')}${field('price','Precio de mercado (MXN)',p.priceCents/100,'number','min="0" step="0.01" required')}${select('shipping','Tipo de envío',['Pequeño','Mediano','Grande'],p.shippingType)}${select('shippingException','Regla de envío',['Automático','Pequeño','Mediano','Grande'],p.shippingException||'Automático')}${field('satCode','Clave SAT',p.satCode,'text','maxlength="100"')}${field('department','Departamento',p.department,'text','maxlength="100"')}${field('minStock','Mínimo de alerta',p.minStock??3,'number','min="0" step="1"')}${select('status','Estado',['OK','INACTIVO'],p.status||'OK')}${existing?field('safety','Stock de seguridad actual',p.safety??0,'number','readonly','Para modificarlo utiliza Ajustar inventario y registra el motivo.'):''}</div></details><details class="pt29-form-section"><summary>Excepciones de categoría por marketplace</summary><div class="form-grid">${ERP.engines.pricing.CHANNELS.map((channel,i)=>select('override'+i,channel,ERP.engines.pricing.listCategories(state.config,channel,{mapping:true}),p.categoryOverrides?.[channel]||'','Automático · usar mapeo')).join('')}</div></details><details class="pt29-form-section"><summary>Equivalencias de artículos del proveedor</summary><p class="pt29-help">Asocia el número de item que aparece en las órdenes y facturas a este SKU interno.</p><div id="pt29-supplier-rows">${(p.supplierCodes||[]).map(supplierRow).join('')}</div><button type="button" class="btn small" data-pt29-add-supplier>${icon('plus')} Agregar equivalencia</button></details><div class="field spacer-top"><label for="pt29-review">Observaciones / revisión</label><textarea id="pt29-review" name="review" rows="3" maxlength="300">${esc(p.review||'')}</textarea></div><div class="info-box blue spacer-top">${existing?'Actualizar la ficha conserva las existencias y los movimientos. Los nuevos cálculos usan el costo actualizado.':'El producto se dará de alta con inventario cero. Las existencias se suman al confirmar una recepción física en Compras.'}</div><datalist id="pt29-brands">${[...new Set((state.products||[]).map(p=>p.brand).filter(Boolean))].map(brand=>`<option value="${esc(brand)}"></option>`).join('')}</datalist><datalist id="pt29-suppliers">${(state.catalogs?.suppliers||[]).map(supplier=>`<option value="${esc(typeof supplier==='object'?supplier.name||supplier.value:supplier)}"></option>`).join('')}</datalist><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">${existing?'Guardar cambios':'Registrar con inventario cero'}</button></div></form>`);
    updatePreview(document.getElementById('pt29-product-form'));
  }

  function updatePreview(form) {
    if(!form)return;
    const p={name:val(form,'name'),brand:val(form,'brand'),model:val(form,'model'),color:val(form,'color'),capacity:val(form,'capacity'),imageUrl:val(form,'imageUrl')};
    if(!form.dataset.original&&ERP.engines.inventory.generateProductSku){form.elements.namedItem('sku').value=p.name?ERP.engines.inventory.generateProductSku(p,state.products||[]):'';}
    const photo=document.getElementById('pt29-preview-photo');if(photo)photo.innerHTML=thumb(p,{large:true});
  }

  function formError(form,message) {
    const error=form.querySelector('.pt29-form-error');if(error){error.textContent=message;error.hidden=!message;if(message)error.scrollIntoView({block:'nearest'});}
  }

  async function saveProduct(form) {
    if(form.dataset.submitting)return;
    const originalSku=form.dataset.original,previous=originalSku?getProduct(originalSku):null;
    const p={...(previous||{}),sku:originalSku||'',name:val(form,'name'),brand:val(form,'brand'),model:val(form,'model'),color:val(form,'color'),capacity:val(form,'capacity'),upc:val(form,'upc'),imageUrl:val(form,'imageUrl'),category:val(form,'category'),costCents:amount(form,'cost'),averageCostMxn:Number(val(form,'cost')),priceCents:amount(form,'price'),shippingType:val(form,'shipping'),shippingException:val(form,'shippingException'),satCode:val(form,'satCode'),department:val(form,'department'),minStock:Number(val(form,'minStock')),status:val(form,'status'),review:val(form,'review'),categoryOverrides:{...(previous?.categoryOverrides||{})},supplierCodes:[...form.querySelectorAll('.pt29-supplier-row')].map(row=>({supplier:row.querySelector('[name="supplier"]').value.trim(),item:row.querySelector('[name="supplierItem"]').value.trim(),name:row.querySelector('[name="supplierName"]').value.trim()}))};
    if(p.supplierCodes.some(code=>!code.supplier||!code.item)){formError(form,'Completa el proveedor y el número de artículo en cada equivalencia, o elimina la fila vacía.');return;}
    if(p.imageUrl&&!safeImage(p.imageUrl)){formError(form,'La imagen debe usar una URL HTTPS o una ruta de AIMERKA que comience con /.');return;}
    try {if(p.upc&&p.upc!==previous?.upc)ERP.engines.inventory.validateProductUpc(p.upc);}catch(error){formError(form,error.message);return;}
    if(previous?.costStatus==='Por confirmar'&&p.costCents>0)p.costStatus='Confirmado';
    ERP.engines.pricing.CHANNELS.forEach((channel,i)=>p.categoryOverrides[channel]=val(form,'override'+i));
    formError(form,'');form.dataset.submitting='true';const submit=form.querySelector('[type="submit"]');submit.disabled=true;
    try {
      const result=await ERP.command('product.save',{originalSku:originalSku||null,product:p});
      if(result.ok){const sku=result.result?.sku||originalSku;form.closest('dialog').close();if(sku)showProduct(sku);}
      else formError(form,result.error||'No se pudo guardar el producto. Revisa los datos e intenta de nuevo.');
    }catch(error){formError(form,error.message||'No se pudo guardar el producto.');}
    finally{delete form.dataset.submitting;submit.disabled=false;}
  }

  function showUpc(sku) {
    const p=getProduct(sku);if(!p||p.upc)return;sku=p.sku;
    showModal(`<h2 id="modal-title">Asignar UPC original</h2><p class="modal-subtitle">${esc(p.name)} · ${esc(p.sku)}</p><form id="pt29-upc-form" data-sku="${esc(sku)}"><div class="pt29-form-error" role="alert" hidden></div>${field('upc','Escanea el código del producto','', 'text','required inputmode="numeric" minlength="8" maxlength="14" pattern="[0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14}" autocomplete="off" autofocus','Un escáner USB o Bluetooth puede capturarlo como teclado.')}<div class="info-box blue">El UPC se vincula al SKU que ya existe. Esta acción no recibe mercancía ni modifica las existencias.</div><div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Cancelar</button><button type="submit" class="btn primary">Asignar UPC</button></div></form>`);
    document.getElementById('pt29-upc')?.focus();
  }

  async function saveUpc(form) {
    if(form.dataset.submitting)return;
    try{ERP.engines.inventory.validateProductUpc(val(form,'upc'));}catch(error){formError(form,error.message);return;}
    form.dataset.submitting='true';const submit=form.querySelector('[type="submit"]');submit.disabled=true;
    try{const result=await ERP.command('product.assignUpc',{sku:form.dataset.sku,upc:val(form,'upc')});if(result.ok){form.closest('dialog').close();showProduct(form.dataset.sku);}else formError(form,result.error||'No se pudo asignar el UPC.');}
    catch(error){formError(form,error.message||'No se pudo asignar el UPC.');}
    finally{delete form.dataset.submitting;submit.disabled=false;}
  }

  function decorate(markup,viewKey) {
    const template=document.createElement('template');template.innerHTML=markup;
    template.content.querySelectorAll('table tbody [data-product]').forEach(button=>{
      const p=getProduct(button.dataset.product),cell=button.closest('td');if(!p||!cell||cell.querySelector('.pt29-product-cell'))return;
      if(viewKey==='products'&&p.costStatus==='Por confirmar'){const costCell=cell.closest('tr')?.children[2];if(costCell)costCell.innerHTML='<span class="pt29-pending">Por confirmar</span>';}
      const copy=cell.innerHTML;cell.innerHTML=`<div class="pt29-product-cell">${thumb(p)}<div class="pt29-product-cell-text">${copy}${!p.upc?'<span class="pt29-upc-pending">UPC pendiente</span>':''}</div></div>`;
    });
    return template.innerHTML;
  }

  for(const key of ['products','inventory']) {
    const previous=renderers[key];if(previous)renderers[key]=function(){return decorate(previous.apply(this,arguments),key);};
  }
  c28ProductForm=showProductForm;
  productDetails=showProduct;
  window.ProductTrace28={thumb,documents,documentUrl,show:showProduct,form:showProductForm,matchesLine,safeImage};

  document.addEventListener('error',event=>{
    const image=event.target;if(image?.tagName==='IMG'&&image.closest('.pt29-thumb')){image.closest('.pt29-thumb').classList.add('pt29-image-failed');image.hidden=true;}
  },true);
  document.addEventListener('input',event=>{
    const form=event.target.closest('#pt29-product-form');if(form&&['name','brand','model','color','capacity','imageUrl'].includes(event.target.name))updatePreview(form);
  });
  document.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-pt29-generate')){const form=button.closest('form');updatePreview(form);if(!val(form,'name'))form.elements.namedItem('name').focus();}
    else if(button.hasAttribute('data-pt29-add-supplier'))document.getElementById('pt29-supplier-rows')?.insertAdjacentHTML('beforeend',supplierRow());
    else if(button.hasAttribute('data-pt29-remove-supplier'))button.closest('.pt29-supplier-row')?.remove();
    else if(button.dataset.pt29Upc)showUpc(button.dataset.pt29Upc);
    else if(button.dataset.pt29Purchase&&typeof op28Detail==='function')op28Detail('purchase',button.dataset.pt29Purchase);
    else if(button.dataset.pt29Tab){trace.tab=button.dataset.pt29Tab;trace.limit=60;document.querySelectorAll('.pt29-tab').forEach(tab=>{const active=tab.dataset.pt29Tab===trace.tab;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));});const container=document.getElementById('pt29-history-panel'),p=getProduct(trace.sku);if(container&&p){container.setAttribute('aria-labelledby','pt29-tab-'+trace.tab);container.innerHTML=panel(p,dataFor(p));}}
    else if(button.hasAttribute('data-pt29-more')){trace.limit+=60;const p=getProduct(trace.sku);if(p)document.getElementById('pt29-history-panel').innerHTML=panel(p,dataFor(p));}
  });
  document.addEventListener('submit',event=>{
    if(event.target.id==='pt29-product-form'){event.preventDefault();saveProduct(event.target);}
    else if(event.target.id==='pt29-upc-form'){event.preventDefault();saveUpc(event.target);}
  });
})();
