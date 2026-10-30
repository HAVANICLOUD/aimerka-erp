import { workspaceId, readState } from '../../../../lib/store';
import { documentBucket, documentId, documentKey } from '../../../../lib/documents';
import {requestAccess} from '../../../../lib/access';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: {params: Promise<{id:string}>}) {
  try {
    const id = documentId((await context.params).id), workspace = workspaceId(new URL(request.url).searchParams.get('workspace'));
    const current = await readState(workspace);
    if(!(await requestAccess(request,current)).active)return new Response('Acceso no disponible.',{status:403});
    const doc = (current.state.documents || []).find((row:any)=>row.id===id);
    if (!doc) return new Response('Documento no encontrado en este espacio.',{status:404});
    const object = await documentBucket().get(documentKey(workspace,id));
    if (!object) return new Response('Archivo no disponible.',{status:404});
    const headers = new Headers({'Content-Type':object.httpMetadata?.contentType || doc.mime,
      'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
      'Content-Disposition':"inline; filename*=UTF-8''"+encodeURIComponent(doc.name || 'Documento'),
      'Content-Length':String(object.size)});
    return new Response(object.body,{headers});
  } catch(error:any) { return Response.json({error:error.message || 'No se pudo consultar el archivo.'},{status:422}); }
}
