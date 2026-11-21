import { env } from 'cloudflare:workers';
import { SupabaseBucket, storageConfig } from './supabase-storage';

export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
export function documentBucket(): any {
  // Con SUPABASE_SERVICE_ROLE_KEY los archivos viven en Supabase Storage.
  const supabase = storageConfig(env as unknown as Record<string, unknown>);
  if (supabase) return new SupabaseBucket(supabase);
  const bucket = (env as any).BUCKET;
  if (!bucket) throw new Error('El archivo documental no está disponible. Intenta nuevamente.');
  return bucket;
}
export function documentId(value: unknown) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Identificador documental no válido.');
  return value;
}
export function documentKey(workspace: string, id: string) { return workspace + '/documents/' + documentId(id); }
export function fileMetadata(object: any, id: string) {
  const meta = object.customMetadata || {};
  let name = 'Documento';
  try { name = decodeURIComponent(meta.name || 'Documento'); } catch {}
  return { id, sha256: id, name, mime: object.httpMetadata?.contentType || 'application/octet-stream', size: object.size,
    createdAt: meta.createdAt || new Date().toISOString() };
}
export async function verifyDocuments(workspace: string, documents: any[]) {
  if (!Array.isArray(documents) || !documents.length || documents.length > 12) throw new Error('Selecciona entre 1 y 12 documentos por importación.');
  const ids = new Set<string>();
  const bucket = documentBucket();
  return Promise.all(documents.map(async doc => {
    const id = documentId(doc?.id);
    if (ids.has(id)) throw new Error('El mismo archivo está repetido en esta importación.');
    ids.add(id);
    if (JSON.stringify(doc.parsed || {}).length > 250000) throw new Error('La lectura del documento es demasiado extensa. Divide el archivo.');
    const object = await bucket.head(documentKey(workspace, id));
    if (!object) throw new Error('Uno de los archivos no terminó de cargarse. Vuelve a adjuntarlo.');
    return fileMetadata(object, id);
  }));
}
