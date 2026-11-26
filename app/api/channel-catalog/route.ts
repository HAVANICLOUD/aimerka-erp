import {searchChannelCatalog} from '../../../lib/channel-catalog.mjs';
import {readState,workspaceId} from '../../../lib/store';
import {requestAccess} from '../../../lib/access';
import {MARKETS} from '../../../lib/product-prices.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{
  const q=new URL(request.url).searchParams,data=await readState(workspaceId(q.get('workspace'))),access=await requestAccess(request,data);
  if(!access.active)return Response.json({error:'Inicia sesión para consultar categorías.'},{status:403});
  const market=q.get('market');if(!MARKETS.includes(market))return Response.json({error:'Canal no válido.'},{status:422});
  // Only an integration-written snapshot can supply external IDs; pricing category names are not marketplace IDs.
  const catalog=data.state.catalogs?.channelCatalogs?.[market]||{};
  return Response.json({market,...searchChannelCatalog(catalog,q.get('q')||'',q.get('categoryId')||'')},{headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});
 }catch{return Response.json({error:'No se pudo consultar el catálogo del canal.'},{status:503});}
}
