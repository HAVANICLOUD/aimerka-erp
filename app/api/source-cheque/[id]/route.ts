import originals from '../../../../data/source-cheques-v43.json';
import {requestAccess,assertPermission} from '../../../../lib/access';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
 try{
  const access=await requestAccess(request);assertPermission(access,'settlement.cheque');
  if(new URL(request.url).searchParams.get('workspace')!=='v43')return new Response('Disponible en Laboratorio V43.',{status:404});
  const id=(await context.params).id,doc=(originals as any)[id];if(!doc)return new Response('Original no disponible.',{status:404});
  const bytes=Uint8Array.from(atob(doc.data),(c:string)=>c.charCodeAt(0));
  return new Response(bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':"inline; filename*=UTF-8''"+encodeURIComponent(doc.name),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch{return new Response('Se requiere acceso de finanzas.',{status:403});}
}
