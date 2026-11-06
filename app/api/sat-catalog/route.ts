import catalogue from '../../../data/sat-products.json';
import {readState,workspaceId} from '../../../lib/store';
import {requestAccess} from '../../../lib/access';
export const dynamic='force-dynamic';
const normalize=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const indexed=catalogue.rows.map(r=>({code:r[0] as string,description:r[1] as string,search:normalize(r.slice(0,3).join(' ')),from:r[3] as string,to:r[4] as string|null}));
export async function GET(request:Request){
 try{const url=new URL(request.url),state=await readState(workspaceId(url.searchParams.get('workspace'))),access=await requestAccess(request,state);if(!access.active)return Response.json({error:'Inicia sesión para consultar el catálogo.'},{status:403});
 const q=normalize((url.searchParams.get('q')||'').slice(0,120)),terms=q.split(/\s+/).filter(Boolean),today=new Date().toISOString().slice(0,10);
 const results=q.length<2?[]:indexed.filter(r=>(!r.to||r.to>=today)&&r.from<=today&&terms.every(t=>r.search.includes(t))).sort((a,b)=>Number(b.code===q)-Number(a.code===q)||a.code.localeCompare(b.code)).slice(0,40).map(({code,description})=>({code,description}));
 return Response.json({results,version:catalogue.version,source:catalogue.source,sourceUrl:catalogue.sourceUrl,officialUrl:catalogue.officialUrl},{headers:{'Cache-Control':'private, max-age=300'}});
 }catch(error:any){return Response.json({error:error.message},{status:503});}
}
