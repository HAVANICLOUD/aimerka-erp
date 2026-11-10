/** Archive catalogue presentation without removing identity or transactional history. */
export const PHYSICAL_POOLS=['good','reserved','quarantine','damaged'];
export const isDiscontinued=p=>p?.lifecycle?.discontinued===true;
export const isHidden=p=>p?.lifecycle?.hidden===true;
export const catalogVisible=p=>!!p&&!isHidden(p);
export const commerciallySelectable=p=>catalogVisible(p)&&!isDiscontinued(p)&&p.status!=='INACTIVO';
export function discontinuationEligibility(state,p){
 const issues=[];
 if(!p)issues.push('Producto no encontrado.');
 else{
  if(PHYSICAL_POOLS.some(key=>!Number.isFinite(Number(p[key]??0))||Number(p[key]??0)!==0))issues.push('Las existencias físicas, reservas, inspección y no vendibles deben estar en cero.');
  if((state.warehouseStock||[]).filter(row=>row.sku===p.sku).some(row=>PHYSICAL_POOLS.some(key=>!Number.isFinite(Number(row[key]??0))||Number(row[key]??0)!==0)))issues.push('Todos los almacenes deben tener saldo cero para este producto; revisa también déficits.');
 }
 return {eligible:issues.length===0,issues};
}
function record(state,p,command,ctx,label,patch){
 const previous=p.lifecycle||{};
 p.lifecycle={...previous,...patch,updatedAt:ctx.now,actor:ctx.actor,history:[...(previous.history||[]),{id:command.id,type:command.type,date:ctx.now,actor:ctx.actor,reason:String(command.payload?.reason||'').trim(),discontinued:patch.discontinued??previous.discontinued??false,hidden:patch.hidden??previous.hidden??false}]};
 (state.events??=[]).unshift({id:command.id,type:command.type,date:ctx.now,actor:ctx.actor,result:'ok',message:label,changes:{sku:p.sku,discontinued:isDiscontinued(p),hidden:isHidden(p)}});
 return {ok:true,sku:p.sku,message:label};
}
export function applyProductLifecycle(state,command,ctx={}){
 const payload=command.payload||{},p=(state.products||[]).find(p=>p.sku===payload.sku);
 if(!p)throw Error('Producto no encontrado.');
 if(payload.reason!==undefined&&(typeof payload.reason!=='string'||payload.reason.length>1000))throw Error('Escribe un motivo de hasta 1000 caracteres.');
 if(command.type==='inventory.product.discontinue'){
  const check=discontinuationEligibility(state,p);if(!check.eligible)throw Error(check.issues.join(' '));
  if(!String(payload.reason||'').trim())throw Error('Indica el motivo para descontinuar el producto.');
  if(payload.hide!==undefined&&typeof payload.hide!=='boolean')throw Error('La opción de ocultar debe ser válida.');
  if(isDiscontinued(p))throw Error('Este producto ya está descontinuado. Puedes cambiar su visibilidad o reactivarlo.');
  const status=p.status||'OK';p.status='INACTIVO';
  return record(state,p,command,ctx,'Producto descontinuado'+(payload.hide?' y oculto':'')+'. El historial y las conciliaciones se conservan.',{discontinued:true,hidden:payload.hide===true,previousStatus:status,discontinuedAt:ctx.now});
 }
 if(command.type==='inventory.product.visibility'){
  if(typeof payload.hidden!=='boolean'||!isDiscontinued(p))throw Error('Solo se pueden ocultar productos descontinuados.');
  if(payload.hidden){const check=discontinuationEligibility(state,p);if(!check.eligible)throw Error(check.issues.join(' '));}
  return record(state,p,command,ctx,payload.hidden?'Producto oculto de los catálogos operativos. El historial se conserva.':'Producto visible en el catálogo; continúa descontinuado.',{hidden:payload.hidden});
 }
 if(command.type==='inventory.product.reactivate'){
  if(!isDiscontinued(p))throw Error('El producto ya está activo.');
  p.status='OK';
  return record(state,p,command,ctx,'Producto reactivado y visible. Sus identificadores e historial se conservan.',{discontinued:false,hidden:false,reactivatedAt:ctx.now});
 }
 throw Error('Operación de ciclo de producto no reconocida.');
}
/** A real return/receipt must remain possible, including for an archived sale. */
export function revealProductsWithStock(state,command,ctx={}){
 for(const p of state.products||[]){
  if(!isDiscontinued(p)&&!isHidden(p))continue;
  if(discontinuationEligibility(state,p).eligible){if(isDiscontinued(p))p.status='INACTIVO';continue;}
  p.status=p.lifecycle?.previousStatus==='INACTIVO'?'INACTIVO':'OK';
  record(state,p,{...command,id:command.id+'-reveal-'+p.sku,type:'inventory.product.autoReactivate',payload:{reason:'Entrada o corrección física: '+command.type}},ctx,'Producto visible nuevamente por un movimiento físico: '+p.sku+'.',{discontinued:false,hidden:false,reactivatedAt:ctx.now});
 }
}
