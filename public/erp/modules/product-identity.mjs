const key=v=>String(v??'').trim().toUpperCase();
export function renameProductSkus(state,changes,ctx={}){
 const products=state.products||[],mapping=new Map(),seen=new Set(),rows=[];
 for(const c of changes||[]){const from=String(c.from||'').trim(),to=String(c.to||'').trim(),p=products.find(p=>p.sku===from);if(!p||!to||to.length>80||!/^[A-Za-z0-9Ññ][A-Za-z0-9Ññ._/+-]*$/.test(to)||mapping.has(from)||seen.has(key(to)))throw new Error('Revisa los SKU: deben ser únicos, de hasta 80 caracteres y sin espacios.');seen.add(key(to));if(from===to)continue;mapping.set(from,to);rows.push({from,to,name:p.name});}
 for(const {from,to}of rows)if(products.some(p=>p.sku!==from&&[p.sku,p.upc,p.sellerSku,...(p.skuAliases||[])].some(c=>c&&key(c)===key(to))))throw new Error('El SKU '+to+' ya identifica otro producto. No se modificó ningún dato.');
 for(const p of products)if(mapping.has(p.sku)){const old=p.sku;p.sku=mapping.get(old);p.skuAliases=[...new Set([...(p.skuAliases||[]),old])].filter(a=>key(a)!==key(p.sku));p.skuOrigin=ctx.source||'Edición manual';p.skuUpdatedAt=ctx.now;}
 const skip=new Set(['source','sourceAudit','sourceTrace','rawReconciliation','rawReconciliationDetail','v43SourceTables','sicarMonthlyReference','sicarMovements','events','sicarHistory','parsed','history','original','signature','fiscalValidation']);
 const walk=(value)=>{if(!value||typeof value!=='object')return;if(Array.isArray(value)){for(const row of value)walk(row);return;}for(const[k,v]of Object.entries(value)){if(skip.has(k))continue;if(['sku','skuOrUpc','productSku'].includes(k)&&mapping.has(v))value[k]=mapping.get(v);else if(v&&typeof v==='object')walk(v);}};
 for(const[k,v]of Object.entries(state))if(k!=='products'&&!skip.has(k))walk(v);
 for(const row of state.stockSyncQueue||[]){for(const[from,to]of mapping){if(row.id==='stock-'+from)row.id='stock-'+to;if(row.reference===from)row.reference=to;}}
 return rows;
}
export function renameProductCommand(state,command,ctx){const rows=renameProductSkus(state,[{from:command.payload?.sku,to:command.payload?.newSku}],ctx);if(rows.length)(state.events??=[]).unshift({id:command.id,type:command.type,date:ctx.now,actor:ctx.actor,result:'ok',message:'SKU actualizado conservando alias, existencias e historial.',changes:{mappings:rows}});return {ok:true,sku:rows[0]?.to||command.payload?.sku,message:'SKU guardado. Las referencias y el historial se conservaron.'};}

/** Select a documented alphanumeric SKU; a numeric main code is not a SKU choice. */
export function previewSicarSkuRestoration(state){
 const imports=(state.events||[]).filter(e=>e.type==='inventory.importSicarCatalog'&&e.changes?.mappings);
 const rows=[],unresolved=[];
 for(const p of state.products||[]){
  if(!p.sicarInventory)continue;
  const codes=p.sicarInventory.codes||[],source=imports.find(e=>e.changes.sourceHash===p.sicarInventory.sourceHash),previous=source?.changes.mappings.find(m=>m.to===p.sicarCode&&[p.sku,...(p.skuAliases||[])].includes(m.from))?.from;
  // Respect corrections made manually after the original import.
  if(/[A-Za-z]/.test(p.sku)&&p.sku!==p.sicarCode)continue;
  const alpha=codes.filter(c=>/[A-Za-z]/.test(c)),descriptive=alpha.filter(c=>!/^S\d+$/i.test(c));
  let to,origin;
  if(previous&&descriptive.includes(previous)){to=previous;origin='SICAR';}
  else if(descriptive.length===1){to=descriptive[0];origin='SICAR';}
  else if(!descriptive.length&&alpha.length===1){to=alpha[0];origin='SICAR';}
  else if(!alpha.length&&previous&&/[A-Za-z]/.test(previous)){to=previous;origin='SKU anterior AIMERKA';}
  else if(alpha.includes(p.sku)){to=p.sku;origin='SICAR';}
  else {unresolved.push({sku:p.sku,name:p.name,candidates:alpha});continue;}
  if(to!==p.sku)rows.push({from:p.sku,to,name:p.name,origin});
 }
 if(rows.length){const draft=structuredClone(state);renameProductSkus(draft,rows,{source:'Restitución SKU SICAR'});}
 return {rows,unresolved,count:rows.length,sicarCount:rows.filter(r=>r.origin==='SICAR').length,previousCount:rows.filter(r=>r.origin!=='SICAR').length};
}
export function restoreSicarSkus(state,command,ctx){
 if(!ctx.actor||key(ctx.actor)!==key(ctx.ownerEmail))throw new Error('Solo el propietario puede restablecer los SKU del catálogo.');
 if(!state.sicarInventorySnapshot?.sha256||command.payload?.sourceHash!==state.sicarInventorySnapshot.sha256)throw new Error('El cotejo SICAR cambió. Vuelve a revisar los códigos.');
 const plan=previewSicarSkuRestoration(state);
 if(plan.unresolved.length)throw new Error('Hay '+plan.unresolved.length+' productos con códigos ambiguos. Revisa sus equivalencias antes de restablecer.');
 if(!plan.count)return {ok:true,duplicate:true,message:'Los SKU alfanuméricos ya están restablecidos.'};
 const rows=renameProductSkus(state,plan.rows,{...ctx,source:'SKU alfanumérico SICAR'});
 for(const r of plan.rows){const p=state.products.find(p=>p.sku===r.to);p.skuOrigin=r.origin;p.skuRestoredAt=ctx.now;p.skuRestoration={from:r.from,origin:r.origin,sourceHash:command.payload.sourceHash};}
 state.sicarInventorySnapshot.skuPolicy='preserve-alphanumeric';
 (state.events??=[]).unshift({id:command.id,type:command.type,date:ctx.now,actor:ctx.actor,result:'ok',message:plan.count+' SKU alfanuméricos restablecidos; UPC, existencias y conciliaciones conservados.',changes:{mappings:rows,sourceHash:command.payload.sourceHash,sicarCount:plan.sicarCount,previousCount:plan.previousCount}});
 return {ok:true,count:plan.count,message:plan.count+' SKU alfanuméricos restablecidos. Se conservaron los vínculos, los UPC y las existencias.'};
}
