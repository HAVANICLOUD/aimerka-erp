/* Public integration: CompetitionPricing.open({name, upc, onApply(price, reference)}).
 * Returns {close()}; closing/reopening aborts lookup and invalidates its callback.
 * No persistence: host may save reference as input.competitorReference.
 */
(function () {
  'use strict';
  let current = null;
  const text = (v, max = 200) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
  function node(tag, value, className) {
    const el = document.createElement(tag);
    if (value) el.textContent = value;
    if (className) el.className = className;
    return el;
  }
  function https(value) {
    try {
      if (typeof value !== 'string' || value.length > 2048 || /[\s\u0000-\u001f]/.test(value)) return null;
      const u = new URL(value);
      if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.') || u.hostname === 'localhost' || /\.(local|localhost)$/.test(u.hostname) || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':')) return null;
      if ([...u.searchParams.keys()].some(k => /^(api[_-]?key|token|access_token|authorization)$/i.test(k))) return null;
      return u.href;
    } catch { return null; }
  }
  function link(label, url) {
    const a = node('a', label); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.referrerPolicy = 'no-referrer'; return a;
  }
  const money = price => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(price) + ' MXN';
  const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  function validReference(r) {
    if (!r || typeof r.price !== 'number' || !Number.isFinite(r.price) || r.price <= 0 || r.price > 1e9 || r.currency !== 'MXN' || !https(r.url) || !text(r.store, 100) || !text(r.condition, 80)) return false;
    const latest = r.provenance === 'manual' ? localDate() : new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || r.date > latest) return false;
    const d = new Date(r.date + 'T12:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === r.date;
  }
  function open(options = {}) {
    if (current) current.close();
    const name = text(options.name, 160), upc = text(options.upc, 14), onApply = options.onApply;
    const previousFocus = document.activeElement;
    const dialog = node('dialog', '', 'competition-pricing');
    const header = node('div', '', 'competition-pricing-header');
    const title = node('h2', 'Analizar competencia'); title.id = 'competition-pricing-title';
    dialog.setAttribute('aria-labelledby', title.id);
    const closeButton = node('button', 'Cerrar'); closeButton.type = 'button'; header.append(title, closeButton);
    dialog.append(header, node('p', [name, upc].filter(Boolean).join(' · ')), node('p', 'Análisis guiado de referencias públicas. Revisa modelo, capacidad, condición, envío y precio total de contado; una coincidencia de búsqueda no confirma el UPC. No hay verificación por IA.'));
    const status = node('p', 'Conexión de búsqueda pendiente. Pulsa Buscar para consultar disponibilidad.', 'competition-pricing-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const lookup = node('button', 'Buscar precios públicos'); lookup.type = 'button';
    const results = node('div', '', 'competition-pricing-results');
    const setup = node('details', '', 'competition-pricing-setup');
    setup.append(node('summary', 'Cómo conectar la búsqueda más adelante'));
    const steps = node('ol');
    const signup = node('li', 'Crea tu cuenta en SerpApi cuando decidas conectar la búsqueda: '); signup.append(link('Registro oficial', 'https://serpapi.com/users/sign_up'));
    const apiKey = node('li', 'Inicia sesión y consulta tu clave en el panel oficial: '); apiKey.append(link('Clave de API', 'https://serpapi.com/manage-api-key'));
    steps.append(signup, apiKey, node('li', 'Con ayuda de la administración técnica de AIMERKA, registra la clave como secreto del servidor con el nombre SERPAPI_KEY; no la pegues en el chat, el navegador ni los datos del ERP.'), node('li', 'Después de configurar el secreto en el servidor, vuelve a este panel y pulsa Buscar precios públicos para probar la conexión. Revisa la fuente y confirma cada referencia antes de usarla.'));
    setup.append(steps, node('p', 'Hasta entonces puedes usar las búsquedas manuales de tiendas. Esta guía no crea una cuenta ni activa una contratación.'));
    const external = node('nav', '', 'competition-pricing-links'); external.setAttribute('aria-label', 'Buscar manualmente en tiendas');
    const query = encodeURIComponent([name, upc].filter(Boolean).join(' '));
    external.append(link('Amazon México', `https://www.amazon.com.mx/s?k=${query}`), link('Google Shopping', `https://www.google.com/search?tbm=shop&gl=mx&hl=es&q=${query}`), link('Walmart México', `https://www.walmart.com.mx/search?q=${query}`), link('Mercado Libre', `https://listado.mercadolibre.com.mx/${query}`));
    const form = node('form', '', 'competition-pricing-manual');
    form.append(node('h3', 'Capturar referencia manual'), node('p', 'Capturada manualmente; no verificada por IA. Ingresa el precio total de contado en MXN, sin mensualidades.'));
    function field(label, type, max) {
      const wrap = node('label', label), input = node('input'); input.type = type; input.required = true;
      if (max) input.maxLength = max;
      wrap.append(input); form.append(wrap); return input;
    }
    const store = field('Tienda', 'text', 100), url = field('Enlace HTTPS', 'url', 2048), price = field('Precio total de contado (MXN)', 'number'); price.min = '0.01'; price.max = '1000000000'; price.step = '0.01';
    const condition = field('Condición (nuevo, usado, reacondicionado…)', 'text', 80), date = field('Fecha en que viste el precio', 'date'); date.max = localDate(); date.value = localDate();
    const manualButton = node('button', 'Revisar referencia manual'); manualButton.type = 'submit'; form.append(manualButton);
    const selection = node('section', '', 'competition-pricing-selection'); selection.hidden = true; selection.setAttribute('aria-live', 'polite');
    const error = node('p', '', 'competition-pricing-error'); error.setAttribute('role', 'alert');
    dialog.append(status, lookup, setup, results, node('h3', 'Búsqueda manual en tiendas'), external, form, selection, error);
    let controller = null, generation = 0, selected = null, applying = false;
    const session = { close };
    function alive() { return current === session && dialog.isConnected; }
    function close() {
      generation++; controller?.abort(); selected = null;
      if (current === session) current = null;
      if (dialog.open) dialog.close();
      dialog.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
    }
    function select(reference) {
      if (!alive() || applying) return;
      if (!validReference(reference)) { error.textContent = 'Revisa tienda, enlace HTTPS, precio positivo MXN, condición y fecha válida hasta hoy.'; return; }
      error.textContent = '';
      selected = { title: text(reference.title), store: text(reference.store, 100), url: https(reference.url), price: reference.price, currency: 'MXN', condition: text(reference.condition, 80), date: reference.date, observedAt: reference.provenance === 'manual' ? reference.date : text(reference.observedAt, 40), kind: reference.provenance === 'manual' ? 'manual' : 'provider', provenance: reference.provenance === 'manual' ? 'manual' : 'serpapi', match: reference.provenance === 'manual' ? 'manual' : 'search', verified: false };
      selection.replaceChildren(node('h3', 'Confirmar referencia'), node('p', `${selected.store} · ${money(selected.price)} · ${selected.condition} · ${selected.date}`), link('Abrir fuente', selected.url), node('p', selected.provenance === 'manual' ? 'Capturada manualmente; no verificada por IA.' : 'Resultado de búsqueda; UPC y disponibilidad no verificados. La fecha indica la consulta, no una actualización de la tienda.'), node('p', 'Este precio se usará para comparar. Confirma que corresponde al mismo producto y variante.'));
      const apply = node('button', 'Usar precio para comparar'); apply.type = 'button';
      apply.disabled = typeof onApply !== 'function';
      apply.addEventListener('click', async () => {
        if (!alive() || applying || !validReference(selected) || typeof onApply !== 'function') return;
        applying = true; apply.disabled = true; lookup.disabled = true; manualButton.disabled = true;
        try { await onApply(selected.price, { ...selected }); if (alive()) close(); }
        catch { if (alive()) { error.textContent = 'No se pudo aplicar la referencia. Intenta de nuevo.'; applying = false; apply.disabled = false; lookup.disabled = false; manualButton.disabled = false; } }
      });
      selection.append(apply); selection.hidden = false;
    }
    form.addEventListener('submit', event => {
      event.preventDefault(); if (!form.reportValidity() || applying) return;
      select({ title: name, store: store.value, url: url.value.trim(), price: Number(price.value), currency: 'MXN', condition: condition.value, date: date.value, observedAt: '', provenance: 'manual' });
    });
    lookup.addEventListener('click', async () => {
      if (!alive() || applying || lookup.disabled) return;
      controller?.abort(); controller = new AbortController(); const ownGeneration = ++generation;
      const fresh = () => alive() && ownGeneration === generation;
      lookup.disabled = true; status.textContent = 'Buscando referencias públicas…'; results.replaceChildren();
      const timer = setTimeout(() => controller?.abort(), 12000);
      try {
        const response = await fetch('/api/competition', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, upc }), signal: controller.signal });
        const data = await response.json();
        if (!fresh()) return;
        if (!response.ok) { status.textContent = response.status === 429 ? 'Espera un momento antes de volver a buscar.' : 'No se pudo consultar la búsqueda. Puedes capturar una referencia manual.'; return; }
        if (data.providerUnavailable) { status.textContent = data.engine?.status === 'not_configured' ? 'Conexión de búsqueda pendiente' : 'La búsqueda no está disponible por ahora. Usa los enlaces o captura una referencia manual.'; return; }
        const rows = (Array.isArray(data.results) ? data.results : []).slice(0, 12).filter(validReference);
        status.textContent = rows.length ? `${rows.length} referencias de búsqueda${data.cached ? ' (consulta en caché, hasta 5 minutos)' : ''}. Revisa la fuente antes de comparar.` : 'Sin referencias de contado identificables como MXN. Prueba los enlaces o captura una referencia manual.';
        for (const r of rows) {
          const card = node('article', '', 'competition-pricing-card');
          card.append(node('h3', text(r.title)), node('p', `${text(r.store, 100)} · ${money(r.price)}`), node('p', `${text(r.condition, 80)} · Consulta: ${text(r.observedAt, 40)}`), link('Ver fuente', https(r.url)), node('p', 'Coincidencia de búsqueda; UPC no verificado.'));
          const use = node('button', 'Revisar este precio'); use.type = 'button'; use.addEventListener('click', () => select({ ...r, provenance: 'serpapi' })); card.append(use); results.append(card);
        }
      } catch { if (fresh()) status.textContent = 'La búsqueda se interrumpió. Puedes reintentar o capturar una referencia manual.'; }
      finally { clearTimeout(timer); if (fresh()) lookup.disabled = false; }
    });
    closeButton.addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => { if (current === session) close(); });
    current = session; document.body.append(dialog); dialog.showModal(); closeButton.focus();
    return session;
  }
  window.CompetitionPricing = Object.freeze({ open, close: () => current?.close() });
})();
