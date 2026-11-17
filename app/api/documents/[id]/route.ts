import {productImages} from '../../../../lib/product-images';
import {canReadFinance} from '../../../../lib/access-control.mjs';
import { workspaceId, readState } from '../../../../lib/store';
import { documentBucket, documentId, documentKey } from '../../../../lib/documents';
import {requestAccess} from '../../../../lib/access';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: {params: Promise<{id:string}>}) {
  try {
    const id = documentId((await context.params).id), workspace = workspaceId(new URL(request.url).searchParams.get('workspace'));
    const access=await requestAccess(request);
    if(!access.active)return new Response('Acceso no disponible.',{status:403});
    const index=await productImages(workspace),image=index.get(id);
    let financial:any=image?.financial,doc:any=image;
    if(!doc){
      const current=await readState(workspace,false);
      financial=(current.state.settlementLedger?.documents||[]).find((row:any)=>row.id===id);
      doc=financial||(current.state.documents||[]).find((row:any)=>row.id===id);
    }
    if(financial&&!canReadFinance(access))return new Response('Se requiere permiso de finanzas.',{status:403});
    if (!doc) return new Response('Documento no encontrado en este espacio.',{status:404});
    const object = await documentBucket().get(documentKey(workspace,id));
    if (!object) return new Response('Archivo no disponible.',{status:404});
    const headers = new Headers({'Content-Type':object.httpMetadata?.contentType || doc.mime,
      'Cache-Control':!financial&&image?'private, max-age=3600':'private, no-store','X-Content-Type-Options':'nosniff',
      'Content-Disposition':"inline; filename*=UTF-8''"+encodeURIComponent(doc.name || 'Documento'),
      'Content-Length':String(object.size)});
    if((object.httpMetadata?.contentType||doc.mime)==='application/xml'){headers.set('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(doc.name||'retencion.xml'));headers.set('Content-Security-Policy',"default-src 'none'; sandbox");}
    return new Response(object.body,{headers});
  } catch(error:any) { return Response.json({error:error.message || 'No se pudo consultar el archivo.'},{status:422}); }
}
