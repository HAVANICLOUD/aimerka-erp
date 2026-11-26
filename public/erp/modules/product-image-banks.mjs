import {MARKETS} from './product-prices.mjs';
import {isProductImageMime} from './product-image-formats.mjs';
const defaults=[{id:'markets',name:'Imágenes para markets'},{id:'store',name:'Imágenes para tienda propia'}];
export function productPhotos(product){return [...new Map([...(product.images||[]),...(product.imageUrl&&!(product.images||[]).some(i=>i.url===product.imageUrl)?[{url:product.imageUrl}]:[])].filter(i=>i?.url).map(i=>[i.url,i])).values()];}
export function imageBanks(product,{archived=false}={}){const rows=product.imageBanks??defaults.map((b,n)=>({...b,imageUrls:n===0?productPhotos(product).map(i=>i.url):[]}));return rows.filter(b=>archived||!b.archivedAt);}
export function bankImages(product,id){const bank=imageBanks(product).find(b=>b.id===id),images=productPhotos(product);return (bank?.imageUrls||[]).map(url=>images.find(i=>i.url===url)).filter(Boolean);}
export function channelImageBank(product,market){return product.channelProfiles?.[market]?.imageBankId||imageBanks(product)[0]?.id||'';}
export function channelImages(product,market){return bankImages(product,channelImageBank(product,market));}
export function imageBankCommand(state,command,ctx={}){
 const p=command.payload||{},original=state.products?.find(r=>r.sku===p.sku);if(!original)throw Error('Producto no encontrado.');
 const product=structuredClone(original),banks=product.imageBanks=imageBanks(product,{archived:true}).map(b=>structuredClone(b));
 const active=()=>banks.filter(b=>!b.archivedAt),get=id=>active().find(b=>b.id===id),bank=get(p.bankId);
 const name=value=>{if(typeof value!=='string'||!value.trim()||value.length>80||/[\u0000-\u001f]/.test(value))throw Error('Escribe un nombre de banco de hasta 80 caracteres.');const n=value.trim();if(active().some(b=>b.id!==p.bankId&&b.name.toLocaleLowerCase('es-MX')===n.toLocaleLowerCase('es-MX')))throw Error('Ya existe un banco con este nombre.');return n;};
 const type=command.type;
 if(type==='product.imageBank.create'){if(active().length>=20)throw Error('Usa hasta 20 bancos por producto.');const id='bank-'+command.id;if(banks.some(b=>b.id===id))throw Error('El banco ya existe.');banks.push({id,name:name(p.name),imageUrls:[],createdAt:ctx.now});}
 else if(type==='product.imageBank.restore'){const old=banks.find(b=>b.id===p.bankId&&b.archivedAt);if(!old)throw Error('Banco eliminado no encontrado.');if(active().length>=20)throw Error('Usa hasta 20 bancos activos.');name(old.name);delete old.archivedAt;}
 else {
  if(!bank)throw Error('Actualiza la ficha: el banco ya no está disponible.');
  if(type==='product.imageBank.rename')bank.name=name(p.name);
  else if(type==='product.imageBank.remove'){
   if(active().length<=1)throw Error('Conserva al menos un banco activo.');
   const used=MARKETS.filter(m=>channelImageBank(product,m)===bank.id);
   if(used.length&&!get(p.replacementBankId)||p.replacementBankId===bank.id)throw Error('Selecciona otro banco para los canales asociados antes de eliminar este banco.');
   for(const market of used)(product.channelProfiles??={})[market]={...(product.channelProfiles?.[market]||{}),imageBankId:p.replacementBankId};
   bank.archivedAt=ctx.now;
  }
  else if(type==='product.imageBank.assign'){
   if(!Array.isArray(p.markets)||!p.markets.length||p.markets.some(m=>!MARKETS.includes(m)))throw Error('Selecciona canales válidos.');
   for(const market of p.markets)(product.channelProfiles??={})[market]={...(product.channelProfiles?.[market]||{}),imageBankId:bank.id,updatedAt:ctx.now};
  }
  else if(type==='product.imageBank.photos'){
   const urls=p.imageUrls;if(!Array.isArray(urls)||urls.length>100||new Set(urls).size!==urls.length||urls.some(url=>!productPhotos(product).some(i=>i.url===url)))throw Error('Selecciona fotografías originales de este producto, sin repetirlas.');bank.imageUrls=[...urls];
  }
  else if(type==='product.imageBank.upload'){
   const verified=ctx.verifiedImages?.find(i=>i.id===p.image?.id);if(!verified||!isProductImageMime(verified.mime))throw Error('Carga y verifica una fotografía antes de agregarla.');
   const images=product.images??=[],existing=images.find(i=>i.id===verified.id),url=existing?.url||'/api/documents/'+verified.id+'?workspace='+encodeURIComponent(ctx.workspace);
   if(!images.some(i=>i.id===verified.id)){if(images.length>=100)throw Error('Usa hasta 100 originales por producto.');images.push({...verified,url,source:'upload',primary:!images.length&&!product.imageUrl});}
   if(!bank.imageUrls.includes(url))bank.imageUrls.push(url);
   if(!product.imageUrl)product.imageUrl=url;
  }else throw Error('Acción de banco no reconocida.');
 }
 bank&&(bank.updatedAt=ctx.now);product.updatedAt=ctx.now;Object.assign(original,product);
 (state.events??=[]).unshift({id:command.id,type,date:ctx.now,actor:ctx.actor,sku:p.sku,result:'ok',message:'Banco de imágenes actualizado. Originales conservados.'});
 return {ok:true,bankId:type==='product.imageBank.create'?'bank-'+command.id:p.bankId,message:'Banco guardado. No se ha enviado ninguna imagen al canal.'};
}
