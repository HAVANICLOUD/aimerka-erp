import {normalizeChannelCatalog} from './channel-catalog.mjs';
import {available} from './inventory-v28.mjs';
import {imageBanks,channelImageBank,bankImages} from './product-image-banks.mjs';
import {MARKETS,LISTING_STATUSES,channelPrice} from './product-prices.mjs';
const limits={title:250,description:200000,shortDescription:10000,videoUrl:2000,categoryId:160,categoryName:8000,condition:80,warranty:1000,sellerSku:100,publicationId:150};
export function saveProductChannelProfile(state,command,ctx={}){
 const {sku,market,profile}=command.payload||{},product=(state.products||[]).find(p=>p.sku===sku);
 if(!product||!MARKETS.includes(market)||!profile||typeof profile!=='object'||Array.isArray(profile))throw Error('Selecciona un producto y un marketplace válidos.');
 const clean={};
 if('publicationStatus' in profile&&!LISTING_STATUSES.includes(profile.publicationStatus))throw Error('Selecciona un estado de publicación válido.');
 for(const [key,max] of Object.entries(limits)){
  if(!(key in profile))continue;
  if(typeof profile[key]!=='string'||profile[key].length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(profile[key]))throw Error('Revisa el campo '+key+' de la ficha del canal.');
  clean[key]=profile[key].trim();
 }
 if('attributes' in profile){
  if(!Array.isArray(profile.attributes)||profile.attributes.length>50)throw Error('Usa hasta 50 atributos por canal.');
  clean.attributes=profile.attributes.map(row=>{
   if(!row||typeof row.name!=='string'||!row.name.trim()||row.name.length>100||typeof row.value!=='string'||row.value.length>1000)throw Error('Completa el nombre y valor de los atributos.');
   return {name:row.name.trim(),value:row.value.trim()};
  });
  if(new Set(clean.attributes.map(r=>r.name.toLocaleLowerCase('es-MX'))).size!==clean.attributes.length)throw Error('No repitas atributos en el mismo canal.');
 }
 if('imageBankId' in profile){if(!imageBanks(product).some(b=>b.id===profile.imageBankId))throw Error('Selecciona un banco de imágenes activo.');clean.imageBankId=profile.imageBankId;}
 if('availabilityDays' in profile){if(!Number.isInteger(profile.availabilityDays)||profile.availabilityDays<0||profile.availabilityDays>365)throw Error('Usa de 0 a 365 días de disponibilidad.');clean.availabilityDays=profile.availabilityDays;}
 if(clean.categoryId){const category=normalizeChannelCatalog(state.catalogs?.channelCatalogs?.[market]||{}).categories.find(c=>c.id===clean.categoryId);if(category){if(!category.selectable)throw Error('Selecciona una categoría publicable del canal.');clean.categoryName=category.path;}}
 const old=product.channelProfiles?.[market],row={...old,...clean,updatedAt:ctx.now,actor:ctx.actor};
 (product.channelProfiles??={})[market]=row;
 const identifiers={...(product.channelIdentifiers?.[market]||{})};
 for(const field of ['sellerSku','publicationId'])if(field in clean)identifiers[field]=clean[field];
 (product.channelIdentifiers??={})[market]=identifiers;
 // A changed listing identifier must be reviewed again; a price/profile never proves publication.
 if('publicationId' in clean&&product.channelListings?.[market]&&product.channelListings[market].publicationId!==clean.publicationId){
  product.channelListings[market]={...product.channelListings[market],publicationId:clean.publicationId,status:'unknown',updatedAt:ctx.now};
 }
 if('publicationStatus' in profile)(product.channelListings??={})[market]={status:profile.publicationStatus,publicationId:identifiers.publicationId||'',source:'manual',updatedAt:ctx.now,actor:ctx.actor};
 (state.events??=[]).unshift({id:command.id,type:command.type,date:ctx.now,actor:ctx.actor,result:'ok',message:'Ficha de '+market+' guardada para '+sku+'. Pendiente de conexión con el canal.'});
 return {ok:true,message:'Ficha del canal guardada. No se ha enviado a la tienda.'};
}

export function saveChannelPrice(state,command,ctx={}){
 const p=command.payload||{},product=state.products?.find(r=>r.sku===p.sku),valid=n=>Number.isSafeInteger(n)&&n>0&&n<=100000000000;
 if(!product||!MARKETS.includes(p.market)||!valid(p.regularCents)||!valid(p.discountCents)||p.discountCents>p.regularCents)throw Error('Usa importes positivos; el precio con descuento no puede superar el regular.');
 const rows=state.productChannelPrices??=[],index=rows.findIndex(r=>r.sku===p.sku&&r.market===p.market),old=rows[index];
 const previous=old||channelPrice(state,p.sku,p.market);
 const row={sku:p.sku,market:p.market,regularCents:p.regularCents,discountCents:p.discountCents,currency:'MXN',status:'awaiting_connection',source:'manual',revision:(previous?.revision||0)+1,updatedAt:ctx.now,actor:ctx.actor,commandId:command.id};
 if(previous)(state.productChannelPriceHistory??=[]).unshift(structuredClone(previous));if(index<0)rows.push(row);else rows[index]=row;
 (state.events??=[]).unshift({id:command.id,type:command.type,date:ctx.now,sku:p.sku,market:p.market,actor:ctx.actor,result:'ok',message:'Precio guardado en AIMERKA. Pendiente de envío al canal.'});
 return {ok:true,message:'Precio guardado en AIMERKA; pendiente de conexión.'};
}

