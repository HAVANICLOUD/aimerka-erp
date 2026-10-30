/** Warehouse balances complement existing aggregate stock; never reimport stock. */
export const POOLS=['good','reserved','quarantine','damaged','safety'];
const empty=()=>Object.fromEntries(POOLS.map(k=>[k,0]));
export function warehouses(state){return state.warehouses?.length?state.warehouses:[{id:'principal',name:'Almacén principal',code:'PRINCIPAL',active:true}];}
export function warehouseBalances(state){return state.warehouseStock||state.products.map(p=>({warehouseId:'principal',sku:p.sku,...Object.fromEntries(POOLS.map(k=>[k,Number(p[k]||0)]))}));}
function initialize(state){state.warehouses??=warehouses(state);state.warehouseStock??=warehouseBalances(state);}
function warehouse(state,id){const w=warehouses(state).find(w=>w.id===(id||'principal'));if(!w||!w.active)throw new Error('Selecciona un almacén activo.');return w;}
function balance(state,id,sku){let row=state.warehouseStock.find(b=>b.warehouseId===id&&b.sku===sku);if(!row){row={warehouseId:id,sku,...empty()};state.warehouseStock.push(row);}return row;}
function audit(state,command,ctx,message,details){(state.events??=[]).unshift({id:command.id,type:command.type,date:ctx.now,actor:ctx.actor,result:'ok',message,changes:details});return {ok:true,message};}
export function warehouseCommand(state,command,ctx){
 initialize(state);const p=command.payload||{};
 if(command.type==='warehouse.save'){
  const id=p.id||'alm-'+command.id,name=String(p.name||'').trim(),code=String(p.code||'').trim().toUpperCase();
  if(!name||name.length>120||!code||!/^[A-Z0-9_-]{1,24}$/.test(code))throw new Error('Escribe el nombre y una clave de hasta 24 letras, números o guiones.');
  const current=state.warehouses.find(w=>w.id===id);if(p.id&&!current)throw new Error('Almacén no encontrado.');
  if(state.warehouses.some(w=>w.id!==id&&(w.code===code||w.name.toLowerCase()===name.toLowerCase())))throw new Error('Ya existe esa clave o nombre de almacén.');
  const active=p.active!==false;
  if(!active&&(id==='principal'||state.warehouseStock.some(b=>b.warehouseId===id&&POOLS.some(k=>b[k]>0))||state.orders.some(o=>o.warehouseId===id&&o.status==='reserved')))throw new Error('El almacén principal y los almacenes con existencias o reservas deben permanecer activos.');
  const row={id,name,code,active,address:String(p.address||'').trim().slice(0,300),updatedAt:ctx.now};if(current)Object.assign(current,row);else state.warehouses.push({...row,createdAt:ctx.now});
  return {...audit(state,command,ctx,'Almacén guardado. Las existencias se conservan.',row),id};
 }
 if(command.type==='warehouse.transfer'){
  const from=warehouse(state,p.from),to=warehouse(state,p.to),qty=Number(p.qty),reason=String(p.reason||'').trim(),product=state.products.find(x=>x.sku===p.sku);
  if(from.id===to.id||!product||!Number.isSafeInteger(qty)||qty<=0||!reason)throw new Error('Selecciona almacenes distintos, producto, cantidad entera positiva y motivo.');
  const source=balance(state,from.id,p.sku),target=balance(state,to.id,p.sku),available=Math.max(0,source.good-source.reserved-source.safety);
  if(qty>available)throw new Error('El almacén de origen tiene '+available+' unidades disponibles; las reservas y el stock de seguridad se conservan.');
  source.good-=qty;target.good+=qty;
  const transfer={id:command.id,date:ctx.now,actor:ctx.actor,from:from.id,to:to.id,sku:p.sku,qty,reason:reason.slice(0,2000)};
  (state.warehouseTransfers??=[]).unshift(transfer);
  return audit(state,command,ctx,'Traspaso registrado. El inventario total no cambia.',transfer);
 }
 throw new Error('Operación de almacén no reconocida.');
}
export function applyWarehouseInventory(state,command,ctx,apply){
 if(!state.warehouseStock)return apply(state,command,ctx);
 const p=command.payload||{},order=p.orderId?state.orders.find(o=>o.id===p.orderId):null;
 const id=order?.warehouseId||p.warehouseId||'principal';
 if(order&&p.warehouseId&&p.warehouseId!==(order.warehouseId||'principal'))throw new Error('El movimiento debe conservar el almacén de la venta.');
 warehouse(state,id);
 const before=new Map(state.products.map(p=>[p.sku,Object.fromEntries(POOLS.map(k=>[k,Number(p[k]||0)]))]));
 const result=apply(state,command,ctx);
 for(const product of state.products){
  const previous=before.get(product.sku)||empty(),deltas=POOLS.map(k=>[k,Number(product[k]||0)-previous[k]]).filter(([,v])=>v);
  if(!deltas.length)continue;
  const local=balance(state,id,product.sku);for(const [k,delta]of deltas)local[k]+=delta;
  if(POOLS.some(k=>!Number.isSafeInteger(local[k])||local[k]<0)||local.reserved>local.good)throw new Error('El almacén seleccionado no tiene existencias suficientes para '+product.sku+'.');
  if(command.type==='sale.create'&&local.good-local.reserved-local.safety<0)throw new Error('La reserva invade el stock de seguridad del almacén.');
 }
 if(command.type==='sale.create'){const saved=state.orders.find(o=>o.id===result.id);if(saved)saved.warehouseId=id;}
 if(command.type==='inventory.receivePurchase'){const receipt=state.purchaseReceipts.find(r=>r.id===result.receiptId);if(receipt)receipt.warehouseId=id;}
 for(const movement of state.movements||[])if(movement.id?.startsWith(command.id+'-'))movement.warehouseId=id;
 return result;
}
