import {CHANNELS,resolveCategory} from './pricing-v28.mjs';
import seed from './dingdong-classification-data.mjs';
import reviewed from './product-classification-review.mjs';
export const labelKey=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLocaleLowerCase('es-MX');
const bySku=new Map();for(const row of seed.products){const k=labelKey(row.sku);bySku.set(k,bySku.has(k)?null:row);}
const barcode=v=>String(v??'').trim().replace(/^0+(?=\d)/,'');
const byUpc=new Map();for(const row of seed.products){const k=barcode(row.upc);if(!k||!/^\d{8,14}$/.test(String(row.upc)))continue;byUpc.set(k,byUpc.has(k)?null:row);}
const initialNodes=[...seed.nodes,...reviewed.nodes],mergedNodes=new WeakMap();
export function taxonomy(state){const saved=state.catalogs?.productTaxonomy;if(!saved)return {revision:0,source:seed.source,capturedAt:seed.capturedAt,nodes:initialNodes};let nodes=mergedNodes.get(saved.nodes);if(!nodes){nodes=[...saved.nodes,...[...seed.nodes,...reviewed.nodes].filter(n=>!saved.nodes.some(v=>v.id===n.id))];mergedNodes.set(saved.nodes,nodes);}return {...saved,nodes};}
const pathCaches=new WeakMap();
export function categoryPath(state,id){const nodes=taxonomy(state).nodes;let paths=pathCaches.get(nodes);if(!paths){paths=new Map();const map=new Map(nodes.map(n=>[n.id,n]));for(const node of nodes){const seen=new Set(),path=[];for(let n=node;n&&!seen.has(n.id);n=map.get(n.parentId)){seen.add(n.id);path.unshift(n);}paths.set(node.id,path);}pathCaches.set(nodes,paths);}return paths.get(id)||[];}
export function categoryLabel(state,id){return categoryPath(state,id).map(n=>n.name).join(' › ');}
export function categoryWithin(state,id,parent){return categoryPath(state,id).some(n=>n.id===parent);}
function leaves(state,ids){return [...new Set(ids)].filter(id=>!ids.some(other=>other!==id&&categoryWithin(state,other,id)));}
export function classification(state,product){
 const valid=new Set(taxonomy(state).nodes.map(n=>n.id));
 if(product.classification)return {...product.classification,categoryIds:leaves(state,(product.classification.categoryIds||[]).filter(id=>valid.has(id)))};
 const exact=bySku.get(labelKey(product.sku));
 const aliases=[...new Set((product.skuAliases||[]).map(s=>bySku.get(labelKey(s))).filter(Boolean))];
 const upc=byUpc.get(barcode(product.upc));
 const matches=exact?[exact]:aliases.length?aliases:upc?[upc]:[];
 if(upc&&matches.length===1&&upc.sourceProductId!==matches[0].sourceProductId)return {categoryIds:[],origin:'pending',reason:'El SKU y el UPC identifican productos diferentes en DingDong.'};
 if(matches.length===1&&matches[0].categoryIds.some(id=>valid.has(id)))return {categoryIds:leaves(state,matches[0].categoryIds.filter(id=>valid.has(id))),origin:'dingdong',sourceUrl:matches[0].sourceUrl};
 const familyMatches=reviewed.products.filter(row=>[product.sku,...(product.skuAliases||[])].some(s=>labelKey(s)===labelKey(row.sku)));
 const family=familyMatches.length===1?familyMatches[0]:null;
 if(family&&(!family.upc||!product.upc||barcode(family.upc)===barcode(product.upc))){const ids=family.categoryIds.filter(id=>valid.has(id));if(ids.length===family.categoryIds.length)return {categoryIds:leaves(state,ids),origin:'family_classified',reviewedAt:reviewed.reviewedAt,note:family.note};}
 // A legacy perfume profile can identify its broad branch, never a gender or precise subcategory.
 if(/perfum|fraganc|colonia/.test(labelKey(product.category))||/\bperfume\b|eau de (?:parfum|toilette)|\bedp\b|\bedt\b/.test(labelKey(product.name))){const node=taxonomy(state).nodes.find(n=>n.name==='Perfumes');if(node)return {categoryIds:[node.id],origin:'legacy_review'};}
 return {categoryIds:[],origin:'pending'};
}
export function productInCategories(state,p,ids=[]){return !ids.length||ids.includes('__review__')&&classificationNeedsReview(state,p)||classification(state,p).categoryIds.some(id=>ids.some(parent=>categoryWithin(state,id,parent)));}
export function productCategoryLabels(state,p){return classification(state,p).categoryIds.map(id=>categoryLabel(state,id));}
export function validateClassification(state,value){if(!value||!Array.isArray(value.categoryIds)||value.categoryIds.length>40||value.categoryIds.some(id=>!taxonomy(state).nodes.some(n=>n.id===id)))throw Error('Selecciona categorías existentes en el catálogo.');return {categoryIds:leaves(state,value.categoryIds),origin:'manual'};}
export function saveTaxonomyNode(state,command,ctx={}){
 const current=taxonomy(state),p=command.payload||{};
 if(p.expectedRevision!==current.revision)throw Error('El catálogo cambió en otra sesión. Vuelve a abrirlo antes de guardar.');
 const nodes=structuredClone(current.nodes),existing=nodes.find(n=>n.id===p.node?.id),input=p.node||{},name=typeof input.name==='string'?input.name.trim():'';
 if(!name||name.length>120||/[\u0000-\u001f]/.test(name))throw Error('Escribe un nombre de categoría de hasta 120 caracteres.');
 if(input.id&&!existing)throw Error('No se encontró la categoría.');
 const parentId=input.parentId||'';if(parentId&&!nodes.some(n=>n.id===parentId))throw Error('La categoría superior no existe.');
 if(existing&&(parentId===existing.id||categoryWithin(state,parentId,existing.id)))throw Error('No puedes mover una categoría dentro de sus descendientes.');
 if(categoryPath(state,parentId).length>10)throw Error('Usa un máximo de once niveles de categorías.');
 if(nodes.some(n=>n.id!==existing?.id&&n.parentId===parentId&&n.name===name))throw Error('Esa categoría ya existe en esta rama.');
 const id=existing?.id||'cat-'+command.id;const node={...(existing||{}),id,name,parentId,position:existing?.position??nodes.length};
 if(existing)Object.assign(existing,node);else nodes.push(node);
 const saved={...structuredClone(current),revision:current.revision+1,nodes};
 (state.catalogs??={}).productTaxonomy=saved;
 (state.events??=[]).unshift({id:command.id,type:command.type,date:ctx.now,actor:ctx.actor,result:'ok',before:existing?current.nodes.find(n=>n.id===id):null,after:node,message:'Clasificación comercial actualizada; perfiles de comisión conservados.'});
 return {ok:true,id,message:'Categoría guardada. Productos y mapeos conservados.'};
}

export function taxonomyBrands(state){const brands=new Map();for(const value of [...(state.products||[]).map(p=>p.brand),...seed.products.map(p=>p.brand)])if(typeof value==='string'&&value.trim()&&!brands.has(labelKey(value)))brands.set(labelKey(value),value.trim());return [...brands.values()].sort((a,b)=>a.localeCompare(b,'es'));}

export function classificationNeedsReview(state,p){const c=classification(state,p);return !c.categoryIds.length||!['dingdong','manual','family_classified'].includes(c.origin);}

// Suggestions summarize existing mappings in the more precise commercial branch.
// They never replace a product override or update a price.
export function marketplaceMappingSuggestions(state,id){
 const products=(state.products||[]).filter(p=>productInCategories(state,p,[id]));
 return CHANNELS.map(channel=>{const counts=new Map();for(const p of products){const category=resolveCategory(state.config||{},p,channel);if(category)counts.set(category,(counts.get(category)||0)+1);}const candidates=[...counts].map(([category,count])=>({category,count})).sort((a,b)=>b.count-a.count||a.category.localeCompare(b.category,'es'));return {channel,candidates,productCount:products.length,consistent:candidates.length===1};});
}
