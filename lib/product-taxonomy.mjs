import {CHANNELS,resolveCategory,listCategories} from './pricing-v28.mjs?v=20261115-product-routing';
import seed from './dingdong-classification-data.mjs';
import reviewed from './product-classification-review.mjs';
export const labelKey=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLocaleLowerCase('es-MX');
const bySku=new Map();for(const row of seed.products){const k=labelKey(row.sku);bySku.set(k,bySku.has(k)?null:row);}
const barcode=v=>String(v??'').trim().replace(/^0+(?=\d)/,'');
const byUpc=new Map();for(const row of seed.products){const k=barcode(row.upc);if(!k||!/^\d{8,14}$/.test(String(row.upc)))continue;byUpc.set(k,byUpc.has(k)?null:row);}
const initialNodes=[...seed.nodes,...reviewed.nodes],mergedNodes=new WeakMap(),normalizedNodes=new WeakMap();
const redundantAliases=Object.fromEntries(initialNodes.filter(n=>{const parent=initialNodes.find(p=>p.id===n.parentId);return parent&&(/^tod[oa]s?\b/.test(labelKey(n.name))||labelKey(n.name)===labelKey(parent.name));}).map(n=>[n.id,n.parentId]));
export function canonicalCategoryId(state,id){const aliases={...redundantAliases,...(state.catalogs?.productTaxonomy?.aliases||{})};const seen=new Set();while(aliases[id]&&!seen.has(id)){seen.add(id);id=aliases[id];}return id;}
export function taxonomy(state){
 const saved=state.catalogs?.productTaxonomy;let raw=saved?.nodes||initialNodes;
 if(saved){let merged=mergedNodes.get(raw);if(!merged){merged=[...raw,...initialNodes.filter(n=>!raw.some(v=>v.id===n.id))];mergedNodes.set(raw,merged);}raw=merged;}
 let normalized=normalizedNodes.get(raw);if(!normalized){const aliases={...redundantAliases,...(saved?.aliases||{})},canonical=id=>{const seen=new Set();while(aliases[id]&&!seen.has(id)){seen.add(id);id=aliases[id];}return id;};const nodes=raw.filter(n=>canonical(n.id)===n.id).map(n=>({...n,parentId:canonical(n.parentId)}));
  for(const old of raw.filter(n=>canonical(n.id)!==n.id)){const target=nodes.find(n=>n.id===canonical(old.id));if(!target)continue;for(const [market,value] of Object.entries(old.marketMappings||{})){if(!value)continue;const previous=target.marketMappings?.[market];target.marketMappings={...(target.marketMappings||{})};if(!previous)target.marketMappings[market]=value;else if(previous!==value){target.marketMappingConflicts={...(target.marketMappingConflicts||{}),[market]:[...new Set([...(target.marketMappingConflicts?.[market]||[]),previous,value])]};delete target.marketMappings[market];}}}
  normalized={nodes,aliases};normalizedNodes.set(raw,normalized);
 }
 return {...(saved||{revision:0,source:seed.source,capturedAt:seed.capturedAt}),...normalized};
}
export function hasCategory(state,id){return taxonomy(state).nodes.some(n=>n.id===canonicalCategoryId(state,id));}
const pathCaches=new WeakMap();
export function categoryPath(state,id){const nodes=taxonomy(state).nodes;let paths=pathCaches.get(nodes);if(!paths){paths=new Map();const map=new Map(nodes.map(n=>[n.id,n]));for(const node of nodes){const seen=new Set(),path=[];for(let n=node;n&&!seen.has(n.id);n=map.get(n.parentId)){seen.add(n.id);path.unshift(n);}paths.set(node.id,path);}pathCaches.set(nodes,paths);}return paths.get(canonicalCategoryId(state,id))||[];}
export function categoryLabel(state,id){return categoryPath(state,id).map(n=>n.name).join(' › ');}
export function categoryWithin(state,id,parent){return categoryPath(state,id).some(n=>n.id===canonicalCategoryId(state,parent));}
function leaves(state,ids){ids=[...new Set(ids.map(id=>canonicalCategoryId(state,id)))];return ids.filter(id=>!ids.some(other=>other!==id&&categoryWithin(state,other,id)));}
export function classification(state,product){
 const valid=new Set(taxonomy(state).nodes.map(n=>n.id));
 if(product.classification)return {...product.classification,categoryIds:leaves(state,(product.classification.categoryIds||[]).map(id=>canonicalCategoryId(state,id)).filter(id=>valid.has(id)))};
 const exact=bySku.get(labelKey(product.sku));
 const aliases=[...new Set((product.skuAliases||[]).map(s=>bySku.get(labelKey(s))).filter(Boolean))];
 const upc=byUpc.get(barcode(product.upc));
 const matches=exact?[exact]:aliases.length?aliases:upc?[upc]:[];
 if(upc&&matches.length===1&&upc.sourceProductId!==matches[0].sourceProductId)return {categoryIds:[],origin:'pending',reason:'El SKU y el UPC identifican productos diferentes en DingDong.'};
 if(matches.length===1&&matches[0].categoryIds.some(id=>valid.has(canonicalCategoryId(state,id))))return {categoryIds:leaves(state,matches[0].categoryIds.map(id=>canonicalCategoryId(state,id)).filter(id=>valid.has(id))),origin:'dingdong',sourceUrl:matches[0].sourceUrl};
 const familyMatches=reviewed.products.filter(row=>[product.sku,...(product.skuAliases||[])].some(s=>labelKey(s)===labelKey(row.sku)));
 const family=familyMatches.length===1?familyMatches[0]:null;
 if(family&&(!family.upc||!product.upc||barcode(family.upc)===barcode(product.upc))){const ids=family.categoryIds.map(id=>canonicalCategoryId(state,id)).filter(id=>valid.has(id));if(ids.length===family.categoryIds.length)return {categoryIds:leaves(state,ids),origin:'family_classified',reviewedAt:reviewed.reviewedAt,note:family.note};}
 // A legacy perfume profile can identify its broad branch, never a gender or precise subcategory.
 if(/perfum|fraganc|colonia/.test(labelKey(product.category))||/\bperfume\b|eau de (?:parfum|toilette)|\bedp\b|\bedt\b/.test(labelKey(product.name))){const node=taxonomy(state).nodes.find(n=>n.name==='Perfumes');if(node)return {categoryIds:[node.id],origin:'legacy_review'};}
 return {categoryIds:[],origin:'pending'};
}
export function productInCategories(state,p,ids=[]){return !ids.length||ids.includes('__review__')&&classificationNeedsReview(state,p)||classification(state,p).categoryIds.some(id=>ids.some(parent=>categoryWithin(state,id,parent)));}
export function productCategoryLabels(state,p){return classification(state,p).categoryIds.map(id=>categoryLabel(state,id));}
export function validateClassification(state,value){if(!value||!Array.isArray(value.categoryIds)||value.categoryIds.length>40||value.categoryIds.some(id=>!hasCategory(state,id)))throw Error('Selecciona categorías existentes en el catálogo.');return {categoryIds:leaves(state,value.categoryIds),origin:'manual'};}
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
 if('marketMappings' in input){node.marketMappings=validateMarketCategories(state,input.marketMappings);if(node.marketMappingConflicts){node.marketMappingConflicts={...node.marketMappingConflicts};for(const ch of Object.keys(node.marketMappings))delete node.marketMappingConflicts[ch];}}
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

