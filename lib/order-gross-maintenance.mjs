import {autoCertificateLink,allocateTax} from './retention-certificates.mjs';
const id='order-gross-87195171-20261124',uuid='8DF08515-7E2B-49E1-A17B-2351C90A495D';
/** Owner-authorized correction; retains original source, bank proof, net allocation and warehouse state. */
export function maintainOrderGross(state,batch,ctx={}){
 const markers=(state.config??={}).orderGrossMaintenance??={};if(markers[id])return null;
 const o=(state.orders||[]).find(o=>o.id==='V000876'&&o.market==='Sears'&&o.number==='87195171'),report={id,at:ctx.now,actor:ctx.actor,corrected:false,certificateLinked:false};
 if(o?.totalCents===1169000&&o.items?.length===1&&o.items[0].qty===1&&o.items[0].totalCents===1169000&&o.items[0].unitPriceCents===1169000){
  report.originalOrder=structuredClone(o);o.totalCents=1169900;o.unitPriceCents=1169900;o.items[0].totalCents=1169900;o.items[0].unitPriceCents=1169900;report.corrected=true;
 }
 for(const e of batch.rows||[]){const matches=(state.orders||[]).filter(o=>o.id===e.orderId&&o.market===e.market&&String(o.number||o.literalNumber||'').trim()===e.number);if(matches.length===1&&!matches[0].marketplaceGrossEvidence)matches[0].marketplaceGrossEvidence=structuredClone(e);}
 const ledger=state.settlementLedger,cert=ledger?.retentionCertificates?.find(c=>c.uuid===uuid),cheque=ledger?.cheques?.find(c=>c.id==='Sears|12514');
 if(o?.totalCents===1169900&&cert?.satStatus==='Activo'&&cert.status==='review'&&cheque&&!ledger.retentionCertificates.some(c=>c.uuid!==uuid&&c.satStatus==='Activo'&&c.chequeIds?.includes(cheque.id))){
  const match=autoCertificateLink(cert,state);
  if(match.status==='matched'&&match.chequeIds.length===1&&match.chequeIds[0]===cheque.id){report.originalCertificate=structuredClone(cert);Object.assign(cert,match,{allocations:{[cheque.id]:allocateTax(cert,cheque,state)}});(cert.statusHistory??=[]).push({status:'review',checkedAt:ctx.now,actor:ctx.actor,reason:'Venta 87195171 corregida por el propietario de 11690 a 11699; banco y cheque conservados.'});report.certificateLinked=true;}
 }
 (state.orderGrossCorrectionHistory??=[]).push(report);markers[id]={at:ctx.now,corrected:report.corrected,certificateLinked:report.certificateLinked};
 (state.events??=[]).unshift({id:ctx.requestId||id,type:'sale.gross.documentaryCorrection',date:ctx.now,actor:ctx.actor,result:'ok',message:'Pedido 87195171: venta bruta corregida a $11,699 con trazabilidad; pago y conciliación bancaria conservados. Validación de venta bruta independiente habilitada.'});
 return {corrected:report.corrected,certificateLinked:report.certificateLinked};
}
