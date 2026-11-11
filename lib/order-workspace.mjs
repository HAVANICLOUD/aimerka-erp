/** Read-only presentation of recorded ERP states. No external status mapping is verified. */
export const ORDER_TABS = Object.freeze([
  {key:'',label:'Todos',icon:'layers'},
  {key:'reserved',label:'Por preparar',icon:'bag'},
  {key:'shipped',label:'Enviados',icon:'truck'},
  {key:'delivered',label:'Entregados',icon:'check'},
  {key:'returns',label:'Devoluciones y reembolsos',icon:'refund'},
  {key:'cancelled',label:'Canceladas',icon:'close'}
].map(Object.freeze));
const value = input => String(input ?? '').trim();
const pendingFollowup = order => ['Pendiente','En seguimiento'].includes(order.followupStatus);

export function orderReference(order = {}) {
  const number = value(order.number) || value(order.literalNumber);
  return number ? (/^pedido\s/i.test(number) ? number : 'Pedido '+number) : 'Pedido sin número registrado';
}

export function classifyOrder(order = {}, evidence = {}) {
  const historical = order.stockMode === 'historical' || order.status === 'historical';
  const cancelled = order.status === 'cancelled' || order.commercialStatus === 'Cancelada';
  const refunded = ['refunded','partially_refunded','Reembolsada'].includes(order.paymentStatus)
    || (Number.isSafeInteger(order.refundCents) && order.refundCents > 0)
    || evidence.documentaryRefund === true || evidence.financialState === 'refunded'
    || !!(order.marketplace34?.trace?.refundMarketplace || order.marketplace34?.trace?.refundSeller);
  const receivingPending = order.returnStatus === 'requested';
  const inspecting = order.returnStatus === 'inspection';
  const returned = ['requested','inspection','restocked','rejected'].includes(order.returnStatus);
  const followup = pendingFollowup(order);
  const incidence = !!value(order.incident) || !!value(order.review) || followup;
  const returns = refunded || returned;
  // Acceptance is unknown for a local reservation; no remote acceptance is inferred.
  const preparing = !historical && !cancelled && !refunded && !returned && ['reserved','pending_acceptance','preparing'].includes(order.status);
  const shipped = !cancelled && !returns && order.status === 'shipped';
  const delivered = !cancelled && !returns && order.status === 'delivered';
  const categories = ['',...(preparing?['reserved']:[]),...(shipped?['shipped']:[]),...(delivered?['delivered']:[]),...(returns?['returns']:[]),...(cancelled?['cancelled']:[])];
  const subtypes = [...(refunded?['refunded']:[]),...(receivingPending?['receivingPending']:[]),...(inspecting?['inspection']:[]),...(incidence?['incidence']:[]),...(['restocked','rejected'].includes(order.returnStatus)?[order.returnStatus]:[])];
  const stateLabel = cancelled ? 'Cancelada' : preparing ? 'Pendiente de aceptación / preparación local' : order.status === 'shipped' ? 'Enviado · registrado en ERP' : order.status === 'delivered' ? 'Entregado · registrado en ERP' : historical ? 'Estado operativo no confirmado' : 'Estado operativo por confirmar';
  return {historical,cancelled,refunded,receivingPending,inspecting,followup,incidence,returns,preparing,shipped,delivered,categories,subtypes,
    stateLabel,tone:cancelled||historical?'slate':preparing?'amber':delivered?'green':shipped?'blue':'slate',
    subtypeLabels:[...(refunded?[order.paymentStatus==='partially_refunded'?'Reembolso parcial registrado':'Reembolsada']:[]),...(receivingPending?['Pendiente de recibir']:[]),...(inspecting?['En inspección']:[]),...(incidence?['Incidencia / seguimiento']:[]),...(order.returnStatus==='restocked'?['Reintegrada']:[]),...(order.returnStatus==='rejected'?['No vendible']:[])]};
}

export function matchesOrderCategory(order, category = '', evidence = {}) {
  const c = classifyOrder(order,evidence);
  if(category === 'pending') return c.followup; // Existing dashboard shortcut.
  if(category === 'issues') return c.incidence;
  if(category === 'historical') return c.historical; // Old deep links only; no primary tab.
  return c.categories.includes(category);
}

/** Uses only real calendar expense installments with a known positive balance and date. */
export function expenseIssues(rows = [], today) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(today||'')) return [];
  const day = Date.parse(today+'T00:00:00Z');
  if(!Number.isFinite(day) || new Date(day).toISOString().slice(0,10)!==today) return [];
  return rows.filter(row => {
    if(row.kind!=='expense'||!row.entityId||!Number.isSafeInteger(row.balanceCents)||row.balanceCents<=0||!/^\d{4}-\d{2}-\d{2}$/.test(row.dueDate||'')) return false;
    const due=Date.parse(row.dueDate+'T00:00:00Z');
    return Number.isFinite(due)&&new Date(due).toISOString().slice(0,10)===row.dueDate&&(due-day)/86400000<=7;
  }).map(row=>({...row})).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||String(a.entityId).localeCompare(String(b.entityId))||a.number-b.number).map(row=>({
    type:'expense-payment',payment:row,title:row.dueDate<today?'Gasto vencido':row.dueDate===today?'Gasto vence hoy':'Gasto por vencer',
    detail:row.description||'Gasto registrado',tone:row.dueDate<today?'red':'amber'
  }));
}
