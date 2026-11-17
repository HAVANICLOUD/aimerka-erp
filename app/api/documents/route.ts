import {originalDimensions,checkedDimensions} from '../../../lib/image-original-info.mjs';
import {detectProductImageMime} from '../../../lib/product-image-formats.mjs';
import {thumbnailKey,validateThumbnail} from '../../../lib/product-image-policy.mjs';
import { workspaceId } from '../../../lib/store';
import { documentBucket, documentKey, fileMetadata, MAX_DOCUMENT_BYTES } from '../../../lib/documents';
import {requestAccess,assertPermission} from '../../../lib/access';
import {parseRetentionXML} from '../../../lib/retention-certificates.mjs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return Response.json({error:'Origen de solicitud no válido.'},{status:403});
    if(new URL(request.url).searchParams.get('workspace')!=='v43')return Response.json({error:'Recarga AIMERKA para adjuntar documentos en la operación compartida.'},{status:409});
    const workspace = workspaceId('v43');
    const purpose=new URL(request.url).searchParams.get('purpose');
    const access=await requestAccess(request);try{assertPermission(access,purpose==='settlement'||purpose==='retention'?'settlement.cheque':purpose==='image'?'product.save':'purchase.importDocuments');}catch(error:any){return Response.json({error:error.message},{status:403});}
    if (!request.headers.get('content-type')?.includes('multipart/form-data')) return Response.json({error:'Adjunta un archivo PDF, PNG o JPG.'},{status:415});
    if (Number(request.headers.get('content-length') || 0) > MAX_DOCUMENT_BYTES + 65536 + (purpose==='image'?2304*1024:0)) return Response.json({error:'El archivo supera el límite de 15 MB.'},{status:413});
    const form = await request.formData(), file = form.get('file');
    if (!(file instanceof File) || !file.size || file.size > MAX_DOCUMENT_BYTES) return Response.json({error:'Selecciona un archivo de hasta 15 MB.'},{status:422});
    const bytes = new Uint8Array(await file.arrayBuffer());
    let mime = detectProductImageMime(bytes);
    if (new TextDecoder().decode(bytes.slice(0,5)) === '%PDF-') mime = 'application/pdf';
    else if ([137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b)) mime = 'image/png';
    else if (bytes[0]===255 && bytes[1]===216 && bytes[2]===255) mime = 'image/jpeg';
    if(!mime&&purpose==='retention'){parseRetentionXML(new TextDecoder().decode(bytes));mime='application/xml';}
    if (!mime) return Response.json({error:'El contenido debe ser un PDF o una imagen JPG, PNG, WebP, GIF o AVIF válida; para certificados fiscales también XML SAT.'},{status:415});
    if(purpose==='image'&&!mime.startsWith('image/'))return Response.json({error:'Selecciona una imagen JPG, PNG, WebP, GIF o AVIF.'},{status:415});
    const digest = await crypto.subtle.digest('SHA-256',bytes);
    const id = Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,'0')).join('');
    const key = documentKey(workspace,id), bucket = documentBucket();
    let object = await bucket.head(key);
    if (!object) {
      const name = file.name.replace(/[\u0000-\u001f\u007f/\\]/g,'_').slice(0,200) || 'Documento';
      const dimensions=checkedDimensions(originalDimensions(bytes,mime));
      object = await bucket.put(key,bytes,{httpMetadata:{contentType:mime,cacheControl:'private, no-store'},customMetadata:{name:encodeURIComponent(name),createdAt:new Date().toISOString(),...(dimensions?{width:String(dimensions.width),height:String(dimensions.height)}:{})}});
    }
    if(purpose==='image')for(const variant of ['thumbnail','preview']){
      const derived=form.get(variant);if(!(derived instanceof File))continue;
      const value=new Uint8Array(await derived.arrayBuffer());validateThumbnail(value,variant);
      const derivedKey=thumbnailKey(workspace,id,variant);if(!await bucket.head(derivedKey))await bucket.put(derivedKey,value,{httpMetadata:{contentType:'image/webp',cacheControl:'private, max-age=3600'},customMetadata:{sourceId:id,version:variant==='preview'?'v1-1280':'v1-256',kind:'product-thumbnail'}});
    }
    return Response.json({document:fileMetadata(object,id)},{headers:{'Cache-Control':'no-store'}});
  } catch(error:any) { return Response.json({error:error.message || 'No se pudo guardar el archivo.'},{status:422}); }
}
