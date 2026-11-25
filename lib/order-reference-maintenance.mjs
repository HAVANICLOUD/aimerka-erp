import {applyMarketplaceOrderEvidence} from './marketplace-order-status.mjs';
const allowed=new Set(['Sears','Sanborns','Coppel','Liverpool']);
const clean=v=>String(v??'').replace(/\s+/g,'').toUpperCase();
/** A reference annotates the source; it never executes return/restock instructions from comments. */
export function maintainOrderReference(state,batch,ctx={}){
 const markers=(state.config??={}).orderReferenceMaintenance??={};if(markers[batch.id])return null;
 const rows=batch.rows.filter(r=>allowed.has(r.market));
 const result=applyMarketplaceOrderEvidence(state,{...batch,rows},ctx);let referenced=0;
 for(const reference of batch.referenceRows||[]){
  if(!allowed.has(reference.market)||reference.verified!==true)continue;
  const matches=(state.orders||[]).filter(o=>o.id===reference.orderId&&o.market===reference.market&&String(o.number||o.literalNumber||'').trim()===reference.number&&clean(o.sicar)===clean(reference.sicar));
  if(matches.length!==1||matches[0].orderReferenceEvidence)continue;
  matches[0].orderReferenceEvidence={...structuredClone(reference),sourceSha256:batch.referenceSha256};referenced++;
 }
 markers[batch.id]={...result,referenced,appliedAt:ctx.now,excludedMarkets:['Mercado Libre']};
 return {...result,referenced};
}
