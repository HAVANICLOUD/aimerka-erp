'use strict';

// Alerts are a projection of the current workspace's unpaid installments.
// They neither record payments nor change the existing V28 credit schedule.
window.PaymentAlerts28 = (() => {
  const DAY = 86400000;
  const summary = () => ERP.engines.operations.supplierPaymentAlerts(state, ERP.today());
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  function situation(row) {
    if (!(row.balanceCents > 0)) return {label:'Pagada',tone:'green'};
    if (!row.dueDate) return {label:'Fecha por configurar',tone:'slate'};
    const days = Math.round((Date.parse(row.dueDate+'T00:00:00Z')-Date.parse(ERP.today()+'T00:00:00Z'))/DAY);
    if (days < 0) return {label:'Vencido · '+plural(-days,'día','días'),tone:'red'};
    if (days === 0) return {label:'Vence hoy',tone:'amber'};
    if (days <= 7) return {label:'Vence en '+plural(days,'día','días'),tone:'amber'};
    return {label:'Programada',tone:'blue'};
  }

  function rowBadge(row) {
    const value = situation(row);
    return badge(value.label,value.tone);
  }

  function panel({limit=4}={}) {
    const value = summary();
    const cards = [
      ['overdue','Vencidos',value.overdue,'red','Fecha límite anterior a hoy','alert'],
      ['today','Vencen hoy',value.dueToday,'amber','Pagar a más tardar hoy','clock'],
      ['upcoming','Próximos 7 días',value.upcoming,'blue','Desde mañana hasta '+op28date(value.throughDate),'clock']
    ];
    const rows = value.actionableRows.slice(0,Math.max(0,limit));
    return `<section class="panel payment-alerts" aria-label="Alertas de pagos a proveedores">
      <div class="payment-alerts-head"><div><div class="eyebrow">TESORERÍA · HOY ${op28date(value.today)}</div><h2>Pagos a proveedores</h2><p>Cuotas pendientes de compras del espacio actual. Aviso desde 7 días antes del vencimiento.</p></div><button class="btn small" type="button" data-payment-alert-status="pending">Ver calendario ${icon('arrow')}</button></div>
      <div class="payment-alert-cards">${cards.map(([key,label,group,tone,hint,ic])=>`<button class="payment-alert-card ${group.count?'':'is-empty'}" data-tone="${tone}" type="button" data-payment-alert-status="${key}" aria-label="Ver pagos a proveedores ${label.toLowerCase()}: ${plural(group.count,'cuota','cuotas')}, ${money(group.amountCents)}"><span class="payment-alert-label">${icon(ic)} ${label}</span><strong class="payment-alert-amount">${money(group.amountCents)}</strong><span class="payment-alert-count">${plural(group.count,'cuota','cuotas')} · ${plural(group.purchaseCount,'compra','compras')}</span><span class="payment-alert-hint">${hint}</span></button>`).join('')}</div>
      ${rows.length?`<div class="payment-alert-list">${rows.map(row=>`<div class="payment-alert-row"><div class="payment-alert-main"><strong>${esc(row.entityId)} · ${esc(row.description||'Proveedor por confirmar')}</strong><span class="payment-alert-meta">SICAR ${esc(row.reference||'Sin referencia')} · ${esc(row.instrument||'Sin instrumento')} · Cuota ${row.number}/${row.term}</span><span class="payment-alert-date">${rowBadge(row)} <span>Vencimiento ${op28date(row.dueDate)}</span></span></div><div class="payment-alert-actions"><strong>${money(row.balanceCents)}</strong><button class="btn small" type="button" data-op28="detail" data-kind="purchase" data-id="${esc(row.entityId)}" aria-label="Ver compra ${esc(row.entityId)}">Ver compra ${icon('arrow')}</button></div></div>`).join('')}</div>`:''}
      ${!value.actionableCount?'<p class="payment-alert-empty">No hay cuotas de compras vencidas ni por vencer en los próximos 7 días con las fechas registradas.</p>':''}
      ${limit>0&&value.actionableCount>limit?`<div class="payment-alert-missing"><span>${plural(value.actionableCount,'cuota requiere','cuotas requieren')} atención.</span><button class="btn small" type="button" data-payment-alert-status="attention">Ver todos los avisos</button></div>`:''}
      ${value.missing.count?`<div class="payment-alert-missing"><span>${plural(value.missing.count,'cuota pendiente sin fecha','cuotas pendientes sin fecha')} · ${money(value.missing.amountCents)}. Configura corte y pago del instrumento o una fecha en la compra.</span><button class="btn small" type="button" data-payment-alert-status="missing">Revisar fechas</button></div>`:''}
    </section>`;
  }

  function openCalendar(status) {
    // An alert always opens all matching purchases, even if a previous visit
    // left a different instrument, range, or workspace filter selected.
    op28workspace();
    const allowed=['pending','overdue','today','upcoming','attention','missing'];
    op28filters.calendar={kind:'purchase',status:allowed.includes(status)?status:'pending'};
    op28pages.calendar=1;
    navigate('calendar');
    document.getElementById('op28-calendar-status')?.focus({preventScroll:true});
  }

  function paymentIssues() {
    if (!ERP.ready || !ERP.engines.operations) return [];
    return summary().actionableRows.map(row=>({
      type:'supplier-payment',payment:row,
      title:row.alertKind==='overdue'?'Pago a proveedor vencido':row.alertKind==='today'?'Pago a proveedor vence hoy':'Pago a proveedor por vencer',
      detail:`${row.entityId} · ${row.description||'Proveedor'} · cuota ${row.number}/${row.term} · ${money(row.balanceCents)} · ${situation(row).label}`,
      tone:row.alertKind==='overdue'?'red':'amber'
    }));
  }

  function issueTarget(issue) {
    if (issue.payment) return `data-op28="detail" data-kind="purchase" data-id="${esc(issue.payment.entityId)}"`;
    if (issue.type==='settlement') return `data-c28-recon="${esc(issue.order.id)}"`;
    if (issue.order) return `data-order="${esc(issue.order.id)}"`;
    return `data-product="${esc(issue.product.sku)}"`;
  }

  function updateIndicators() {
    if (!ERP.ready) return;
    const value=summary(),total=value.actionableCount;
    const calendar=document.querySelector('#sidebar [data-view="calendar"]');
    calendar?.querySelector('.payment-count')?.remove();
    if (total && calendar) {
      const counter=document.createElement('span');
      counter.className='nav-count payment-count';counter.textContent=String(total);
      counter.title=plural(total,'cuota de compra requiere','cuotas de compras requieren')+' atención';
      calendar.appendChild(counter);
    }
    const bell=document.querySelector('.notification'),counter=document.getElementById('notification-count');
    if (bell && counter) {
      counter.classList.toggle('has-payment-count',total>0);
      counter.textContent=total>0?(total>99?'99+':String(total)):'';
      bell.setAttribute('aria-label','Ver incidencias y pagos pendientes');
      bell.title=total?`${plural(value.overdue.count,'cuota vencida','cuotas vencidas')} · ${plural(value.dueToday.count,'vence hoy','vencen hoy')} · ${plural(value.upcoming.count,'por vencer','por vencer')}`:'Ver incidencias y pagos pendientes';
    }
  }

  return {summary,panel,badge:rowBadge,openCalendar,issues:paymentIssues,issueTarget,updateIndicators};
})();

const operationalIssues28=issues;
issues=function(){return [...PaymentAlerts28.issues(),...operationalIssues28()];};

let paymentAlertDay=null;
const renderBeforePaymentAlerts28=render;
render=function(){
  renderBeforePaymentAlerts28();
  if (ERP.ready) {PaymentAlerts28.updateIndicators();paymentAlertDay=ERP.today();}
};

function refreshPaymentAlertDay() {
  if (!ERP.ready || ERP.busy || document.hidden || paymentAlertDay===ERP.today()) return;
  // Re-evaluate a tab left open overnight without discarding an in-progress form.
  if (document.getElementById('modal')?.open || !document.getElementById('drawer')?.hidden) return;
  if (document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')) return;
  render();
}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-payment-alert-status]');
  if (button) {PaymentAlerts28.openCalendar(button.dataset.paymentAlertStatus);return;}
  refreshPaymentAlertDay();
});
window.addEventListener('focus',refreshPaymentAlertDay);
document.addEventListener('visibilitychange',refreshPaymentAlertDay);
setInterval(refreshPaymentAlertDay,60000);
