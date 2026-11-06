import {readState,workspaceId,priorAction,hashInput,commitState,createSeed} from '../../../lib/store';
import {applyCommand} from '../../../lib/commands.mjs';
import {verifyDocuments} from '../../../lib/documents';
import {requestAccess,assertPermission,OWNER_EMAIL,visibleState} from '../../../lib/access';
import {parseBankStatement} from '../../../lib/settlement-documents.mjs';
export const dynamic='force-dynamic';
export async function POST(request:Request){
  try{
    const origin=request.headers.get('origin');
    if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'Origen de solicitud no válido.'},{status:403});
    if(!request.headers.get('content-type')?.includes('application/json'))return Response.json({error:'Se requiere JSON.'},{status:415});
    const command=await request.json();
    if(typeof command.id!=='string'||command.id.length<8||command.id.length>160||typeof command.type!=='string')return Response.json({error:'La operación requiere un identificador válido.'},{status:400});
    const id=workspaceId(command.workspace),inputHash=await hashInput({type:command.type,payload:command.payload||{}});
    const current=await readState(id),access=await requestAccess(request,current);
    try{assertPermission(access,command.type);}catch(error:any){return Response.json({error:error.message},{status:403});}
    const previous=await priorAction(id,command.id);
    if(previous){if(previous.input_hash!==inputHash)return Response.json({error:'Este identificador ya se utilizó para otra operación.'},{status:409});return Response.json({...visibleState(current,access),result:{...JSON.parse(previous.result),duplicate:true,message:'Operación ya registrada. No se repitieron movimientos.'}});}
    if(command.revision!==current.revision)return Response.json({error:'Hay cambios guardados desde otra ventana. Se cargó la versión actual; revisa y vuelve a guardar.',...visibleState(current,access)},{status:409});
    const next=structuredClone(current.state),actor=access.email;
    const financial=['settlement.cheque','settlement.statement'].includes(command.type);
    const verifiedDocuments=command.type==='purchase.importDocuments'?await verifyDocuments(id,command.payload?.documents):financial?await verifyDocuments(id,[{id:command.payload?.documentId}]):undefined;
    let accountHash;
    let verifiedImages;
    if(command.type==='product.save'&&command.payload?.product?.images){
      const images=command.payload.product.images;if(!Array.isArray(images)||images.length>100)throw new Error('Galería inválida.');
      const uploads=images.filter((image:any)=>image.source!=='V43');
      verifiedImages=uploads.length?await verifyDocuments(id,uploads):[];
      if(verifiedImages.some((image:any)=>!['image/jpeg','image/png'].includes(image.mime)))throw new Error('La galería solo admite imágenes JPG y PNG.');
    }
    if(command.type==='settlement.statement'){const parsed=parseBankStatement(command.payload?.text,current.state.config.bankReconciliation);accountHash=await hashInput(parsed.account);}
    const result=applyCommand(next,command,{workspace:id,requireFiscalValidation:true,now:new Date().toISOString(),actor,ownerEmail:OWNER_EMAIL,verifiedDocuments,verifiedImages,accountHash,createPractice:()=>createSeed('practice')});
    if(result?.ok===false)return Response.json({error:result.message,result},{status:422});
    const saved=await commitState(id,current.revision,current.state,next,command,result,actor,inputHash);
    if(!saved)return Response.json({error:'La operación coincidió con otro guardado. Revisa la versión actual y vuelve a intentar.',...visibleState(await readState(id),access)},{status:409});
    return Response.json(visibleState(saved,await requestAccess(request,saved)),{headers:{'Cache-Control':'no-store'}});
  }catch(error:any){return Response.json({error:error.message||'No se pudo guardar la operación.'},{status:422});}
}
