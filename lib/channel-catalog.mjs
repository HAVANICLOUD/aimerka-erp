/** Common category contract for future marketplace adapters; never substitutes pricing categories for external IDs. */
const key=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es-MX');
export function normalizeChannelCatalog(catalog={}){
 const nodes=new Map();
 function visit(rows,parentId=null,depth=0){if(!Array.isArray(rows)||depth>30)return;for(const raw of rows){if(!raw||raw.id==null||typeof raw.name!=='string')continue;const id=String(raw.id);if(!id||id.length>160||nodes.has(id))continue;const parent=raw.parentId==null?parentId:String(raw.parentId);nodes.set(id,{id,name:raw.name.slice(0,250),parentId:parent===id?null:parent,path:raw.path,isLeaf:raw.isLeaf,selectable:raw.selectable!==false});visit(raw.children,id,depth+1);}}
 visit(catalog.categories);
 const childIds=new Set([...nodes.values()].map(n=>n.parentId).filter(Boolean));
 function path(node){if(Array.isArray(node.path)){const names=node.path.map(v=>typeof v==='string'?v:v?.name).filter(Boolean);if(names.length)return names.join(' › ');}if(typeof node.path==='string'&&node.path.trim())return node.path;const chain=[],seen=new Set();for(let n=node;n&&!seen.has(n.id)&&chain.length<=30;n=nodes.get(n.parentId)){seen.add(n.id);chain.unshift(n.name);}return chain.join(' › ');}
 return {status:catalog.syncedAt?'cached':'not_connected',source:typeof catalog.source==='string'?catalog.source:null,syncedAt:catalog.syncedAt||null,categories:[...nodes.values()].map(n=>({...n,path:path(n),isLeaf:typeof n.isLeaf==='boolean'?n.isLeaf:!childIds.has(n.id)})),attributesByCategory:catalog.attributesByCategory||{}};
}
export function searchChannelCatalog(catalog,query='',categoryId=''){
 const all=normalizeChannelCatalog(catalog),q=key(query),matches=all.categories.filter(c=>!q||key(c.path+' '+c.id).includes(q)),attributes=all.attributesByCategory[String(categoryId)];
 return {status:all.status,source:all.source,syncedAt:all.syncedAt,total:all.categories.length,matched:matches.length,hasMore:matches.length>500,categories:matches.slice(0,500),attributes:Array.isArray(attributes)?attributes.slice(0,50).filter(a=>a&&typeof a.name==='string').map(a=>({id:String(a.id??a.name),name:a.name,required:a.required===true,type:a.type||'text',values:Array.isArray(a.values)?a.values.slice(0,500).map(v=>typeof v==='object'?String(v.name??v.value??''):String(v)):[]})):[]};
}
