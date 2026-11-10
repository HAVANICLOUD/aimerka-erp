import {MARKETS,LISTING_STATUSES} from './product-prices.mjs';
const limits={title:250,description:10000,categoryId:160,categoryName:250,condition:80,warranty:1000,sellerSku:100,publicationId:150};
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
