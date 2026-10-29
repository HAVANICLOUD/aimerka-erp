import {readState,workspaceId,priorAction,hashInput,commitState,createSeed} from '../../../lib/store';
import {applyCommand} from '../../../lib/commands.mjs';
import {verifyDocuments} from '../../../lib/documents';
export const dynamic='force-dynamic';
export async function POST(request:Request){
  try{
    const origin=request.headers.get('origin');
    if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'Origen de solicitud no válido.'},{status:403});
    if(!request.headers.get('content-type')?.includes('application/json'))return Response.json({error:'Se requiere JSON.'},{status:415});
    const command=await request.json();
    if(typeof command.id!=='string'||command.id.length<8||command.id.length>160||typeof command.type!=='string')return Response.json({error:'La operación requiere un identificador válido.'},{status:400});
    const id=workspaceId(command.workspace),inputHash=await hashInput({type:command.type,payload:command.payload||{}});
    const previous=await priorAction(id,command.id);
    if(previous){if(previous.input_hash!==inputHash)return Response.json({error:'Este identificador ya se utilizó para otra operación.'},{status:409});return Response.json({...await readState(id),result:{...JSON.parse(previous.result),duplicate:true,message:'Operación ya registrada. No se repitieron movimientos.'}});}
    const current=await readState(id);
    if(command.revision!==current.revision)return Response.json({error:'Hay cambios guardados desde otra ventana. Se cargó la versión actual; revisa y vuelve a guardar.',...current},{status:409});
    const next=structuredClone(current.state),actor=request.headers.get('oai-authenticated-user-email')||'Acceso privado AIMERKA';
    const verifiedDocuments=command.type==='purchase.importDocuments'?await verifyDocuments(id,command.payload?.documents):undefined;
    const result=applyCommand(next,command,{workspace:id,now:new Date().toISOString(),actor,verifiedDocuments,createPractice:()=>createSeed('practice')});
    if(result?.ok===false)return Response.json({error:result.message,result},{status:422});
    const saved=await commitState(id,current.revision,current.state,next,command,result,actor,inputHash);
    if(!saved)return Response.json({error:'La operación coincidió con otro guardado. Revisa la versión actual y vuelve a intentar.',...await readState(id)},{status:409});
    return Response.json(saved,{headers:{'Cache-Control':'no-store'}});
  }catch(error:any){return Response.json({error:error.message||'No se pudo guardar la operación.'},{status:422});}
}
