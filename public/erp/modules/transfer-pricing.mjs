/** Shared cent-accurate transfer payment scenario, separate from normal market fees. */
const fail=message=>{throw new Error(message);};
export function validateTransferRule(value){
 if(value===undefined)return null;
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.enabled!=='boolean')fail('Configura la opción de pago por transferencia.');
 const discount=value.discount,commissionRate=value.commissionRate;
 if(value.rounding!==undefined&&!['cents','ending99'].includes(value.rounding))fail('Redondeo de transferencia inválido.');
 if(typeof discount!=='number'||!Number.isFinite(discount)||discount<.01||discount>.5)fail('El descuento adicional por transferencia debe estar entre 1% y 50%.');
 if((value.enabled||commissionRate!=null)&&(typeof commissionRate!=='number'||!Number.isFinite(commissionRate)||commissionRate<0||commissionRate>=1))fail('Indica una comisión porcentual de transferencia válida.');
 return {enabled:value.enabled,discount,commissionRate:commissionRate??null,...(value.rounding?{rounding:value.rounding}:{})};
}
/** Additional discount is applied to the campaign price. Fees are rounded in cents. */
export function transferPaymentResult(result,rule,targetMargin=0,regularCents=0){
 if(!rule?.enabled||!result?.valid||!Number.isFinite(result.discount?.price)||result.channel!=='Tienda Nube')return null;
 const t=validateTransferRule(rule),baseCents=Math.round(result.discount.price*100);
 const discountedCents=Math.round(baseCents*(1-t.discount));
 const priceCents=t.rounding==='ending99'?Math.max(0,Math.floor((discountedCents-9900)/10000)*10000+9900):discountedCents;
 const commissionCents=Math.round(priceCents*t.commissionRate);
 const price=priceCents/100,commission=commissionCents/100,cost=result.cost,shipping=result.shipping;
 const marketplacePayout=price-commission,netPayout=marketplacePayout-shipping,cashProfit=netPayout-cost,margin=price>0?cashProfit/price:0;
 const belowTargetMargin=margin+1e-10<targetMargin;
 const color=priceCents<=0||Math.round(cashProfit*100)<=0?'red':belowTargetMargin?'yellow':'green';
 const reason=priceCents<=0?'No existe un precio positivo terminado en 99 con este descuento.':color==='red'?'La transferencia no deja caja positiva después de costo y envío.':color==='yellow'?'La transferencia queda por debajo del margen mínimo de la campaña.':'La transferencia cumple el margen mínimo de la campaña.';
 return {price,priceCents,baseCents,additionalDiscount:t.discount,effectiveAdditionalDiscount:baseCents>0?1-priceCents/baseCents:0,rounding:t.rounding||'cents',totalDiscountRate:regularCents>0?1-priceCents/regularCents:null,commissionRate:t.commissionRate,commission,commissionCents,withholdingTotal:0,financing:0,cost,shipping,marketplacePayout,netPayout,cashProfit,commercialProfit:cashProfit,margin,targetMargin,belowTargetMargin,traffic:{color,reason}};
}
