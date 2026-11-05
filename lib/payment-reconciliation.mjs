import {compareV43,documentaryNetCents,pendingBalanceCents} from './settlement-documents.mjs';
import {estimateOrder,isCancelled} from './reconciliation-v28.mjs';

const present=n=>typeof n==='number'&&Number.isFinite(n);
const cents=n=>Math.round((n+Number.EPSILON)*100);
export const isT1=o=>['Sears','Sanborns'].includes(o.market);
export function saleDate(o){return String(o.documentDate||o.marketplace34?.trace?.creation||o.date||o.creationDate||'').slice(0,19);}
export function newestSales(orders){return [...orders].sort((a,b)=>saleDate(b).localeCompare(saleDate(a))||String(b.creationDate||b.date||'').localeCompare(String(a.creationDate||a.date||''))||String(b.id).localeCompare(String(a.id),undefined,{numeric:true}));}
export function financialState(o){
 const trace=o.marketplace34?.trace||{};
 if(o.paymentStatus==='refunded'||o.paymentStatus==='partially_refunded'||o.refundCents>0||trace.refundMarketplace||trace.refundSeller)return 'refunded';
 if(isCancelled(o)||trace.cancelMarketplace||trace.cancelSeller)return 'cancelled';
 return 'active';
}
/** A bank credit proves the net payment, not its tax/fee breakdown. No drafts or calculator rates become real commissions. */
export function commissionEvidence(o,state){
 if(!isT1(o))return {amountCents:null,rate:null,quality:'unknown',label:'Sin desglose del market',note:'El depósito por sí solo no identifica la comisión; falta el documento con deducciones.'};
 const related=(state.settlementLedger?.cheques||[]).filter(c=>c.lines.some(l=>l.orderId===o.id)),lines=related.flatMap(c=>c.lines).filter(l=>l.orderId===o.id),lp=lines.filter(l=>['LP','NT'].includes(l.code)&&l.amountCents>0),np=lines.filter(l=>l.code==='NP'&&l.amountCents>0);
 const gross=o.totalCents,adjustments=lines.filter(l=>['SI','SV'].includes(l.code)).reduce((sum,l)=>sum+l.amountCents,0);
 if(!gross||(!lp.length&&!np.length)||lp.length&&np.length)return {amountCents:null,rate:null,quality:'unknown',label:'Sin documento de pago',note:'La tarifa configurada se muestra únicamente como estimación.'};
 if(lp.length){const amountCents=gross-lp.reduce((s,l)=>s+l.amountCents,0)-adjustments;if(amountCents<0||amountCents>gross)return {amountCents:null,rate:null,quality:'unknown',label:'Revisar ajustes',note:'El pago contiene ajustes que impiden aislar la comisión.'};return {amountCents,rate:amountCents/gross,quality:'documentary',label:'Inferida del pago LP',note:'Venta bruta menos pago original LP, antes de la retención CR/DR. En devoluciones conserva la comisión del pago original.'};}
 // NP is already net. Preserve the historical withholding snapshot instead of applying today's calculator rates.
 const separateTax=related.some(c=>c.lines.some(l=>['CR','DR'].includes(l.code))),documented=separateTax||present(o.t1Source?.withholdingMxn),retention=separateTax?0:documented?o.t1Source.withholdingMxn:o.v43Comparison?.retentionMxn;
 if(!present(retention))return {amountCents:null,rate:null,quality:'unknown',label:'Retención sin identificar',note:'El NP es neto; falta separar retención y comisión.'};
 const amountCents=gross-np.reduce((s,l)=>s+l.amountCents,0)-adjustments-cents(retention);
 if(amountCents<0||amountCents>gross)return {amountCents:null,rate:null,quality:'unknown',label:'Revisar ajustes',note:'No se atribuye una devolución o ajuste a la comisión.'};
 return {amountCents,rate:amountCents/gross,quality:documented?'documentary':'estimated-tax',label:documented?'Inferida del pago NP':'Inferida · retención estimada',note:separateTax?'Comisión del NP original antes de la retención CR/DR separada. No se descuenta la retención dos veces.':documented?'NP neto más retención documental; no se descuenta la retención dos veces.':'NP neto más retención estimada conservada del Excel. Porcentaje preliminar hasta contar con el desglose fiscal; el banco confirma únicamente el neto.'};
}
export function paymentRow(o,state){
 const documentaryT1=isT1(o)&&!!state.settlementLedger,status=financialState(o),deposit=o.reconciliation?.depositCents??null;let estimate=null,error=null,realProfit=null,expectedRate=null;
 if(documentaryT1){
  const calc=compareV43(o,state.products,state.config);expectedRate=calc.commissionRate;
  estimate={netCents:status==='cancelled'?0:cents(calc.expectedNet),profitCents:status==='cancelled'?0:calc.expectedProfit==null?null:cents(calc.expectedProfit),commissionCents:cents(calc.commission),vatCents:cents(calc.vat),incomeCents:cents(calc.isr),costCents:calc.cost==null?null:cents(calc.cost),externalShippingCents:calc.shipping==null?null:cents(calc.shipping),shippingCents:0};
  realProfit=status==='active'&&present(calc.realProfit)?cents(calc.realProfit):null;
 }else{
  if(status==='cancelled')estimate={grossCents:o.totalCents,netCents:0,profitCents:0,commissionCents:0,vatCents:0,incomeCents:0,costCents:null,externalShippingCents:null,shippingCents:0};
  else try{estimate=o.reconciliation?.estimate||estimateOrder(o,state.products,state.config);expectedRate=estimate.grossCents?estimate.commissionCents/estimate.grossCents:null;}catch(e){error=e.message;}
  if(present(deposit)&&status==='active'&&present(estimate?.costCents)&&present(estimate?.externalShippingCents))realProfit=deposit-estimate.costCents-estimate.externalShippingCents;
 }
 const confirmed=o.reconciliation?.status==='Conciliada',documentary=documentaryT1?documentaryNetCents(o):null;
 const pending=status!=='active'||confirmed?0:documentaryT1?pendingBalanceCents(o,state.products,state.config):present(estimate?.netCents)?Math.max(0,estimate.netCents-(deposit||0)):null;
 return {order:o,date:saleDate(o),financialState:status,estimate,error,expectedRate,actualCommission:commissionEvidence(o,state),depositCents:deposit,documentaryCents:documentary,realProfitCents:realProfit,pendingCents:pending,confirmed,statusLabel:confirmed?'Conciliada':status==='refunded'?'Reembolsada · revisar débitos':status==='cancelled'?'Cancelada':o.reconciliation?.status==='Conciliación parcial'?'Conciliación parcial':present(deposit)?'Depósito registrado':'Pendiente de pago'};
}
export function paymentRows(state,filter={}){
 return newestSales(state.orders.filter(o=>{
  const day=saleDate(o).slice(0,10),text=[o.id,o.number,o.sicar,o.productNames,o.t1Source?.cheques,...(o.items||[]).map(i=>[i.name,i.sku,i.upc].join(' '))].join(' ').toLowerCase();
  return (!filter.market||filter.market==='all'||o.market===filter.market)&&(!filter.from||day>=filter.from)&&(!filter.to||day<=filter.to)&&(!filter.query||text.includes(filter.query.toLowerCase()));
 })).map(o=>paymentRow(o,state)).filter(r=>!filter.status||filter.status==='all'||filter.status==='confirmed'&&r.confirmed||filter.status==='cancelled'&&r.financialState==='cancelled'||filter.status==='refunded'&&r.financialState==='refunded'||filter.status==='pending'&&r.financialState==='active'&&!r.confirmed);
}
export function paymentSummary(rows){
 const s={count:rows.length,grossCents:0,effectiveCents:0,cancelledCount:0,cancelledCents:0,refundedCount:0,refundedCents:0,estimatedCents:0,estimateCount:0,estimatedProfitCents:0,estimatedProfitCount:0,depositCents:0,depositCount:0,realProfitCents:0,realProfitCount:0,documentaryCents:0,documentaryCount:0,differenceCents:0,comparisonCount:0,pendingCents:0,pendingCount:0,pendingUnknown:0,confirmedCount:0};
 for(const r of rows){const o=r.order;s.grossCents+=o.totalCents||0;
  if(r.financialState==='cancelled'){s.cancelledCount++;s.cancelledCents+=o.totalCents||0;}else if(r.financialState==='refunded'){s.refundedCount++;s.refundedCents+=present(o.refundCents)?o.refundCents:o.totalCents||0;}else s.effectiveCents+=o.totalCents||0;
  if(r.estimate){s.estimatedCents+=r.estimate.netCents;s.estimateCount++;if(present(r.estimate.profitCents)){s.estimatedProfitCents+=r.estimate.profitCents;s.estimatedProfitCount++;}}
  if(present(r.depositCents)){s.depositCents+=r.depositCents;s.depositCount++;if(present(r.realProfitCents)){s.realProfitCents+=r.realProfitCents;s.realProfitCount++;}if(r.estimate){s.differenceCents+=r.depositCents-r.estimate.netCents;s.comparisonCount++;}}
  if(present(r.documentaryCents)){s.documentaryCents+=r.documentaryCents;s.documentaryCount++;}
  if(r.confirmed)s.confirmedCount++;
  if(r.financialState==='active'&&!r.confirmed){s.pendingCount++;if(present(r.pendingCents))s.pendingCents+=r.pendingCents;else s.pendingUnknown++;}
 }
 return s;
}
