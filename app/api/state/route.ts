import { readState, workspaceId } from '../../../lib/store';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  try{const data=await readState(workspaceId(new URL(request.url).searchParams.get('workspace')));return Response.json(data,{headers:{'Cache-Control':'no-store'}});}
  catch(error:any){return Response.json({error:error.message},{status:503,headers:{'Cache-Control':'no-store'}});}
}
