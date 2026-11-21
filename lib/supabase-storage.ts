import { postgresDatabase } from './pg-d1';

// Adaptador con la forma mínima de R2 (head/get/put) sobre Supabase Storage.
// Los bytes viven en el bucket privado; los metadatos (tipo, tamaño, etag y
// customMetadata) en la tabla erp_files de Postgres, así `head` no toca Storage.

export type StorageConfig = { url: string; serviceKey: string; bucket: string };

export function storageConfig(env: Record<string, unknown>): StorageConfig | null {
  const url = typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL.replace(/\/+$/, '') : '';
  const serviceKey = typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string' ? env.SUPABASE_SERVICE_ROLE_KEY : '';
  const bucket = typeof env.SUPABASE_STORAGE_BUCKET === 'string' && env.SUPABASE_STORAGE_BUCKET ? env.SUPABASE_STORAGE_BUCKET : 'erp-files';
  return url && serviceKey ? { url, serviceKey, bucket } : null;
}

type Row = { key: string; content_type: string; cache_control: string | null; size: number; etag: string; custom: string; created_at: string };

function objectFrom(row: Row) {
  let customMetadata: Record<string, string> = {};
  try { customMetadata = JSON.parse(row.custom || '{}'); } catch {}
  return {
    key: row.key,
    size: Number(row.size),
    etag: row.etag,
    httpEtag: '"' + row.etag + '"',
    uploaded: new Date(row.created_at),
    httpMetadata: { contentType: row.content_type, ...(row.cache_control ? { cacheControl: row.cache_control } : {}) },
    customMetadata,
  };
}

const encodePath = (key: string) => key.split('/').map(encodeURIComponent).join('/');

export class SupabaseBucket {
  constructor(private config: StorageConfig) {}

  private db() {
    const db = postgresDatabase();
    if (!db) throw new Error('El archivo documental requiere la base de datos Postgres.');
    return db;
  }
  private endpoint(key: string) { return `${this.config.url}/storage/v1/object/${this.config.bucket}/${encodePath(key)}`; }
  private auth() { return { apikey: this.config.serviceKey, Authorization: 'Bearer ' + this.config.serviceKey }; }

  async head(key: string) {
    const row = await this.db().prepare('SELECT key,content_type,cache_control,size,etag,custom,created_at FROM erp_files WHERE key=?').bind(key).first<Row>();
    return row ? objectFrom(row) : null;
  }

  async get(key: string, options: { range?: { offset?: number; length?: number } } = {}) {
    const meta = await this.head(key);
    if (!meta) return null;
    const headers: Record<string, string> = this.auth();
    const range = options.range;
    if (range && (range.offset || range.length)) {
      const start = range.offset || 0;
      headers.Range = 'bytes=' + start + '-' + (range.length ? start + range.length - 1 : '');
    }
    const response = await fetch(this.endpoint(key), { headers });
    if (!response.ok || !response.body) {
      if (response.status === 404 || response.status === 400) return null;
      throw new Error('No se pudo leer el archivo (' + response.status + ').');
    }
    const body = response.body;
    return {
      ...meta,
      body,
      text: () => new Response(body).text(),
      arrayBuffer: () => new Response(body).arrayBuffer(),
    };
  }

  async put(key: string, value: ArrayBuffer | Uint8Array, options: { httpMetadata?: { contentType?: string; cacheControl?: string }; customMetadata?: Record<string, string> } = {}) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    const contentType = options.httpMetadata?.contentType || 'application/octet-stream';
    const response = await fetch(this.endpoint(key), {
      method: 'POST',
      headers: { ...this.auth(), 'Content-Type': contentType, 'x-upsert': 'true', 'Cache-Control': 'max-age=3600' },
      body: bytes as unknown as BodyInit,
    });
    if (!response.ok) throw new Error('No se pudo guardar el archivo (' + response.status + ').');
    const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
    const etag = Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2, '0')).join('');
    const now = new Date().toISOString();
    await this.db().prepare('INSERT INTO erp_files(key,content_type,cache_control,size,etag,custom,created_at) VALUES(?,?,?,CAST(? AS INTEGER),?,?,?) ON CONFLICT(key) DO UPDATE SET content_type=excluded.content_type,cache_control=excluded.cache_control,size=excluded.size,etag=excluded.etag,custom=excluded.custom')
      .bind(key, contentType, options.httpMetadata?.cacheControl || null, bytes.byteLength, etag, JSON.stringify(options.customMetadata || {}), now).run();
    return objectFrom({ key, content_type: contentType, cache_control: options.httpMetadata?.cacheControl || null, size: bytes.byteLength, etag, custom: JSON.stringify(options.customMetadata || {}), created_at: now });
  }
}
