// Pantalla de inicio de sesión (Supabase Auth). Sin dependencias externas.
// Modos: entrar, recuperar contraseña y definir contraseña (enlace de invitación o
// recuperación: Supabase regresa a /login#access_token=…&type=invite|recovery).
export const loginPage = `<!doctype html>
<html lang="es-MX">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>AiMerka — Iniciar sesión</title>
<link rel="icon" type="image/png" href="/erp/assets/aimerka-logo.png">
<style>
:root{--bg:#f4f7fc;--card:#fff;--text:#14213d;--muted:#5b6b86;--line:#d9e1ee;--brand:#2453d6;--brand-ink:#fff;--error:#b42318;--ok:#067647}
@media (prefers-color-scheme:dark){:root{--bg:#0f1524;--card:#172036;--text:#e8edf7;--muted:#9aa8c2;--line:#2a3654;--brand:#5b84ff;--error:#ff8a80;--ok:#5fd39a}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px}
main{width:100%;max-width:380px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:32px 28px;box-shadow:0 10px 30px rgba(20,33,61,.08)}
img{display:block;height:40px;width:auto;margin:0 auto 20px}
h1{font-size:20px;margin:0 0 4px;text-align:center}
p.sub{margin:0 0 24px;color:var(--muted);text-align:center;font-size:14px}
label{display:block;font-size:14px;font-weight:600;margin:14px 0 6px}
input{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit;font:inherit}
input:focus{outline:2px solid var(--brand);outline-offset:1px;border-color:transparent}
button{width:100%;margin-top:22px;padding:12px;border:0;border-radius:10px;background:var(--brand);color:var(--brand-ink);font:inherit;font-weight:600;cursor:pointer}
button[disabled]{opacity:.6;cursor:wait}
.link{display:block;margin-top:16px;text-align:center;font-size:14px;color:var(--brand);background:none;border:0;padding:0;cursor:pointer;width:auto;margin-left:auto;margin-right:auto}
.msg{margin-top:16px;font-size:14px;min-height:20px;text-align:center}
.msg.error{color:var(--error)}.msg.ok{color:var(--ok)}
[hidden]{display:none!important}
</style>
</head>
<body>
<main>
  <img src="/erp/assets/aimerka-logo.png" alt="AiMerka" width="2048" height="462">
  <form id="login">
    <h1>Inicia sesión</h1>
    <p class="sub">ERP AiMerka</p>
    <label for="email">Correo</label>
    <input id="email" name="email" type="email" autocomplete="username" required>
    <label for="password">Contraseña</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">Entrar</button>
    <button type="button" class="link" data-mode="recover">Olvidé mi contraseña</button>
  </form>
  <form id="recover" hidden>
    <h1>Recuperar contraseña</h1>
    <p class="sub">Te enviaremos un enlace a tu correo.</p>
    <label for="recover-email">Correo</label>
    <input id="recover-email" name="email" type="email" autocomplete="username" required>
    <button type="submit">Enviar enlace</button>
    <button type="button" class="link" data-mode="login">Volver</button>
  </form>
  <form id="password-form" hidden>
    <h1>Define tu contraseña</h1>
    <p class="sub">Mínimo 10 caracteres.</p>
    <label for="new-password">Contraseña nueva</label>
    <input id="new-password" type="password" autocomplete="new-password" minlength="10" required>
    <label for="new-password-2">Repite la contraseña</label>
    <input id="new-password-2" type="password" autocomplete="new-password" minlength="10" required>
    <button type="submit">Guardar y entrar</button>
  </form>
  <div class="msg" id="msg" role="status" aria-live="polite"></div>
</main>
<script>
(function(){
  var forms={login:document.getElementById('login'),recover:document.getElementById('recover'),password:document.getElementById('password-form')};
  var msg=document.getElementById('msg');
  function show(mode){Object.keys(forms).forEach(function(k){forms[k].hidden=k!==mode;});say('');}
  function say(text,tone){msg.textContent=text||'';msg.className='msg '+(tone||'');}
  document.querySelectorAll('[data-mode]').forEach(function(b){b.addEventListener('click',function(){show(b.getAttribute('data-mode'));});});
  async function send(path,body,button){
    button.disabled=true;
    try{var r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'same-origin'});var d=await r.json().catch(function(){return {};});return {ok:r.ok,data:d};}
    catch(e){return {ok:false,data:{error:'Sin conexión. Intenta de nuevo.'}};}
    finally{button.disabled=false;}
  }
  var next=new URLSearchParams(location.search).get('next')||'/';
  if(!next.startsWith('/')||next.startsWith('//'))next='/';
  forms.login.addEventListener('submit',async function(e){e.preventDefault();var b=e.submitter||forms.login.querySelector('button[type=submit]');say('Entrando…');
    var r=await send('/auth/login',{email:forms.login.email.value.trim(),password:forms.login.password.value},b);
    if(r.ok)location.replace(next);else say(r.data.error||'No se pudo iniciar sesión.','error');});
  forms.recover.addEventListener('submit',async function(e){e.preventDefault();var b=e.submitter||forms.recover.querySelector('button[type=submit]');
    var r=await send('/auth/recover',{email:forms.recover.email.value.trim()},b);
    say(r.ok?'Si el correo está registrado, te llegará un enlace en unos minutos.':(r.data.error||'No se pudo enviar el enlace.'),r.ok?'ok':'error');});
  var hash=new URLSearchParams(location.hash.slice(1));
  var tokens={access_token:hash.get('access_token'),refresh_token:hash.get('refresh_token')};
  if(hash.get('error_description'))say(hash.get('error_description'),'error');
  if(tokens.access_token&&/^(invite|recovery|signup|magiclink)$/.test(hash.get('type')||'')){history.replaceState(null,'',location.pathname);show('password');}
  forms.password.addEventListener('submit',async function(e){e.preventDefault();var b=e.submitter||forms.password.querySelector('button[type=submit]');
    var p1=document.getElementById('new-password').value,p2=document.getElementById('new-password-2').value;
    if(p1!==p2){say('Las contraseñas no coinciden.','error');return;}
    var r=await send('/auth/password',{access_token:tokens.access_token,refresh_token:tokens.refresh_token,password:p1},b);
    if(r.ok)location.replace('/');else say(r.data.error||'No se pudo guardar la contraseña.','error');});
})();
</script>
</body>
</html>`;
