import {orderGrossValidation} from './order-gross-validation.mjs?v=20261124-promotions';
import {compareV43,documentaryNetCents,pendingBalanceCents} from './settlement-documents.mjs?v=20261120-t1-current14';
import {estimateOrder,isCancelled} from './reconciliation-v28.mjs?v=20261120-t1-current14';
import {orderCertificateEvidence} from './retention-certificates.mjs';

const present=n=>typeof n==='number'&&Number.isFinite(n);
const cents=n=>Math.round((n+Number.EPSILON)*100);
export const isT1=o=>['Sears','Sanborns'].includes(o.market);
export function paymentDate(value){
 const raw=String(value??'').trim();
 if(/^\d{5}(?:\.\d+)?$/.test(raw)){const serial=Number(raw);if(serial>=36526&&serial<73416)return new Date(Date.UTC(1899,11,30)+Math.round(serial*86400)*1000).toISOString().slice(0,19);}
 const match=raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|\s|$)/);if(!match)return '';
 const [year,month,day]=match.slice(1).map(Number),date=new Date(Date.UTC(year,month-1,day));
 if(year<2000||year>2100||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return '';
 if(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)){const instant=new Date(raw);if(!Number.isFinite(instant.getTime()))return '';const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(instant).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;}
 return raw.replace(' ','T');
}
export function saleDate(o){return (paymentDate(o.documentDate)||paymentDate(o.creationDate)||paymentDate(o.marketplace34?.trace?.creation)||paymentDate(o.date)).slice(0,19);}
export function documentMovement(line){
 const code=String(line.code||'').toUpperCase(),amount=line.amountCents;
 if(['LP','NP','NT'].includes(code)&&amount>0)return {kind:'payment',label:'Pago de la venta',description:'Pago original documentado por el marketplace.'};
 if(['LD','ND'].includes(code)&&amount<0)return {kind:'refund',label:'Débito por reembolso',description:'Descuento por devolución o reembolso de esta venta.'};
 if(code==='SI'&&amount>0)return {kind:'compensation-credit',label:'Compensación a favor',description:'Completa un pago anterior insuficiente; suma saldo a favor de la venta.'};
 if(code==='SV'&&amount<0)return {kind:'compensation-debit',label:'Compensación en contra',description:'Descuenta un exceso de pago anterior; no implica reembolso.'};
 if(['CR','DR'].includes(code))return {kind:'tax',label:'Retención / ajuste fiscal',description:'Se distribuye según las bases documentales. No representa un reembolso de la venta.'};
 return {kind:'review',label:'Movimiento por revisar',description:'La nomenclatura o el signo requiere revisión documental.'};
}
/** Classification is per sale and per line, never by cheque count or the total sign of a multi-sale cheque. */
export function paymentDocuments(o,state){
 return [...(state?.settlementLedger?.cheques||[])].sort((a,b)=>String(a.date).localeCompare(String(b.date))).flatMap(cheque=>{
  const lines=cheque.lines.filter(l=>l.orderId===o.id);if(!lines.length)return [];
  const parts=lines.map(line=>({...line,...documentMovement(line)})),directCents=lines.reduce((sum,l)=>sum+l.amountCents,0),netCents=cheque.allocations?.[o.id]??null;
  return [{cheque,parts,directCents,netCents,taxAdjustmentCents:netCents==null?null:netCents-directCents,hasRefund:parts.some(p=>p.kind==='refund'),hasCompensation:parts.some(p=>p.kind.startsWith('compensation-'))}];
 });
}
export function newestSales(orders){return [...orders].sort((a,b)=>saleDate(b).localeCompare(saleDate(a))||paymentDate(b.date).localeCompare(paymentDate(a.date))||String(b.id).localeCompare(String(a.id),undefined,{numeric:true}));}
export function financialState(o,state){
 const trace=o.marketplace34?.trace||{};
 if(o.paymentStatus==='refunded'||o.paymentStatus==='partially_refunded'||o.refundCents>0||trace.refundMarketplace||trace.refundSeller||paymentDocuments(o,state).some(d=>d.hasRefund))return 'refunded';
 if(isCancelled(o)||trace.cancelMarketplace||trace.cancelSeller)return 'cancelled';
 return 'active';
}
/** A bank credit proves the net payment, not its tax/fee breakdown. No drafts or calculator rates become real commissions. */
export function commissionEvidence(o,state){
 const grossCheck=orderGrossValidation(o);if(grossCheck.mismatch)return {amountCents:null,rate:null,quality:'gross-mismatch',label:'Venta bruta diferente · comisión por revisar',note:'El importe del ERP difiere del marketplace. La conciliación bancaria se conserva; no se atribuye esta diferencia a una comisión.'};
 const r=o.reconciliation,m=r?.confirmationSource==='manual'?r.manual:null;
 if(m){const tax=m.withholdingCents??m.estimateSnapshot?.retentionCents;if(tax==null||m.shippingCents==null)return {amountCents:null,rate:null,quality:'unknown',label:'Desglose manual incompleto',note:'Falta separar retenciones o envío descontado para inferir la comisión.'};const amountCents=o.totalCents-m.amountCents-tax-m.shippingCents;if(amountCents<0||amountCents>o.totalCents||!m.complete)return {amountCents:null,rate:null,quality:'unknown',label:'Pago parcial o ajustes por revisar',note:'El depósito no permite aislar una comisión válida.'};return {amountCents,rate:o.totalCents?amountCents/o.totalCents:null,quality:m.withholdingCents==null?'estimated-tax':'manual',label:m.withholdingCents==null?'Inferida · retención estimada':'Inferida · datos declarados',note:'Venta menos depósito, retenciones y envío descontado declarados. Sin verificación bancaria ni fiscal.'};}

 if(!isT1(o))return {amountCents:null,rate:null,quality:'unknown',label:'Sin desglose del market',note:'El depósito por sí solo no identifica la comisión; falta el documento con deducciones.'};
 const related=(state.settlementLedger?.cheques||[]).filter(c=>c.lines.some(l=>l.orderId===o.id)),lines=related.flatMap(c=>c.lines).filter(l=>l.orderId===o.id),lp=lines.filter(l=>['LP','NT'].includes(l.code)&&l.amountCents>0),np=lines.filter(l=>l.code==='NP'&&l.amountCents>0);
 const gross=o.totalCents,adjustments=lines.filter(l=>['SI','SV'].includes(l.code)).reduce((sum,l)=>sum+l.amountCents,0);
 if(!gross||(!lp.length&&!np.length)||lp.length&&np.length)return {amountCents:null,rate:null,quality:'unknown',label:'Sin documento de pago',note:'La tarifa configurada se muestra únicamente como estimación.'};
 if(lp.length){const amountCents=gross-lp.reduce((s,l)=>s+l.amountCents,0)-adjustments;if(amountCents<0||amountCents>gross)return {amountCents:null,rate:null,quality:'unknown',label:'Revisar ajustes',note:'El pago contiene ajustes que impiden aislar la comisión.'};return {amountCents,rate:amountCents/gross,quality:'documentary',label:'Inferida del pago LP',note:'Venta bruta menos pago original LP, antes de la retención CR/DR. En devoluciones conserva la comisión del pago original.'};}
 const fiscal=orderCertificateEvidence(o,state),originalCheques=related.filter(c=>c.lines.some(l=>l.orderId===o.id&&l.code==='NP'&&l.amountCents>0));
 const fiscalParts=originalCheques.map(c=>({cheque:c,part:fiscal.find(e=>e.certificate.chequeIds.includes(c.id))?.certificate.allocations?.[c.id]?.[o.id]}));
 if(fiscalParts.length&&fiscalParts.every(p=>present(p.part?.retentionCents))){
  const includedTax=fiscalParts.filter(p=>!p.cheque.lines.some(l=>['CR','DR'].includes(l.code))).reduce((s,p)=>s+p.part.retentionCents,0),amountCents=gross-np.reduce((s,l)=>s+l.amountCents,0)-adjustments-includedTax;
  if(amountCents>=0&&amountCents<=gross)return {amountCents,rate:amountCents/gross,quality:'certificate-allocation',label:'Inferida · retención SAT distribuida',note:'NP y retenciones del certificado asociado. La distribución por venta no es un CFDI individual; CR/DR separado no se descuenta dos veces.'};
 }
 // NP is already net. Preserve the historical withholding snapshot instead of applying today's calculator rates.
 const separateTax=related.some(c=>c.lines.some(l=>['CR','DR'].includes(l.code))),documented=separateTax||present(o.t1Source?.withholdingMxn),retention=separateTax?0:documented?o.t1Source.withholdingMxn:o.v43Comparison?.retentionMxn;
 if(!present(retention))return {amountCents:null,rate:null,quality:'unknown',label:'Retención sin identificar',note:'El NP es neto; falta separar retención y comisión.'};
 const amountCents=gross-np.reduce((s,l)=>s+l.amountCents,0)-adjustments-cents(retention);
 if(amountCents<0||amountCents>gross)return {amountCents:null,rate:null,quality:'unknown',label:'Revisar ajustes',note:'No se atribuye una devolución o ajuste a la comisión.'};
 return {amountCents,rate:amountCents/gross,quality:documented?'documentary':'estimated-tax',label:documented?'Inferida del pago NP':'Inferida · retención estimada',note:separateTax?'Comisión del NP original antes de la retención CR/DR separada. No se descuenta la retención dos veces.':documented?'NP neto más retención documental; no se descuenta la retención dos veces.':'NP neto más retención estimada conservada del Excel. Porcentaje preliminar hasta contar con el desglose fiscal; el banco confirma únicamente el neto.'};
}
export function paymentRow(o,state){
 const fiscalEvidence=orderCertificateEvidence(o,state);
 const documents=paymentDocuments(o,state),documentaryRefund=documents.some(d=>d.hasRefund),compensations=documents.flatMap(d=>d.parts).filter(p=>p.kind.startsWith('compensation-'));
 const documentaryT1=isT1(o)&&!!state.settlementLedger,status=financialState(o,state),deposit=o.reconciliation?.depositCents??null;let estimate=null,error=null,realProfit=null,expectedRate=null;
 if(documentaryT1){
  const calc=compareV43(o,state.products,state.config);expectedRate=calc.commissionRate;
  estimate={netCents:status!=='active'?0:cents(calc.expectedNet),profitCents:status==='refunded'?null:status==='cancelled'?0:calc.expectedProfit==null?null:cents(calc.expectedProfit),commissionCents:cents(calc.commission),vatCents:cents(calc.vat),incomeCents:cents(calc.isr),costCents:calc.cost==null?null:cents(calc.cost),externalShippingCents:calc.shipping==null?null:cents(calc.shipping),shippingCents:0};
  realProfit=status==='active'&&present(calc.realProfit)?cents(calc.realProfit):null;
 }else{
  if(status==='cancelled')estimate={grossCents:o.totalCents,netCents:0,profitCents:0,commissionCents:0,vatCents:0,incomeCents:0,costCents:null,externalShippingCents:null,shippingCents:0};
  else try{estimate=o.reconciliation?.estimate||estimateOrder(o,state.products,state.config);expectedRate=estimate.grossCents?estimate.commissionCents/estimate.grossCents:null;}catch(e){error=e.message;}
  if(present(deposit)&&status==='active'&&present(estimate?.costCents)&&present(estimate?.externalShippingCents))realProfit=deposit-estimate.costCents-estimate.externalShippingCents;
 }
 const confirmed=['Conciliada','Conciliada manualmente'].includes(o.reconciliation?.status),manual=o.reconciliation?.confirmationSource==='manual',documentary=documentaryT1?documentaryNetCents(o):null;
 const pending=status!=='active'||confirmed?0:documentaryT1?pendingBalanceCents(o,state.products,state.config):present(estimate?.netCents)?Math.max(0,estimate.netCents-(deposit||0)):null;
 return {order:o,grossValidation:orderGrossValidation(o),fiscalEvidence,date:saleDate(o),creationDate:paymentDate(o.creationDate)||paymentDate(o.marketplace34?.trace?.creation),documentDate:paymentDate(o.documentDate),dateLabel:paymentDate(o.documentDate)?'Fecha del pedido en marketplace':paymentDate(o.creationDate)?'Creación · sin fecha del pedido en marketplace':paymentDate(o.marketplace34?.trace?.creation)?'Creación en marketplace · sin fecha del pedido en marketplace':'Registro · sin fecha del pedido en marketplace',documents,documentaryRefund,compensations,financialState:status,estimate,error,expectedRate,actualCommission:commissionEvidence(o,state),depositCents:deposit,documentaryCents:documentary,realProfitCents:realProfit,pendingCents:pending,confirmed,manual,unpaid:status==='active'&&!confirmed&&(deposit==null||deposit===0),statusLabel:manual?o.reconciliation.status:confirmed?(status==='refunded'?'Conciliada · Reembolsada':'Conciliada'):status==='refunded'?'Reembolsada · cotejo pendiente':status==='cancelled'?'Cancelada':o.reconciliation?.status==='Conciliación parcial'?'Conciliación parcial':present(deposit)?'Depósito registrado':'Pendiente de pago'};
}
export function paymentRetention(r){
 const parts=(r.fiscalEvidence||[]).flatMap(e=>e.parts).filter(p=>present(p.retentionCents));
 if(parts.length){const covered=new Set(parts.map(p=>p.chequeId)),missing=r.documents.filter(d=>d.parts.some(p=>['LP','NP','NT','LD','ND'].includes(p.code))&&!covered.has(d.cheque.id));return {amountCents:parts.reduce((s,p)=>s+p.retentionCents,0),vatCents:parts.reduce((s,p)=>s+p.vatCents,0),isrCents:parts.reduce((s,p)=>s+p.isrCents,0),baseCents:parts.reduce((s,p)=>s+p.baseCents,0),quality:'certificate-allocation',partial:missing.length>0,label:missing.length?'Retención SAT · cobertura parcial':'Retención SAT · distribuida del cheque'};}
 const m=r.manual?r.order.reconciliation?.manual:null;if(m)return {amountCents:m.withholdingCents??m.estimateSnapshot?.retentionCents??null,label:m.withholdingCents==null?'Retención estimada · registro manual':'Retención declarada manualmente'};
 const taxDocs=r.documents.filter(d=>d.taxAdjustmentCents!==0&&d.taxAdjustmentCents!=null);if(taxDocs.length)return {amountCents:-taxDocs.reduce((s,d)=>s+d.taxAdjustmentCents,0),label:'Retención / ajuste documental neto'};
 if(present(r.order.t1Source?.withholdingMxn))return {amountCents:cents(r.order.t1Source.withholdingMxn),label:'Retención documental'};
 return {amountCents:r.order.v43Comparison?.retentionMxn!=null?cents(r.order.v43Comparison.retentionMxn):r.estimate?r.estimate.vatCents+r.estimate.incomeCents:null,label:'Retención estimada · sin desglose fiscal'};
}
/** Differences require a completed, active payment. Unpaid/partial sales are balances, not shortages. */
export function paymentDifference(r){return !r.grossValidation?.mismatch&&r.confirmed&&r.financialState==='active'&&present(r.depositCents)&&present(r.estimate?.netCents)?r.depositCents-r.estimate.netCents:null;}
function latestBankPaidSales(state){
 const latest=new Map();for(const o of state.orders){const r=o.reconciliation;if(r?.status!=='Conciliada'||!r.bankProofIds?.length||!(r.depositCents>0)||financialState(o,state)!=='active')continue;const date=saleDate(o).slice(0,10);if(date&&date>(latest.get(o.market)?.date||''))latest.set(o.market,{id:o.id,number:o.number,date});}return latest;
}
export function paymentRows(state,filter={}){
 const latest=latestBankPaidSales(state);
 return newestSales(state.orders.filter(o=>{
  const day=saleDate(o).slice(0,10),text=[o.id,o.number,o.sicar,o.productNames,o.t1Source?.cheques,...(o.items||[]).map(i=>[i.name,i.sku,i.upc].join(' '))].join(' ').toLowerCase();
  return (!filter.market||filter.market==='all'||o.market===filter.market)&&(!filter.from||day>=filter.from)&&(!filter.to||day<=filter.to)&&(!filter.query||text.includes(filter.query.toLowerCase()));
 })).map(o=>{const r=paymentRow(o,state),paid=latest.get(o.market);r.paymentDifferenceCents=paymentDifference(r);r.laterPaidSale=r.unpaid&&r.date&&paid&&paid.date>r.date.slice(0,10)?paid:null;return r;}).filter(r=>!filter.status||filter.status==='all'||filter.status==='unpaid'&&r.unpaid||filter.status==='older-unpaid'&&r.laterPaidSale||filter.status==='favorable'&&r.paymentDifferenceCents>0||filter.status==='shortfall'&&r.paymentDifferenceCents<0||filter.status==='confirmed'&&r.confirmed||filter.status==='cancelled'&&r.financialState==='cancelled'||filter.status==='refunded'&&r.financialState==='refunded'||filter.status==='compensated'&&r.compensations.length>0||filter.status==='pending'&&r.financialState==='active'&&!r.confirmed);
}
export function paymentSummary(rows){
 const s={count:rows.length,grossCents:0,effectiveCents:0,cancelledCount:0,cancelledCents:0,refundedCount:0,refundedCents:0,estimatedCents:0,estimateCount:0,estimatedProfitCents:0,estimatedProfitCount:0,depositCents:0,depositCount:0,realProfitCents:0,realProfitCount:0,documentaryCents:0,documentaryCount:0,differenceCents:0,comparisonCount:0,comparableEstimatedCents:0,comparableReceivedCents:0,favorableCents:0,favorableCount:0,shortfallCents:0,shortfallCount:0,roundingShortfallCount:0,partialCount:0,unpaidCount:0,unpaidEstimatedCents:0,olderUnpaidCount:0,olderUnpaidEstimatedCents:0,pendingCents:0,pendingCount:0,pendingUnknown:0,confirmedCount:0,manualCount:0};
 for(const r of rows){const o=r.order;s.grossCents+=o.totalCents||0;
  if(r.financialState==='cancelled'){s.cancelledCount++;s.cancelledCents+=o.totalCents||0;}else if(r.financialState==='refunded'){s.refundedCount++;s.refundedCents+=present(o.refundCents)?o.refundCents:o.totalCents||0;}else s.effectiveCents+=o.totalCents||0;
  if(r.estimate){s.estimatedCents+=r.estimate.netCents;s.estimateCount++;if(present(r.estimate.profitCents)){s.estimatedProfitCents+=r.estimate.profitCents;s.estimatedProfitCount++;}}
  if(present(r.depositCents)){s.depositCents+=r.depositCents;s.depositCount++;if(present(r.realProfitCents)){s.realProfitCents+=r.realProfitCents;s.realProfitCount++;}}
  const difference=paymentDifference(r);if(difference!=null){s.differenceCents+=difference;s.comparisonCount++;s.comparableEstimatedCents+=r.estimate.netCents;s.comparableReceivedCents+=r.depositCents;if(difference>0){s.favorableCents+=difference;s.favorableCount++;}if(difference<0){s.shortfallCents-=difference;s.shortfallCount++;if(difference===-1)s.roundingShortfallCount++;}}
  if(r.unpaid){s.unpaidCount++;if(present(r.estimate?.netCents))s.unpaidEstimatedCents+=r.estimate.netCents;if(r.laterPaidSale){s.olderUnpaidCount++;if(present(r.estimate?.netCents))s.olderUnpaidEstimatedCents+=r.estimate.netCents;}}
  if(r.financialState==='active'&&!r.confirmed&&present(r.depositCents)&&r.depositCents!==0)s.partialCount++;
  if(present(r.documentaryCents)){s.documentaryCents+=r.documentaryCents;s.documentaryCount++;}
  if(r.confirmed)s.confirmedCount++;if(r.manual)s.manualCount++;
  if(r.financialState==='active'&&!r.confirmed){s.pendingCount++;if(present(r.pendingCents))s.pendingCents+=r.pendingCents;else s.pendingUnknown++;}
 }
 return s;
}
