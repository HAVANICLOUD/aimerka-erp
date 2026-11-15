import {productInCategories,taxonomy} from './product-taxonomy.mjs?v=20261115-product-routing';
import {resolveCategory} from './pricing-v28.mjs?v=20261115-product-routing';
const key=v=>String(v??'').trim().toLocaleLowerCase('es-MX');
const marker='liverpoolSmartwatches20261115';
/** One-time, owner-requested correction. Later manual mapping edits remain authoritative. */
export function correctLiverpoolSmartwatches(state,ctx={}){
 const config=state.config;if(!config||config.categoryMappingMaintenance?.[marker])return null;
 const target=config.commissions?.Liverpool?.find(row=>key(row.category)==='telefonía');
 if(!target)return null; // Never manufacture a market category or a commission rate.
 const smartIds=taxonomy(state).nodes.filter(n=>key(n.name)==='smartwatches').map(n=>n.id);
 const mappings=[],products=[];
 for(const row of config.categoryMappings||[]){if(!['smartwatch','smartwatches'].includes(key(row.category)))continue;for(const field of ['Liverpool','liverpool'])if(key(row.channels?.[field])==='relojes'){mappings.push({profile:row.category,field,before:row.channels[field],after:target.category});row.channels[field]=target.category;}}
 for(const p of state.products||[]){
  if(!['smartwatch','smartwatches'].includes(key(p.category))&&!productInCategories(state,p,smartIds.length?smartIds:['__no_smartwatch_node__']))continue;
  const changes=[];
  for(const area of ['categoryOverrides','categories'])for(const field of ['Liverpool','liverpool'])if(key(p[area]?.[field])==='relojes'){changes.push({area,field,before:p[area][field],after:target.category});p[area][field]=target.category;}
  if(key(resolveCategory(config,p,'Liverpool'))==='relojes'){(p.categoryOverrides??={}).Liverpool=target.category;changes.push({area:'categoryOverrides',field:'Liverpool',before:null,after:target.category});}
  if(changes.length)products.push({sku:p.sku,changes});
 }
 const report={appliedAt:ctx.now||null,version:1,mappings,products};
 (config.categoryMappingMaintenance??={})[marker]={version:1,appliedAt:report.appliedAt};
 (state.events??=[]).unshift({id:ctx.requestId||marker,type:'config.mapping.liverpoolSmartwatches',date:ctx.now,actor:ctx.actor||'Sistema',result:'ok',message:'Smartwatches Liverpool: Telefonía. Se conservan los demás canales, precios guardados e historial.',changes:report});
 return report;
}
