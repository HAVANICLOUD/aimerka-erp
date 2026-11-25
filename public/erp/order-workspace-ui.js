'use strict';

// Load after commerce-v28, payment-alerts-ui and settlement-v43. The public
// classifier is a byte-identical copy of lib/order-workspace.mjs, checked in tests.
// Parent boot imports its versioned classifier, then calls OrderWorkspace.install(model).
window.OrderWorkspace = (() => {
  let model, installed=false,followupFilter='all';
  let resolveReady;
  const ready = new Promise(resolve=>{resolveReady=resolve;});
  const evidence = o => ERP.engines.payments?.financialState ? {financialState:ERP.engines.payments.financialState(o,state)} : {};
  const classify = o => model.classifyOrder(o,evidence(o));
  const reference = o => model.orderReference(o);
  const useIcon = key => icon(key);

  function supplierLogo(issue) {
    const provider=issue.supplier || issue.payment?.supplier;
    const entries=[...(Array.isArray(state.catalogs?.suppliers)?state.catalogs.suppliers:[]),...(Array.isArray(state.config?.workspacePresentation?.suppliers)?state.config.workspacePresentation.suppliers:[])];
    const name=typeof provider==='string'?provider:provider?.name||issue.payment?.description;
    const entry=provider&&typeof provider==='object'?provider:entries.find(s=>name&&s&&typeof s==='object'&&[s.name,s.id,s.supplier].includes(name));
    const url=entry?.logoUrl||entry?.imageUrl;
    return typeof url==='string'&&(/^(https?:\/\/)/i.test(url)||/^\/(?!\/)/.test(url))?`<img class="ow-supplier-logo" src="${esc(url)}" alt="${esc(name||'Proveedor')}" loading="lazy" referrerpolicy="no-referrer">`:'';
  }

  // Dashboard identity is HTML; describeIssue also exposes its label and kind.
  function describeIssue(issue) {
    const expense=issue.type==='expense-payment'||issue.payment?.kind==='expense';
    const kind=expense?'expense':issue.type==='supplier-payment'?'supplierPayment':issue.type==='settlement'?'salesSettlement':issue.order?'order':'stock';
    const label=kind==='expense'?'Gasto':kind==='supplierPayment'?'Proveedor':kind==='salesSettlement'?'Conciliación de venta':issue.order?(issue.order.market||'Pedido'):'Inventario';
    const number=issue.order?.number||issue.order?.literalNumber;
    const orderRef=number?(/^pedido\s/i.test(number)?String(number):'Pedido '+number):'Pedido sin número registrado';
    const ref=issue.order?orderRef:issue.payment?[(expense?'Gasto':'Compra')+' '+(issue.payment.entityId||'sin referencia registrada'),issue.payment.description].filter(Boolean).join(' · '):issue.product?[issue.product.sku,issue.product.name].filter(Boolean).join(' · '):label;
    const logo=kind==='supplierPayment'?(supplierLogo(issue)||useIcon('supplierPayment')):kind==='expense'?useIcon('expense'):kind==='salesSettlement'?useIcon('salesSettlement'):issue.order?.market?MarketUI.logo(issue.order.market):useIcon('box');
    return {kind,label,reference:ref,logo};
  }

  function statusBadges(o) {
    const c=classify(o),g=model.orderGrossValidation(o),label=c.registrationError?'Cancelada · error de registro':c.cancelled?'Cancelada':c.refunded?'Reembolsada':c.preparing?'Por preparar':c.delivered?'Entregada':c.shipped?'Enviada':c.native?.nativeStatus||'Por definir';
    return `${g.mismatch?badge('Diferencia de importe por revisar','red'):''}${badge(label,c.cancelled?'red':c.refunded?'purple':c.tone)}${c.subtypeLabels.filter(subtype=>!/^Reembolsad/.test(subtype)||label!=='Reembolsada').map(label=>badge(label,/Reembols/i.test(label)?'purple':'amber')).join('')}${c.followup?badge(o.followupStatus,'amber'):''}`;
  }

  const eye=()=>'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  function lineProduct(line){return (state.products||[]).find(p=>p.sku===line.sku||(line.upc&&p.upc===line.upc));}
  function thumb(line){const p=lineProduct(line);return window.ProductMedia?.html(p||{name:line.name},{className:'ow-product-thumb'})||'';}
  function table(list) {
    return `<div class="ow-orders-fit"><table class="ow-orders-table"><colgroup><col style="width:21%"><col style="width:34%"><col style="width:15%"><col style="width:23%"><col style="width:7%"></colgroup><thead><tr><th scope="col">Venta / canal / fecha</th><th scope="col">Producto</th><th scope="col">Importe / pago</th><th scope="col">Estado registrado</th><th scope="col">Ficha</th></tr></thead><tbody>${list.map(o=>{const lines=c28Rows(o),line=lines[0]||{sku:o.sku,name:o.productNames},p=lineProduct(line),number=String(o.number||o.literalNumber||'Sin número').replace(/^pedido\s+/i,'');return `<tr><td data-label="Venta"><div class="ow-sale-identity">${MarketUI.logo(o.market)}<div><button class="row-title" data-order="${esc(o.id)}">${esc(number)}</button><span class="subtext">${esc(o.market)}</span><time>${c28Date(o.documentDate||o.date)}</time></div></div></td><td data-label="Producto"><div class="ow-product-cell">${thumb(line)}<div><strong>${esc(line.name||p?.name||'Sin partidas verificadas')}</strong><span class="subtext">${esc(line.sku||p?.sku||'SKU por identificar')}</span><span class="subtext">${lines.length>1?lines.length+' partidas · ':''}${lines.reduce((n,l)=>n+l.qty,0)} unidades</span></div></div></td><td data-label="Importe" class="table-price"><strong>${money(D.orderTotal(o))}</strong><span class="subtext ow-payment">${esc(c28Payment(o))}</span></td><td data-label="Estado"><div class="ow-status-stack">${statusBadges(o)}</div></td><td data-label="Ficha"><button class="btn small ow-view" data-order="${esc(o.id)}" aria-label="Ver venta ${esc(number)}">${eye()}<span>Ver</span></button></td></tr>`;}).join('')||'<tr><td colspan="5" class="empty">No hay pedidos con estos filtros.</td></tr>'}</tbody></table></div>`;
  }

  function ordersPage() {
    const list=filteredOrders(),pages=Math.max(1,Math.ceil(list.length/50));
    c28.orderPage=Math.max(1,Math.min(c28.orderPage,pages));
    const counts=Object.fromEntries(model.ORDER_TABS.map(tab=>[tab.key,state.orders.filter(o=>model.matchesOrderCategory(o,tab.key,evidence(o))).length]));
    return `<div class="order-workspace">${pageHead('OPERACIÓN / PEDIDOS','Pedidos, de principio a fin.','Venta, pago y seguimiento con sus referencias originales.',`<button class="btn" data-v28="orders-export">${icon('download')} Exportar</button>${primaryNew()}`)}
    <div class="ow-tabs" role="group" aria-label="Estado de pedidos">${model.ORDER_TABS.map(tab=>`<button type="button" class="ow-tab ${statusFilter===tab.key?'is-active':''}" data-ow-category="${tab.key}" aria-pressed="${statusFilter===tab.key}"><span class="ow-tab-icon" aria-hidden="true">${useIcon(tab.icon==='refund'?'salesSettlement':tab.icon)}</span><span>${tab.label}</span><strong>${counts[tab.key]}</strong></button>`).join('')}</div>
    
    ${MarketUI.chips(marketFilter,state.orders.reduce((a,o)=>(a[o.market]=(a[o.market]||0)+1,a),{}))}
    <div class="filterbar"><label class="field-search">${icon('search')}<input id="order-search" value="${esc(orderQuery)}" aria-label="Filtrar pedidos" placeholder="Pedido, referencia, SKU, UPC o producto…"></label><select id="market-filter" aria-label="Filtrar marketplace"><option value="">Todos los marketplaces</option>${[...new Set([...markets,...state.orders.map(o=>o.market)])].map(m=>`<option ${m===marketFilter?'selected':''}>${esc(m)}</option>`).join('')}</select><label class="ow-followup-filter">${icon('alert')} Seguimiento<select id="ow-followup-filter" aria-label="Filtrar incidencia y seguimiento">${[['all','Todos'],['issues','Con incidencia validada'],['pending','Seguimiento pendiente'],['none','Sin incidencia']].map(([v,t])=>`<option value="${v}" ${followupFilter===v?'selected':''}>${t}</option>`).join('')}</select></label><button class="btn" data-action="clear-filters">Limpiar</button></div>
    <div class="filterbar c28-small-filters">${ERP.field('c28-order-from','Desde',c28.orderFrom,'date')}${ERP.field('c28-order-to','Hasta',c28.orderTo,'date')}<span class="tiny">Filtro de fecha del pedido en marketplace · ${list.length} resultados · conteos de categorías de todo el espacio</span></div>
    <section class="panel">${table(list.slice((c28.orderPage-1)*50,c28.orderPage*50))}<div class="table-footer"><span>${list.length} ventas · ${datasetNote()}</span><div class="pager"><button class="btn small" data-c28-page="${c28.orderPage-1}" ${c28.orderPage<=1?'disabled':''}>Anterior</button><span>${c28.orderPage} / ${pages}</span><button class="btn small" data-c28-page="${c28.orderPage+1}" ${c28.orderPage>=pages?'disabled':''}>Siguiente</button></div></div></section></div>`;
  }

  function nativeCatalog(){return `<details class="ow-native-catalog panel"><summary>${icon('layers')} Estados por marketplace <span class="subtext">Vocabulario verificado · consulta</span></summary><p class="ow-local-note">Cada canal conserva su estado original. La equivalencia organiza las vistas del ERP; no confirma cobros ni modifica existencias.</p><div class="ow-native-grid">${Object.entries(model.MARKETPLACE_ORDER_STATES).map(([market,rows])=>`<section><h3>${MarketUI.logo(market)} ${esc(market)}</h3><dl>${rows.map(r=>`<div><dt>${esc(r.native)}</dt><dd>${esc(model.ORDER_STATE_LABELS[r.status])}${r.note?`<small>${esc(r.note)}</small>`:''}</dd></div>`).join('')}</dl></section>`).join('')}</div><p class="info-box"><strong>Liverpool · logística inversa</strong><br>Regla registrada para la futura conexión: esperar 10 días desde la fecha de solicitud de reembolso para revisar la guía de devolución. Automatización desactivada. No se abren incidencias ni reclamaciones.</p></details>`;}
  function grossDetail(o){const g=model.orderGrossValidation(o);if(!g.mismatch)return '';return `<section class="drawer-block gross-validation is-mismatch"><h3>${icon('alert')} Diferencia de importe por revisar</h3><p>Venta registrada: <strong>${money(g.erpCents)}</strong> · Importe del canal: <strong>${money(g.marketplaceCents)}</strong> · Diferencia: <strong>${money(Math.abs(g.differenceCents))}</strong>.</p><p>Revisa precios y promociones. Los depósitos conciliados se conservan.</p></section>`;}
  function promotionDetail(o){
    const p=o.marketplace34?.promotion,e=p?.manualOverride?null:o.promotionEvidence;if((e?.promotionCents??p?.amountCents??0)<=0)return `<section class="drawer-block ow-promotion ow-sale-section"><div class="ow-section-heading"><h3>${icon('tag')} Promociones registradas</h3>${window.SaleRecordUI?.button(o,'promotion','Agregar promoción')||''}</div><p class="subtext">Sin promoción registrada.</p></section>`;
    const base=p?.baseCents||p?.grossCents||e?.sellerGrossCents||o.totalCents,amount=e?.promotionCents??p.amountCents,percent=p?.percent??(base?Math.round(amount/base*10000)/100:0),funding=e?.marketplaceFundedCents===amount?o.market:({marketplace:o.market||'Marketplace',seller:'Nuestra empresa',unknown:'Por confirmar'})[p?.funding]||'Por confirmar';
    const description=String(p?.description||e?.description||'Promoción').replace(/\s*\|\s*Promoción Liverpool:[\s\S]*$/i,'').replace(/FirstDay Discount|DESC\s+X\s+1ER\s+DIA\s+COMP/ig,'Primer día de compras').replace(/Employee Discount/ig,'Descuento de colaborador');
    const cell=(label,value,glyph,kind,wide=false)=>`<div class="ow-promo-field ${kind} ${wide?'is-wide':''}"><dt>${icon(glyph)}<span>${label}</span></dt><dd>${esc(value)}</dd></div>`;
    return `<section class="drawer-block ow-promotion ow-sale-section"><div class="ow-section-heading"><h3>${icon('tag')} Promociones registradas</h3>${window.SaleRecordUI?.button(o,'promotion','Editar promoción')||''}</div><dl class="ow-promo-grid">${cell('Tipo o nombre de descuento',description,'tag','is-name',true)}${cell('Monto de promoción',money(amount),'wallet','is-amount')}${cell('Porcentaje',percent+'%','percent','is-percent')}${cell('Absorbida por',funding,'payer','is-funding')}${cell('Pagado por el cliente',money(e?.customerCents??((p.customerAmountCents??base-amount)+(o.shippingChargedCents||0))),'receipt','is-customer')}</dl></section>`;
  }

  function nativeDetail(o){return grossDetail(o)+promotionDetail(o);}

  function incidentDetail(issue) {
    return String(issue.detail||'').split(' · ').slice(1).filter(part=>part.trim()!==issue.order?.market).join(' · ');
  }

  function incidentsPage() {
    const list=issues().filter(i=>!i.product?.lifecycle?.hidden&&!i.product?.lifecycle?.discontinued);
    return `<div class="order-workspace">${pageHead('CONTROL / INCIDENCIAS','Cada pendiente tiene un siguiente paso.','Pagos, devoluciones, seguimiento y conciliación.',`<button class="btn" data-view="orders">Consultar ventas</button>`)}<section class="panel"><div class="table-wrap"><table class="ow-issues-table"><thead><tr><th scope="col">Origen</th><th scope="col">Asunto</th><th scope="col">Referencia</th><th scope="col">Situación</th><th scope="col">Acción</th></tr></thead><tbody>${list.map(i=>{const identity=describeIssue(i);return `<tr><td><div class="ow-issue-origin"><span class="ow-identity-icon">${identity.logo}</span><strong>${esc(identity.label)}</strong>${i.order&&identity.kind==='salesSettlement'?MarketUI.logo(i.order.market):''}</div></td><td>${esc(i.title)}</td><td><strong>${esc(identity.reference)}</strong>${i.order?`${incidentDetail(i)?`<span class="subtext">${esc(incidentDetail(i))}</span>`:''}${i.order.incident?`<span class="subtext">${esc(i.order.incident)}</span>`:''}`:(i.payment?'':`<span class="subtext">${esc(i.detail||'')}</span>`)}${i.payment?`<span class="subtext">Cuota ${esc(i.payment.number)}/${esc(i.payment.term)} · ${esc(c28Date(i.payment.dueDate))} · ${money(i.payment.balanceCents)}</span>`:''}</td><td>${i.order?`<div class="ow-status-stack">${statusBadges(i.order)}</div>`:badge(i.payment?(i.payment.dueDate<ERP.today()?'Vencido':i.payment.dueDate===ERP.today()?'Vence hoy':'Próximo vencimiento'):identity.label,i.tone||'amber')}${i.order&&i.type==='settlement'?`<span class="subtext">${esc(c28Payment(i.order))}</span>`:''}</td><td><button type="button" class="btn small" ${window.PaymentAlerts28.issueTarget(i)} aria-label="Revisar ${esc(identity.reference)}">Revisar ${icon('arrow')}</button></td></tr>`;}).join('')||'<tr><td colspan="5" class="empty">No hay incidencias pendientes.</td></tr>'}</tbody></table></div></section></div>`;
  }

  function install(classifier) {
    if(installed) return;
    if(!classifier?.classifyOrder||!classifier?.matchesOrderCategory||!classifier?.expenseIssues||!classifier?.ORDER_TABS) throw new TypeError('OrderWorkspace.install requires the order-workspace classifier');
    model=classifier;
    const previousFilteredOrders=filteredOrders;
    filteredOrders=function() {
      // Delegate search, documentary dates, marketplace and settlement sorting
      // unchanged. Clear only the legacy category while obtaining that scope.
      const category=statusFilter;
      let scope;
      try {statusFilter='';scope=previousFilteredOrders();} finally {statusFilter=category;}
      return scope.filter(o=>model.matchesOrderCategory(o,category,evidence(o))).filter(o=>followupFilter==='all'||followupFilter==='issues'&&classify(o).incidence||followupFilter==='pending'&&classify(o).followup||followupFilter==='none'&&!classify(o).incidence);
    };
    const previousIssues=issues;
    issues=function() {
      const current=previousIssues();
      if(!ERP.ready||!ERP.engines.operations?.buildCalendar) return current;
      const calendar=ERP.engines.operations.buildCalendar(state,ERP.today());
      const expenses=model.expenseIssues(Array.isArray(calendar)?calendar:calendar?.rows||[],ERP.today());
      const keys=new Set(current.filter(i=>i.payment?.kind==='expense').map(i=>i.payment.entityId+'|'+i.payment.number));
      const grossIssues=(state.orders||[]).filter(o=>model.orderGrossValidation(o).mismatch).map(o=>({type:'order-gross',order:o,title:'Venta bruta diferente',detail:o.market+' · ERP '+money(o.totalCents)+' / market '+money(model.orderGrossValidation(o).marketplaceCents),tone:'red'}));
      return [...current.filter(i=>i.type!=='order'||!i.order||classify(i.order).incidence),...expenses.filter(i=>!keys.has(i.payment.entityId+'|'+i.payment.number)),...grossIssues];
    };
    // Preserve the existing target mechanism, extending only real expense rows.
    const previousTarget=window.PaymentAlerts28.issueTarget;
    window.PaymentAlerts28.issueTarget=function(issue) {
      if(issue.payment?.kind==='expense') return `data-op28="detail" data-kind="expense" data-id="${esc(issue.payment.entityId)}"`;
      return previousTarget(issue);
    };
    const priorCatalog=renderers.catalogs;renderers.catalogs=()=>nativeCatalog()+(priorCatalog?priorCatalog():'');
    c28OrdersPage=ordersPage;c28Incidents=incidentsPage;
    renderers.orders=ordersPage;renderers.incidents=incidentsPage;
    document.addEventListener('click',event=>{
      if(event.target.closest('[data-action="clear-filters"]')){followupFilter='all';render();return;}
      const button=event.target.closest('[data-ow-category]');
      if(!button) return;
      statusFilter=button.dataset.owCategory;c28.orderPage=1;render();
    });
    document.addEventListener('change',event=>{if(event.target.id==='ow-followup-filter'){followupFilter=event.target.value;c28.orderPage=1;render();}});

    installed=true;
    resolveReady(api);
    if(ERP.ready&&['orders','incidents'].includes(view)) render();
  }
  const api={referenceError:o=>model.registrationErrorEvidence(o),nativeDetail,nativeCatalog,statusBadges,history:o=>model.operationalSaleHistory(o),noteEvidence:o=>model.orderNoteEvidence(o),lineIdentifiers:(o,l,i)=>model.orderLineIdentifiers(o,l,i),thumb,lineProduct,eye,issueIdentity:issue=>describeIssue(issue).logo,issueReference:issue=>describeIssue(issue).reference,describeIssue,logoForIssue:issue=>describeIssue(issue).logo,useIcon,install};
  api.ready=ready;
  return api;
})();
