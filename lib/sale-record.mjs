import {archiveSaleComments} from './sale-aftercare.mjs?v=20261124-aftercare';
import {salePromotion} from './sale-promotion.mjs?v=20261124-promotions';
const text=(v,max=4000)=>String(v??'').trim().slice(0,max);
export function promotionBase(order){const shipping=Number(order.shippingChargedCents||0),base=order.items?.length?order.items.reduce((n,l)=>n+Number(l.totalCents??l.qty*l.unitPriceCents),0):order.totalCents-shipping;if(!Number.isSafeInteger(base)||base<0)throw Error('Revisa el importe de las partidas de la venta.');return base;}
export function saleIdentityLocked(order,state={}){return !!(order.stockMode==='historical'||order.marketplaceStatusEvidence||order.marketplaceGrossEvidence||order.orderReferenceEvidence||order.promotionEvidence||order.reconciliation?.closure||order.reconciliation?.depositCents!=null||order.paidCents!=null||order.reconciliation?.bankProofIds?.length||(state.documents||[]).some(d=>d.orderId===order.id)||(state.settlementLedger?.cheques||[]).some(c=>(c.lines||c.items||[]).some(l=>l.orderId===order.id)));}
export function currentSalePromotion(order){const p=order.marketplace34?.promotion,e=p?.manualOverride?null:order.promotionEvidence,base=promotionBase(order),amount=p?.manualOverride?p.amountCents:e?.promotionCents??p?.amountCents??0;return {enabled:amount>0,mode:p?.mode||'amount',description:p?.description||e?.description||'',amountCents:amount,percent:base?Math.round(amount/base*10000)/100:0,funding:p?.manualOverride?p.funding:e?.marketplaceFundedCents===amount&&amount>0?'marketplace':p?.funding||'unknown',baseCents:base,customerAmountCents:base-amount};}
function saveAudit(state,order,command,ctx,label,before,after){const event={id:command.id,type:command.type,orderId:order.id,date:ctx.now,actor:ctx.actor||'Operador',result:'ok',message:label,changes:{before,after}};(state.events??=[]).unshift(event);(order.history??=[]).push({label,date:ctx.now,actor:event.actor});return {ok:true,id:order.id,orderId:order.id,message:label};}
export function updateSaleRecord(state,command,ctx={}){
 const p=command.payload||{},o=state.orders.find(o=>o.id===p.orderId);if(!o)throw Error('No se encontró la venta.');
 if(command.type==='sale.comments.update'||command.type==='sale.comments.restore'){
  const source=command.type==='sale.comments.restore'?(o.commentHistory||[]).find(h=>h.id===p.entryId):null;
  if(command.type==='sale.comments.restore'&&!source)throw Error('No se encontró la versión anterior de los comentarios.');
  const next=source?source.before:p.comments;if(typeof next!=='string'||next.length>12000)throw Error('Los comentarios deben contener como máximo 12,000 caracteres.');
  const before=String(o.comments||'');archiveSaleComments(o,before,next,ctx,source?'Restauración de comentarios':'Edición manual');o.comments=next;
  return saveAudit(state,o,command,ctx,source?'Comentarios anteriores restaurados.':'Comentarios actualizados.',before,next);
 }
 if(command.type==='sale.promotion.update'){
  const input=p.promotion||{},base=promotionBase(o);if(input.enabled&&!['marketplace','seller','unknown'].includes(input.funding))throw Error('Selecciona quién absorbe la promoción.');
  const calculated=salePromotion(input,base),before=structuredClone(o.marketplace34?.promotion||null),next={...(o.marketplace34?.promotion||{}),...(calculated||{amountCents:0,percent:0,description:'',baseCents:base,grossCents:base,customerAmountCents:base,funding:'unknown',mode:'amount',treatment:'Informativa'}),manualOverride:true,updatedAt:ctx.now,updatedBy:ctx.actor};
  (o.marketplace34??={}).promotion=next;
  return saveAudit(state,o,command,ctx,'Promoción actualizada. Pago del cliente recalculado; depósitos conciliados conservados.',before,structuredClone(next));
 }
 if(command.type==='sale.details.update'){
  const input=p.details||{},allowed=['number','market','sicar','account','documentDate','priority','followupStatus','comments'];if(Object.keys(input).some(k=>!allowed.includes(k)))throw Error('Ese campo requiere su operación específica.');
  const next=Object.fromEntries(allowed.map(k=>[k,k in input?text(input[k],k==='comments'?4000:160):o[k]])),before=Object.fromEntries(allowed.map(k=>[k,o[k]]));
  if(!next.number||!['Sears','Sanborns','Liverpool','Coppel','Elektra','Tienda Nube','Mercado Libre','T1 Comercios'].includes(next.market))throw Error('Indica el número de pedido y un canal válido.');
  if(saleIdentityLocked(o,state)&&['number','market','sicar'].some(k=>(next[k]||'')!==(o[k]||'')))throw Error('El canal, pedido y referencia tienen documentos asociados y deben conservarse.');
  if(state.orders.some(other=>other.id!==o.id&&other.market===next.market&&text(other.number).toLowerCase()===next.number.toLowerCase()&&text(other.account).toLowerCase()===text(next.account).toLowerCase()))throw Error('Ya existe ese pedido en el canal y cuenta seleccionados.');
  const date=new Date(next.documentDate+'T12:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(next.documentDate)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==next.documentDate||next.documentDate>ctx.today)throw Error('Selecciona una fecha de pedido válida y no futura.');
  if(!['Normal','Importante'].includes(next.priority)||!['Sin pendiente','Pendiente','En seguimiento','Resuelto'].includes(next.followupStatus))throw Error('Revisa la prioridad y el seguimiento.');
  if(next.number!==o.number)o.literalNumber=next.number;Object.assign(o,next);return saveAudit(state,o,command,ctx,'Información general de la venta actualizada.',before,structuredClone(next));
 }
 if(command.type==='sale.identifiers.update'){
  if(!Array.isArray(p.units)||p.units.length>5000)throw Error('Captura una serie o IMEI por unidad.');const keys=new Set(),serials=new Set(),imeis=new Set();
  const units=p.units.map(input=>{const line=o.items?.find(l=>l.id===input.lineId),unit=Number(input.unit),serial=text(input.serial,200),imei=text(input.imei,30),key=input.lineId+'/'+unit;
   if(!line||!Number.isSafeInteger(unit)||unit<1||unit>line.qty||keys.has(key)||imei&&!/^\d{15}$/.test(imei))throw Error('Revisa la partida, unidad e IMEI de 15 dígitos.');keys.add(key);
   if(serials.has(serial.toUpperCase())&&serial||imeis.has(imei)&&imei)throw Error('No repitas series ni IMEI dentro de la venta.');if(serial)serials.add(serial.toUpperCase());if(imei)imeis.add(imei);return {lineId:line.id,sku:line.sku,unit,serial,imei};});
  const previousIds=[...(o.marketplace34?.units||[]),...(o.items||[])],previousSerials=new Set(previousIds.map(u=>String(u.serial||u.serialNumber||u.serie||'').toUpperCase()).filter(Boolean)),previousImeis=new Set(previousIds.map(u=>String(u.imei||'')).filter(Boolean));
  for(const other of state.orders){if(other.id===o.id||other.status==='cancelled'||other.returnStatus==='restocked')continue;const existing=[...(other.marketplace34?.units||[]),...(other.items||[]).flatMap(l=>[{serial:l.serial||l.serialNumber||l.serie,imei:l.imei},...(l.serials||[]).map(serial=>({serial})),...(l.imeis||[]).map(imei=>({imei}))])];if(existing.some(u=>u.serial&&serials.has(String(u.serial).toUpperCase())&&!previousSerials.has(String(u.serial).toUpperCase())||u.imei&&imeis.has(String(u.imei))&&!previousImeis.has(String(u.imei))))throw Error('Una serie o IMEI ya pertenece a otra venta activa.');}
  const before={units:structuredClone(o.marketplace34?.units||[]),items:structuredClone(o.items)};(o.marketplace34??={}).units=units.filter(u=>u.serial||u.imei);
  for(const line of o.items||[]){line.identifierOverride=true;if(line.qty===1){const unit=units.find(u=>u.lineId===line.id&&u.unit===1);line.serial=unit?.serial||'';line.imei=unit?.imei||'';}}
  return saveAudit(state,o,command,ctx,'Series e IMEI de las partidas actualizados.',before,{units:structuredClone(o.marketplace34.units)});
 }
 throw Error('Operación de edición de venta no reconocida.');
}
