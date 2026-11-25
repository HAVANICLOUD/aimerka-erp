import {verifiedPromotionEvidence} from './sale-promotion.mjs';
export function maintainSalePromotions(state,batch,ctx={}){
 const markers=(state.config??={}).salePromotionMaintenance??={};if(markers[batch.id])return null;
 const applied=[],skipped=[];
 for(const e of batch.rows||[]){const matches=(state.orders||[]).filter(o=>o.id===e.orderId&&o.market===e.market&&o.number===e.number);const o=matches.length===1?matches[0]:null;
 if(!o||o.totalCents!==e.sellerGrossCents||!verifiedPromotionEvidence({...o,promotionEvidence:e})){skipped.push(e.orderId);continue;}
 o.promotionEvidence=structuredClone(e);applied.push(o.id);
 }
 markers[batch.id]={at:ctx.now,applied,skipped};(state.events??=[]).unshift({id:ctx.requestId||batch.id,type:'sale.promotion.documentaryReview',date:ctx.now,actor:ctx.actor,result:'ok',message:'Promociones registradas en '+applied.length+' ventas. Depósitos conservados.'});return {applied,skipped};
}
