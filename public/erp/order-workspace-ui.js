'use strict';

// Load after commerce-v28, payment-alerts-ui and settlement-v43. The public
// classifier is a byte-identical copy of lib/order-workspace.mjs, checked in tests.
// Parent boot imports its versioned classifier, then calls OrderWorkspace.install(model).
window.OrderWorkspace = (() => {
  let model, installed=false;
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
    const c=classify(o);
    return `${c.historical?badge('Histórico · sin consulta en vivo','slate'):''}${!c.historical||o.status==='shipped'||o.status==='delivered'||c.cancelled?badge(c.stateLabel,c.tone):''}${c.subtypeLabels.map(label=>badge(label,'amber')).join('')}${c.followup?badge(o.followupStatus,'amber'):''}`;
  }

  function table(list) {
    return `<div class="table-wrap"><table class="ow-orders-table"><thead><tr><th scope="col">Pedido original</th><th scope="col">Marketplace / fecha del pedido en marketplace</th><th scope="col">Producto</th><th scope="col">Estado registrado</th><th scope="col">Importe MXN / pago</th><th scope="col">Ficha</th></tr></thead><tbody>${list.map(o=>{const lines=c28Rows(o),p=product(o.sku);return `<tr><td><button class="row-title" data-order="${esc(o.id)}">${esc(reference(o))}</button>${o.sicar?`<span class="subtext">SICAR ${esc(o.sicar)}</span>`:''}</td><td>${marketTag(o.market)}<span class="subtext">${c28Date(o.documentDate||o.date)}</span></td><td>${esc(lines[0]?.name||p?.name||o.productNames||'Sin partidas verificadas')}<span class="subtext">${lines.length>1?lines.length+' partidas · ':''}${lines.reduce((n,l)=>n+l.qty,0)} unidades${lines.length?'':' · revisar origen'}</span></td><td><div class="ow-status-stack">${statusBadges(o)}</div></td><td class="table-price">${money(D.orderTotal(o))}<span class="subtext ow-payment">${esc(c28Payment(o))}</span></td><td><button class="more-arrow" data-order="${esc(o.id)}" aria-label="Abrir ${esc(reference(o))}">${icon('arrow')}</button></td></tr>`;}).join('')||'<tr><td colspan="6" class="empty">No hay pedidos con estos filtros.</td></tr>'}</tbody></table></div>`;
  }

  function ordersPage() {
    const list=filteredOrders(),pages=Math.max(1,Math.ceil(list.length/50));
    c28.orderPage=Math.max(1,Math.min(c28.orderPage,pages));
    const counts=Object.fromEntries(model.ORDER_TABS.map(tab=>[tab.key,state.orders.filter(o=>model.matchesOrderCategory(o,tab.key,evidence(o))).length]));
    return `<div class="order-workspace">${pageHead('OPERACIÓN / PEDIDOS','Pedidos, de principio a fin.','Venta, pago y seguimiento con sus referencias originales.',`<button class="btn" data-v28="orders-export">${icon('download')} Exportar</button>${primaryNew()}`)}
    <div class="ow-tabs" role="group" aria-label="Estado de pedidos">${model.ORDER_TABS.map(tab=>`<button type="button" class="ow-tab ${statusFilter===tab.key?'is-active':''}" data-ow-category="${tab.key}" aria-pressed="${statusFilter===tab.key}"><span class="ow-tab-icon" aria-hidden="true">${useIcon(tab.icon==='refund'?'salesSettlement':tab.icon)}</span><span>${tab.label}</span><strong>${counts[tab.key]}</strong></button>`).join('')}</div>
    <p class="ow-local-note">Mostramos los estados guardados en el ERP; los estados actuales de VentiApp no se han podido verificar. Los pedidos históricos conservan su origen y no representan una consulta en vivo; «Por preparar» indica aceptación o preparación local pendiente.</p>
    ${MarketUI.chips(marketFilter,state.orders.reduce((a,o)=>(a[o.market]=(a[o.market]||0)+1,a),{}))}
    <div class="filterbar"><label class="field-search">${icon('search')}<input id="order-search" value="${esc(orderQuery)}" aria-label="Filtrar pedidos" placeholder="Pedido, folio SICAR, SKU, UPC o producto…"></label><select id="market-filter" aria-label="Filtrar marketplace"><option value="">Todos los marketplaces</option>${[...new Set([...markets,...state.orders.map(o=>o.market)])].map(m=>`<option ${m===marketFilter?'selected':''}>${esc(m)}</option>`).join('')}</select><button class="btn" data-action="clear-filters">Limpiar</button></div>
    <div class="filterbar c28-small-filters">${ERP.field('c28-order-from','Desde',c28.orderFrom,'date')}${ERP.field('c28-order-to','Hasta',c28.orderTo,'date')}<span class="tiny">Filtro de fecha del pedido en marketplace · ${list.length} resultados · conteos de categorías de todo el espacio</span></div>
    <section class="panel">${table(list.slice((c28.orderPage-1)*50,c28.orderPage*50))}<div class="table-footer"><span>${list.length} ventas · ${datasetNote()}</span><div class="pager"><button class="btn small" data-c28-page="${c28.orderPage-1}" ${c28.orderPage<=1?'disabled':''}>Anterior</button><span>${c28.orderPage} / ${pages}</span><button class="btn small" data-c28-page="${c28.orderPage+1}" ${c28.orderPage>=pages?'disabled':''}>Siguiente</button></div></div></section></div>`;
  }

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
      return scope.filter(o=>model.matchesOrderCategory(o,category,evidence(o)));
    };
    const previousIssues=issues;
    issues=function() {
      const current=previousIssues();
      if(!ERP.ready||!ERP.engines.operations?.buildCalendar) return current;
      const calendar=ERP.engines.operations.buildCalendar(state,ERP.today());
      const expenses=model.expenseIssues(Array.isArray(calendar)?calendar:calendar?.rows||[],ERP.today());
      const keys=new Set(current.filter(i=>i.payment?.kind==='expense').map(i=>i.payment.entityId+'|'+i.payment.number));
      return [...current,...expenses.filter(i=>!keys.has(i.payment.entityId+'|'+i.payment.number))];
    };
    // Preserve the existing target mechanism, extending only real expense rows.
    const previousTarget=window.PaymentAlerts28.issueTarget;
    window.PaymentAlerts28.issueTarget=function(issue) {
      if(issue.payment?.kind==='expense') return `data-op28="detail" data-kind="expense" data-id="${esc(issue.payment.entityId)}"`;
      return previousTarget(issue);
    };
    c28OrdersPage=ordersPage;c28Incidents=incidentsPage;
    renderers.orders=ordersPage;renderers.incidents=incidentsPage;
    document.addEventListener('click',event=>{
      const button=event.target.closest('[data-ow-category]');
      if(!button) return;
      statusFilter=button.dataset.owCategory;c28.orderPage=1;render();
    });
    installed=true;
    resolveReady(api);
    if(ERP.ready&&['orders','incidents'].includes(view)) render();
  }
  const api={issueIdentity:issue=>describeIssue(issue).logo,issueReference:issue=>describeIssue(issue).reference,describeIssue,logoForIssue:issue=>describeIssue(issue).logo,useIcon,install};
  api.ready=ready;
  return api;
})();
