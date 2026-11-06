import {savePurchaseSupplier,importSicarHistory} from './purchase-workspace.mjs';
import {saveManualPayment} from './manual-payment.mjs';
import * as inventory from './inventory-v28.mjs';
import * as operations from './operations-v28.mjs';
import * as reconciliation from './reconciliation-v28.mjs';
import * as pricing from './pricing-v28.mjs';
import {applyDocumentImport} from './purchase-document-commands.mjs';
import {applyCompactSkuMigration} from './compact-sku-migration.mjs';
import {validatePurchaseDocuments} from './purchase-document-validation.mjs';
import {warehouseCommand,applyWarehouseInventory} from './warehouses.mjs';
import {applyAccessCommand} from './access-control.mjs';
import {applyMarketplace34} from './marketplace-v34.mjs';
import {validateSchedule} from './payout-schedules.mjs';
import {applySettlementCommand,reconcileLedger} from './settlement-documents.mjs';

function order(state,id){const item=state.orders.find(o=>o.id===id);if(!item)throw new Error('Pedido no encontrado.');return item;}
function validatedConfigSection(section,value){
  const copy=structuredClone(value),rate=(n,label)=>{if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>=1)throw new Error(label+': usa una tasa entre 0 y menos de 100%.');},positive=(n,label)=>{if(typeof n!=='number'||!Number.isFinite(n)||n<0)throw new Error(label+': usa un importe no negativo.');};
  if(section==='parameters'){rate(copy.vatWithholding,'Retención IVA');rate(copy.incomeWithholding,'Retención ISR');rate(copy.competitiveTolerance,'Tolerancia');if(copy.t1IncludedVat!=null)rate(copy.t1IncludedVat,'IVA incluido T1');pricing.pricePolicy({parameters:copy});}
  else if(section==='shipping'){if(!Array.isArray(copy)||!copy.length)throw new Error('Configura al menos un envío.');for(const row of copy){if(!row.type?.trim())throw new Error('Escribe el tipo de envío.');for(const k of ['min','max','base'])positive(row[k],k);if(row.min>row.max)throw new Error('El mínimo de envío supera el máximo.');}}
  else if(section==='shippingRules'){if(!Array.isArray(copy))throw new Error('Reglas de envío inválidas.');for(const row of copy){if(!row.keyword&&!row.family&&!row.category&&!row.text&&!row.name)throw new Error('Cada regla necesita un criterio.');}}
  else if(section==='elektraMsi'){if(!Array.isArray(copy)||!copy.length)throw new Error('Configura los plazos MSI.');const seen=new Set();for(const row of copy){rate(row.rate,'Cargo MSI');if(!/^(Sin MSI|\d+\s*MSI)$/i.test(row.label||''))throw new Error('Usa un plazo MSI válido.');const months=pricing.parseMsi(row.label);if(seen.has(months))throw new Error('No repitas el mismo plazo MSI.');seen.add(months);}}
  else if(section==='tnGateways'){if(!Array.isArray(copy))throw new Error('Pasarelas inválidas.');for(const row of copy){for(const key of ['effectiveRate','msiRate','extraRate'])rate(row[key],key);for(const key of ['weight','min','max','months'])positive(row[key],key);if(row.min>row.max)throw new Error('El mínimo de la pasarela supera el máximo.');if(!Number.isInteger(row.months))throw new Error('El plazo de la pasarela debe ser entero.');}}
  else if(section==='tnBands'){if(!Array.isArray(copy)||!copy.length)throw new Error('Define los rangos de Tienda Nube.');let previous=-1;for(const row of copy){positive(row.min,'Mínimo del rango');positive(row.max,'Máximo del rango');if(row.min>row.max||row.min<=previous)throw new Error('Revisa los límites crecientes de los rangos.');previous=row.min;rate(row.usedRate,'Comisión ponderada');}}
  else throw new Error('Sección de configuración no reconocida.');
  return copy;
}
export function applyCommand(state,command,context={}){
 const type=command.type,p=command.payload||{},ctx={...context,requestId:command.id,today:operations.mexicoToday(context.now||new Date()),user:context.actor};
 let result;
 if(type==='purchase.importSicarHistory'){const draft=structuredClone(state),result=importSicarHistory(draft,command,ctx);Object.assign(state,draft);return result;}
 if(type==='purchase.supplier.save')return savePurchaseSupplier(state,command,ctx);
 if(type==='payment.manual.save'){const draft=structuredClone(state),saved=saveManualPayment(draft,command,ctx);if(draft.settlementLedger)reconcileLedger(draft,ctx);Object.assign(state,draft);return saved;}
 if(type.startsWith('settlement.')){const draft=structuredClone(state),result=applySettlementCommand(draft,command,ctx);Object.assign(state,draft);return result;}
 if(state.settlementLedger&&['reconciliation.save','reconciliation.saveBatch','marketplace.deposit','marketplace.close'].includes(type)){
  const ids=p.orderId?[p.orderId]:p.ids||state.orders.filter(o=>o.reconciliation?.selected).map(o=>o.id);
  if(ids.some(id=>state.orders.find(o=>o.id===id)?.reconciliation?.bankProofRequired))throw new Error('Sears y Sanborns requieren cheque y estado de cuenta coincidentes. Usa Conciliación de pagos para confirmar el depósito.');
 }
 if(type.startsWith('marketplace.')){const draft=structuredClone(state),result=applyMarketplace34(draft,command,ctx);if(draft.settlementLedger)reconcileLedger(draft,ctx);Object.assign(state,draft);return result;}
 if(type.startsWith('access.')){if(context.workspace!=='v28')throw new Error('Administra usuarios y roles desde el espacio operativo.');return applyAccessCommand(state,command,ctx);}
 if(type==='product.compactGeneratedSkus')return applyCompactSkuMigration(state,{...ctx,type});
 if(type.startsWith('warehouse.')){const draft=structuredClone(state),result=warehouseCommand(draft,command,ctx);Object.assign(state,draft);return result;}
 if(type.startsWith('sale.')||type.startsWith('inventory.')||type==='product.save'||type==='product.assignUpc'){
  // Validate cross-warehouse consequences before touching the live references.
  if(state.warehouseStock)applyWarehouseInventory(structuredClone(state),command,ctx,inventory.applyInventory);
  const result=applyWarehouseInventory(state,command,ctx,inventory.applyInventory);if(state.settlementLedger)reconcileLedger(state,ctx);return result;
 }
 if(type==='purchase.importDocuments')return applyDocumentImport(state,command,ctx);
 if(type==='purchase.update'){
   const attached=(state.documents||[]).filter(document=>document.purchaseId===p.id);
   if(attached.length){
     const draft=structuredClone(state),saved=operations.applyOperation(draft,command,ctx),purchase=draft.purchases.find(row=>row.id===saved.id);
     const validation=validatePurchaseDocuments(attached,{purchase,lines:purchase.items,products:draft.products,purchases:state.purchases,purchaseId:purchase.id});
     if(!validation.valid)throw new Error(validation.issues.filter(issue=>issue.severity==='error').map(issue=>issue.message).join(' '));
     Object.assign(state,draft);return {...saved,documentValidation:validation};
   }
 }
 if(/^(purchase|expense|credit|catalog)\./.test(type))return operations.applyOperation(state,command,ctx);
 if(type.startsWith('reconciliation.')){
   const ids=p.orderId?[p.orderId]:p.ids||state.orders.filter(o=>o.reconciliation?.selected).map(o=>o.id);
   if(!['reconciliation.select','reconciliation.clearSelection'].includes(type)&&ids.some(id=>state.orders.find(o=>o.id===id)?.reconciliation?.closure))throw new Error('El lote contiene una conciliación cerrada. Reábrela con motivo antes de modificarla.');
   switch(type){
   case 'reconciliation.conditions':result=reconciliation.setConditions(order(state,p.orderId),p.conditions,ctx);break;
   case 'reconciliation.draft':result=reconciliation.setDraft(order(state,p.orderId),p.draft,ctx);break;
   case 'reconciliation.discardDraft':result=reconciliation.discardDraft(order(state,p.orderId),ctx);break;
   case 'reconciliation.estimate':result=reconciliation.applyEstimate(order(state,p.orderId),state.products,state.config,ctx);break;
   case 'reconciliation.save':result=reconciliation.saveDeposit(order(state,p.orderId),p.input||{},ctx);break;
   case 'reconciliation.followup':result=reconciliation.markFollowup(order(state,p.orderId),p.status,p.notes,ctx);break;
   case 'reconciliation.select':result=reconciliation.selectOrders(state,p.ids||[],p.selected!==false);break;
   case 'reconciliation.clearSelection':result=reconciliation.clearSelection(state);break;
   case 'reconciliation.estimateBatch':result=reconciliation.estimateBatch(state,p.ids,ctx);break;
   case 'reconciliation.saveBatch':result=reconciliation.saveBatch(state,p.ids,ctx);break;
   case 'reconciliation.confirmShipping':result=reconciliation.confirmInferredShipping(order(state,p.orderId),state.products,state.config,ctx);break;
   default:throw new Error('Operación de conciliación no reconocida.');
   }
   if(state.settlementLedger)reconcileLedger(state,ctx);
   return {ok:true,message:result?.message||(type.endsWith('Batch')?`${result.succeeded} ventas procesadas; ${result.failed} requieren revisión.`:'Conciliación actualizada.'),...result};
 }
 if(type==='config.settlement')return {ok:true,...reconciliation.updateSettlementConfig(state,p.settlement,ctx)};
 if(type==='config.payout.save'){
  const rule={...validateSchedule(p.rule),updatedAt:ctx.now,actor:ctx.actor},rules=state.config.payoutSchedules??=[],index=rules.findIndex(r=>r.channel===rule.channel);
  const before=index>=0?structuredClone(rules[index]):null;if(index>=0)rules[index]=rule;else rules.push(rule);
  (state.events??=[]).unshift({id:command.id,type,date:ctx.now,actor:ctx.actor,result:'ok',message:'Regla de cortes y pagos actualizada: '+rule.channel,changes:{before,after:rule}});
  return {ok:true,message:'Regla de cortes y pagos guardada. Solo las reglas confirmadas generan fechas previstas.'};
 }
 if(type==='config.pricing.save'){
   if(p.section==='settlement')return {ok:true,...reconciliation.updateSettlementConfig(state,p.value,ctx)};
   state.config[p.section]=validatedConfigSection(p.section,p.value);state.config.updatedAt=ctx.now;return {ok:true,message:'Configuración guardada. Las estimaciones anteriores conservan su cálculo hasta que las recalcules.'};
 }
 if(type==='config.commission.save'){const result=pricing.applyCommissionUpdate(state.config,p);if(result?.valid===false)throw new Error(result.errors.map(e=>e.message||e).join(' '));state.config=result.config;state.config.updatedAt=ctx.now;return {ok:true,message:'Comisión guardada para nuevos cálculos.'};}
 if(type==='config.mapping.save'){
   const check=pricing.validateMapping(state.config,p);if(!check.valid)throw new Error(check.errors.map(e=>e.message||e).join(' '));
   const rows=state.config.categoryMappings??=[],i=rows.findIndex(r=>r.category.toLowerCase()===p.category.toLowerCase());if(i>=0)rows[i]=structuredClone(p);else rows.push(structuredClone(p));state.config.categoryMappings=rows;return {ok:true,message:'Mapeo de categoría guardado.'};
 }
 if(type==='pricing.scenario.save'){
   const product=p.productSku?state.products.find(x=>x.sku===p.productSku):null;
   if(p.context==='recomendador'&&!product)throw new Error('Selecciona un producto.');
   const result=p.context==='recomendador'?pricing.recommend(state.config,product,p.input):pricing.quote(state.config,{...p.input,context:p.context});
   if(!result.valid)throw new Error(result.errors.map(e=>e.message||e).join(' '));
   if(!result.discount)throw new Error('El escenario no produce un precio viable para guardar.');
   (state.pricingScenarios??=[]).unshift({id:command.id,name:String(p.name||'Escenario V28').slice(0,120),date:ctx.now,context:p.context,input:structuredClone(p.input),productSku:p.productSku||null,result,configSnapshot:structuredClone(state.config)});
   return {ok:true,message:'Escenario guardado con sus entradas, resultado y configuración.',id:command.id};
 }
 if(type==='pricing.publication.prepare'){
   const product=state.products.find(x=>x.sku===p.productSku),channels=p.channels;
   if(!product||product.status==='INACTIVO'||!Array.isArray(channels)||!channels.length||channels.some(c=>!pricing.CHANNELS.includes(c))||new Set(channels).size!==channels.length)throw new Error('Selecciona un producto activo y canales válidos sin repetir.');
   const results=channels.map(channel=>pricing.recommend(state.config,product,{...p.input,channel}));
   const invalid=results.find(r=>!r.valid||!r.discount||!r.regular||r.discount.profit<0||r.regular.profit<0||!Number.isFinite(r.discount.price)||Math.round(r.discount.price*100)<=0||r.commissionRate===0&&r.channel!=='Tienda Nube');
   if(invalid)throw new Error('Revisa '+invalid.channel+': el precio debe ser viable, con costo, comisión y utilidad válidos.');
   const queue=state.pricePublicationQueue??=[];
   for(const r of results){for(const old of queue)if(old.sku===product.sku&&old.channel===r.channel&&old.status==='awaiting_connection'){old.status='superseded';old.supersededAt=ctx.now;}
    queue.unshift({id:command.id+'-'+r.channel,sku:product.sku,upc:product.upc,name:product.name,channel:r.channel,currency:'MXN',discountCents:Math.round(r.discount.price*100),regularCents:Math.round(r.regular.price*100),status:'awaiting_connection',createdAt:ctx.now,actor:ctx.actor,input:structuredClone(p.input||{}),result:r,configSnapshot:structuredClone(state.config)});
   }
   (state.events??=[]).unshift({id:command.id,type,date:ctx.now,actor:ctx.actor,result:'ok',message:results.length+' propuestas de precio preparadas para '+product.sku+'. Pendientes de conexión; no enviadas a tiendas.'});
   return {ok:true,message:'Precios preparados y guardados. Están pendientes de conexión con VentiApp; aún no se enviaron a las tiendas.'};
 }
 if(type==='pricing.legacyScenario.save'){
   const x=p.calc;for(const k of ['price','cost','shipping','commission','msi','vat','target','withholding'])if(!Number.isFinite(x?.[k])||x[k]<0)throw new Error('Revisa los campos numéricos del escenario.');for(const k of ['commission','msi','vat','target'])if(x[k]>=100)throw new Error('Las tasas deben ser menores a 100%.');
   (state.rules??=[]).push({...x,date:ctx.now});return {ok:true,message:'Escenario libre guardado.'};
 }
 if(type==='practice.reset'){if(context.workspace!=='practice')throw new Error('El restablecimiento está disponible únicamente en la práctica.');const seed=context.createPractice?.();if(!seed)throw new Error('No se pudo preparar el escenario.');for(const k of Object.keys(state))delete state[k];Object.assign(state,seed);return {ok:true,message:'Escenario de práctica restablecido. La operación V28 conserva sus registros.'};}
 throw new Error('La operación solicitada no está implementada.');
}
