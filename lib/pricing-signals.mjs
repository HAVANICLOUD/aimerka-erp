/** Presentation/review policy only; never changes price, commission, tax or stock. */
export const DEFAULT_SIGNALS=Object.freeze({minCashMargin:.03,peerCashRatio:.5});
export function signalPolicy(config={}){return {...DEFAULT_SIGNALS,...config.pricingSignals};}
export function validateSignalPolicy(value){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['minCashMargin','peerCashRatio'].includes(k)))throw Error('Criterios de semáforo inválidos.');for(const k of ['minCashMargin','peerCashRatio'])if(typeof value[k]!=='number'||!Number.isFinite(value[k])||value[k]<0||value[k]>1)throw Error('Los límites del semáforo deben estar entre 0% y 100%.');return {...value};}
const positive=value=>Number.isFinite(value)&&Math.round(value*100)>0;
export function canSavePrice(r){return !!r?.valid&&positive(r.discount?.price)&&positive(r.regular?.price)&&r.regular.price>=r.discount.price&&Number.isFinite(r.discount.cashProfit??r.discount.profit)&&Number.isFinite(r.regular.cashProfit??r.regular.profit)&&Number.isFinite(r.discount.commercialProfit??r.discount.profit)&&Number.isFinite(r.regular.commercialProfit??r.regular.profit)&&Number.isFinite(r.commissionRate)&&(r.commissionRate>0||r.channel==='Tienda Nube');}
function metrics(r){const d=r.discount||{};return {cash:d.cashProfit??d.profit,commercial:d.commercialProfit??d.profit,margin:(d.cashProfit??d.profit)/d.price};}
const median=values=>{const ordered=values.slice().sort((a,b)=>a-b),n=ordered.length;return n?n%2?ordered[(n-1)/2]:(ordered[n/2-1]+ordered[n/2])/2:null;};
export function classifyPricing(rows,config={}){
 const policy=validateSignalPolicy(signalPolicy(config));
 return rows.map((r,index)=>{
  const {cash,commercial,margin}=metrics(r),savable=canSavePrice(r),regularCash=r.regular?.cashProfit??r.regular?.profit,regularCommercial=r.regular?.commercialProfit??r.regular?.profit;
  const peers=rows.filter((p,i)=>i!==index&&canSavePrice(p)&&positive(metrics(p).cash)&&positive(metrics(p).commercial)).map(p=>metrics(p).margin),peerMedian=median(peers);
  let color='green',title='Utilidad y caja positivas',reason='Genera utilidad comercial y disponible de caja después de retenciones.';
  if(!savable){color='red';title='Revisar datos · sin precio válido';reason='Faltan datos, comisión o precios válidos; regular debe ser igual o mayor al precio con descuento.';}
  else if(!positive(commercial)||!positive(cash)||!positive(regularCash)||!positive(regularCommercial)){color='red';title='No viable · sin utilidad o caja';reason=!positive(commercial)?'El precio con descuento no deja utilidad comercial.':!positive(cash)?'El precio con descuento no deja caja disponible después de costo, envío y retenciones.':'El precio regular no deja utilidad o caja disponible.';}
  else if(margin<policy.minCashMargin||(peerMedian!==null&&margin<peerMedian*policy.peerCashRatio)){color='yellow';title='Revisión · utilidad de caja baja';reason=margin<policy.minCashMargin?'El margen de caja está por debajo del mínimo configurado.':'El margen de caja es bajo frente a la mediana de los otros marketplaces.';}
  const transfer=r.transfer?.traffic;
  if(transfer&&['red','yellow'].includes(transfer.color)){
   if(transfer.color==='red'){color='red';title='Revisar transferencia · sin caja positiva';}
   else if(color==='green'){color='yellow';title='Revisar margen de transferencia';}
   reason+=' '+transfer.reason;
  }
  return {color,title,reason,savable,cash,commercial,cashMargin:margin,peerMedian,policy};
 });
}
