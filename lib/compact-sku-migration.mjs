import {generateCompactProductSku as generateProductSku} from './inventory-v28.mjs';

const compact=/^[A-Z0-9]{1,10}$/;
const key=value=>String(value??'').trim().toUpperCase();
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);

/** Imported, supplier and marketplace identifiers are not internal generated SKUs. */
export function compactSkuMigrationCandidates(state) {
  return (state.products||[]).filter(product=>product.skuGenerated===true&&!compact.test(product.sku||''));
}

/**
 * Rename generated identifiers and their explicit ERP foreign keys atomically.
 * Original documentary text, audit events, supplier IDs, UPCs and seller SKUs
 * remain evidence of what was originally recorded; skuAliases retain the join.
 */
export function applyCompactSkuMigration(state,context={}) {
  if(!Array.isArray(state.products))throw new Error('El catálogo de productos no es válido.');
  const candidates=compactSkuMigrationCandidates(state);
  if(!candidates.length)return {ok:true,migrated:0,mappings:[],message:'Los SKU internos generados ya cumplen el máximo de 10 caracteres alfanuméricos.'};
  const draft=structuredClone(state),products=draft.products,mapping=new Map(),mappings=[];
  const now=context.now||new Date().toISOString(),actor=context.actor||context.user||'Operador';
  // Sorting makes the allocation stable even if the UI changes catalog order.
  const targets=compactSkuMigrationCandidates(draft).sort((a,b)=>String(a.sku).localeCompare(String(b.sku),'en'));
  for(const product of targets) {
    const from=product.sku;
    if(typeof from!=='string'||!from.trim())throw new Error('Un producto generado no tiene SKU de origen; revisa el catálogo antes de migrarlo.');
    if(products.filter(other=>key(other.sku)===key(from)).length!==1)throw new Error('El SKU de origen '+from+' es ambiguo; no se modificó el catálogo.');
    if(product.skuAliases!=null&&!Array.isArray(product.skuAliases))throw new Error('Los alias del SKU '+from+' no son válidos.');
    const to=generateProductSku(product,products);
    if(!compact.test(to))throw new Error('El generador debe producir un SKU de máximo 10 caracteres alfanuméricos.');
    const collision=products.some(other=>[other.sku,other.sellerSku,other.upc,...(Array.isArray(other.skuAliases)?other.skuAliases:[])].some(value=>value&&key(value)===key(to)));
    if(collision)throw new Error('El SKU propuesto '+to+' ya está reservado; no se modificó el catálogo.');
    mapping.set(from,to);
    mappings.push({from,to,name:product.name||'',upc:product.upc||''});
    product.skuAliases=[...new Set([...(product.skuAliases||[]),from])];
    product.sku=to;product.skuFormatVersion=2;product.skuMigratedAt=now;product.updatedAt=now;
  }
  const rewrite=(row,fields=['sku'])=>{
    if(!object(row))return;
    for(const field of fields)if(typeof row[field]==='string'&&mapping.has(row[field]))row[field]=mapping.get(row[field]);
  };
  const lines=(rows,fields=['sku'])=>{for(const row of rows||[])rewrite(row,fields);};

  for(const purchase of draft.purchases||[])lines(purchase.items,['sku','skuOrUpc']);
  for(const order of draft.orders||[]) {
    rewrite(order);lines(order.items,['sku','skuOrUpc']);
    lines(order.marketplace34?.units);
    // Current calculated views keep their original amounts and assumptions.
    // Historical audit snapshots are intentionally not rewritten.
    lines(order.reconciliation?.estimate?.lines);
    lines(order.reconciliation?.draft?.estimate?.lines);
  }
  for(const receipt of draft.purchaseReceipts||[])lines(receipt.items,['sku','skuOrUpc']);
  lines(draft.movements);
  lines(draft.warehouseStock);
  lines(draft.warehouseTransfers);
  lines(draft.pricePublicationQueue);
  lines(draft.supplierEquivalences);
  for(const document of draft.documents||[])lines(document.lineLinks);
  for(const scenario of draft.pricingScenarios||[]) {
    rewrite(scenario,['productSku']);rewrite(scenario.input,['productSku','sku']);
    rewrite(scenario.result?.product);lines(scenario.result?.lines);
  }
  for(const row of draft.stockSyncQueue||[]) {
    const from=row.sku;
    if(!mapping.has(from))continue;
    const to=mapping.get(from);row.sku=to;
    if(row.id==='stock-'+from)row.id='stock-'+to;
    if(row.reference===from)row.reference=to;
  }
  const message=mappings.length+' SKU interno'+(mappings.length===1?'':'s')+' actualizado'+(mappings.length===1?'':'s')+' a máximo 10 caracteres alfanuméricos; se conservaron existencias e historial.';
  (draft.events??=[]).unshift({
    id:context.requestId||context.id||crypto.randomUUID(),type:context.type||'product.compactGeneratedSkus',
    message,date:now,actor,result:'ok',source:'AIMERKA',
    changes:{skuFormatVersion:2,mappings:structuredClone(mappings)}
  });
  // No state is exposed until every allocation and reference update succeeds.
  for(const property of Object.keys(state))delete state[property];
  Object.assign(state,draft);
  return {ok:true,migrated:mappings.length,mappings,message};
}
