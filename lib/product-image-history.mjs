import {isProductImageMime} from './product-image-formats.mjs';
export function replaceProductImage(state,command,ctx={}){
 const p=command.payload||{},product=state.products?.find(row=>row.sku===p.sku);if(!product)throw Error('Producto no encontrado.');
 const images=product.images||[],index=images.findIndex(i=>i.id===p.originalId&&i.url===p.originalUrl);if(index<0)throw Error('La imagen cambió en otra sesión. Actualiza el catálogo antes de reemplazarla.');
 const current=images[index],verified=ctx.verifiedImages?.find(i=>i.id===p.image?.id);if(!verified||!isProductImageMime(verified.mime))throw Error('Carga y verifica la nueva imagen antes de guardarla.');
 if(images.some(i=>i.id===verified.id))throw Error('Esta fotografía ya está en la galería. Selecciona otro archivo.');
 const image={...verified,url:'/api/documents/'+verified.id+'?workspace='+encodeURIComponent(ctx.workspace),source:'upload',primary:current.primary===true};
 const history={...structuredClone(current),archivedAt:ctx.now,archivedBy:ctx.actor||'Operador',replacementId:image.id,changeId:command.id,reason:'Reemplazo de imagen original'};
 product.imageHistory=[history,...(product.imageHistory||[])];product.images=images.map((value,n)=>n===index?image:value);
 if(current.primary||product.imageUrl===current.url)product.imageUrl=image.url;product.updatedAt=ctx.now;
 const message='Imagen reemplazada; el original anterior se conserva en el historial.';
 (state.events??=[]).unshift({id:command.id,type:command.type,date:ctx.now,actor:ctx.actor,result:'ok',sku:product.sku,originalId:current.id,imageId:image.id,message});
 return {ok:true,sku:product.sku,imageId:image.id,originalId:current.id,message};
}