export const CLASSIFIED_MARKETS=['Coppel','Mercado Libre','Liverpool','Elektra'];
export function validateMarketCategories(state,input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Las correspondencias de categoría no son válidas.');
 const result={};for(const [channel,value] of Object.entries(input)){if(!CLASSIFIED_MARKETS.includes(channel)||typeof value!=='string')throw Error('Canal o categoría inválidos.');if(!value.trim()){result[channel]='';continue;}const valid=listCategories(state.config,channel,{mapping:true}).find(c=>labelKey(c)===labelKey(value));if(!valid)throw Error('Selecciona una categoría del catálogo de '+channel+'.');result[channel]=valid;}return result;
}
export function categoryMappingProposal(state,ids=[],excludeSku=''){
 ids=leaves(state,ids);return CLASSIFIED_MARKETS.map(channel=>{
  const values=[];let ambiguous=false;
  for(const id of ids){const chain=categoryPath(state,id).slice().reverse();
   for(const node of chain){if(node.marketMappingConflicts?.[channel]?.length){ambiguous=true;break;}if(node.marketMappings?.[channel]){values.push(node.marketMappings[channel]);break;}
    let peers=(state.products||[]).filter(p=>p.sku!==excludeSku&&productInCategories(state,p,[node.id]));
    if(!peers.length&&node.id===canonicalCategoryId(state,id)){const proposals=categorySearch(state,node.name).filter(r=>r.score>=120&&r.id!==node.id&&!categoryWithin(state,r.id,node.id));const known=proposals.map(r=>({...r,peers:(state.products||[]).filter(p=>p.sku!==excludeSku&&productInCategories(state,p,[r.id]))})).filter(r=>r.peers.length);if(known.length){const best=known[0].score;peers=[...new Set(known.filter(r=>r.score===best).flatMap(r=>r.peers))];}}
    const available=listCategories(state.config,channel,{mapping:true}),resolved=peers.map(p=>resolveCategory(state.config,p,channel));if(resolved.some(v=>!available.some(c=>labelKey(c)===labelKey(v))))ambiguous=true;
    const candidates=[...new Set(resolved.filter(v=>available.some(c=>labelKey(c)===labelKey(v))))];
    if(candidates.length){if(candidates.length===1)values.push(candidates[0]);else ambiguous=true;break;}
   }
  }
  const unique=[...new Set(values)];return {channel,category:!ambiguous&&unique.length===1?unique[0]:'',candidates:unique,needsReview:ambiguous||unique.length!==1};
 });
}
export function brandsForCategory(state,id='',products=state.products||[]){const values=new Map();for(const p of products)if((!id||productInCategories(state,p,[id]))&&p.brand&&!values.has(labelKey(p.brand)))values.set(labelKey(p.brand),p.brand);return [...values.values()].sort((a,b)=>a.localeCompare(b,'es'));}
export function categorySearch(state,query='',product={}){
 const raw=labelKey(query||product.name),normalize=v=>labelKey(v).replace(/[^a-z0-9]+/g,' ').trim();
 const input=normalize(raw),tokens=input.split(/\s+/).filter(Boolean),brand=normalize(product.brand)||taxonomyBrands(state).map(normalize).filter(b=>b.length>2&&(' '+input+' ').includes(' '+b+' ')).sort((a,b)=>b.length-a.length)[0]||'',model=normalize(product.model);
 const families=[[/\b(?:funda|cargador|adaptador|accesorio|accesorios)\b/,'accesorios'],[/\b(?:iphone|celular(?:es)?|smartphones?|galaxy a\d|galaxy s\d)\b/,'celulares'],[/\b(?:ipad|tablets?|tabletas?|tab)\b/,'tablet'],[/\b(?:macbook|laptops?|portatiles?)\b/,'laptops'],[/\b(?:airpods|audifono|audifonos|headphone)\b/,'audifonos'],[/\b(?:smartwatch|watch)\b/,'smartwatches'],[/\b(?:perfume|perfumes|parfum|toilette|fragancia)\b/,'perfumes'],[/\b(?:xbox|playstation|consola|switch)\b/,'consolas'],[/\b(?:aspiradora|vacuum)\b/,'aspiradoras'],[/\b(?:botella|botellas|termo|termos)\b/,'termos y botellas']];
 const family=families.find(([re])=>re.test(input))?.[1]||'';
 const candidates=taxonomy(state).nodes.map(node=>{const path=categoryLabel(state,node.id),text=normalize(path),name=normalize(node.name);let score=0;
  if(brand&&brand!=='apple'&&text.startsWith('apple'))return null;
  if(family&&family!=='accesorios'&&text.includes('accesorios'))return null;
  if(family==='celulares'&&name==='smartwatches')return null;
  const familyTerms={tablet:['tablet','ipad'],laptops:['laptops','macbook'],audifonos:['audifonos','airpods'],smartwatches:['smartwatches','watch'],celulares:['celulares','iphone']};
  if(family){if((familyTerms[family]||[family]).some(term=>text.includes(term)))score+=120;else if(name==='apple'&&/\b(?:iphone|ipad|macbook|airpods|watch)\b/.test(input))score+=15;else return null;}
  const generation=name.match(/(?:iphone|watch|ipad)\s*(?:series\s*)?(\d+)/);if(generation&&!new RegExp('\\b'+generation[1]+'\\b').test(input))score-=80;
  const variants=name.match(/\b(?:m[1-9]|a1[67]|\d+(?:a|va)? gen)\b/g)||[];if(variants.some(v=>!input.includes(v)))score-=80;
  for(const token of tokens)if(token.length>=2&&text.includes(token))score+=name.includes(token)?12:4;
  if(brand&&text.includes(brand))score+=8;if(model&&text.includes(model))score+=6;
  if((input.includes('dama')&&text.includes('dama'))||(input.includes('caballero')&&text.includes('caballero')))score+=40;
  if(name===family)score+=20;score+=Math.min(categoryPath(state,node.id).length,6);
  return score>5?{id:node.id,path,score,reason:family?'Tipo de producto primero; después marca y modelo.':'Coincidencia de palabras en la ruta.'}:null;
 }).filter(Boolean).sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path,'es'));
 return raw?candidates.slice(0,12):[];
}

