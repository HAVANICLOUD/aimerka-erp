import {taxonomy,classification,categoryLabel,labelKey} from './product-taxonomy.mjs?v=20261115-simple-mapping';
const normalize=v=>labelKey(v).replace(/[^a-z0-9]+/g,' ').trim();
const compact=v=>normalize(v).replaceAll(' ','');
const cache=new WeakMap();
const groups=[['celular','celulares','telefono','telefonos','smartphone','smartphones'],['tablet','tablets','tableta','tabletas'],['audifono','audifonos','auricular','auriculares','headphone','headphones'],['laptop','laptops','portatil','portatiles'],['perfume','perfumes','perfumeria','fragancia','fragancias','colonia'],['aspiradora','aspiradoras','vacuum'],['smartwatch','smartwatches'],['consola','consolas'],['botella','botellas','termo','termos']];
const alternatives=token=>groups.find(g=>g.includes(token))||[token];
function documentFor(state,p){const nodes=taxonomy(state).nodes,prior=cache.get(p);if(prior?.nodes===nodes)return prior;
 const paths=classification(state,p).categoryIds.map(id=>categoryLabel(state,id)),title=normalize(p.name),brand=normalize(p.brand),model=normalize(p.model);
 const codes=[p.sku,p.upc,p.sellerSku,...(p.skuAliases||[]),...(p.supplierCodes||[]).map(r=>r.item)].filter(Boolean).map(compact);
 let text=normalize([p.name,p.brand,p.model,p.color,p.capacity,p.variant,p.category,p.department,p.description,...paths,...codes,...(p.aliases||[]),...(p.supplierCodes||[]).flatMap(r=>[r.name,r.item,r.supplier])].join(' '));
 if(/eau de (parfum|toilette)/.test(title))text+=' perfume fragancia';
 const entry={nodes,text,title,brand,model,codes};cache.set(p,entry);return entry;
}
export function productSearchScore(state,p,query=''){
 const q=normalize(query);if(!q)return 1;const doc=documentFor(state,p),terms=q.split(' ').filter((t,i,a)=>a.length===1||!['de','del','la','el','los','las','para','con','y'].includes(t));
 const code=compact(query);if(code&&doc.codes.includes(code))return 10000;
 let score=0;for(const term of terms){const choices=alternatives(term);const hit=choices.find(t=>doc.text.includes(t));if(!hit)return 0;score+=doc.title.includes(term)?30:doc.brand.includes(term)?22:doc.model.includes(term)?24:8;}
 if(code&&doc.codes.some(c=>c.startsWith(code)))score+=1000;return score||1;
}
export const productSearchMatch=(state,p,query)=>productSearchScore(state,p,query)>0;
