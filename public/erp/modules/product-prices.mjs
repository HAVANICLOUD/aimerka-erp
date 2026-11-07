/** Internal channel prices are proposals; they do not establish publication or send prices. */
export const MARKETS=['Sears','Sanborns','Coppel','Mercado Libre','Liverpool','Tienda Nube','Elektra'];
const money=value=>Number.isSafeInteger(value)&&value>0&&value<=100000000000;
export function channelPrice(state,sku,market){
 const saved=(state.productChannelPrices||[]).find(r=>r.sku===sku&&r.market===market);if(saved)return {...saved,source:'assignment'};
 const queued=(state.pricePublicationQueue||[]).find(r=>r.sku===sku&&['awaiting_connection','review_required'].includes(r.status)&&(r.targetMarket===market||!r.targetMarket&&r.channel===market||['Sears','Sanborns'].includes(market)&&!r.targetMarket&&r.channel==='T1 Comercios'));
 return queued?{sku,market,regularCents:queued.regularCents,discountCents:queued.discountCents,currency:'MXN',updatedAt:queued.createdAt,source:'legacy-proposal',status:queued.status,traffic:queued.traffic}:null;
}
export function listingStatus(product,market){
 const saved=product?.channelListings?.[market];
 if(saved&&['published','not_published'].includes(saved.status))return {status:saved.status,publicationId:saved.publicationId||'',source:saved.source||'manual',verified:false,updatedAt:saved.updatedAt};
 const publicationId=product?.channelIdentifiers?.[market]?.publicationId;
 return {status:publicationId?'registered':'unknown',publicationId:publicationId||'',verified:false,source:publicationId?'identifier':'none'};
}
export function saveCalculatedPrices(state,product,results,ctx={},commandId=''){
 if(!Array.isArray(results)||!results.length||results.length>7)throw Error('Selecciona entre uno y siete marketplaces.');
 const rows=results.flatMap(r=>{const markets=r.targetMarket==='T1 Comercios'?['Sears','Sanborns']:[r.targetMarket];return markets.map(market=>({sku:product.sku,market,regularCents:Math.round(r.regular?.price*100),discountCents:Math.round(r.discount?.price*100),currency:'MXN',status:r.traffic?.color==='red'?'review_required':'awaiting_connection',traffic:r.traffic?structuredClone(r.traffic):null,updatedAt:ctx.now,actor:ctx.actor,commandId,category:r.category,commissionRate:r.commissionRate,msiRate:r.msiRate||0}));});
 if(rows.some(r=>!MARKETS.includes(r.market)||!money(r.regularCents)||!money(r.discountCents)||r.regularCents<r.discountCents)||new Set(rows.map(r=>r.market)).size!==rows.length)throw Error('Revisa los precios: usa marketplaces únicos e importes positivos; el precio regular no puede ser menor que el de descuento.');
 const records=state.productChannelPrices??=[];
 for(const row of rows){const i=records.findIndex(r=>r.sku===row.sku&&r.market===row.market),old=i>=0?records[i]:null;row.revision=(old?.revision||0)+1;if(old)(state.productChannelPriceHistory??=[]).unshift(structuredClone(old));if(i<0)records.push(row);else records[i]=row;}
 return rows;
}
export function saveListingStatus(state,command,ctx={}){
 const p=command.payload||{},product=(state.products||[]).find(r=>r.sku===p.sku);
 if(!product||!MARKETS.includes(p.market)||!['unknown','published','not_published'].includes(p.status))throw Error('Selecciona un producto, un marketplace y un estado válido.');
 const publicationId=String(p.publicationId||'').trim();if(publicationId.length>150||/[\u0000-\u001f]/.test(publicationId))throw Error('Identificador de publicación inválido.');
 (product.channelListings??={})[p.market]={status:p.status,publicationId,source:'manual',updatedAt:ctx.now,actor:ctx.actor};
 (state.events??=[]).unshift({id:command.id,type:command.type,date:ctx.now,actor:ctx.actor,result:'ok',message:'Estado de publicación declarado para '+product.sku+' en '+p.market+'. No verificado con el canal.'});
 return {ok:true,message:'Estado guardado como declaración manual; la verificación con el marketplace está pendiente.'};
}
