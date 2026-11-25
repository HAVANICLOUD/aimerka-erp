import {fiscalCatalogResults,FISCAL_CATALOG_SOURCE} from '../../../lib/sat-fiscal-catalog.mjs';
import products from '../../../data/sat-products.json';
import units from '../../../data/sat-units.json';
import {requestAccess} from '../../../lib/access';
export const dynamic='force-dynamic';
const normalize=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const catalogues={products,units};
const index=(catalogue:typeof products)=>catalogue.rows.map(r=>({code:r[0] as string,description:r[1] as string,search:normalize(r.slice(0,3).join(' ')),from:r[3] as string,to:r[4] as string|null}));
const indexes={products:index(products),units:index(units)};
export async function GET(request:Request){
 try{
  // Authorize against the team policy only; a static catalogue must not load workspace fragments.
  const url=new URL(request.url),access=await requestAccess(request);
  if(!access.active)return Response.json({error:'Inicia sesión para consultar el catálogo.',errorCode:'SAT_ACCESS_DENIED'},{status:403,headers:{'Cache-Control':'no-store'}});
  const kind=url.searchParams.get('kind')||'products';
  if(kind==='regimes'||kind==='usages'){
   const rfc=(url.searchParams.get('rfc')||'').slice(0,13),regime=(url.searchParams.get('regime')||'').slice(0,3),q=(url.searchParams.get('q')||'').slice(0,120),code=(url.searchParams.get('code')||'').slice(0,3);
   const results=fiscalCatalogResults(kind,{rfc,regime,q,code});
   return Response.json({results,kind,bundled:true,...FISCAL_CATALOG_SOURCE},{headers:{'Cache-Control':'private, max-age=300'}});
  }
  if(kind!=='products'&&kind!=='units')return Response.json({error:'Catálogo SAT no reconocido.'},{status:400});
  const catalogue=catalogues[kind],q=normalize((url.searchParams.get('q')||'').slice(0,120)),terms=q.split(/\s+/).filter(Boolean),today=new Date().toISOString().slice(0,10),code=normalize(url.searchParams.get('code')||'');
  const browse=url.searchParams.get('browse')==='1'&&!q&&!code;
  const preferredUnits=['H87','E48','ACT','KGM','MTR','LTR'];
  const rank=(r:{code:string,description:string})=>normalize(r.code)===q?0:normalize(r.description)===q?1:normalize(r.code).startsWith(q)?2:normalize(r.description).startsWith(q)?3:4;
  const results=(!code&&!browse&&q.length<2)?[]:indexes[kind].filter(r=>(!r.to||r.to>=today)&&(!r.from||r.from<=today)&&(code?normalize(r.code)===code:terms.every(t=>r.search.includes(t)))).sort((a,b)=>(browse&&kind==='units'?((preferredUnits.indexOf(a.code)+1)||99)-((preferredUnits.indexOf(b.code)+1)||99):rank(a)-rank(b))||a.code.localeCompare(b.code)).slice(0,40).map(({code,description})=>({code,description}));
  return Response.json({results,kind,bundled:true,version:catalogue.version,source:catalogue.source,sourceUrl:catalogue.sourceUrl,officialUrl:catalogue.officialUrl},{headers:{'Cache-Control':'private, max-age=300'}});
 }catch{ return Response.json({error:'No se pudo consultar el catálogo SAT incluido. Vuelve a intentar.',errorCode:'SAT_UNAVAILABLE'},{status:503,headers:{'Cache-Control':'no-store'}}); }
}
