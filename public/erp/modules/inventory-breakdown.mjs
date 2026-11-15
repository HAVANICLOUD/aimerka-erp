/** Read-only explanation of current inventory buckets. Historical sales alone never allocate stock. */
import {available,orderItems} from './inventory-v28.mjs';
export const INVENTORY_BUCKETS=Object.freeze([
 {key:'good',label:'Inventario físico vendible',icon:'box',description:'Saldo físico vendible. Incluye las unidades reservadas y la protección de seguridad; inspección y no vendible se consultan por separado.'},
 {key:'reserved',label:'Unidades en reserva',icon:'lock',description:'Unidades apartadas para pedidos que siguen en curso. Consulta el pedido, marketplace y estado de la reserva.'},
 {key:'quarantine',label:'Unidades en inspección',icon:'search',description:'Mercancía recibida para revisar. Aún no está disponible para venta.'},
 {key:'damaged',label:'Inventario no vendible',icon:'alert',description:'Unidades rechazadas o clasificadas como no vendibles. El origen se muestra solo cuando existe evidencia registrada.'},
 {key:'safety',label:'Inventario de seguridad',icon:'shield',description:'Protección configurada por producto. No agrega piezas al físico ni corresponde a una venta; se descuenta al calcular disponibilidad.'},
 {key:'available',label:'Disponible para vender',icon:'check',description:'Físico vendible menos reservas y seguridad, con mínimo cero. Respeta productos inactivos, ocultos y descontinuados.'}
].map(Object.freeze));
const code=v=>String(v??'').trim().toUpperCase();
const qty=v=>Number.isFinite(Number(v))?Number(v):0;
function productIndex(products){const index=new Map();for(const p of products)for(const c of [p.sku,p.upc,p.sellerSku,...(p.skuAliases||[])].filter(Boolean)){const k=code(c);index.set(k,index.has(k)&&index.get(k)!==p.sku?null:p.sku);}return line=>{const owners=new Set([line.sku,line.productSku,line.skuOrUpc,line.upc,line.sellerSku].map(c=>index.get(code(c))).filter(Boolean));return owners.size===1?[...owners][0]:null;};}
const orderView=o=>({orderId:o.id,orderNumber:o.number||o.literalNumber||o.id,market:o.market||'',orderStatus:o.status||'',returnStatus:o.returnStatus||'',documentDate:o.documentDate||o.date||'',paymentStatus:o.paymentStatus||''});
function unknown(quantity,reason='Saldo sin referencia documental de origen'){return {kind:'unknown',quantity,reason,orderId:null,market:'',source:'Origen por verificar'};}
function originsFromMovements(state,movements,current,orders,eventIndex){
 let allocations=[],balance=0,conflict=false;
 const orderById=new Map(orders.map(o=>[String(o.id),o]));
 const rows=movements.map((m,i)=>({m,i})).sort((a,b)=>String(a.m.date||'').localeCompare(String(b.m.date||''))||b.i-a.i);
 for(const {m} of rows){
  const delta=Number(m.delta??m.qty);if(!Number.isFinite(delta)||delta===0)continue;
  const before=Number(m.before),hasBefore=m.before!==null&&m.before!==undefined&&Number.isFinite(before);
  if(hasBefore&&before!==balance){if(before>balance)allocations.push(unknown(before-balance,'Saldo anterior o ajuste sin desglose de origen'));else {allocations=before>0?[unknown(before,'Reducción previa sin referencia de unidades de origen')]:[];conflict=true;}balance=before;}
  const o=orderById.get(String(m.orderId??''))||(String(m.type||'').startsWith('sale.')?orderById.get(String(m.reference)):null);
  const movementId=String(m.id||''),requestId=movementId.slice(0,movementId.lastIndexOf('-'));
  const event=eventIndex.byId.get(requestId)||(o?eventIndex.byOrder.get(JSON.stringify([o.id,m.type,m.date])):null);
  const reason=m.reason||m.note||m.notes||event?.message||(o?(m.type==='sale.return_reject'?'Devolución clasificada como no vendible':m.type==='sale.return_receive'?'Devolución recibida y pendiente de inspección':m.type==='sale.create'?'Reserva de pedido registrada':m.reference):m.reference)||'Movimiento registrado sin motivo';
  const after=Number(m.after),hasAfter=m.after!==null&&m.after!==undefined&&Number.isFinite(after);
  if(delta>0){allocations.push({kind:o?'order':'adjustment',quantity:delta,...o?orderView(o):{orderId:null,market:''},reason,date:m.date||'',warehouseId:m.warehouseId||o?.warehouseId||'',movementId:m.id||'',source:o?'Movimiento de inventario vinculado a venta':'Ajuste documentado sin venta relacionada'});}
  else if(o){let remaining=-delta;for(const row of allocations)if(row.orderId===o.id&&remaining>0){const removed=Math.min(remaining,row.quantity);row.quantity-=removed;remaining-=removed;}for(const row of allocations)if(row.kind==='unknown'&&remaining>0){const removed=Math.min(remaining,row.quantity);row.quantity-=removed;remaining-=removed;}if(remaining>0){allocations=[];conflict=true;}}
  else {allocations=[];conflict=true;}
  balance=Math.max(0,balance+delta);
  if(hasAfter&&after!==balance){allocations=[];balance=Math.max(0,after);conflict=true;}
  const allocated=allocations.reduce((s,r)=>s+r.quantity,0);if(allocated<balance)allocations.push(unknown(balance-allocated,delta<0&&!o?'Saldo tras reducción manual; no se identifica qué unidades de cada venta permanecen':'Saldo no explicado por movimientos completos'));
  allocations=allocations.filter(r=>r.quantity>0);if(balance===0)conflict=false;
 }
 if(balance>current){allocations=current>0?[unknown(current,'El saldo actual es menor que el historial; origen de las unidades restantes por verificar')]:[];conflict=true;}
 else if(balance<current)allocations.push(unknown(current-balance));
 return {allocations,conflict};
}
function declaredOrigins(state,product,pool,match,current){
 const claims=[];
 for(const o of state.orders||[]){
  const lines=orderItems(o).filter(l=>match(l)===product.sku);if(!lines.length)continue;
  let amount=0;
  if(pool==='reserved'&&o.status==='reserved'&&o.stockMode!=='historical')amount=lines.reduce((n,l)=>n+Math.max(0,qty(l.reservedQty??l.qty)),0);
  if(pool==='quarantine')amount=lines.reduce((n,l)=>n+Math.max(0,qty(l.returnedQty)-qty(l.restockedQty)-qty(l.rejectedQty)),0);
  if(pool==='damaged')amount=lines.reduce((n,l)=>n+Math.max(0,qty(l.rejectedQty)),0);
  if(amount>0)claims.push({...orderView(o),kind:'order',quantity:amount,date:pool==='reserved'?o.creationDate||o.date:o.returnedAt||o.date,reason:pool==='reserved'?(o.paymentStatus==='refunded'?'Pedido reembolsado con reserva aún registrada; requiere revisión':'Reserva activa registrada en las partidas del pedido'):o.incident||'Cantidad de devolución registrada en las partidas de la venta',source:'Partidas registradas; sin movimientos detallados'});
 }
 const claimed=claims.reduce((n,r)=>n+r.quantity,0);
 if(claimed>current)return {allocations:[unknown(current,'Las cantidades declaradas por las ventas superan el saldo actual; revisar correspondencia')],conflict:true,relatedOrders:claims};
 return {allocations:[...claims,...claimed<current?[unknown(current-claimed)]:[]],conflict:false,relatedOrders:[]};
}
export function inventoryPoolReport(state,pool){
 const definition=INVENTORY_BUCKETS.find(r=>r.key===pool);if(!definition)throw Error('Selecciona un estado de inventario válido.');
 const products=state.products||[],orders=state.orders||[],match=productIndex(products),bySku=new Map();
 for(const m of state.movements||[]){if(m.pool!==pool)continue;const sku=match(m);if(sku){if(!bySku.has(sku))bySku.set(sku,[]);bySku.get(sku).push(m);}}
 const eventIndex={byId:new Map(),byOrder:new Map()};for(const e of state.events||[]){if(e.id&&!eventIndex.byId.has(String(e.id)))eventIndex.byId.set(String(e.id),e);if(e.orderId){const key=JSON.stringify([e.orderId,e.type,e.date]);if(!eventIndex.byOrder.has(key))eventIndex.byOrder.set(key,e);}}
 const rows=[];
 for(const product of products){
  const quantity=pool==='available'?available(product):qty(product[pool]);if(quantity===0)continue;
  const movements=bySku.get(product.sku)||[];let origins=[],conflict=false,relatedOrders=[];
  if(quantity<0){origins=[{kind:'deficit',quantity,reason:'Déficit de origen registrado en inventario; no representa unidades disponibles.',source:product.sicarInventory?'Saldo SICAR':'Saldo registrado'}];}
  else if(pool==='safety'){origins=[{kind:'configuration',quantity,reason:'Protección configurada en la ficha del producto. No pertenece a un pedido.',source:'Configuración del producto'}];}
  else if(pool==='good'||pool==='available'){origins=[{kind:'balance',quantity,reason:pool==='good'?'Saldo físico vendible registrado; consulta movimientos para revisar sus entradas y salidas.':'Disponible = físico vendible − reservas − seguridad. No incluye inspección ni no vendible.',source:'Saldo actual del inventario'}];}
  else {const result=movements.length?originsFromMovements(state,movements,quantity,orders,eventIndex):declaredOrigins(state,product,pool,match,quantity);origins=result.allocations;conflict=result.conflict;relatedOrders=result.relatedOrders||[];}
  // Merge partial receipts for the same order, without dropping their detailed reasons.
  const grouped=new Map();for(const row of origins){const id=JSON.stringify([row.kind,row.orderId||'',row.warehouseId||'',row.kind==='unknown'?row.reason:'']);if(!grouped.has(id))grouped.set(id,{...row,quantity:0,details:[]});const group=grouped.get(id);group.quantity+=row.quantity;group.details.push({...row});}
  origins=[...grouped.values()];
  const linkedQuantity=origins.filter(r=>r.orderId).reduce((n,r)=>n+r.quantity,0),unverifiedQuantity=origins.filter(r=>r.kind==='unknown').reduce((n,r)=>n+r.quantity,0);
  rows.push({sku:product.sku,product,quantity,physical:qty(product.good),reserved:qty(product.reserved),safety:qty(product.safety),available:available(product),origins,relatedOrders,linkedQuantity,unverifiedQuantity,conflict,lastMovement:movements.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))[0]||null});
 }
 rows.sort((a,b)=>Number(b.unverifiedQuantity>0)-Number(a.unverifiedQuantity>0)||String(a.product.name).localeCompare(String(b.product.name)));
 return {pool,definition,rows,total:rows.reduce((n,r)=>n+r.quantity,0),products:rows.length,linkedQuantity:rows.reduce((n,r)=>n+r.linkedQuantity,0),unverifiedQuantity:rows.reduce((n,r)=>n+r.unverifiedQuantity,0),deficits:rows.filter(r=>r.quantity<0).length};
}
