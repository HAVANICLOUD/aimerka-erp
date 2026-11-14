import {database,readState} from '../../../lib/store';import {requestAccess} from '../../../lib/access';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{const access=await requestAccess(request);if(!access.active)return Response.json({error:'Acceso no disponible.'},{status:403});const data=await readState('v43');const row={revision:data.revision,updated_at:data.updatedAt};return Response.json({workspace:'v43',revision:Number(row?.revision||0),teamRevision:access.teamRevision,updatedAt:row?.updated_at||null},{headers:{'Cache-Control':'no-store'}});}catch(error:any){return Response.json({error:error.message},{status:503});}
}
