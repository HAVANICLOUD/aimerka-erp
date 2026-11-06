const key=v=>String(v??'').trim().toUpperCase();
export function renameProductSkus(state,changes,ctx={}){
 const products=state.products||[],mapping=new Map(),seen=new Set(),rows=[];
 for(const c of changes||[]){const from=String(c.from||'').trim(),to=String(c.to||'').trim(),p=products.find(p=>p.sku===from);if(!p||!to||to.length>80||!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(to)||mapping.has(from)||seen.has(key(to)))throw new Error('Revisa los SKU: deben ser únicos, de hasta 80 caracteres y sin espacios.');seen.add(key(to));if(from===to)continue;mapping.set(from,to);rows.push({from,to,name:p.name});}
 for(const {from,to}of rows)if(products.some(p=>p.sku!==from&&[p.sku,p.upc,p.sellerSku,...(p.skuAliases||[])].some(c=>c&&key(c)===key(to))))throw new Error('El SKU '+to+' ya identifica otro producto. No se modificó ningún dato.');
 for(const p of products)if(mapping.has(p.sku)){const old=p.sku;p.sku=mapping.get(old);p.skuAliases=[...new Set([...(p.skuAliases||[]),old])].filter(a=>key(a)!==key(p.sku));p.skuOrigin=ctx.source||'Edición manual';p.skuUpdatedAt=ctx.now;}
 const skip=new Set(['source','sourceAudit','sourceTrace','rawReconciliation','rawReconciliationDetail','v43SourceTables','sicarMonthlyReference','sicarMovements','events','sicarHistory','parsed','history','original','signature','fiscalValidation']);
 const walk=(value)=>{if(!value||typeof value!=='object')return;if(Array.isArray(value)){for(const row of value)walk(row);return;}for(const[k,v]of Object.entries(value)){if(skip.has(k))continue;if(['sku','skuOrUpc','productSku'].includes(k)&&mapping.has(v))value[k]=mapping.get(v);else if(v&&typeof v==='object')walk(v);}};
 for(const[k,v]of Object.entries(state))if(k!=='products'&&!skip.has(k))walk(v);
 for(const row of state.stockSyncQueue||[]){for(const[from,to]of mapping){if(row.id==='stock-'+from)row.id='stock-'+to;if(row.reference===from)row.reference=to;}}
 return rows;
}
export function renameProductCommand(state,command,ctx){const rows=renameProductSkus(state,[{from:command.payload?.sku,to:command.payload?.newSku}],ctx);if(rows.length)(state.events??=[]).unshift({id:command.id,type:command.type,date:ctx.now,actor:ctx.actor,result:'ok',message:'SKU actualizado conservando alias, existencias e historial.',changes:{mappings:rows}});return {ok:true,sku:rows[0]?.to||command.payload?.sku,message:'SKU guardado. Las referencias y el historial se conservaron.'};}
