/** Native marketplace vocabulary verified in the owner's reports on 24/11/2026.
 * A documentary status never changes warehouse movements or bank reconciliation. */
const row=(native,status,note='')=>Object.freeze({native,status,note});
const t1=[row('Por Enviar','preparing'),row('Por Recolectar','ready_pickup'),row('En Tránsito','shipped'),row('Entregado','delivered'),row('Cancelado','cancelled'),row('Devolución en Curso','returning')];
export const MARKETPLACE_ORDER_STATES=Object.freeze({
 Sears:t1,Sanborns:t1,'Mercado Libre':t1,
 Liverpool:[row('Pendiente de aceptación','pending_acceptance'),row('Pendiente de envío','preparing'),row('Para recoger','ready_pickup'),row('Recibido','delivered'),row('Cancelado','cancelled'),row('Rechazado','rejected'),row('Reembolsado','refunded')],
 Coppel:[row('Esperando envío','preparing'),row('Enviado','shipped'),row('Recibido','delivered'),row('Cerrado','closed','Cierre administrativo: por sí solo no confirma entrega ni reembolso.'),row('Cancelado','cancelled'),row('Reembolsado','refunded'),row('Incidencia abierta','incident')]
});
export const ORDER_STATE_LABELS=Object.freeze({pending_acceptance:'Pendiente de aceptación',preparing:'Por preparar',ready_pickup:'Listo para recolección',shipped:'Enviado',delivered:'Entregado',cancelled:'Cancelado',rejected:'Rechazado',refunded:'Reembolsado',returning:'Devolución en curso',closed:'Cerrado · entrega por verificar',incident:'Incidencia abierta'});
export const REFUND_RETURN_POLICY=Object.freeze({market:'Liverpool',waitingDays:10,dateBasis:'refundRequestDate',dayBasis:'calendar',automaticIncidents:false,enabled:false});
const key=v=>String(v??'').trim();
export function registrationErrorEvidence(order={}){const e=order.orderReferenceEvidence;return e?.verified===true&&e.registrationError===true&&e.orderId===order.id&&e.market===order.market&&key(e.sicar).replace(/\s+/g,'')===key(order.sicar).replace(/\s+/g,'')&&order.status==='cancelled'?e:null;}
export function verifiedOrderStatus(order={}){
 const e=order.marketplaceStatusEvidence;
 if(!e?.verified||e.orderId!==order.id||e.market!==order.market||key(e.number)!==key(order.number||order.literalNumber)||(e.matchBasis!=='marketplace-order-number'&&e.totalCents!==order.totalCents))return null;
 const mapped=MARKETPLACE_ORDER_STATES[e.market]?.find(r=>r.native===e.nativeStatus);
 return {...e,mappedStatus:mapped?.status||null};
}
export function verifiedOrderRefunds(order={}){const e=order.marketplaceRefundEvidence;return e&&e.orderId===order.id&&e.market===order.market&&key(e.number)===key(order.number||order.literalNumber)&&e.totalCents===order.totalCents?e:null;}
/** Only annotates matched existing orders. The original source and every financial field stay intact. */
export function applyMarketplaceOrderEvidence(state,batch,ctx={}){
 if(!batch?.id||!Array.isArray(batch.rows))throw new TypeError('Missing verified marketplace batch');
 const maintenance=(state.config??={}).marketplaceOrderMaintenance??={};
 if(maintenance[batch.id])return null;
 const duplicate=new Set(),counts=new Map();for(const r of batch.rows){const k=r.orderId;counts.set(k,(counts.get(k)||0)+1);if(counts.get(k)>1)duplicate.add(k);}
 let applied=0,skipped=0,alreadyMatched=0;
 for(const e of batch.rows){
  const matches=(state.orders||[]).filter(o=>o.id===e.orderId&&o.market===e.market&&key(o.number||o.literalNumber)===key(e.number));
  if(matches.length!==1||duplicate.has(e.orderId)){skipped++;continue;}const o=matches[0];
  const numberOnly=e.matchBasis==='marketplace-order-number';
  const identities=(state.orders||[]).filter(x=>x.market===e.market&&key(x.number||x.literalNumber)===key(e.number));
  const skus=(o.items||[]).filter(l=>(l.qty||0)>0).map(l=>[l.sku,l.sellerSku].filter(Boolean));
  if(e.verified!==true||!Number.isSafeInteger(e.totalCents)||(!numberOnly&&(e.totalCents!==o.totalCents||!skus.every(aliases=>aliases.some(s=>e.skus?.includes(s)))))||(numberOnly&&identities.length!==1)||!MARKETPLACE_ORDER_STATES[o.market]?.some(r=>r.native===e.nativeStatus)){skipped++;continue;}
  if(o.marketplaceStatusEvidence){if(verifiedOrderStatus(o))alreadyMatched++;else skipped++;continue;}
  o.marketplaceStatusEvidence=structuredClone(e);applied++;
 }
 let refundsApplied=0;for(const e of batch.refundRows||[]){const matches=(state.orders||[]).filter(o=>o.id===e.orderId&&o.market==='Liverpool'&&key(o.number||o.literalNumber)===key(e.number)&&o.totalCents===e.totalCents&&o.paymentStatus==='refunded');if(matches.length!==1||matches[0].marketplaceRefundEvidence)continue;const o=matches[0];if(!e.refunds?.every(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.requestDate)&&r.amountCents>0&&r.amountCents<=o.totalCents))continue;o.marketplaceRefundEvidence=structuredClone(e);refundsApplied++;}
 maintenance[batch.id]={applied,skipped,alreadyMatched,refundsApplied,observedAt:batch.observedAt,appliedAt:ctx.now||null};
 state.config.marketplaceRefundReturnPolicy??=structuredClone(REFUND_RETURN_POLICY);
 (state.events??=[]).unshift({id:ctx.requestId||batch.id,type:'orders.marketplace.evidence',date:ctx.now,actor:ctx.actor||'Sistema',result:'ok',message:`Cotejo documental de marketplaces: ${applied} pedidos anotados; ${alreadyMatched} ya cotejados; ${skipped} pendientes; ${refundsApplied} solicitudes de reembolso documentadas. Sin cambios en pagos, stock ni incidencias.`});
 return {applied,skipped,...(alreadyMatched?{alreadyMatched}:{}),...(refundsApplied?{refundsApplied}:{})};
}
