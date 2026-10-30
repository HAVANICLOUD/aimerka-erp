import {database,workspaceId} from '../../../lib/store';
import {requestAccess} from '../../../lib/access';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  if(!(await requestAccess(request)).active)return Response.json({error:'Acceso no disponible.'},{status:403});
  try{const id=workspaceId(new URL(request.url).searchParams.get('workspace'));const data=await database().prepare('SELECT id,type,result,revision,actor,created_at FROM erp_actions WHERE workspace=? ORDER BY revision DESC LIMIT 500').bind(id).all();return Response.json({rows:data.results},{headers:{'Cache-Control':'no-store'}});}
  catch(error:any){return Response.json({error:error.message},{status:503});}
}
