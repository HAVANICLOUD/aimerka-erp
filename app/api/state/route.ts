import { readState, workspaceId } from '../../../lib/store';
import {requestAccess,visibleState} from '../../../lib/access';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  try{const data=await readState(workspaceId(new URL(request.url).searchParams.get('workspace'))),access=await requestAccess(request,data);if(!access.active)return Response.json({error:'Tu acceso está suspendido o falta iniciar sesión.'},{status:403});return Response.json(visibleState(data,access),{headers:{'Cache-Control':'no-store'}});}
  catch(error:any){return Response.json({error:error.message},{status:503,headers:{'Cache-Control':'no-store'}});}
}