/** Internal handoff for a future connector. Private originals require an authorized export; this does not publish. */
export function channelPublicationDraft(state,sku,market){
 const product=state.products?.find(p=>p.sku===sku);if(!product||!MARKETS.includes(market))throw Error('Producto o canal no válido.');
 const profile=product.channelProfiles?.[market]||{},common=product.channelContent||{},bankId=channelImageBank(product,market);
 return {sku,market,sellerSku:profile.sellerSku??product.channelIdentifiers?.[market]?.sellerSku??sku,publicationId:profile.publicationId??product.channelIdentifiers?.[market]?.publicationId??'',title:profile.title||common.title||product.name,shortDescription:profile.shortDescription||common.shortDescription||'',description:profile.description||common.description||product.description||'',category:{id:profile.categoryId||'',name:profile.categoryName||''},condition:profile.condition||common.condition||product.condition||'Nuevo',warranty:profile.warranty||common.warranty||'',availabilityDays:profile.availabilityDays??common.availabilityDays??0,videoUrl:profile.videoUrl||common.videoUrl||'',currency:common.currency||'MXN',publicationType:common.publicationType||'simple',variationGroup:common.variationGroup||'',bundleContents:common.bundleContents||'',productDimensions:structuredClone(common.productDimensions||product.productDimensions||{}),packageDimensions:structuredClone(common.packageDimensions||product.packageDimensions||product.dimensions||{}),attributes:[...new Map([...['brand','model','gtin','manufacturerPart','material','countryOfOrigin'].filter(k=>common[k]||product[k]).map(name=>({name,value:common[name]||product[name]})),...(profile.attributes||[])].map(a=>[a.name.toLocaleLowerCase('es-MX'),structuredClone(a)])).values()],availableQty:available(product),price:channelPrice(state,sku,market),imageBankId:bankId,imageAssets:bankImages(product,bankId).map((image,index)=>({id:image.id||null,originalUrl:image.url,position:index+1,primary:index===0,requiresAuthorizedExport:true})),status:'draft_not_sent'};
}

const commonText={title:250,description:200000,shortDescription:10000,condition:80,warranty:1000,videoUrl:2000,brand:100,model:150,gtin:80,manufacturerPart:150,material:250,countryOfOrigin:150,variationGroup:150,bundleContents:4000};
export function validateChannelContent(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Revisa la información general para canales.');
 const clean={};for(const [key,max] of Object.entries(commonText))if(key in input){if(typeof input[key]!=='string'||input[key].length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input[key]))throw Error('Revisa el campo '+key+' de la información general.');clean[key]=input[key].trim();}
 if('availabilityDays' in input){if(!Number.isInteger(input.availabilityDays)||input.availabilityDays<0||input.availabilityDays>365)throw Error('Usa entre 0 y 365 días de disponibilidad.');clean.availabilityDays=input.availabilityDays;}
 if('currency' in input){if(!['MXN','USD'].includes(input.currency))throw Error('Selecciona MXN o USD.');clean.currency=input.currency;}
 if('publicationType' in input){if(!['simple','variant','bundle'].includes(input.publicationType))throw Error('Selecciona un tipo de publicación válido.');clean.publicationType=input.publicationType;}
 for(const field of ['productDimensions','packageDimensions'])if(field in input){if(!input[field]||typeof input[field]!=='object'||Array.isArray(input[field]))throw Error('Revisa las medidas.');const dims={};for(const key of ['heightCm','widthCm','lengthCm','weightKg']){const v=input[field][key];if(v==null||v==='')continue;if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1000000)throw Error('Revisa las medidas y pesos; usa valores no negativos.');dims[key]=v;}clean[field]=dims;}
 return clean;
}
export function saveChannelWorkspace(state,command,ctx={}){
 const p=command.payload||{},draft=structuredClone(state),product=draft.products?.find(r=>r.sku===p.sku);if(!product)throw Error('Producto no encontrado.');
 if(!Array.isArray(p.channels)||p.channels.length>MARKETS.length||new Set(p.channels.map(r=>r.market)).size!==p.channels.length)throw Error('Revisa los canales de la ficha.');
 const common=validateChannelContent(p.common||{});product.channelContent={...(product.channelContent||{}),...common,updatedAt:ctx.now,actor:ctx.actor};
 for(const row of p.channels)saveProductChannelProfile(draft,{...command,payload:{sku:p.sku,market:row.market,profile:row.profile}},ctx);
 // One atomic save and one user-facing event, even when several channel overrides change.
 draft.events=state.events?structuredClone(state.events):[];
 draft.events.unshift({id:command.id,type:command.type,date:ctx.now,actor:ctx.actor,sku:p.sku,result:'ok',message:'Ficha de canales guardada: información general y '+p.channels.length+' canales actualizados. Pendiente de conexión.'});
 Object.assign(state,draft);return {ok:true,message:'Ficha de canales guardada en AIMERKA. Pendiente de envío a las tiendas.'};
}
