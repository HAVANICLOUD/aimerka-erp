import {verifiedPromotionEvidence} from './sale-promotion.mjs?v=20261124-promotions';
/** Documentary gross validation is independent of bank reconciliation and fee inference. */
export function orderGrossValidation(order={}){
 const e=order.marketplaceGrossEvidence,n=String(order.number||order.literalNumber||'').trim();
 if(!e||e.orderId!==order.id||e.market!==order.market||e.number!==n||e.currency!=='MXN'||!Number.isSafeInteger(e.totalCents)||!Number.isSafeInteger(order.totalCents))return {status:'unverified',mismatch:false};
 const p=verifiedPromotionEvidence(order);
 if(p&&p.customerCents===e.totalCents){const comparableCents=p.sellerGrossCents-p.sellerFundedCents,differenceCents=comparableCents-order.totalCents;return {status:differenceCents?'mismatch':'matched-promotion',mismatch:differenceCents!==0,erpCents:order.totalCents,marketplaceCents:comparableCents,customerCents:p.customerCents,promotion:p,differenceCents,source:e.source,observedAt:p.observedAt};}
 const differenceCents=e.totalCents-order.totalCents;
 return {status:differenceCents?'mismatch':'matched',mismatch:differenceCents!==0,erpCents:order.totalCents,marketplaceCents:e.totalCents,differenceCents,source:e.source,observedAt:e.observedAt};
}
