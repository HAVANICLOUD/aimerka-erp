// Inicio de sesión con Supabase Auth.
//
// La sesión vive en dos cookies HttpOnly (token de acceso y de renovación).
// El worker valida el token antes de cualquier ruta y, si es válido, pasa el
// correo verificado al ERP en `oai-authenticated-user-email` — el mismo
// encabezado que usaba OpenAI Sites — así lib/access.ts no cambia. Cualquier
// valor de ese encabezado que llegue del navegador se descarta.

export type AuthConfig = { url: string; anonKey: string };
export type Session = { access_token: string; refresh_token: string; expires_in: number };

export const IDENTITY_HEADER = 'oai-authenticated-user-email';
const ACCESS_COOKIE = 'aimerka_at';
const REFRESH_COOKIE = 'aimerka_rt';
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;

export function authConfig(env: Record<string, unknown>): AuthConfig | null {
  const url = typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL.replace(/\/+$/, '') : '';
  const anonKey = typeof env.SUPABASE_ANON_KEY === 'string' ? env.SUPABASE_ANON_KEY : '';
  return url && anonKey ? { url, anonKey } : null;
}

async function supabase(config: AuthConfig, path: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set('apikey', config.anonKey);
  headers.set('Authorization', 'Bearer ' + (init.token || config.anonKey));
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(config.url + '/auth/v1' + path, { ...init, headers });
  const data: any = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

export async function passwordLogin(config: AuthConfig, email: string, password: string) {
  return supabase(config, '/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
}
export async function refreshSession(config: AuthConfig, refreshToken: string) {
  return supabase(config, '/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) });
}
export async function sendRecovery(config: AuthConfig, email: string, redirectTo: string) {
  return supabase(config, '/recover?redirect_to=' + encodeURIComponent(redirectTo), { method: 'POST', body: JSON.stringify({ email }) });
}
export async function updatePassword(config: AuthConfig, accessToken: string, password: string) {
  return supabase(config, '/user', { method: 'PUT', token: accessToken, body: JSON.stringify({ password }) });
}
export async function logout(config: AuthConfig, accessToken: string) {
  return supabase(config, '/logout', { method: 'POST', token: accessToken });
}

// ---- Verificación del token (JWKS asimétrico; si no aplica, se consulta /user) ----

const b64url = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), c => c.charCodeAt(0));
const jsonPart = (value: string) => JSON.parse(new TextDecoder().decode(b64url(value)));

let jwks: { at: number; keys: any[] } | null = null;
async function signingKeys(config: AuthConfig) {
  if (jwks && Date.now() - jwks.at < 10 * 60_000) return jwks.keys;
  const response = await fetch(config.url + '/auth/v1/.well-known/jwks.json', { headers: { apikey: config.anonKey } });
  const data: any = await response.json().catch(() => ({}));
  jwks = { at: Date.now(), keys: Array.isArray(data.keys) ? data.keys : [] };
  return jwks.keys;
}

const userCache = new Map<string, { email: string; until: number }>();

/** Devuelve el correo verificado del token, o null si no es válido o expiró. */
export async function verifyAccessToken(config: AuthConfig, token: string): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header: any, payload: any;
  try { header = jsonPart(parts[0]); payload = jsonPart(parts[1]); } catch { return null; }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
  if (payload.aud !== 'authenticated' || typeof payload.email !== 'string' || !payload.email) return null;
  if (payload.iss && payload.iss !== config.url + '/auth/v1') return null;

  const algorithms: Record<string, { import: any; verify: any }> = {
    ES256: { import: { name: 'ECDSA', namedCurve: 'P-256' }, verify: { name: 'ECDSA', hash: 'SHA-256' } },
    RS256: { import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verify: { name: 'RSASSA-PKCS1-v1_5' } },
  };
  const algorithm = algorithms[header.alg];
  const jwk = algorithm && (await signingKeys(config)).find(k => k.kid === header.kid);
  if (algorithm && jwk) {
    const key = await crypto.subtle.importKey('jwk', jwk, algorithm.import, false, ['verify']);
    const valid = await crypto.subtle.verify(algorithm.verify, key, b64url(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    return valid ? payload.email.toLowerCase() : null;
  }
  // Proyectos con secreto compartido (HS256): Supabase valida el token.
  const cached = userCache.get(token);
  if (cached && cached.until > Date.now()) return cached.email;
  const user = await supabase(config, '/user', { token });
  const email = user.ok && typeof user.data?.email === 'string' ? user.data.email.toLowerCase() : null;
  if (email) userCache.set(token, { email, until: Math.min(Date.now() + 60_000, payload.exp * 1000) });
  if (userCache.size > 500) userCache.clear();
  return email;
}

// ---- Cookies ----

export function readCookie(request: Request, name: string) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}
export const sessionCookies = (request: Request) => ({ access: readCookie(request, ACCESS_COOKIE), refresh: readCookie(request, REFRESH_COOKIE) });

function cookie(name: string, value: string, maxAge: number, secure: boolean) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
export function setSessionCookies(headers: Headers, session: Session, secure: boolean) {
  headers.append('Set-Cookie', cookie(ACCESS_COOKIE, session.access_token, Math.max(60, Number(session.expires_in) || 3600), secure));
  headers.append('Set-Cookie', cookie(REFRESH_COOKIE, session.refresh_token, REFRESH_MAX_AGE, secure));
}
export function clearSessionCookies(headers: Headers, secure: boolean) {
  headers.append('Set-Cookie', cookie(ACCESS_COOKIE, '', 0, secure));
  headers.append('Set-Cookie', cookie(REFRESH_COOKIE, '', 0, secure));
}