export function categoryMarketSummary(state,id,market){
 const channel=['Sears','Sanborns'].includes(market)?'T1 Comercios':market;
 const node=taxonomy(state).nodes.find(n=>n.id===canonicalCategoryId(state,id));
 if(!node)throw Error('No se encontró la ruta seleccionada.');
 const products=(state.products||[]).filter(p=>productInCategories(state,p,[node.id]));
 const counts=new Map();for(const p of products){const value=resolveCategory(state.config,p,channel)||'';counts.set(value,(counts.get(value)||0)+1);}
 const candidates=[...counts].map(([category,count])=>({category,count})).sort((a,b)=>b.count-a.count||a.category.localeCompare(b.category,'es'));
 const proposal=categoryMappingProposal(state,[node.id]).find(r=>r.channel===channel);
 const general=channel==='T1 Comercios'||channel==='Tienda Nube';
 const configured=node.marketMappings?.[channel]||'';
 return {id:node.id,market,channel,path:categoryLabel(state,node.id),products:products.length,candidates,configured,proposed:general?resolveCategory(state.config,{},channel):proposal?.category||'',general,category:candidates.length===1?candidates[0].category:!products?(configured||proposal?.category||''):'',mixed:candidates.length>1};
}
export function saveCategoryMarketMapping(state,command,ctx={}){
 const p=command.payload||{},current=taxonomy(state),id=canonicalCategoryId(state,p.categoryId),node=current.nodes.find(n=>n.id===id);
 if(!node)throw Error('Selecciona una ruta existente.');if(p.expectedRevision!==current.revision)throw Error('El catálogo cambió. Vuelve a abrir esta ruta antes de guardar.');
 if(typeof p.applyExisting!=='boolean'||typeof p.includeExceptions!=='boolean')throw Error('Revisa el alcance del cambio.');
 if(!CLASSIFIED_MARKETS.includes(p.market))throw Error('Este canal utiliza una regla general; edítala desde Comisiones.');
 if(typeof p.marketCategory!=='string'||!p.marketCategory.trim())throw Error('Selecciona la categoría del marketplace.');
 const mapped=validateMarketCategories(state,{[p.market]:p.marketCategory})[p.market],draft=structuredClone(state),catalog=structuredClone(current),savedNode=catalog.nodes.find(n=>n.id===id);
 savedNode.marketMappings={...(savedNode.marketMappings||{}),[p.market]:mapped};if(savedNode.marketMappingConflicts){savedNode.marketMappingConflicts={...savedNode.marketMappingConflicts};delete savedNode.marketMappingConflicts[p.market];}
 catalog.revision++;(draft.catalogs??={}).productTaxonomy=catalog;const changes=[],preserved=[];
 if(p.applyExisting)for(const product of draft.products||[]){if(!productInCategories(draft,product,[id]))continue;const keys=({Coppel:['coppel'],'Mercado Libre':['mercado libre','ml','mercadolibre'],Liverpool:['liverpool'],Elektra:['elektra']})[p.market],overrides=Object.entries(product.categoryOverrides||{}).filter(([key,value])=>keys.includes(labelKey(key))&&value&&labelKey(value)!=='automatico'),overridden=overrides.length>0;
  if(overridden&&!p.includeExceptions){preserved.push(product.sku);continue;}
  const before=resolveCategory(draft.config,product,p.market);if(before===mapped)continue;
  changes.push({sku:product.sku,before,after:mapped,previousMarketCategories:structuredClone(product.marketCategories||{}),previousOverrides:structuredClone(product.categoryOverrides||{})});
  if(overridden){product.categoryOverrides={...(product.categoryOverrides||{})};for(const [key] of overrides)delete product.categoryOverrides[key];}
  product.marketCategories={...(product.marketCategories||{}),[p.market]:mapped};
 }
 (draft.events??=[]).unshift({id:command.id,type:command.type,date:ctx.now,actor:ctx.actor,result:'ok',message:'Mapeo de '+categoryLabel(draft,id)+' en '+p.market+' actualizado.',changes:{categoryId:id,market:p.market,before:node.marketMappings?.[p.market]||null,after:mapped,products:changes,preservedExceptions:preserved}});
 Object.assign(state,draft);return {ok:true,count:changes.length,preserved:preserved.length,message:'Mapeo guardado para '+p.market+'. '+changes.length+' productos actualizados; '+preserved.length+' excepciones conservadas. Los precios guardados no cambian.'};
}
