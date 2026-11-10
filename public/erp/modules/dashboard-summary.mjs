/** Dashboard projection of EstadisticasERP.Resumen. Money remains integer centavos.
 * Sales use the selected basis; cancellations and refunds use their own event dates.
 * The workbook's six columns remain separate: no cancellation subtraction from active gross.
 */
import {dateOnly, mexicoToday, periodBounds, salesStatistics} from './operations-v28.mjs';
import {orderTotal} from './inventory-v28.mjs';

const id = value => String(value ?? '').trim();
const fullRefund = order => ['refunded','Reembolsada'].includes(order.paymentStatus);
const cancelled = order => order.commercialStatus ? order.commercialStatus === 'Cancelada' : order.status === 'cancelled';
const unique = (rows, key) => {
  const seen = new Set();
  return rows.filter(row => { const k=key(row); if (!k) return true; if (seen.has(k)) return false; seen.add(k); return true; });
};

export function dashboardPeriod(mode='month', anchor=mexicoToday()) {
  if (!['year','month','week','day'].includes(mode)) throw new Error('Periodo inválido.');
  return {mode, anchor:dateOnly(anchor), ...periodBounds(mode,anchor)};
}

function normalizedState(state) {
  // Identity is the ERP order / movement ID, never marketplace order number: split
  // payments can legitimately have the same number, date and amount.
  const orders=unique(state.orders||[],o=>id(o.id)).map(o=>({...o,id:id(o.id)}));
  const orderMap=new Map(orders.filter(o=>o.id).map(o=>[o.id,o]));
  const movements=unique(state.sicarMovements||[],m=>id(m.id)).map(m=>({...m,orderId:id(m.orderId),market:m.market||orderMap.get(id(m.orderId))?.market}));
  const refundIds=new Set(movements.filter(m=>m.type==='REEMBOLSO'&&m.orderId).map(m=>m.orderId));
  const excludedNegativeOrders=orders.filter(o=>orderTotal(o)<0).length;
  return {orders:orders.filter(o=>orderTotal(o)>=0).map(o=>{
    const hasRefund=fullRefund(o)||o.paymentStatus==='partially_refunded'||refundIds.has(o.id)||dateOnly(o.refundedAt||o.refundDate);
    return {...o,totalCents:orderTotal(o),
      // Excel excludes refunded Liverpool cancellations; other markets retain
      // independent cancellation/refund series, which may overlap.
      cancelledAt:o.market==='Liverpool'&&hasRefund?null:(o.cancelledAt||o.cancelDate),
      refundedAt:o.refundedAt||o.refundDate,
      // Excel fallback is fully refunded only. Partial money requires a SICAR
      // event; it cannot silently become a full-order refund.
      paymentStatus:o.paymentStatus==='partially_refunded'?'unknown':o.paymentStatus};
  }),sicarMovements:movements,excludedNegativeOrders};
}

export function dashboardYears(state, today=mexicoToday()) {
  const years=new Set([Number(dateOnly(today)?.slice(0,4))]);
  for (const o of state.orders||[]) for (const value of [o.documentDate,o.creationDate,o.date,o.cancelledAt,o.cancelDate,o.refundedAt,o.refundDate]) {
    const day=dateOnly(value); if(day) years.add(Number(day.slice(0,4)));
  }
  for (const m of state.sicarMovements||[]) {const day=dateOnly(m.date);if(day)years.add(Number(day.slice(0,4)));}
  return [...years].filter(Number.isFinite).sort((a,b)=>b-a);
}

export function dashboardSummary(state, options={}) {
  const period=dashboardPeriod(options.mode||'month',options.anchor||mexicoToday());
  const basis=['creation','Creacion'].includes(options.basis)?'Creacion':'Documento';
  const normalized=normalizedState(state);
  const summary=salesStatistics(normalized,{from:period.from,to:period.to,basis});
  const orders=new Map(normalized.orders.filter(o=>o.id).map(o=>[o.id,o]));
  // Refunds of a cancelled order are already absent from active gross. Display
  // them, but never subtract them a second time in the commercial balance.
  const buckets=new Map();
  for(const row of summary.markets)buckets.set(row.market,{...row,refundOnActiveCents:0,refundOnCancelledCents:0,unlinkedRefundCents:0});
  const classify=(market,order,amount)=>{
    const row=buckets.get(market);if(!row)return;
    const key=!order?'unlinkedRefundCents':cancelled(order)?'refundOnCancelledCents':'refundOnActiveCents';
    row[key]+=amount;
  };
  for(const m of normalized.sicarMovements) if(m.type==='REEMBOLSO'){
    const date=dateOnly(m.date);
    if(date&&date>=period.from&&date<=period.to)classify(m.market,orders.get(m.orderId),Math.abs(m.amountCents||0));
  }
  const linked=new Set(normalized.sicarMovements.filter(m=>m.type==='REEMBOLSO'&&m.orderId).map(m=>m.orderId));
  for(const o of normalized.orders) if(fullRefund(o)&&!linked.has(o.id)) {
    const date=dateOnly(o.refundedAt);
    if(date&&date>=period.from&&date<=period.to)classify(o.market,o,Number.isSafeInteger(o.refundCents)&&o.refundCents>0?o.refundCents:o.totalCents);
  }
  const markets=[...buckets.values()].map(row=>({...row,netCommercialCents:row.activeGrossCents-row.refundOnActiveCents}));
  const sum=key=>markets.reduce((n,row)=>n+row[key],0);
  return {...summary,period,basis,markets,netCommercialCents:sum('netCommercialCents'),refundOnActiveCents:sum('refundOnActiveCents'),
    refundOnCancelledCents:sum('refundOnCancelledCents'),unlinkedRefundCents:sum('unlinkedRefundCents'),
    excludedNegativeOrders:normalized.excludedNegativeOrders,years:dashboardYears(state,options.today||mexicoToday())};
}
