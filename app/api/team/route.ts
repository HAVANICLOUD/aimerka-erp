import {readState,readTeamPolicy,priorAction,hashInput,commitState} from '../../../lib/store';
import {requestAccess,assertPermission,OWNER_EMAIL} from '../../../lib/access';
import {applyAccessCommand} from '../../../lib/access-control.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const access=await requestAccess(request);if(!access.active||!access.permissions.includes('access'))return Response.json({error:'Tu rol no permite administrar el equipo.'},{status:403});
 const team=await readTeamPolicy();return Response.json({revision:team.revision},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request:Request){
 try{
  const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'Origen no válido.'},{status:403});
  if(!request.headers.get('content-type')?.includes('application/json'))return Response.json({error:'Se requiere JSON.'},{status:415});
  const command=await request.json();if(typeof command.id!=='string'||command.id.length<8||command.id.length>160||!['access.role.save','access.user.save'].includes(command.type))return Response.json({error:'Operación de equipo no válida.'},{status:400});
  const access=await requestAccess(request);try{assertPermission(access,command.type);}catch(error:any){return Response.json({error:error.message},{status:403});}
  const current=await readState('v28'),inputHash=await hashInput({type:command.type,payload:command.payload||{}}),previous=await priorAction('v28',command.id);
  if(previous){if(previous.input_hash!==inputHash)return Response.json({error:'Identificador utilizado en otra operación.'},{status:409});return Response.json({result:JSON.parse(previous.result),duplicate:true},{headers:{'Cache-Control':'no-store'}});}
  if(command.revision!==current.revision)return Response.json({error:'El equipo cambió en otra ventana. Revisa y vuelve a guardar.'},{status:409});
  const next=structuredClone(current.state),result=applyAccessCommand(next,command,{actor:access.email,ownerEmail:OWNER_EMAIL,now:new Date().toISOString()});
  const saved=await commitState('v28',current.revision,current.state,next,command,result,access.email,inputHash);if(!saved)return Response.json({error:'Otro usuario guardó al mismo tiempo. Vuelve a intentar.'},{status:409});
  return Response.json({result,revision:saved.revision},{headers:{'Cache-Control':'no-store'}});
 }catch(error:any){return Response.json({error:error.message||'No se pudo guardar el equipo.'},{status:422});}
}
