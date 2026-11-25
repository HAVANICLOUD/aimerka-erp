/** Promotion metadata never changes bank evidence, sale lines or confirmed receipts. */
export function salePromotion(input,baseCents){
 if(!input?.enabled)return null;
 if(!Number.isSafeInteger(baseCents)||baseCents<=0)throw new Error('La promoción requiere un importe de productos mayor a cero.');
 const mode=input.mode==='percent'?'percent':'amount',percent=Number(input.percent),value=mode==='percent'?Math.round(baseCents*percent/100):Number(input.amountCents);
 if(!Number.isSafeInteger(value)||value<0||value>baseCents||mode==='percent'&&(!Number.isFinite(percent)||percent<0||percent>100))throw new Error('La promoción debe estar entre 0 y 100% del importe de productos.');
 const description=String(input.description||'').trim();if(!description)throw new Error('Indica el tipo o nombre de la promoción.');
 const funding=['marketplace','seller','unknown'].includes(input.funding)?input.funding:'unknown';
 return {amountCents:value,percent:Math.round(value/baseCents*10000)/100,description:description.slice(0,2000),baseCents,mode,funding,treatment:'Informativa',grossCents:baseCents,customerAmountCents:baseCents-value};
}
export function verifiedPromotionEvidence(order){
 const e=order.promotionEvidence;
 if(!e||order.market!=='Liverpool'||e.orderId!==order.id||e.number!==String(order.number||order.literalNumber||'').trim()||e.market!==order.market||e.currency!=='MXN'||e.verified!==true||!e.sourceUrl?.startsWith('https://marketplace.liverpool.com.mx/orders/detail/')||e.sourceUrl.split('/').pop()!==e.number)return null;
 const keys=['customerCents','sellerGrossCents','promotionCents','sellerFundedCents','marketplaceFundedCents','sellerNetDisplayedCents','logisticsCents','commissionDisplayedCents'];
 if(keys.some(k=>!Number.isSafeInteger(e[k])||e[k]<0)||e.sellerGrossCents-e.promotionCents!==e.customerCents||e.sellerFundedCents+e.marketplaceFundedCents!==e.promotionCents||e.sellerGrossCents-e.sellerFundedCents-e.logisticsCents-e.commissionDisplayedCents!==e.sellerNetDisplayedCents)return null;
 return e;
}
