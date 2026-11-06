import {renameProductSkus} from './product-identity.mjs';
const pools=['good','reserved','quarantine','damaged','safety'];
const key=v=>String(v??'').trim().toUpperCase();
export function inventoryTimeline(state,product){
 const codes=new Set([product.sku,product.upc,...(product.skuAliases||[])].filter(Boolean).map(key)),matches=l=>[l.sku,l.upc,l.skuOrUpc].some(c=>codes.has(key(c)));
 const movements=(state.movements||[]).filter(matches).map(m=>({...m,sourceKind:'movement',quantity:m.delta??m.qty??0}));
 const sales=(state.orders||[]).filter(o=>o.stockMode==='historical').flatMap(o=>{const lines=o.items?.length?o.items:[{sku:o.sku,qty:o.qty||1}];const n=lines.filter(matches).reduce((s,l)=>s+Number(l.qty||0),0);if(!n)return [];return [{id:'sale-history-'+o.id,date:o.documentDate||o.date,sku:product.sku,type:o.commercialStatus==='Cancelada'||o.status==='cancelled'?'sale.historical.cancelled':'sale.historical',quantity:n,reference:o.number||o.id,orderId:o.id,market:o.market,sourceKind:'sale-reference',note:'Venta documental; incluida en el saldo de origen. No vuelve a descontar inventario.'}];});
 return [...movements,...sales].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
}
export function previewSicarInventory(state,manifest){
 const fail=m=>{throw new Error(m);};
 if(manifest?.format!=='AIMERKA-SICAR-INVENTORY-1'||!Array.isArray(manifest.entries)||!manifest.entries.length||manifest.entries.length>10000||!/^[a-f0-9]{64}$/.test(manifest.sha256||''))fail('Archivo de cotejo SICAR inválido.');
 const seen=new Set(),target=new Set();const rows=manifest.entries.map(r=>{const p=state.products?.find(p=>p.sku===r.sku);if(!p||seen.has(p.sku)||!r.primaryCode||target.has(key(r.primaryCode)))fail('Producto sin identificar, repetido o código principal duplicado.');seen.add(p.sku);target.add(key(r.primaryCode));
  if(!Number.isSafeInteger(r.quantity)||r.quantity< -1000000||r.quantity>1000000||!r.name||!Array.isArray(r.codes)||!r.codes.includes(r.primaryCode)||r.codes.some(c=>typeof c!=='string'||c.length>100))fail('Revisa las cantidades y códigos de '+p.name+'.');
  for(const k of pools)if(Number(p[k]||0)!==Number(r.expectedStock?.[k]||0))fail('El inventario de '+p.name+' cambió desde el cotejo; actualiza el respaldo antes de aplicar.');
  if((r.quantity<Number(p.reserved||0)&&Number(p.reserved||0)>0))fail('El saldo SICAR no cubre las reservas activas de '+p.name+'. Revisa esa diferencia antes de aplicar.');
  if(r.satCode&&!/^\d{8}$/.test(r.satCode))fail('Clave SAT inválida en '+p.name+'.');
  return {product:p,input:r,from:p.sku,to:r.primaryCode,before:Number(p.good||0),after:r.quantity,delta:r.quantity-Number(p.good||0),negative:r.quantity<0};
 });
 const ownerByCode=new Map();
 for(const p of state.products||[])for(const c of [p.sku,p.upc,p.sellerSku,...(p.skuAliases||[])].filter(Boolean)){const k=key(c);if(!ownerByCode.has(k))ownerByCode.set(k,p.sku);}
 for(const row of rows)for(const c of row.input.codes){const owner=ownerByCode.get(key(c));if(owner&&owner!==row.from)fail('El código '+c+' identifica dos productos. Revisa las equivalencias antes de aplicar.');ownerByCode.set(key(c),row.from);}
 if(state.warehouseStock?.some(b=>b.warehouseId!=='principal'&&rows.some(r=>r.from===b.sku)&&pools.some(k=>Number(b[k]||0)!==0)))fail('Hay existencias en otros almacenes. Distribuye el cotejo por almacén antes de aplicar.');
 const draft=structuredClone(state);renameProductSkus(draft,rows.map(r=>({from:r.from,to:r.to})),{source:'SICAR'});
 return {rows,count:rows.length,renamed:rows.filter(r=>r.from!==r.to).length,changedStock:rows.filter(r=>r.delta).length,totalBefore:rows.reduce((s,r)=>s+r.before,0),totalAfter:rows.reduce((s,r)=>s+r.after,0),negativeCount:rows.filter(r=>r.negative).length,satCount:rows.filter(r=>r.input.satCode).length};
}
export function importSicarInventory(state,command,ctx){
 if(!ctx.actor||String(ctx.actor).toLowerCase()!==String(ctx.ownerEmail||'').toLowerCase())throw new Error('Solo el propietario puede aplicar el cotejo completo de SICAR.');
 const m=command.payload?.manifest;if(state.sicarInventorySnapshot?.sha256===m?.sha256)return {ok:true,duplicate:true,message:'Este archivo SICAR ya se aplicó; no se repitieron ajustes.'};
 const plan=previewSicarInventory(state,m),mapping=renameProductSkus(state,plan.rows.map(r=>({from:r.from,to:r.to})),{...ctx,source:'SICAR'});
 for(const [i,row]of plan.rows.entries()){const p=state.products.find(p=>p.sku===row.to),r=row.input;
  p.name=r.name;p.good=r.quantity;p.skuAliases=[...new Set([...(p.skuAliases||[]),...r.codes])].filter(c=>key(c)!==key(p.sku));p.skuOrigin='SICAR';p.sicarCode=r.primaryCode;p.stockStatus=r.quantity<0?'Déficit en SICAR':'Cotejado con SICAR';p.updatedAt=ctx.now;
  p.sicarInventory={quantity:r.quantity,warehouse:'Default',sourceHash:m.sha256,sourceRow:r.sourceRow,capturedAt:m.capturedAt,appliedAt:ctx.now,codes:r.codes,satCode:r.satCode||null,emptyExportVerifiedAsZero:!!r.emptyExportVerifiedAsZero};
  if(r.satCode){p.satCode=r.satCode;p.satCodeSource={source:'SICAR',checkedAt:ctx.now,sourceHash:m.sha256};}
  if(state.warehouseStock){const rows=state.warehouseStock.filter(b=>b.sku===p.sku),others=rows.filter(b=>b.warehouseId!=='principal').reduce((s,b)=>s+Number(b.good||0),0);let principal=rows.find(b=>b.warehouseId==='principal');if(!principal){principal={warehouseId:'principal',sku:p.sku,good:0,reserved:0,quarantine:0,damaged:0,safety:0};state.warehouseStock.push(principal);}principal.good=r.quantity-others;}
  const queue={id:'stock-'+p.sku,sku:p.sku,upc:p.upc||'',availableQty:Math.max(0,p.good-Number(p.reserved||0)-Number(p.safety||0)),status:'awaiting_connection',updatedAt:ctx.now,reference:'Cotejo SICAR · Default'};
  state.stockSyncQueue??=[];const qi=state.stockSyncQueue.findIndex(q=>q.sku===p.sku);if(qi<0)state.stockSyncQueue.push(queue);else state.stockSyncQueue[qi]=queue;
  if(row.delta)(state.movements??=[]).unshift({id:command.id+'-'+i,date:ctx.now,type:'inventory.sicarSync',sku:p.sku,pool:'good',delta:row.delta,before:row.before,after:row.after,reference:'Cotejo SICAR · Default',actor:ctx.actor,sourceHash:m.sha256});
 }
 state.sicarInventorySnapshot={sha256:m.sha256,fileName:m.fileName,capturedAt:m.capturedAt,appliedAt:ctx.now,actor:ctx.actor,products:plan.count,totalUnits:plan.totalAfter,satCodes:plan.satCount,negativeCount:plan.negativeCount};
 (state.events??=[]).unshift({id:command.id,type:command.type,date:ctx.now,actor:ctx.actor,result:'ok',message:'Catálogo cotejado con SICAR: '+plan.count+' productos, '+plan.changedStock+' ajustes; compras, ventas y documentos conservados.',changes:{mappings:mapping,quantityChanges:plan.rows.filter(r=>r.delta).map(r=>({sku:r.to,before:r.before,after:r.after})),sourceHash:m.sha256}});
 return {ok:true,count:plan.count,changedStock:plan.changedStock,renamed:plan.renamed,totalUnits:plan.totalAfter,message:'Inventario, códigos y claves SAT actualizados conforme a SICAR.'};
}
