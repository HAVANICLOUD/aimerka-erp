/* Purchase form presentation: keeps the existing purchase and receiving commands. */
'use strict';
(function(){
 const get=id=>document.getElementById(id);
 icons.link??='<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/>';
 icons.credit??='<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>';
 icons.barcode??='<path d="M3 5v14M6 5v14M9 5v14M13 5v14M16 5v14M20 5v14"/>';
 icons.store??='<path d="M3 10h18l-2-6H5zM5 10v10h14V10M9 20v-6h6v6"/>';
 const help=(title,text)=>`<span class="buy-field-help" tabindex="0" role="note" aria-label="${esc(title+': '+text)}">${icon('info')}<span role="tooltip">${esc(text)}</span></span>`;
 function costPair(value,source='gross'){
  if(String(value??'').trim()==='')return {gross:'',net:''};
  const cents=Math.round(Number(value)*100);if(!Number.isSafeInteger(cents)||cents<0)return null;
  const gross=source==='net'?Math.round(cents*1.16):cents,net=source==='net'?cents:Math.round(cents/1.16);
  return {gross:(gross/100).toFixed(2),net:(net/100).toFixed(2)};
 }
 const fields={date:['calendar','Fecha de compra','Fecha documental de la compra. Se utiliza para ordenar las compras y calcular el calendario de pago.'],supplier:['store','Proveedor','Selecciona quién vende la mercancía. Puedes registrar un proveedor desde este formulario.'],sicar:['file','Referencia SICAR (opcional)','Consecutivo de la compra original en SICAR; se conserva para consultar su procedencia.'],supplierOrder:['file','Número de orden del proveedor','Referencia original del pedido. Se coteja al adjuntar órdenes y facturas.'],shippingStatus:['truck','Estado del traslado','Pendiente o en tránsito describe el envío del proveedor; no registra una recepción.'],taxInvoice:['file','Serie y número de factura fiscal','Serie y folio de la factura, por ejemplo BMG 37144420. El PDF y su UUID se vinculan desde Subir facturación.'],satReviewed:['shield','Revisado en SAT','Indica si el comprobante ya fue revisado manualmente en SAT. Este campo no realiza una consulta automática.'],amount:['wallet','Importe total de la compra (MXN)','Total final de la orden con impuestos. Puede quedar pendiente hasta confirmar las facturas.'],notes:['file','Comentarios (opcional)','Observaciones de la compra y acuerdos con el proveedor.'],lender:['credit','Dador de pago / crédito','Entidad o persona que financia o cubre esta compra. Se combina con el instrumento para obtener corte y vencimiento.'],instrument:['wallet','Instrumento de pago','Tarjeta u otro medio de pago. Se utilizan sus fechas configuradas de corte y pago.'],term:['layers','Parcialidades','Número de pagos de esta compra. La distribución respeta el calendario de financiamiento configurado.'],firstPaymentDate:['calendar','Primer pago (opcional)','Se estima con la fecha de compra, el dador y el instrumento configurados. Puedes establecer otra fecha manualmente.'],lineName:['tag','Título del producto','Nombre del artículo comprado. Se completa al seleccionar un producto del inventario y puede revisarse antes de agregarlo.'],lineQty:['box','Cantidad ordenada','Unidades que compras de este producto. Recibirlas en almacén es un proceso independiente.'],lineCost:['wallet','Costo unitario con IVA (16%)','Precio final por unidad, en pesos. Al capturarlo se calcula el costo sin IVA. No modifica el costo promedio del inventario.'],lineNetCost:['wallet','Costo unitario sin IVA','Base por unidad antes de IVA del 16%. Al capturarla se actualiza el costo con IVA que se guardará en la compra.']};
 function decorate(form,name,definition){
  const input=form.elements[name];if(!input)return;const label=form.querySelector(`label[for="${input.id}"]`);if(!label)return;
  const [svg,title,text]=definition;input.setAttribute('aria-label',title);label.innerHTML=`<span>${icon(svg)} ${esc(title)}</span>${help(title,text)}`;
 }
 function automaticDate(form,force=false){
  const field=form.elements.firstPaymentDate;if(!field||field.dataset.manual==='true')return;
  const rule=op28engine().creditRuleFor(state.creditRules,form.elements.lender.value,form.elements.instrument.value),preview=op28engine().creditPreview(form.elements.date.value,rule);
  if(preview.paymentDate){if(force||!field.value||field.dataset.automatic==='true'){field.value=preview.paymentDate;field.dataset.automatic='true';op28draft.buyDateMode='auto';}get('op28-purchase-date-result').textContent='Primer pago estimado: '+op28date(preview.paymentDate)+'. Según el corte y pago configurados; puedes editarlo.';}
  else{if(field.dataset.automatic==='true')field.value='';get('op28-purchase-date-result').textContent='Configura el día de corte y pago de este dador e instrumento en Calendario, o captura la primera fecha manualmente.';}
  window.ERPDate?.refresh(form);
 }
 const previous=op28RenderPurchaseForm;
 op28RenderPurchaseForm=function(){
  previous();const form=get('op28-purchase-form');if(!form)return;
  form.classList.add('buy-form-refined');
  const modal=get('modal');modal.classList.add('buy-form-modal');get('modal-title').innerHTML=icon('bag')+' '+(op28draft.id?'Actualizar compra':'Nueva orden de compra');
  const identity=form.querySelector('.p29-order-identity');identity.querySelector('span').innerHTML=icon('file')+' Folio AIMERKA';
  if(!op28draft.id)identity.querySelector('strong').textContent='Se generará automáticamente al guardar la orden de compra.';
  const docs=form.querySelector('.info-box');docs.classList.add('buy-import-actions');
  for(const [action,svg] of [['purchase-docs-draft','upload'],['purchase-invoices-draft','file']]){const button=form.querySelector(`[data-op28="${action}"]`);button.innerHTML=icon(svg)+' '+(action==='purchase-docs-draft'?'Importar orden o listado':'Subir facturación');}
  const finance=form.querySelector('.p29-finance summary');finance.innerHTML=`${icon('wallet')} <strong>Pago y financiamiento</strong><span>Configura cómo y cuándo pagar</span>`;
  const heading=form.querySelector('.p29-section-heading h3');heading.innerHTML=icon('box')+' Mercancía de la orden';
  const code=get('op28-line-code');code.removeAttribute('list');code.setAttribute('autocomplete','off');code.placeholder='Nombre, SKU o UPC · buscar en el catálogo';
  const label=form.querySelector('label[for="op28-line-code"]');label.innerHTML=`<span>${icon('search')} Buscar producto en inventario</span>${help('Buscar producto','Explora el catálogo con imágenes, existencias, SKU, UPC y costo promedio, incluidos los artículos sin stock.')}`;
  code.insertAdjacentHTML('afterend',`<button class="btn buy-explore" type="button" data-buy-product-explore>${icon('box')} Explorar inventario</button>`);
  code.parentElement.classList.add('buy-code-field');
  const cost=form.elements.lineCost;cost.parentElement.insertAdjacentHTML('afterend',op28input('lineNetCost','Costo unitario sin IVA','','number','min="0" step="0.01"'));
  for(const [name,definition] of Object.entries(fields))decorate(form,name,definition);
  const reception=form.querySelector('.p29-readonly');if(reception){const label=reception.parentElement.querySelector('label');label.innerHTML=`<span>${icon('truck')} Recepción en almacén</span>${help('Recepción en almacén','Avance calculado a partir de las recepciones confirmadas por artículo. Subir una factura no suma unidades.')}`;}
  const add=form.querySelector('[data-op28="purchase-line"]');add.classList.add('buy-add-merchandise');add.innerHTML=icon('plus')+' Agregar mercancía';
  const first=form.elements.firstPaymentDate;if(first.value&&!op28draft.buyDateMode)op28draft.buyDateMode='manual';if(op28draft.buyDateMode==='manual')first.dataset.manual='true';else if(op28draft.buyDateMode==='auto')first.dataset.automatic='true';automaticDate(form);
 };
 function pickerProducts(query){const text=String(query||'').trim().toLocaleLowerCase('es-MX');return (state.products||[]).filter(p=>!p.lifecycle?.hidden&&!p.lifecycle?.discontinued&&(!text||[p.name,p.sku,p.upc,p.brand].join(' ').toLocaleLowerCase('es-MX').includes(text)));}
 let pickerLimit=24,pickerReturn=null;
 function pickerResults(){const query=get('buy-picker-query').value,rows=pickerProducts(query);get('buy-picker-count').textContent=rows.length+' productos';get('buy-picker-results').innerHTML=rows.slice(0,pickerLimit).map(p=>`<button type="button" class="buy-picker-product" data-buy-pick="${esc(p.sku)}"><span class="buy-picker-thumb">${op28PurchaseThumb(p)}</span><span><strong>${esc(p.name)}</strong><span class="buy-picker-identifiers"><b>SKU</b> ${esc(p.sku)}<br><b>UPC</b> ${esc(p.upc||'Sin registrar')}</span><span class="buy-picker-stock">${icon('box')} Físico vendible: <b>${Number(p.good)||0}</b> · Disponible: <b>${ERP.engines.inventory.available(p)}</b></span><span class="buy-picker-prices">Costo promedio: <b>${money(p.costCents)}</b> · Precio general: <b>${money(p.priceCents||0)}</b></span></span>${icon('plus')}</button>`).join('')||'<p>No hay productos con esa búsqueda.</p>';get('buy-picker-more').hidden=rows.length<=pickerLimit;}
 function openPicker(){
  if(!get('op28-purchase-form'))return;let dialog=get('buy-product-picker');if(dialog)dialog.remove();
  dialog=document.createElement('dialog');dialog.id='buy-product-picker';dialog.className='buy-inventory-picker';dialog.setAttribute('aria-labelledby','buy-picker-title');
  dialog.innerHTML=`<header><div><h2 id="buy-picker-title">${icon('box')} Elegir mercancía</h2><p>Seleccionar un artículo no modifica el inventario.</p></div><button class="icon-button" type="button" data-buy-picker-close aria-label="Cerrar explorador">${icon('close')}</button></header><label for="buy-picker-query">${icon('search')} Nombre, marca, SKU o UPC</label><input type="search" id="buy-picker-query" placeholder="Buscar en todo el catálogo"><small id="buy-picker-count" aria-live="polite"></small><div id="buy-picker-results"></div><button class="btn" id="buy-picker-more" type="button">Ver más productos</button>`;
  pickerReturn=document.activeElement;document.body.appendChild(dialog);pickerLimit=24;pickerResults();dialog.showModal();get('buy-picker-query').focus();dialog.addEventListener('close',()=>{pickerReturn?.focus();dialog.remove();});
 }
 function selectProduct(sku){const form=get('op28-purchase-form'),p=(state.products||[]).find(p=>p.sku===sku);if(!p||!form)return;get('op28-line-code').value=p.sku;form.elements.lineName.value=p.name;const pair=costPair(op28amountValue(p.costCents));form.elements.lineCost.value=pair.gross;form.elements.lineNetCost.value=pair.net;get('buy-product-picker')?.close();form.elements.lineQty.focus();form.elements.lineQty.select();}
 document.addEventListener('click',e=>{if(e.target.closest('[data-op28="purchase-date"]')){const form=get('op28-purchase-form');if(form){delete form.elements.firstPaymentDate.dataset.manual;op28draft.buyDateMode='auto';automaticDate(form,true);}return;}if(e.target.closest('[data-buy-product-explore]')||e.target.id==='op28-line-code'){openPicker();return;}const pick=e.target.closest('[data-buy-pick]');if(pick){selectProduct(pick.dataset.buyPick);return;}if(e.target.closest('[data-buy-picker-close]'))get('buy-product-picker')?.close();if(e.target.id==='buy-picker-more'){pickerLimit+=24;pickerResults();}});
 document.addEventListener('input',e=>{
  if(e.target.id==='buy-picker-query'){pickerLimit=24;pickerResults();return;}
  const form=get('op28-purchase-form');if(!form)return;
  if(['op28-lineCost','op28-lineNetCost'].includes(e.target.id)){const net=e.target.id==='op28-lineNetCost',pair=costPair(e.target.value,net?'net':'gross');if(pair)form.elements[net?'lineCost':'lineNetCost'].value=pair[net?'gross':'net'];}
  if(e.target.id==='op28-line-code'){const p=op28PurchaseProduct({skuOrUpc:e.target.value});if(p){const pair=costPair(op28amountValue(p.costCents));form.elements.lineNetCost.value=pair.net;}}
  if(e.target.id==='op28-firstPaymentDate'){e.target.dataset.manual='true';op28draft.buyDateMode='manual';delete e.target.dataset.automatic;}
 });
 document.addEventListener('change',e=>{const form=get('op28-purchase-form');if(form&&['op28-date','op28-lender','op28-instrument'].includes(e.target.id))automaticDate(form,true);});
 document.addEventListener('click',e=>{if(e.target.closest('[data-op28="purchase-line"]')){const net=get('op28-lineNetCost');if(net&&!net.checkValidity()){e.preventDefault();e.stopImmediatePropagation();net.reportValidity();}}},true);
 window.PurchaseFormUI={costPair,pickerProducts,automaticDate};
})();
