import {applyInventory} from './inventory-v28.mjs?v=20261115-product-routing';
const code=v=>String(v||'').trim().toUpperCase();
const codes=p=>[p.sku,p.upc,p.sellerSku,p.sicarCode,...(p.skuAliases||[])].filter(Boolean).map(code);
export function importSicarNewProducts(state,command,ctx){
 if(!ctx.actor||code(ctx.actor)!==code(ctx.ownerEmail))throw Error('Solo el propietario puede importar el catálogo SICAR.');
 const m=command.payload?.manifest;
 if(m?.format!=='AIMERKA-SICAR-NEW-1'||!Array.isArray(m.products)||!m.products.length||m.products.length>200||!/^[a-f0-9]{64}$/.test(m.sourceHash||''))throw Error('Archivo de productos SICAR inválido.');
 const draft=structuredClone(state),added=[],skipped=[];
 for(const r of m.products){
  if(!Array.isArray(r.codes)||!r.codes.length||r.codes.length>20||r.codes.some(c=>typeof c!=='string'||!c.trim()||c.length>100)||!r.codes.map(code).includes(code(r.sku))||r.quantity!==0)throw Error('Este importador admite únicamente productos nuevos con stock cero y códigos completos.');
  const matches=draft.products.filter(p=>codes(p).some(c=>r.codes.map(code).includes(c)));
  if(matches.length>1)throw Error('Códigos ambiguos en '+r.name+'. Revisa las equivalencias.');
  if(matches.length){skipped.push(r.sku);continue;}
  if(!Number.isFinite(r.averageCostMxn)||r.averageCostMxn<0||!Number.isSafeInteger(r.priceCents)||r.priceCents<0||!r.category||typeof r.name!=='string'||typeof r.brand!=='string'||!Array.isArray(r.images)||r.images.length>12)throw Error('Revisa nombre, marca, categoría, costo y fotografías de '+r.sku+'.');
  const p={sku:r.sku,upc:r.upc,name:r.name,brand:r.brand,department:r.department||'',category:r.category,costCents:Math.round(r.averageCostMxn*100),averageCostMxn:r.averageCostMxn,priceCents:r.priceCents,description:r.features||'',satCode:r.satCode||'',unitSat:r.unit==='PIEZA'?'H87':'',shippingType:'Pequeño',shippingException:'Automático',status:'OK',minStock:r.minStock||0,images:r.images,costStatus:'Confirmado',review:r.classification?'':'Importado de SICAR; categorías de canal pendientes de revisión.',...(r.classification?{classification:r.classification}:{}),...(r.marketCategories?{marketCategories:r.marketCategories}:{})};
  applyInventory(draft,{id:command.id+'-'+added.length,type:'product.save',payload:{product:p}},ctx);
  const product=draft.products.find(p=>p.sku===r.sku);
  product.skuAliases=r.codes.filter(c=>code(c)!==code(product.sku));product.sellerSku=product.sku;product.sicarCode=r.codes[0];product.source='SICAR';product.skuOrigin='SICAR';product.sourceStock=0;
  product.sicarSource={sourceHash:m.sourceHash,fileName:String(m.fileName||'SICAR').slice(0,200),sourceRow:r.sourceRow,capturedAt:m.capturedAt,importedAt:ctx.now,unit:r.unit,flags:r.flags||{},costIncludesVat:true,exportedFields:r.sourceFields&&JSON.stringify(r.sourceFields).length<20000?structuredClone(r.sourceFields):{}};
  added.push(product.sku);
 }
 (draft.events??=[]).unshift({id:command.id,type:command.type,date:ctx.now,actor:ctx.actor,result:'ok',message:`SICAR: ${added.length} productos nuevos; ${skipped.length} existentes conservados.`,sourceHash:m.sourceHash,added,skipped});
 Object.assign(state,draft);return {ok:true,added,skipped,message:`Importación completa: ${added.length} productos nuevos con inventario cero.`};
}
