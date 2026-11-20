import {estimateMarketplace34,isCancelled,validDate,saveDeposit} from './reconciliation-v28.mjs?v=20261120-t1-current14';
const amount=(n,label)=>{if(!Number.isSafeInteger(n)||n<0)throw new Error(label+': indica un importe no negativo.');return n;};
const text=v=>String(v??'').trim();
function unlocked(order){if(order.reconciliation?.closure)throw new Error('La conciliación tiene un cierre definitivo. Reábrela con motivo antes de modificar sus condiciones.');}
function audit(state,command,ctx,order,before,message){(state.events??=[]).unshift({id:command.id,type:command.type,date:ctx.now,actor:ctx.actor,orderId:order?.id,message,result:'ok',changes:{before,after:structuredClone(order?.marketplace34||{})}});if(order)(order.history??=[]).push({date:ctx.now,actor:ctx.actor,label:message});return {ok:true,message};}
export function applyMarketplace34(state,command,ctx={}){
 const p=command.payload||{},order=state.orders.find(o=>o.id===p.orderId);if(!order)throw new Error('Selecciona una venta.');
 const before=structuredClone(order.marketplace34||{});
 if(command.type==='marketplace.reopen'){
  const reason=text(p.reason);if(!order.reconciliation?.closure||!reason)throw new Error('Indica el motivo para reabrir un cierre existente.');
  (order.reconciliation.closedHistory??=[]).push({...order.reconciliation.closure,reopenedAt:ctx.now,reopenedBy:ctx.actor,reopenReason:reason.slice(0,2000)});order.reconciliation.closure=null;order.reconciliation.status='En revisión';
  return audit(state,command,ctx,order,before,'Cierre reabierto con motivo: '+reason);
 }
 unlocked(order);let metadata=structuredClone(before);
 if(command.type==='marketplace.trace.save'){
  if(!text(p.reference))throw new Error('Incluye la referencia documental de estas fechas.');
  const trace={};for(const key of ['creation','dispatch','shipment','delivery','cancelMarketplace','cancelSeller','refundMarketplace','refundSeller','restock']){const date=text(p.dates?.[key]);if(date&&(!validDate(date)||date>ctx.today))throw new Error('Las fechas de trazabilidad deben ser válidas y no futuras.');trace[key]=date||null;}
  for(const [earlier,later]of [['creation','shipment'],['shipment','delivery']])if(trace[earlier]&&trace[later]&&trace[later]<trace[earlier])throw new Error('Revisa el orden de creación, envío y entrega.');
  metadata.trace={...trace,reference:text(p.reference).slice(0,2000),updatedAt:ctx.now};
 }else if(command.type==='marketplace.promotion.save'){
  if(order.market!=='Liverpool')throw new Error('La promoción informativa V34 corresponde a Liverpool.');
  const value=amount(p.amountCents,'Promoción'),description=text(p.description),msiMonths=Number(p.msiMonths);
  if(value>order.totalCents||value>0&&!description||![0,3,6].includes(msiMonths))throw new Error('La promoción debe caber en el bruto, tener descripción y un plazo Sin MSI, 3 o 6.');
  metadata.promotion={amountCents:value,description:description.slice(0,2000),msiMonths,treatment:'Informativa',grossCents:order.totalCents,customerAmountCents:order.totalCents-value};
 }else if(command.type==='marketplace.logistics.save'){
  if(!Array.isArray(p.charges)||p.charges.length>100||!text(p.reference))throw new Error('Incluye una referencia del estado de cuenta o del cotejo manual.');
  const charges=p.charges.map(c=>{const row={kind:text(c.kind),amountCents:amount(c.amountCents,'Cargo logístico'),treatment:c.treatment,credit:c.credit===true,document:text(c.document).slice(0,200),date:text(c.date)};
   if(!['Envío','Seguro','Logística inversa','Ajuste'].includes(row.kind)||!['Externo','Descontado'].includes(row.treatment)||!validDate(row.date)||row.date>ctx.today)throw new Error('Revisa el tipo de cargo, tratamiento y fecha del documento.');return row;});
  metadata.logistics={confirmed:p.confirmed===true,charges,reference:text(p.reference).slice(0,2000),at:ctx.now,actor:ctx.actor};
 }else if(command.type==='marketplace.identifiers.save'){
  if(!Array.isArray(p.units)||p.units.length>5000)throw new Error('Envía una serie o IMEI por unidad.');const usedSerials=new Set(),usedImeis=new Set();
  const units=p.units.map(u=>{const item=order.items?.find(i=>i.id===u.lineId),serial=text(u.serial),imei=text(u.imei),unit=Number(u.unit);
   if(!item||!Number.isSafeInteger(unit)||unit<1||unit>item.qty||!serial&&!imei||serial.length>200||imei&&!/^\d{15}$/.test(imei))throw new Error('Revisa la partida, unidad, serie e IMEI de 15 dígitos conservado como texto.');
   const sk=serial.toUpperCase();if(serial&&usedSerials.has(sk)||imei&&usedImeis.has(imei))throw new Error('No repitas series ni IMEI dentro de la venta.');if(serial)usedSerials.add(sk);if(imei)usedImeis.add(imei);
   return {lineId:item.id,sku:item.sku,unit,serial,imei};});
  if(new Set(units.map(u=>u.lineId+'/'+u.unit)).size!==units.length)throw new Error('No repitas la misma unidad de una partida.');
  for(const item of order.items||[]){const own=units.filter(u=>u.lineId===item.id);if(own.length&&own.length!==item.qty)throw new Error('Captura una serie o IMEI por cada unidad de la partida.');}
  for(const other of state.orders){if(other.id===order.id||other.status==='cancelled'||other.returnStatus==='restocked')continue;for(const u of other.marketplace34?.units||[])if(u.serial&&usedSerials.has(u.serial.toUpperCase())||u.imei&&usedImeis.has(u.imei))throw new Error('Un identificador ya está asociado a otra venta. Coteja el equipo y conserva la captura original.');}
  (metadata.identifierHistory??=[]).push({units:structuredClone(metadata.units||[]),at:ctx.now,actor:ctx.actor,reason:text(p.reason)});metadata.units=units;
 }else if(command.type==='marketplace.estimate'){
  order.marketplace34=metadata;
  const estimate=estimateMarketplace34(order,state.products,state.config,ctx),r=order.reconciliation??={};r.estimate=estimate;r.estimateError=null;r.status=r.depositCents==null?'Pendiente de pago':Math.abs(r.depositCents-estimate.netCents)<=2?'Conciliada':'Incongruencia';r.differenceCents=r.depositCents==null?null:r.depositCents-estimate.netCents;
  return audit(state,command,ctx,order,before,'Estimación V34 guardada con promociones y cargos cotejados.');
 }else if(command.type==='marketplace.deposit'){
  saveDeposit(order,{amountCents:p.amountCents,date:p.date,notes:p.notes},{...ctx,allowSignedDebit:true});
  return audit(state,command,ctx,order,before,'Movimiento del estado de cuenta registrado sin modificar existencias.');
 }else if(command.type==='marketplace.close'){
  const r=order.reconciliation;if(!r?.estimate||!Number.isSafeInteger(r.depositCents)||Math.abs(r.depositCents-r.estimate.netCents)>2)throw new Error('El cierre requiere estimación y depósito registrado, con diferencia máxima de $0.02.');
  if(isCancelled(order)&&order.market!=='Liverpool')throw new Error('Revisa el reembolso de la venta cancelada antes de cerrar.');
  if(order.market==='Liverpool'&&(isCancelled(order)||order.paymentStatus==='refunded')&&r.estimate.version!==34)throw new Error('Vuelve a estimar con las reglas V34 antes de cerrar esta cancelación o reembolso.');
  if(r.estimate.warnings?.length&&!text(p.reviewNote))throw new Error('Documenta la revisión de las advertencias antes del cierre.');
  r.closure={id:command.id,at:ctx.now,actor:ctx.actor,estimate:structuredClone(r.estimate),depositCents:r.depositCents,depositDate:r.depositDate,reviewNote:text(p.reviewNote).slice(0,4000)};r.status='Conciliada';
  return audit(state,command,ctx,order,before,'Conciliación cerrada con copia definitiva del cálculo y depósito.');
 }else throw new Error('Operación V34 no reconocida.');
 order.marketplace34=metadata;
 if(command.type!=='marketplace.identifiers.save'&&order.reconciliation){order.reconciliation.estimate=null;order.reconciliation.status='En revisión';order.reconciliation.differenceCents=null;}
 return audit(state,command,ctx,order,before,'Información V34 guardada. El importe original de venta y las existencias se conservan.');
}
