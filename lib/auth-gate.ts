import { loginPage } from './login-page';
import {
  IDENTITY_HEADER, authConfig, clearSessionCookies, logout, passwordLogin, refreshSession,
  sendRecovery, sessionCookies, setSessionCookies, updatePassword, verifyAccessToken, type AuthConfig,
} from './supabase-auth';

// Puerta de autenticación del worker. Sin SUPABASE_URL/SUPABASE_ANON_KEY no hace
// nada (OpenAI Sites sigue poniendo su propio encabezado de identidad).

const json = (body: unknown, status = 200, headers = new Headers()) => {
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
};

/** Caddy termina TLS: se reconstruye la URL pública para que las comprobaciones de origen coincidan. */
export function publicRequest(request: Request) {
  const proto = request.headers.get('x-forwarded-proto');
  const url = new URL(request.url);
  if (proto === 'https' || proto === 'http') url.protocol = proto + ':';
  const host = request.headers.get('x-forwarded-host');
  if (host) url.host = host;
  return url.href === request.url ? request : new Request(url.href, request);
}

const isSecure = (request: Request) => new URL(request.url).protocol === 'https:';

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Correo o contraseña incorrectos.',
  email_not_confirmed: 'Confirma tu correo antes de entrar.',
  over_request_rate_limit: 'Demasiados intentos. Espera unos minutos.',
  over_email_send_rate_limit: 'Se enviaron demasiados correos. Espera unos minutos.',
  weak_password: 'La contraseña es muy débil. Usa al menos 10 caracteres.',
  same_password: 'La contraseña nueva debe ser distinta de la anterior.',
};
const friendly = (data: any, fallback: string) => MESSAGES[data?.error_code] || MESSAGES[data?.error] || fallback;

async function body(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json')) return null;
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return null;
  return request.json().catch(() => null) as Promise<any>;
}

async function authRoute(request: Request, config: AuthConfig, path: string): Promise<Response | null> {
  const secure = isSecure(request);
  if (path === '/login' && request.method === 'GET') {
    return new Response(loginPage, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (path === '/logout') {
    const { access } = sessionCookies(request);
    if (access) await logout(config, access).catch(() => {});
    const headers = new Headers({ Location: '/login', 'Cache-Control': 'no-store' });
    clearSessionCookies(headers, secure);
    return new Response(null, { status: 303, headers });
  }
  if (!path.startsWith('/auth/')) return null;
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  const input = await body(request);
  if (!input) return json({ error: 'Solicitud no válida.' }, 400);

  if (path === '/auth/login') {
    const email = String(input.email || '').trim().toLowerCase(), password = String(input.password || '');
    if (!email || !password) return json({ error: 'Escribe tu correo y contraseña.' }, 400);
    const result = await passwordLogin(config, email, password);
    if (!result.ok) return json({ error: friendly(result.data, 'No se pudo iniciar sesión.') }, result.status === 429 ? 429 : 401);
    const headers = new Headers();
    setSessionCookies(headers, result.data, secure);
    return json({ ok: true }, 200, headers);
  }
  if (path === '/auth/recover') {
    const email = String(input.email || '').trim().toLowerCase();
    if (!email) return json({ error: 'Escribe tu correo.' }, 400);
    const result = await sendRecovery(config, email, new URL('/login', request.url).href);
    // No se revela si el correo existe.
    if (!result.ok && result.status === 429) return json({ error: friendly(result.data, 'Espera unos minutos.') }, 429);
    return json({ ok: true });
  }
  if (path === '/auth/password') {
    const access = String(input.access_token || ''), refresh = String(input.refresh_token || ''), password = String(input.password || '');
    if (password.length < 10) return json({ error: 'Usa al menos 10 caracteres.' }, 400);
    if (!access || !(await verifyAccessToken(config, access))) return json({ error: 'El enlace expiró. Pide uno nuevo.' }, 401);
    const result = await updatePassword(config, access, password);
    if (!result.ok) return json({ error: friendly(result.data, 'No se pudo guardar la contraseña.') }, 400);
    const headers = new Headers();
    if (refresh) {
      const renewed = await refreshSession(config, refresh);
      if (renewed.ok) setSessionCookies(headers, renewed.data, secure);
    }
    return json({ ok: true }, 200, headers);
  }
  return json({ error: 'Ruta no encontrada.' }, 404);
}

/**
 * Si la solicitud necesita sesión y no la tiene, responde (login o 401).
 * Si la tiene, llama a `next` con la identidad verificada en el encabezado.
 */
export async function withAuth(
  incoming: Request,
  env: Record<string, unknown>,
  next: (request: Request) => Promise<Response>,
): Promise<Response> {
  const request = publicRequest(incoming);
  const config = authConfig(env);
  if (!config) return next(request);

  const path = new URL(request.url).pathname;
  const route = await authRoute(request, config, path);
  if (route) return route;

  // Nunca se acepta la identidad que mande el navegador.
  const headers = new Headers(request.headers);
  headers.delete(IDENTITY_HEADER);

  const { access, refresh } = sessionCookies(request);
  let email = access ? await verifyAccessToken(config, access) : null;
  const setCookies = new Headers();
  if (!email && refresh) {
    const renewed = await refreshSession(config, refresh);
    if (renewed.ok) {
      email = await verifyAccessToken(config, renewed.data.access_token);
      if (email) setSessionCookies(setCookies, renewed.data, isSecure(request));
    }
  }

  if (!email) {
    const clear = new Headers();
    if (access || refresh) clearSessionCookies(clear, isSecure(request));
    if (path.startsWith('/api/')) return json({ error: 'Tu sesión terminó. Vuelve a iniciar sesión.', login: '/login' }, 401, clear);
    clear.set('Location', '/login' + (path !== '/' ? '?next=' + encodeURIComponent(path) : ''));
    clear.set('Cache-Control', 'no-store');
    return new Response(null, { status: 303, headers: clear });
  }

  headers.set(IDENTITY_HEADER, email);
  const response = await next(new Request(request, { headers }));
  const out = new Response(response.body, response);
  out.headers.set('X-Aimerka-Session', '1');
  for (const value of setCookies.getSetCookie()) out.headers.append('Set-Cookie', value);
  return out;
}
