/* Commercial events workspace. Host owns routing, assets and state synchronization.
 * Campaign commands persist changes. No publish API.
 */
(function () {
  'use strict';
  const markets = ['Sears', 'Sanborns', 'Coppel', 'Mercado Libre', 'Liverpool', 'Tienda Nube', 'Elektra'];
  const presetFallback = ['Buen Fin', 'Hot Sale', 'Decembrino', 'Pre-navideño', 'Navidad', 'Día de la Madre', 'Día del Padre', 'Black Friday', 'Cyber Monday'];
  const presetNames = () => [...new Set((engine()?.eventTemplates?.length ? engine().eventTemplates.map(e => typeof e === 'string' ? e : e.name) : presetFallback).filter(Boolean))];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const engine = () => window.ERP?.engines?.commercialEvents;
  const allEvents = () => state.commercialEvents || [];
  let workspaceKind='campaign';
  const events = () => allEvents().filter(e => !e.deletedAt&&(e.kind||'campaign')===workspaceKind);
  const rotationFlag = sku => window.StockRotationUI?.flag?.(sku,workspaceKind==='liquidation'?'liquidation':'events')||'';
  function setWorkspace(kind){if(workspaceKind===kind)return;workspaceKind=kind;draft=null;savedJSON='';historyCampaign='';historyLot='';historyRun='';invalidate();}
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).reduce((o, p) => { o[p.type] = p.value; return o; }, {});
  function mexicoDate() { const p = today(); return `${p.year}-${p.month}-${p.day}`; }
  let month = mexicoDate().slice(0, 7), draft = null, savedJSON = '', preview = null, previewEvent = '', selected = new Set(), acknowledged = new Set(), page = 0, busy = false, error = '', notice = '', search = '', scope = 'all', revision = 0;
  let resultView = 'list', signalFilter = 'all', historyCampaign = '', historyLot = '', familyModalId = '', historyRun = '', historyGreen = false, historyPage = 0, pendingDelete = '', pendingRelease = null;
  const pageSize = 50;
  const selectableProducts = () => {
    const completed=draft?.id&&engine()?.commercialEventCompletedTargets?engine().commercialEventCompletedTargets(state,draft.id):new Set();
    return (state.products||[]).filter(p=>(workspaceKind!=='liquidation'||window.StockRotationUI?.report?.().some(r=>r.sku===p.sku&&r.level>0&&r.available>0))&&(window.ERP?.engines?.productLifecycle?.commerciallySelectable?.(p)??true)&&(!draft?.id||(draft.markets||[]).some(m=>!completed.has(JSON.stringify([p.sku,m])))));
  };
  const key = row => JSON.stringify([row.sku, row.market]);
  const color = row => { const v = String(typeof row.traffic === 'object' ? row.traffic?.color || row.traffic?.level || row.traffic?.status : row.traffic).toLowerCase(); return ['green', 'verde'].includes(v) ? 'green' : ['amber', 'yellow', 'amarillo'].includes(v) ? 'amber' : 'red'; };
  const eligible = row => row.valid === true;
  const status = (event, date = mexicoDate()) => !event.startDate || !event.endDate ? 'Sin fechas' : event.endDate < date ? 'Finalizada' : event.startDate > date ? 'Próxima' : 'En curso';
  const defaultTransferCommission = .0007; // Confirmed 0.07% of the collected amount; still editable per campaign.
  const canonical = event => JSON.stringify({ id: event.id || undefined,kind:event.kind||'campaign',isParent:!!event.isParent,parentId:event.parentId||undefined,parentName:event.parentName||'', name: event.name || '', startDate: event.startDate || '', endDate: event.endDate || '', markets: event.markets || [], selection: { categoryIds:event.selection?.categoryIds||[],rotationLevels:event.selection?.rotationLevels||[], brands: event.selection?.brands || [], departments: event.selection?.departments || [], skus: event.selection?.skus || [], warehouseId: event.selection?.warehouseId || '', onlyPublished: !!event.selection?.onlyPublished,onlyAvailable:!!event.selection?.onlyAvailable }, rules: { mode: event.rules?.mode || 'margin', margin: event.rules?.margin ?? .1, discount: event.rules?.discount ?? .1, retentionTreatment: event.rules?.retentionTreatment || 'pass_through', t1CommissionMode: event.rules?.t1CommissionMode || 'configured', mlType: event.rules?.mlType || 'CLASICA', msi: event.rules?.msi || 'Sin MSI', transfer:{enabled:event.rules?.transfer?.enabled??false,discount:event.rules?.transfer?.discount??.1,commissionRate:event.rules?.transfer?.commissionRate??defaultTransferCommission}, marketReferences: event.rules?.marketReferences || [] } });
  function blank() { return JSON.parse(canonical({ kind:workspaceKind,markets: [...markets],selection:workspaceKind==='liquidation'?{rotationLevels:[1,2,3,4,5,6],onlyAvailable:true}:{} })); }
  function invalidate() { revision++; preview = null; previewEvent = ''; selected.clear(); acknowledged.clear(); page = 0; error = ''; notice = ''; document.querySelector?.('.commercial-events .ce-preview')?.remove(); const badge = document.querySelector?.('.ce-editor>header .ce-pill'); if (badge) badge.textContent = dirty() ? 'Cambios sin guardar' : 'Campaña guardada'; }
  function open(id,parentId) {
    if (busy) return;
    const event = events().find(e => e.id === id);
    draft = event ? JSON.parse(canonical(event)) : blank(); savedJSON = event ? canonical(event) : '';
    if(!event&&parentId)draft.parentId=parentId;
    scope = draft.selection.skus.length ? 'selected' : 'all'; search = ''; invalidate(); redraw();
    const editor = document.getElementById('commercial-events-form');
    editor?.scrollIntoView?.({block:'start',behavior:'instant'});
    editor?.querySelector?.('[data-ce-field="name"]')?.focus?.({preventScroll:true});
  }
  function dirty() { return !!draft && canonical(draft) !== savedJSON; }
  function redraw() {
    const details = Array.from(document.querySelectorAll?.('.commercial-events .ce-choices') || []), opened = details.map(d => d.open);
    const list = document.querySelector?.('.commercial-events .ce-product-results'), scrollTop = list?.scrollTop || 0;
    if (typeof render === 'function') render();
    Array.from(document.querySelectorAll?.('.commercial-events .ce-choices') || []).forEach((d, i) => { d.open = !!opened[i]; });
    const next = document.querySelector?.('.commercial-events .ce-product-results'); if (next) next.scrollTop = scrollTop;
  }
  function edit(path, value) {
    if (!draft || busy) return;
    const parts = path.split('.'); let obj = draft;
    for (const p of parts.slice(0, -1)) obj = obj[p];
    obj[parts.at(-1)] = value; invalidate();
  }
  const button = (action, label, extra = '') => `<button type="button" class="ce-button ${['new', 'apply'].includes(action) ? 'ce-primary' : ''}" data-ce-action="${action}" ${busy ? 'disabled' : ''} ${extra.replace(/class="[^"]*"/g, '')}>${glyph(actionIcon(action))}${label}</button>`;
  // Local icons keep semantics stable even when the host icon vocabulary changes.
  const iconPaths = {
    trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7', download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5', history:'M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2', plus: 'M12 5v14M5 12h14', check: 'm5 12 4 4L19 6', close: 'm6 6 12 12M6 18 18 6',
    left: 'm15 5-7 7 7 7', right: 'm9 5 7 7-7 7', down: 'm6 9 6 6 6-6',
    calendar: 'M4 5h16v16H4zM8 3v4M16 3v4M4 10h16', box: 'm12 3 9 5v9l-9 5-9-5V8l9-5zm0 9v10M3 8l9 4 9-4',
    store: 'M4 10v11h16V10M3 10l2-7h14l2 7M8 21v-7h8v7', calculator: 'M5 3h14v18H5zM8 7h8M8 12h2m4 0h2M8 16h2m4 0h2',
    search: 'M20 20l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0', save: 'M4 3h13l4 4v14H3V3h1zm3 0v6h10V3M7 21v-8h10v8',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1', cards: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    matrix: 'M3 3h18v18H3zM3 9h18M9 3v18M15 3v18M3 15h18',
    shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3zm-4 9 3 3 5-6', percent: 'M5 19 19 5M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0M20 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0', card: 'M3 5h18v14H3zM3 10h18M7 15h4',
    tag: 'm3 3 9 0 9 9-9 9-9-9V3zm4 4h1', barcode: 'M3 4v16M7 4v16M10 4v16M14 4v16M18 4v16M21 4v16',
    bank: 'm3 9 9-6 9 6H3zm2 3v6m7-6v6m7-6v6M3 21h18',
    stock: 'M3 7h18v14H3zM7 3h10v4M8 13l3 3 5-6'
  };
  const glyph = name => `<svg class="ce-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${iconPaths[name] || iconPaths.check}"/></svg>`;
  function trafficLight(active = 'all') {
    return `<svg class="ce-icon ce-traffic-light" viewBox="0 0 24 32" aria-hidden="true" focusable="false"><rect x="5" y="1" width="14" height="30" rx="5" fill="#263b43"/>${[['red', '#ef6b68'], ['amber', '#f5c452'], ['green', '#62cf94']].map(([name, fill], index) => `<circle cx="12" cy="${8 + index * 8}" r="3" fill="${fill}" opacity="${active === 'all' || active === name ? 1 : .18}"/>`).join('')}</svg>`;
  }
  const selectIcon = path => ({ 'rules.mode': 'calculator', 'rules.retentionTreatment': 'shield', 'rules.t1CommissionMode': 'percent', 'rules.mlType': 'store', 'rules.msi': 'card', 'rules.transfer.discount':'percent', 'selection.warehouseId': 'box', 'selection.brands': 'tag', 'selection.departments': 'box' }[path] || (path.endsWith('.market') ? 'store' : 'list'));
  const actionIcon = action => ({ 'release-price':'trash','confirm-release-price':'trash','cancel-release-price':'close',delete:'trash', 'confirm-delete':'trash',restore:'history','cancel-delete':'close','family-edit':'calculator','family-new-lot':'plus','family-history':'history','family-close':'close','history-campaign':'search','history-run':'search','export-run':'download','export-campaign':'download','history-prev':'left','history-next':'right', new: 'plus', apply: 'save', save: 'save', 'prev-month': 'left', 'next-month': 'right', today: 'calendar', 'prev-page': 'left', 'next-page': 'right', greens: 'check', none: 'close', 'add-reference': 'plus', 'remove-reference': 'close', 'lookup-reference': 'search', 'transfer-toggle':'bank', view: 'list', filter: 'signal' }[action] || 'check');
  function productImage(product) {
    if(window.ProductMedia)return window.ProductMedia.html(product,{className:'ce-product-image'});
    // Gallery primary takes priority; each fallback passes the same URL checks.
    const gallery = Array.isArray(product?.images) ? product.images : [];
    const candidates = [gallery.find(image => image.primary === true)?.url, product?.imageUrl, ...gallery.map(image => image.url)];
    const src = candidates.map(value => String(value || '')).find(value => !/[\\\s\u0000-\u001f\u007f]/.test(value) && (/^https:\/\/[^/?#]+(?:[/?#]|$)/i.test(value) || /^\/(?!\/)/.test(value))) || '';
    const safe = !!src;
    return `<span class="ce-product-image">${glyph('box')}${safe ? `<img src="${escape(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-ce-image>` : ''}</span>`;
  }
  const logo = market => window.MarketUI?.logo?.(market) || glyph('store');
  const amount = cents => Number.isFinite(cents) ? (typeof money === 'function' ? money(cents) : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(cents / 100)) : '—';
  function input(label, path, value, type = 'text', attrs = '') { return `<label class="ce-field">${escape(label)}<input data-ce-field="${path}" type="${type}" value="${escape(value)}" ${attrs}></label>`; }
  function select(label, path, value, options) { return `<label class="ce-field">${escape(label)}<span class="ce-select-wrap"><span class="ce-select-leading">${glyph(selectIcon(path))}</span><span class="ce-select-chevron">${glyph('down')}</span><select data-ce-field="${path}">${options.map(([v, text]) => `<option value="${escape(v)}" ${String(v) === String(value) ? 'selected' : ''}>${escape(text)}</option>`).join('')}</select></span></label>`; }
  function calendar() {
    const [year, m] = month.split('-').map(Number), first = new Date(Date.UTC(year, m - 1, 1)), offset = (first.getUTCDay() + 6) % 7, count = new Date(Date.UTC(year, m, 0)).getUTCDate();
    const title = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first), now = mexicoDate();
    return `<section class="ce-panel ce-calendar" aria-label="Calendario de campañas"><header><div><span class="ce-eyebrow">PLANEACIÓN COMERCIAL</span><h2>${escape(title)}</h2></div><div class="ce-toolbar">${button('prev-month', '‹', 'aria-label="Mes anterior"')}${button('today', 'Hoy')}${button('next-month', '›', 'aria-label="Mes siguiente"')}</div></header><div class="ce-calendar-scroll"><div class="ce-week">${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => `<span>${d}</span>`).join('')}</div><div class="ce-days">${Array.from({ length: offset }, () => '<div class="ce-day ce-outside" aria-hidden="true"></div>').join('')}${Array.from({ length: count }, (_, i) => {
      const date = `${month}-${String(i + 1).padStart(2, '0')}`, matches = events().filter(e=>!e.parentId).filter(e => e.startDate && e.endDate && e.startDate <= date && e.endDate >= date);
      return `<div class="ce-day ${date === now ? 'ce-today' : ''}"><time datetime="${date}" ${date === now ? 'aria-current="date"' : ''}>${i + 1}</time>${matches.map(e => `<button type="button" class="ce-calendar-event" data-ce-edit="${escape(e.id)}" title="${escape(`${e.name} · ${status(e)}`)}">${glyph('calendar')}${escape(e.name)}</button>`).join('')}</div>`;
    }).join('')}</div></div><footer>Las fechas las define tu equipo. Los nombres sugeridos no asignan fechas oficiales.<br>Guarda los precios para aplicarlos internamente. Al terminar el día de cierre en Ciudad de México se restauran los precios anteriores; el envío a tiendas requiere integración.</footer></section>`;
  }
  function choices(label, field, values, chosen) {
    return `<details class="ce-choices"><summary><span class="ce-choice-leading">${glyph(selectIcon(field))}</span>${glyph('down')}${escape(label)} <span>${chosen.length ? `${chosen.length} seleccionados` : 'Todos'}</span></summary><div>${values.length ? values.map(v => `<label class="ce-check"><input type="checkbox" data-ce-array="${field}" value="${escape(v)}" ${chosen.includes(v) ? 'checked' : ''}>${escape(v)}</label>`).join('') : '<p>Sin opciones en el inventario.</p>'}</div></details>`;
  }
  function productList() {
    const query = search.toLocaleLowerCase('es-MX'), scoped=engine()?.commercialEventProducts?.(state,draft.selection,{ignoreSkus:true}), allowed=scoped?new Set(scoped.map(p=>p.sku)):null, products = selectableProducts().filter(p=>(!allowed||allowed.has(p.sku))).filter(p => [p.sku, p.upc, p.name, p.brand].some(v => String(v || '').toLocaleLowerCase('es-MX').includes(query)));
    return `<div class="ce-product-results">${products.map(p => {
      return `<label class="ce-product"><input type="checkbox" data-ce-array="selection.skus" value="${escape(p.sku)}" ${draft.selection.skus.includes(p.sku) ? 'checked' : ''}>${productImage(p)}<span><strong>${escape(p.name)}</strong><small>SKU ${escape(p.sku)} · UPC ${escape(p.upc || 'pendiente')}</small></span></label>`;
    }).join('') || '<p>Sin coincidencias.</p>'}</div><small>${products.length} coincidencias · todos los resultados disponibles. ${draft.selection.skus.length} productos seleccionados; se conservan al buscar.</small>`;
  }
  function references() {
    return `<div class="ce-reference-note">${glyph('search')} Referencias capturadas manualmente. El proveedor de búsqueda externa no está configurado para consultas masivas. El cálculo no certifica el precio más barato del mercado.</div>${draft.rules.marketReferences.map((r, i) => `<div class="ce-reference" data-ce-reference="${i}">${input('SKU', `ref.${i}.sku`, r.sku, 'text', 'required')}${select('Marketplace', `ref.${i}.market`, r.market, markets.map(m => [m, m]))}${input('Precio de contado MXN', `ref.${i}.price`, r.price, 'number', 'required min="0.01" step="0.01"')}${input('Tienda', `ref.${i}.store`, r.store, 'text', 'required')}${input('URL de referencia', `ref.${i}.url`, r.url, 'url', 'required')}${button('remove-reference', 'Quitar', `data-ce-index="${i}"`)}${window.CompetitionPricing?.open ? button('lookup-reference', 'Buscar / revisar referencia', `data-ce-index="${i}"`) : ''}</div>`).join('')}${button('add-reference', '+ Agregar referencia manual')}`;
  }
  function transferControls(r){
    const t=r.transfer,hasNube=draft.markets.includes('Tienda Nube');
    return `<section class="ce-transfer-strategy"><div class="ce-transfer-heading">${logo('Tienda Nube')}<div><strong>Pago por transferencia electrónica</strong><small>Un escenario adicional, separado del pago normal y sus MSI.</small></div></div>${button('transfer-toggle',t.enabled?'Descuento por transferencia activado':'Activar descuento adicional por transferencia',`aria-pressed="${t.enabled}" ${!hasNube&&!t.enabled?'disabled':''}`)}${!hasNube?'<p class="ce-help">Selecciona Tienda Nube para analizar esta modalidad.</p>':''}${t.enabled?`<div class="ce-fields">${select('Descuento adicional por transferencia (%)','rules.transfer.discount',String(Math.round(t.discount*100)),Array.from({length:50},(_,i)=>[String(i+1),String(i+1)+'%']))}${input('Comisión por transferencia (%)','rules.transfer.commissionRate',t.commissionRate===null?'':+(t.commissionRate*100).toFixed(6),'number','required min="0" max="99.99" step="0.01"')}</div><p class="ce-help">Se aplica sobre el precio de campaña. Sin MSI y sin retenciones. Captura la comisión como porcentaje: 0.07 significa 0.07%; 7 significa 7%. La caja descuenta únicamente esta comisión, el costo del producto y el envío. El margen mínimo también se revisa para transferencia.</p>`:''}</section>`;
  }
  function form() {
    if (!draft) return `<section class="ce-panel ce-empty">${glyph('calendar')}<h2>${workspaceKind==='liquidation'?'Prepara tu plan de liquidación':'Prepara tu próxima campaña'}</h2><p>Define fechas, productos y marketplaces; revisa los precios antes de guardarlos.</p>${button('new', workspaceKind==='liquidation'?'Crear plan de liquidación':'Crear campaña', 'class="ce-primary"')}</section>`;
    const s = draft.selection, r = draft.rules, products = selectableProducts(), brands = [...new Set([...products.map(p => p.brand).filter(Boolean),...s.brands])].sort(), departments = [...new Set([...products.map(p => p.department).filter(Boolean),...s.departments])].sort();
    const warehouses = window.ERP?.engines?.warehouses?.warehouses?.(state) || (state.warehouses?.length ? state.warehouses : [{ id: 'principal', name: 'Almacén principal' }]);
    const warehouseOptions = warehouses.map(w => typeof w === 'string' ? [w, w] : [w.id, w.name || w.label || w.id]);
    if (s.warehouseId && !warehouseOptions.some(([id]) => id === s.warehouseId)) warehouseOptions.push([s.warehouseId, s.warehouseId]);
    const msi = [...new Set(['Sin MSI', ...(state.config?.elektraMsi || []).map(v => v.label), r.msi])];
    return `<form id="commercial-events-form" class="ce-editor"><header><div><span class="ce-eyebrow">${workspaceKind==='liquidation'?(draft.id?'EDITAR PLAN':'NUEVO PLAN DE LIQUIDACIÓN'):(draft.id ? 'EDITAR CAMPAÑA' : 'NUEVA CAMPAÑA')}</span><h2>${escape(draft.name || 'Diseña tu evento comercial')}</h2></div><span class="ce-pill">${dirty() ? 'Cambios sin guardar' : 'Campaña guardada'}</span></header><fieldset ${busy ? 'disabled' : ''}><legend>${glyph('calendar')} Identidad y calendario</legend><div class="ce-presets" aria-label="Nombres sugeridos">${presetNames().map(name => `<button type="button" data-ce-preset="${escape(name)}">${glyph('calendar')}${escape(name)}</button>`).join('')}</div><p class="ce-help">Elige un nombre sugerido o escribe el tuyo. Captura tus fechas; no se asignan automáticamente.</p><div class="ce-fields">${input(draft.isParent?'Nombre de la campaña principal':workspaceKind==='liquidation'?'Nombre del plan de liquidación':'Nombre del lote de campaña', 'name', draft.name, 'text', 'required maxlength="160"')}${draft.isParent?'<div class="ce-parent-label">Campaña principal · acumula todos sus lotes</div>':select('Campaña principal', 'parentId',draft.parentId||'',[['','Sin campaña principal'],...events().filter(e=>e.isParent&&e.id!==draft.id).map(e=>[e.id,e.name])])+input('Crear campaña principal · nombre opcional','parentName',draft.parentName||'','text','maxlength="160" placeholder="Ej. Buen Fin 2026"')}${input('Fecha de inicio', 'startDate', draft.startDate, 'date', 'required')}${input('Fecha de cierre', 'endDate', draft.endDate, 'date', `required ${draft.startDate ? `min="${escape(draft.startDate)}"` : ''}`)}</div></fieldset><fieldset ${busy ? 'disabled' : ''}><legend>${glyph('box')} Productos y alcance</legend><div class="ce-fields">${choices('Marcas', 'selection.brands', brands, s.brands)}<details><summary>Filtro anterior por departamento${s.departments?.length?' · activo':''}</summary>${choices('Departamentos', 'selection.departments', departments, s.departments)}<small>Se conserva para campañas previas. Seleccionar una categoría nueva lo sustituye.</small></details>${select('Almacén para disponibilidad', 'selection.warehouseId', s.warehouseId, [['', 'Todos los almacenes'], ...warehouseOptions])}</div><div class="ce-toolbar"><label class="ce-check"><input type="radio" name="ce-scope" data-ce-scope="all" ${scope === 'all' ? 'checked' : ''}>Todo el inventario filtrado</label><label class="ce-check"><input type="radio" name="ce-scope" data-ce-scope="selected" ${scope === 'selected' ? 'checked' : ''}>Productos seleccionados</label><label class="ce-check"><input type="checkbox" data-ce-field="selection.onlyPublished" ${s.onlyPublished ? 'checked' : ''}>Solo publicados</label></div>${window.ProductTaxonomyUI?.filters('events',s.categoryIds?.[0]||'')||''}<p class="ce-help">La categoría incluye todas sus subcategorías. Una selección nueva sustituye el filtro anterior de departamento.</p><p class="ce-help">Marca, categoría y publicación delimitan el alcance. Solo publicados excluye pausados y pendientes de aprobación.</p><label class="ce-check"><input type="checkbox" data-ce-field="selection.onlyAvailable" ${s.onlyAvailable?'checked':''}>Solo inventario con stock disponible</label><p class="ce-help">Desactivado: incluye también productos nuevos y con cero piezas, aunque tengas un almacén seleccionado. Activado: exige unidades disponibles en el almacén elegido o, si eliges todos, en el inventario general.</p><p class="ce-help">Al cierre se restauran los precios internos anteriores. La fecha final incluye todo ese día, en Ciudad de México.</p>${scope === 'selected' ? `<label class="ce-field">Buscar productos por nombre, SKU o UPC<input data-ce-search value="${escape(search)}" type="search" placeholder="Buscar en inventario…"></label><div id="ce-products">${productList()}</div>` : ''}</fieldset><fieldset ${busy ? 'disabled' : ''}><legend>${glyph('store')} Marketplaces de la campaña</legend><div class="ce-markets">${markets.map(m => `<label class="ce-market ${draft.markets.includes(m) ? 'is-selected' : ''}"><input type="checkbox" data-ce-array="markets" value="${escape(m)}" ${draft.markets.includes(m) ? 'checked' : ''}>${logo(m)}<span>${escape(m)}</span></label>`).join('')}</div></fieldset><fieldset ${busy ? 'disabled' : ''}><legend>${glyph('calculator')} Estrategia de precios</legend><div class="ce-fields">${select('Método de cálculo', 'rules.mode', r.mode, [['margin', 'Margen objetivo'], ['discount', 'Descuento de campaña'], ['competitive', 'Comparar con referencias manuales']])}${input(r.mode === 'margin' ? 'Margen objetivo (%)' : 'Margen mínimo (%)', 'rules.margin', +(r.margin * 100).toFixed(6), 'number', 'required min="0" max="99.99" step="0.01"')}${r.mode === 'discount' ? input('Descuento (%)', 'rules.discount', +(r.discount * 100).toFixed(6), 'number', 'required min="0" max="99.99" step="0.01"') : ''}${select('Retenciones', 'rules.retentionTreatment', r.retentionTreatment, [['pass_through', 'Trasladar al precio'], ['no_pass_through', 'No trasladar al precio']])}<div class="ce-field"><span>${glyph('percent')} Comisión Sears / Sanborns</span><strong>${Math.round((state.config?.commissions?.['T1 Comercios']?.[0]?.rate??.14)*10000)/100}% · tarifa vigente</strong><small>Los pagos históricos conservan su comisión real.</small></div>${select('Publicación Mercado Libre', 'rules.mlType', r.mlType, [['CLASICA', 'Clásica'], ['PREMIUM', 'Premium']])}${select('Meses sin intereses · Elektra', 'rules.msi', r.msi, msi.map(v => [v, v]))}</div>${transferControls(r)}${r.mode === 'competitive' ? references() : '<p class="ce-help">El motor recomienda precios según costos, comisiones y reglas del canal. La recomendación no implica una búsqueda externa de competidores.</p>'}</fieldset><div class="ce-form-actions">${button('save', 'Guardar campaña')}<button type="submit" class="ce-button ce-primary" ${busy ? 'disabled' : ''}>${glyph('calculator')} ${busy ? 'Procesando…' : 'Calcular precios de campaña'}</button></div></form>`;
  }
  function groupedResults() {
    const groups = new Map();
    (preview?.rows || []).forEach((row, index) => {
      if (signalFilter !== 'all' && color(row) !== signalFilter) return;
      if (!groups.has(row.sku)) groups.set(row.sku, { sku: row.sku, entries: [] });
      groups.get(row.sku).entries.push({ row, index });
    });
    return [...groups.values()];
  }
  const hue = sku => Array.from(String(sku)).reduce((hash, c) => (hash * 31 + c.charCodeAt(0)) >>> 0, 0) % 5;
  function productHeader(group) {
    const p = (state.products || []).find(p => p.sku === group.sku);
    const physical = Number.isFinite(p?.good) ? p.good : null;
    const available = p && window.ERP?.engines?.inventory?.available ? window.ERP.engines.inventory.available(p) : physical !== null ? (!(window.ERP?.engines?.productLifecycle?.commerciallySelectable?.(p) ?? (p.status !== 'INACTIVO' && !p.lifecycle?.hidden && !p.lifecycle?.discontinued)) ? 0 : Math.max(0, physical - Number(p.reserved || 0) - Number(p.safety || 0))) : null;
    // Inventory stores the exact average in MXN and the registered cost in cents.
    const averageMxn = p?.averageCostMxn ?? (Number.isFinite(p?.costCents) ? p.costCents / 100 : null);
    const pending = p?.costStatus === 'Por confirmar';
    const average = pending ? 'Por confirmar' : amount(Number.isFinite(averageMxn) ? Math.round(averageMxn * 100) : null);
    const generalPrice = amount(p?.priceCents);
    return `<header class="ce-product-header">${productImage(p)}<div><h3>${escape(p?.name || group.sku)}</h3><div class="ce-product-meta">${rotationFlag(group.sku)}<span>${glyph('tag')}SKU ${escape(group.sku)}</span><span>${glyph('barcode')}UPC ${escape(p?.upc || '—')}</span><span>${glyph('box')}Físico vendible: ${physical ?? '—'}</span><span>${glyph('stock')}Disponible: ${Number.isFinite(available) ? available : '—'}</span><span class="ce-product-cost${pending ? ' ce-cost-pending' : ''}">${glyph('calculator')}Costo promedio: <strong>${average}</strong></span><span class="ce-product-cost" title="Precio general registrado en la ficha del producto">${glyph('tag')}Precio general: <strong>${generalPrice}</strong></span></div></div></header>`;
  }
  function rowSelection(r, index) {
    const k = key(r);
    return `<div class="ce-row-selection"><input type="checkbox" data-ce-row="${index}" aria-label="Seleccionar ${escape(r.sku)} en ${escape(r.market)}" ${selected.has(k) ? 'checked' : ''} ${!eligible(r) || busy ? 'disabled' : ''}>${color(r) === 'red' && eligible(r) ? `<label class="ce-risk"><input type="checkbox" data-ce-ack="${index}" ${acknowledged.has(k) ? 'checked' : ''} ${busy ? 'disabled' : ''}>Acepto el riesgo de ${escape(r.sku)} en ${escape(r.market)}</label>` : ''}</div>`;
  }
  function evaluation(r) {
    const c = color(r);
    const reason = String(r.reason || r.traffic?.reason || '');
    const warnings = [...new Set(r.warnings || [])].filter(warning => warning && !reason.includes(String(warning)));
    return `<span class="ce-pill ce-${c}">${trafficLight(c)}${!eligible(r) ? 'No calculable' : c === 'green' ? 'Verde' : c === 'amber' ? 'Amarillo · revisar' : 'Rojo · riesgo'}</span><details class="ce-evaluation-detail" ${c==='red'?'open':''}><summary>Ver evaluación</summary><p class="ce-evaluation-reason">${escape([reason, ...warnings].filter(Boolean).join(' · '))}</p></details>`;
  }
  const prices = r => economics(r);
  function channelCard({ row: r, index }) {
    return `<section class="ce-channel-card"><h4 class="ce-market-inline">${logo(r.market)}${escape(r.market)}</h4>${rowSelection(r, index)}${prices(r)}${evaluation(r)}</section>`;
  }
  function productResult(group) {
    const entries = group.entries;
    let content;
    if (resultView === 'list') content = `<div class="ce-channel-list">${entries.map(({row:r,index})=>`<section class="ce-list-row"><header class="ce-list-channel-heading"><h4 class="ce-market-inline">${logo(r.market)}${escape(r.market)}</h4>${rowSelection(r,index)}<div class="ce-list-evaluation">${evaluation(r)}</div></header>${prices(r)}</section>`).join('')}</div>`;
    else if (resultView === 'matrix') content = `<div class="ce-table-scroll" tabindex="0" role="region" aria-label="Comparación horizontal por marketplace"><table class="ce-matrix" style="--ce-market-count:${entries.length}"><caption class="ce-sr-only">Comparación de canales de ${escape(group.sku)}</caption><thead><tr>${entries.map(({ row: r }) => `<th scope="col"><span class="ce-market-inline">${logo(r.market)}${escape(r.market)}</span></th>`).join('')}</tr></thead><tbody><tr>${entries.map(({ row: r, index }) => `<td>${rowSelection(r, index)}${prices(r)}${evaluation(r)}</td>`).join('')}</tr></tbody></table></div>`;
    else content = `<div class="ce-channel-grid">${entries.map(channelCard).join('')}</div>`;
    return `<article class="ce-product-group ce-hue-${hue(group.sku)}" data-ce-product="${escape(group.sku)}">${productHeader(group)}${content}</article>`;
  }
  function previewHTML() {
    if (!preview) return '';
    const rows = preview.rows || [], counts = { green: 0, amber: 0, red: 0 }; rows.forEach(r => counts[color(r)]++);
    const groups = groupedResults(), pages = Math.max(1, Math.ceil(groups.length / pageSize)); page = Math.min(page, pages - 1);
    const filterButton = (value, label) => `<button type="button" class="ce-button ${value === 'all' ? '' : `ce-${value}`}" data-ce-action="filter" data-ce-filter="${value}" aria-pressed="${signalFilter === value}" ${busy ? 'disabled' : ''}>${trafficLight(value)}${label}</button>`;
    return `<section class="ce-panel ce-preview"><header><div><span class="ce-eyebrow">REVISIÓN ANTES DE GUARDAR</span><h2>Precios de campaña · pendientes</h2><p>${preview.summary?.alreadySaved||0} precios ya guardados se excluyen de este cálculo.</p><p>${rows.length} combinaciones de producto y canal · ${selected.size} seleccionadas</p></div><div class="ce-counts" role="group" aria-label="Filtrar por señal">${filterButton('all', `${rows.length} todos`)}${filterButton('green', `${counts.green} verdes`)}${filterButton('amber', `${counts.amber} amarillos`)}${filterButton('red', `${counts.red} rojos`)}</div></header><p class="ce-help">Verde: selección inicial. Amarillo: selección manual. Rojo: requiere aceptación explícita de riesgo. Los resultados inválidos no se pueden guardar. Con transferencia activa, la señal del canal también revisa esa modalidad; su resultado se muestra por separado.</p><div class="ce-toolbar"><div class="ce-selection-actions" role="group" aria-label="Selección de precios">${button('greens', 'Seleccionar verdes')}${button('none', 'Ninguno')}</div><div role="group" aria-label="Vista de resultados">${[['list', 'Lista'], ['cards', 'Tarjetas'], ['matrix', 'Matriz']].map(([view, label]) => `<button type="button" class="ce-button" data-ce-action="view" data-ce-view="${view}" aria-pressed="${resultView === view}" ${busy ? 'disabled' : ''}>${glyph(view)}${label}</button>`).join('')}</div></div><div class="ce-results ce-view-${resultView}">${groups.slice(page * pageSize, (page + 1) * pageSize).map(productResult).join('') || '<p class="ce-no-results">No hay resultados para este alcance o señal. Revisa los filtros y las referencias.</p>'}</div><div class="ce-preview-footer"><div class="ce-toolbar">${button('prev-page', 'Anterior', page === 0 ? 'disabled' : '')}<span>Página ${page + 1} de ${pages} · ${pageSize} productos por página · ${groups.length} productos en este filtro</span>${button('next-page', 'Siguiente', page + 1 >= pages ? 'disabled' : '')}</div>${button('apply', 'Guardar precios seleccionados', `${!selected.size || !currentPreview() ? 'disabled' : ''}`)}</div><p class="ce-help">La selección es global y se conserva entre filtros, vistas y páginas. Se guardan precios virtuales y una cola pendiente de envío. Esta acción no publica ni activa la campaña en las tiendas.</p></section>`;
  }
  function economics(row) {
    const r=row.result||{},d=r.discount;
    if(!d)return '<div class="ce-no-price">Sin precio calculable. Revisa la evaluación del canal.</div>';
    const mxn=value=>Number.isFinite(value)?amount(Math.round(value*100)):'—';
    const pct=value=>Number.isFinite(value)?`${(value*100).toFixed(2)}%`:'—';
    const isNube=row.market==='Tienda Nube';
    return `<div class="ce-payment-options"><section class="ce-gateway-result"><header>${glyph('card')}<strong>${isNube?'Pago por pasarelas / MSI':'Pago del marketplace'}</strong></header><div class="ce-channel-prices"><span>Regular <strong>${eligible(row)?amount(row.regularCents):'—'}</strong></span><span>Campaña <strong>${eligible(row)?amount(row.discountCents):'—'}</strong></span></div><dl class="ce-economics"><div><dt>Comisión ${isNube?'pasarela / MSI':'del market'} (${pct(r.commissionRate)})</dt><dd>${mxn(d.commission)}</dd></div><div><dt>Depósito neto</dt><dd>${mxn(d.marketplacePayout??d.netPayout)}</dd></div><div><dt>Costo + envío</dt><dd>${mxn((r.cost??d.cost)+(r.shipping??d.shipping))}</dd></div><div class="ce-gateway-cash"><dt>Disponible de caja</dt><dd>${mxn(d.cashProfit??d.profit)}</dd></div><div><dt>Margen / objetivo</dt><dd>${pct(row.actualMargin??d.objectiveMargin)} / ${pct(row.targetMargin??draft.rules.margin)}</dd></div></dl><details class="ce-payment-detail"><summary>Ver desglose</summary><dl class="ce-economics"><div><dt>Utilidad comercial</dt><dd>${mxn(d.commercialProfit)}</dd></div><div><dt>Retenciones</dt><dd>${mxn(d.withholdingTotal)}</dd></div>${r.msiRate>0?`<div><dt>MSI incluidos (${pct(r.msiRate)})</dt><dd>${mxn(d.financing)}</dd></div>`:''}</dl>${isNube?'<p>Comisión promedio configurada para pasarelas y MSI, según la lógica vigente de Tienda Nube.</p>':''}</details></section>${transferEconomics(row,mxn,pct)}</div>`;
  }
  function transferEconomics(row,mxn,pct){
    const t=row.campaignTransfer||row.result?.campaignTransfer;if(!t)return '';
    const tone=t.traffic.color==='yellow'?'amber':t.traffic.color;
    return `<section class="ce-transfer-result ce-transfer-${tone}"><header>${glyph('bank')}<strong>Pago por transferencia</strong><span class="ce-pill ce-${tone}">${t.traffic.color==='green'?'Cumple margen':t.traffic.color==='yellow'?'Revisar margen':'Sin caja positiva'}</span></header><div class="ce-transfer-price"><small>Precio final · ${pct(t.additionalDiscount)} adicional</small><strong>${mxn(t.price)}</strong></div><dl class="ce-economics"><div><dt>Comisión (${pct(t.commissionRate)})</dt><dd>${mxn(t.commission)}</dd></div><div><dt>Depósito neto</dt><dd>${mxn(t.marketplacePayout)}</dd></div><div><dt>Costo + envío</dt><dd>${mxn(t.cost+t.shipping)}</dd></div><div class="ce-transfer-cash"><dt>Disponible de caja</dt><dd>${mxn(t.cashProfit)}</dd></div><div><dt>Margen / mínimo</dt><dd>${pct(t.margin)} / ${pct(t.targetMargin)}</dd></div><div><dt>Descuento total vs. regular</dt><dd>${pct(t.totalDiscountRate)}</dd></div></dl><p>Sin MSI · Retenciones $0.00. ${escape(t.traffic.reason)}</p></section>`;
  }
  const percent = value => Number.isFinite(value) ? `${+(value*100).toFixed(2)}%` : '—';
  const dateLabel = value => {const date=new Date(value);return Number.isNaN(+date)?value||'Sin fecha':new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);};
  function runScope(run){
    const s=run.event?.selection||{},r=run.event?.rules||{};
    const brands=s.brands?.length?s.brands:[...new Set((run.targets||[]).map(t=>t.brand).filter(Boolean))];
    const departments=s.departments?.length?s.departments:[...new Set((run.targets||[]).map(t=>t.department).filter(Boolean))];
    const categories=s.categoryIds?.length?s.categoryIds.map(id=>ERP.engines.productTaxonomy?.categoryLabel(state,id)||id):[...new Set((run.targets||[]).map(t=>t.category).filter(Boolean))];
    return [r.mode==='discount'?`Descuento ${percent(r.discount)}`:r.mode==='margin'?`Margen ${percent(r.margin)}`:'Precio competitivo',brands.length?`Marcas: ${brands.join(', ')}`:'Todas las marcas',departments.length?`Departamentos: ${departments.join(', ')}`:'',categories.length?`Categorías: ${categories.join(', ')}`:'',run.targets?`${new Set(run.targets.map(t=>t.sku)).size} productos guardados`:s.skus?.length?`${s.skus.length} productos seleccionados`:'Inventario filtrado'].filter(Boolean).join(' · ');
  }
  function savedRows(options){return engine().commercialEventPriceRows(state,options);}
  function exportPrices(options){
    try{
      const rows=savedRows(options);if(!rows.length)throw Error('No hay precios activos que coincidan con esta selección.');
      const value=n=>Number.isFinite(n)?n:'';
      const data=rows.map(row=>({sku:row.sku,upc:row.upc,producto:row.name,marca:row.brand,departamento:row.department,categoria:row.category||'',marketplace:row.market,nivel_liquidacion:row.rotation?.level||'',unidad_rotacion:row.rotation?.unit||'',periodos_sin_rotacion:row.rotation?.elapsed??'',meses_sin_rotacion:row.rotation?.months??'',ultima_venta:row.rotation?.lastSale?.split('-').reverse().join('/')||'',primera_compra:row.rotation?.firstPurchase?.split('-').reverse().join('/')||'',evaluacion_rotacion:row.rotation?.asOf?.split('-').reverse().join('/')||'',precio_regular_mxn:(row.regularCents/100).toFixed(2),precio_descuento_mxn:(row.discountCents/100).toFixed(2),moneda:'MXN',semaforo:row.traffic?.color==='green'?'Verde':row.traffic?.color==='yellow'?'Amarillo':'Rojo',descuento_efectivo_porcentaje:value(row.regularCents?+(100*(1-row.discountCents/row.regularCents)).toFixed(4):null),precio_base_mxn:Number.isFinite(row.baselineCents)?(row.baselineCents/100).toFixed(2):'',origen_precio_base:row.baselineSource||'Histórico',descuento_configurado_porcentaje:row.rules.mode==='discount'?row.rules.discount*100:'',margen_objetivo_porcentaje:value((row.targetMargin??row.rules.margin)*100),disponible_caja_mxn:value(row.discount?.cashProfit??row.discount?.profit),comision_porcentaje:value(row.commissionRate==null?null:row.commissionRate*100),campana_principal:allEvents().find(e=>e.id===(allEvents().find(e=>e.id===row.eventId)?.parentId||row.eventId))?.name||row.eventName,campana:row.eventName,lote:row.runId,guardado:dateLabel(row.savedAt),inicio:row.startDate?.split('-').reverse().join('/'),fin:row.endDate?.split('-').reverse().join('/'),precio_transferencia_mxn:value(row.campaignTransfer?.price),caja_transferencia_mxn:value(row.campaignTransfer?.cashProfit)}));
      window.ERP.downloadCSV(`AIMERKA-${options.runId||options.lotId?'lote':'campana'}-${options.runId||options.lotId||options.eventId}${options.greenOnly?'-verdes':''}`,data);
      notice=`Exportación preparada: ${rows.length} precios guardados. No se enviaron a las tiendas.`;error='';
    }catch(e){error=e.message||'No se pudo exportar.';}
    redraw();
  }
  function savedTime(value, label) {
    const formatted = window.ERPDate?.datetime(value);
    if (!formatted || formatted === value) return '<small>Fecha de guardado sin registrar</small>';
    return `<small>${label}: <time datetime="${escape(value)}">${escape(formatted)}</time></small>`;
  }
  function runDetail(run){
    const rows=savedRows({...run.campaignId?{eventId:run.campaignId,...run.lotId?{lotId:run.lotId}:{}}:{runId:run.id,includeReleased:true},greenOnly:historyGreen});
    const active=new Map(savedRows({eventId:run.campaignId||run.eventId}).map(r=>[key(r),r.runId]));
    const assignment=row=>row.released?'<span class="ce-pill">Retirado · volvió a pendientes</span>':active.get(key(row))!==row.runId?'<small>Guardado anterior</small>':button('release-price','Volver a pendientes',`data-ce-event-id="${escape(row.eventId)}" data-ce-run-id="${escape(row.runId)}" data-ce-sku="${escape(row.sku)}" data-ce-market="${escape(row.market)}"`);
    const pages=Math.max(1,Math.ceil(rows.length/pageSize));historyPage=Math.min(historyPage,pages-1);
    const dateHeading = run.campaignId ? 'Último guardado' : 'Guardado';
    return `<div class="ce-run-detail"><div class="ce-toolbar"><label class="ce-check"><input type="checkbox" data-ce-history-green ${historyGreen?'checked':''}>Solo precios guardados en verde</label><span>${rows.length} precios · valores del momento de guardar</span></div><div class="ce-table-scroll"><table><thead><tr><th>Producto · SKU · UPC</th><th>Marketplace</th><th>Semáforo guardado</th><th>Regular</th><th>Con descuento</th><th>Descuento y forma de pago</th><th>Caja disponible</th><th>Asignación</th></tr></thead><tbody>${rows.slice(historyPage*pageSize,(historyPage+1)*pageSize).map(row=>`<tr><td><div class="ce-saved-product">${productImage(row)}<div><strong>${escape(row.name)}</strong><small>SKU ${escape(row.sku)}</small><small>UPC ${escape(row.upc||'Sin UPC')}</small>
      ${savedTime(row.savedAt,dateHeading)}${rotationFlag(row.sku)}</div></div></td><td><span class="ce-market-inline">${logo(row.market)}${escape(row.market)}</span></td><td><span class="ce-pill ce-${color(row)}">${trafficLight(color(row))}${color(row)==='green'?'Verde':color(row)==='amber'?'Amarillo':'Rojo'}</span></td><td>${amount(row.regularCents)}</td><td><strong>${amount(row.discountCents)}</strong></td><td><div class="ce-saved-discounts"><span>Campaña · pasarela / MSI: ${percent(1-row.discountCents/row.regularCents)}</span>${row.rules.mode==='discount'&&Math.abs(row.rules.discount-(1-row.discountCents/row.regularCents))>.00001?`<span>Descuento de campaña solicitado: ${percent(row.rules.discount)}</span>`:''}${row.campaignTransfer?`<span>SPEI adicional: ${percent(row.campaignTransfer.additionalDiscount)} sobre el precio de campaña</span><span>Descuento total por SPEI: ${percent(row.campaignTransfer.totalDiscountRate)}</span><span>Precio por SPEI: ${amount(row.campaignTransfer.priceCents)}</span>`:'<span>SPEI: sin descuento adicional configurado</span>'}<span>Marca: ${escape(row.brand||'Sin asignar')}</span></div></td><td>${amount(Math.round((row.discount?.cashProfit??row.discount?.profit)*100))}</td><td>${assignment(row)}</td></tr>`).join('')||'<tr><td colspan="8">No hay precios activos en esta selección.</td></tr>'}</tbody></table></div><div class="ce-toolbar">${button('history-prev','Anterior',historyPage===0?'disabled':'')}<span>Página ${historyPage+1} de ${pages}</span>${button('history-next','Siguiente',historyPage+1>=pages?'disabled':'')}</div><p class="ce-help">Esta consulta conserva el descuento, los precios y el semáforo guardados en la campaña. No recalcula con la configuración actual.</p></div>`;
  }
  function campaignHistory(id,runs,names){
    const rows=savedRows({eventId:id,...historyLot?{lotId:historyLot}:{}}),title=names.get(id)||runs[0].event?.name||id;
    const expanded=historyRun==='campaign:'+id;
    const productCount = new Set(rows.map(row => row.sku)).size;
    return `<article class="ce-history-run ce-campaign-group" data-ce-campaign="${escape(id)}"><header><div><span class="ce-eyebrow">LOTE ACUMULADO DE CAMPAÑA</span><h3>${escape(title)}</h3></div><span class="ce-pill">${productCount} ${productCount === 1 ? 'producto' : 'productos'} · ${rows.length} ${rows.length === 1 ? 'precio' : 'precios'}</span></header><div class="ce-toolbar">${button('history-campaign',expanded?'Cerrar precios de campaña':'Consultar precios de la campaña',`data-ce-event-id="${escape(id)}" aria-expanded="${expanded}"`)}${button('export-campaign',historyLot?'Exportar lote CSV':'Exportar campaña CSV',`data-ce-event-id="${escape(id)}" data-ce-lot-id="${escape(historyLot)}"`)}${button('export-campaign','Exportar verdes CSV',`data-ce-event-id="${escape(id)}" data-ce-lot-id="${escape(historyLot)}" data-ce-green="1"`)}</div>${expanded?runDetail({campaignId:id,lotId:historyLot}):''}<details class="ce-campaign-audit" ${runs.some(run=>historyRun===run.id)?'open':''}><summary>${glyph('history')} Desglose de los ${runs.length} guardados de esta campaña</summary>${runs.map(run=>`<section class="ce-batch-audit"><strong>${escape(run.event?.name||'Lote')} · ${escape(runScope(run))}</strong><small>${escape(dateLabel(run.date))} · ${escape(run.actor||'—')} · ${run.targets?.length||0} precios</small><div class="ce-toolbar">${button('history-run',historyRun===run.id?'Cerrar lote':'Consultar guardado',`data-ce-run-id="${escape(run.id)}" aria-expanded="${historyRun===run.id}"`)}${button('export-run','Exportar guardado CSV',`data-ce-run-id="${escape(run.id)}"`)}</div>${historyRun===run.id?runDetail(run):''}</section>`).join('')}</details></article>`;
  }
  function historyHTML() {
    const familyId=id=>allEvents().find(e=>e.id===id)?.parentId||id;
    const runs=(state.commercialEventRuns||[]).filter(run=>((allEvents().find(e=>e.id===run.eventId)?.kind||run.event?.kind||'campaign')===workspaceKind)&&(!historyCampaign||familyId(run.eventId)===familyId(historyCampaign))&&(!historyLot||run.eventId===historyLot));
    const names=new Map(allEvents().filter(e=>(e.kind||'campaign')===workspaceKind).map(e=>[e.id,e.name+(e.deletedAt?' · eliminada':'')]));
    for(const run of (state.commercialEventRuns||[]).filter(r=>(r.event?.kind||'campaign')===workspaceKind))if(!names.has(run.eventId))names.set(run.eventId,run.event?.name||run.eventId);
    const rootNames=[...names].filter(([id])=>familyId(id)===id);
    const lots=historyCampaign?[...names].filter(([id])=>familyId(id)===historyCampaign):[];
    const hasLots=historyCampaign&&(allEvents().find(e=>e.id===historyCampaign)?.isParent||lots.some(([id])=>id!==historyCampaign));
    const groups=new Map();for(const run of runs){const id=familyId(run.eventId);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(run);}
    return `<section class="ce-panel ce-history" id="ce-history"><header><div><span class="ce-eyebrow">HISTORIAL ACUMULADO POR CAMPAÑA</span><h2>Historial de precios guardados</h2><p>Un bloque por campaña. Los productos guardados con cada descuento se acumulan aquí y salen del cálculo de pendientes.</p></div><span class="ce-pill">${groups.size} campañas · ${runs.length} aplicaciones registradas</span></header><div class="ce-history-tools"><label class="ce-field">Consultar campaña<span class="ce-select-wrap"><span class="ce-select-leading">${glyph('calendar')}</span><span class="ce-select-chevron">${glyph('down')}</span><select data-ce-history-campaign><option value="">Todas las campañas</option>${rootNames.map(([id,name])=>`<option value="${escape(id)}" ${historyCampaign===id?'selected':''}>${escape(name)}</option>`).join('')}</select></span></label>${hasLots?`<label class="ce-field">Seleccionar lote<span class="ce-select-wrap"><span class="ce-select-leading">${glyph('box')}</span><span class="ce-select-chevron">${glyph('down')}</span><select data-ce-history-lot><option value="">Todos los lotes de esta campaña</option>${lots.map(([id,name])=>`<option value="${escape(id)}" ${historyLot===id?'selected':''}>${id===historyCampaign?'Asignaciones de la campaña principal':escape(name)}</option>`).join('')}</select></span></label>`:''}</div><div class="ce-history-runs">${[...groups].map(([id,items])=>campaignHistory(id,items,names)).join('')||'<p class="ce-help">Aún no se han guardado precios de campaña para esta selección. Las aplicaciones registradas aparecerán aquí.</p>'}</div><p class="ce-help">CSV acumulado por campaña: SKU, UPC, canal, precio regular y con descuento en MXN. Se conserva un precio por producto y canal. Exportar no modifica ni publica precios.</p></section>`;
  }
  function coverageHTML(eventId=draft?.parentId||draft?.id){
    if(!eventId||!engine()?.commercialCampaignCoverage)return '';
    const root=events().find(e=>e.id===eventId);if(!root?.isParent)return '';
    const coverage=engine().commercialCampaignCoverage(state,eventId);
    return `<section class="ce-panel ce-family-coverage"><header><div><span class="ce-eyebrow">AVANCE DE CAMPAÑA PRINCIPAL</span><h2>${escape(root.name)}</h2><p>Inventario con stock disponible; todos los lotes comparten los precios ya asignados.</p></div></header><div class="ce-coverage-grid">${coverage.map(c=>`<div class="ce-coverage-channel ${c.complete?'ce-green':''}"><span>${logo(c.market)}${escape(c.market)}</span><strong>${c.assigned} / ${c.total} productos</strong><progress max="${Math.max(c.total,1)}" value="${c.assigned}"></progress><small>${c.complete?'Lista · inventario cubierto':c.total?`${c.pending} pendientes`:'Sin stock disponible para evaluar'}</small></div>`).join('')}</div></section>`;
  }
  function agenda(){
    return `<aside class="ce-panel ce-agenda"><h2>${workspaceKind==='liquidation'?'Planes de liquidación':'Campañas guardadas'} <span>${events().filter(e=>!e.parentId).length}</span></h2>${events().filter(e=>!e.parentId).map(e=>`<div class="ce-agenda-item"><button type="button" data-ce-edit="${escape(e.id)}" class="ce-agenda-event">${glyph('calendar')}<strong>${escape(e.name)}</strong><small>Abrir campaña${e.isParent?' principal':''}</small><span>${escape(e.startDate?.split('-').reverse().join('/')||'Sin inicio')} → ${escape(e.endDate?.split('-').reverse().join('/')||'Sin cierre')}</span><small>${e.isParent?'Principal':e.parentId?'Lote · '+escape(events().find(p=>p.id===e.parentId)?.name||'Principal'):status(e)} · ${(e.markets||[]).length} canales</small></button>${pendingDelete===e.id?`<div class="ce-delete-confirm"><p>¿Eliminar esta campaña de la lista y del calendario? Sus lotes y precios se conservan. Podrás recuperarla.</p>${button('confirm-delete','Eliminar campaña',`data-ce-event-id="${escape(e.id)}"`)}${button('cancel-delete','Conservar')}</div>`:button('delete','Eliminar campaña',`data-ce-event-id="${escape(e.id)}" aria-label="Eliminar campaña ${escape(e.name)}"`)}</div>`).join('')||`<p>${workspaceKind==='liquidation'?'Aún no hay planes de liquidación. Selecciona productos para comenzar.':'Aún no hay campañas. Crea una con las fechas de tu equipo.'}</p>`}${allEvents().some(e=>e.deletedAt&&(e.kind||'campaign')===workspaceKind)?`<details class="ce-deleted"><summary>${glyph('trash')} Campañas eliminadas</summary>${allEvents().filter(e=>e.deletedAt&&(e.kind||'campaign')===workspaceKind).map(e=>`<div><strong>${escape(e.name)}</strong>${button('restore','Recuperar',`data-ce-event-id="${escape(e.id)}"`)}</div>`).join('')}</details>`:''}</aside>`;
  }
  function closeFamily(){
    const modal=document.getElementById('modal');modal?.close?.();modal?.classList?.remove('ce-family-dialog');familyModalId='';
  }
  function showFamily(id){
    const root=events().find(e=>e.id===id);if(!root)return;
    familyModalId=id;
    const lots=events().filter(e=>e.parentId===id);
    const rows=(state.commercialEventRuns||[]).filter(r=>r.eventId===id||lots.some(e=>e.id===r.eventId));
    const html=`<div class="commercial-events ce-family-popup"><header class="ce-family-popup-head"><div><span class="ce-eyebrow">CAMPAÑA PRINCIPAL</span><h2 id="modal-title">${escape(root.name)}</h2><p>${lots.length} lotes · ${rows.length} guardados · ${escape(root.startDate.split('-').reverse().join('/'))} — ${escape(root.endDate.split('-').reverse().join('/'))}</p></div>${button('family-close','Cerrar')}</header>${coverageHTML(id)}<div class="ce-toolbar">${button('family-edit','Trabajar campaña principal',`data-ce-event-id="${escape(id)}"`)}${button('family-new-lot','Crear lote de esta campaña',`data-ce-event-id="${escape(id)}"`)}${button('family-history','Consultar precios guardados',`data-ce-event-id="${escape(id)}"`)}</div><h3>${glyph('box')} Lotes de la campaña</h3><div class="ce-family-lots">${lots.map(lot=>{const saved=(state.commercialEventRuns||[]).filter(r=>r.eventId===lot.id);return `<article><div><strong>${escape(lot.name)}</strong><p>${escape(runScope({event:lot}))}</p><small>${saved.length} guardados · ${new Set(saved.length?savedRows({eventId:id,lotId:lot.id}).map(t=>t.sku):[]).size} productos con precios</small></div><div class="ce-toolbar">${button('family-edit','Continuar lote',`data-ce-event-id="${escape(lot.id)}"`)}${button('family-history','Consultar / exportar',`data-ce-event-id="${escape(id)}" data-ce-lot-id="${escape(lot.id)}"`)}${pendingDelete===lot.id?`${button('confirm-delete','Eliminar lote',`data-ce-event-id="${escape(lot.id)}"`)}${button('cancel-delete','Conservar')}`:button('delete','Eliminar lote',`data-ce-event-id="${escape(lot.id)}"`)}</div></article>`;}).join('')||'<p class="ce-help">Aún no hay lotes asociados. Puedes crear uno aquí.</p>'}</div></div>`;
    if(typeof showModal==='function')showModal(html);
    document.getElementById('modal')?.classList?.add('ce-family-dialog');
  }
  function refreshHistory(control){
    const current=document.querySelector?.('.ce-history');if(!current){redraw();return;}
    const top=control?.getBoundingClientRect?.().top;
    const selector=control?.dataset.ceHistoryLot!==undefined?'[data-ce-history-lot]':'[data-ce-history-campaign]';
    current.outerHTML=historyHTML();
    const next=document.querySelector(selector);next?.focus?.({preventScroll:true});
    if(top!=null&&next)window.scrollBy({top:next.getBoundingClientRect().top-top,left:0,behavior:'instant'});
  }
  async function changeAvailability(id,remove){
    const event=allEvents().find(e=>e.id===id);if(!event)return;
    try{busy=true;error='';await command(remove?'pricing.event.delete':'pricing.event.restore',{eventId:id,expectedRevision:event.revision||0});if(remove&&draft?.id===id){draft=null;savedJSON='';invalidate();}pendingDelete='';notice=remove?'Campaña eliminada. Su historial y precios se conservan; puedes recuperarla.':'Campaña recuperada.';}
    catch(e){error=e.message||'No se pudo actualizar la campaña.';}finally{busy=false;redraw();}
  }
  function pageHTML() {
    setWorkspace('campaign');return workspaceHTML();
  }
  function workspaceHTML() {
    return `<section class="commercial-events" aria-busy="${busy}"><header class="ce-hero"><div><span class="ce-eyebrow">COMERCIAL / EVENTOS</span><h1>Campañas que llegan a tiempo.</h1><p>Planea el calendario, define tu alcance y prepara precios por marketplace.</p></div>${button('new', 'Nueva campaña')}</header><div class="ce-planning">${calendar()}${agenda()}</div>${form()}<div class="ce-feedback" aria-live="polite">${error ? `<p class="ce-error" role="alert">${escape(error)}</p>` : ''}${notice ? `<p class="ce-notice" role="status">${escape(notice)}</p>` : ''}</div>${coverageHTML()}${previewHTML()}${historyHTML()}</section>`;
  }
  function validate() {
    if (!draft || !draft.name.trim()) throw new Error('Escribe el nombre de la campaña.');
    const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T12:00:00Z')) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
    if (!validDate(draft.startDate) || !validDate(draft.endDate) || draft.endDate < draft.startDate) throw new Error('Captura fechas válidas; el cierre debe ser igual o posterior al inicio.');
    if (!draft.markets.length) throw new Error('Selecciona al menos un marketplace.');
    if (scope === 'selected' && !draft.selection.skus.length) throw new Error('Selecciona al menos un producto o elige todo el inventario.');
    if (!Number.isFinite(draft.rules.margin) || draft.rules.margin < 0 || draft.rules.margin >= 1) throw new Error('El margen debe ser de 0 a menos de 100.');
    const transfer=draft.rules.transfer;if(transfer?.enabled&&draft.markets.includes('Tienda Nube')&&(!Number.isFinite(transfer.commissionRate)||transfer.commissionRate<0||transfer.commissionRate>=1))throw new Error('Confirma la comisión por transferencia en porcentaje.');
    const value = draft.rules[draft.rules.mode];
    if (['margin', 'discount'].includes(draft.rules.mode) && (!Number.isFinite(value) || value < 0 || value >= 1)) throw new Error('El porcentaje debe ser de 0 a menos de 100.');
  }
  async function command(type, payload) {
    const response = await window.ERP.command(type, payload);
    if (response?.ok === false) throw new Error(response.error?.message || response.error || 'No se pudo guardar.');
    return response?.result || response;
  }
  function persisted() { return draft?.id && events().find(e => e.id === draft.id && canonical(e) === savedJSON); }
  function currentPreview() { return !!preview?.fingerprint && previewEvent === draft?.id && !dirty() && !!persisted(); }
  async function calculate(onlySave = false) {
    if (busy) return;
    try {
      validate(); busy = true; error = ''; notice = ''; redraw();
      if(!onlySave&&typeof window.ERP.reload==='function'){
        await window.ERP.reload();
        const current=draft.id?events().find(e=>e.id===draft.id):null;
        if(draft.id&&(!current||savedJSON&&canonical(current)!==savedJSON))throw new Error('La campaña cambió desde otra ventana. Conservamos lo capturado; vuelve a abrirla para revisar la versión actual.');
      }
      if (dirty() || !persisted()) {
        const sent = JSON.parse(canonical(draft)), result = await command('pricing.event.save', { event: sent });
        const id = sent.id || result?.event?.id || result?.eventId || result?.id;
        const saved = id ? events().find(e => e.id === id) : events().find(e => canonical({ ...e, id: undefined }) === canonical({ ...sent, id: undefined }));
        if (!saved) { if (id) draft.id = id; throw new Error('La campaña se guardó, pero falta sincronizar el estado. Conservamos tu formulario; vuelve a intentar al actualizar.'); }
        draft = JSON.parse(canonical(saved)); savedJSON = canonical(saved); invalidate();
      }
      if (!onlySave) {
        if (!engine()?.previewCommercialEvent) throw new Error('El motor de campañas todavía no está disponible.');
        const result = await engine().previewCommercialEvent(state, { eventId: draft.id });
        if (!result?.fingerprint || !Array.isArray(result.rows)) throw new Error('No se recibió una vista previa válida.');
        preview = result; previewEvent = draft.id; page = 0; signalFilter = 'all'; selected = new Set(result.rows.filter(r => eligible(r) && color(r) === 'green').map(key)); acknowledged.clear();
        notice = result.rows.length?'Cálculo listo. Pendientes calculados. Los precios ya guardados de esta campaña no se vuelven a calcular.':'No quedan precios pendientes para este alcance y los canales seleccionados. Consulta los precios guardados de la campaña.';
      } else notice = 'Campaña guardada. Puedes calcular los precios cuando lo necesites.';
    } catch (e) { error = e.message || 'No se pudo completar la operación.'; }
    finally { busy = false; redraw(); }
  }
  function choose(index, checked) {
    const row = preview?.rows?.[index]; if (busy || !row || !eligible(row)) return;
    const k = key(row);
    if (checked && color(row) === 'red' && !acknowledged.has(k)) { error = 'Acepta explícitamente el riesgo de esta fila antes de seleccionarla.'; return; }
    if (checked) selected.add(k); else { selected.delete(k); acknowledged.delete(k); } error = '';
  }
  async function apply() {
    if (busy) return;
    try {
      if (!currentPreview()) throw new Error('Guarda y calcula de nuevo la campaña para obtener una vista previa vigente.');
      const rows = preview.rows.filter(r => selected.has(key(r)) && eligible(r));
      if (!rows.length) throw new Error('Selecciona al menos un precio.');
      if (rows.some(r => color(r) === 'red' && !acknowledged.has(key(r)))) throw new Error('Falta la aceptación explícita de riesgo.');
      busy = true; error = ''; notice = ''; redraw();
      // Recompute against current shared state immediately before dispatch. The server
      // checks the same fingerprint atomically; a stale quote never silently applies.
      const latest = await engine().previewCommercialEvent(state, { eventId: draft.id });
      if (latest.fingerprint !== preview.fingerprint || !currentPreview()) throw new Error('El inventario o las reglas cambiaron. Calcula de nuevo antes de guardar.');
      const target = r => ({ sku: r.sku, market: r.market });
      await command('pricing.event.apply', { eventId: draft.id, previewFingerprint: preview.fingerprint, targets: rows.map(target), riskAcknowledgedTargets: rows.filter(r => color(r) === 'red').map(target) });
      preview = null; selected.clear(); acknowledged.clear(); notice = 'Precios virtuales guardados. Pendientes de envío; no se publicaron en las tiendas.';
    } catch (e) { error = e.message || 'No se pudieron guardar los precios.'; }
    finally { busy = false; redraw(); }
  }
  function fieldChange(target) {
    const path = target.dataset.ceField;
    if (!path || !draft || busy) return;
    let value = target.type === 'checkbox' ? target.checked : target.value;
    if (path.startsWith('ref.')) {
      const [, i, name] = path.split('.'); if (!draft.rules.marketReferences[+i]) return;
      draft.rules.marketReferences[+i][name] = name === 'price' ? Number(value) : value; invalidate();
    } else {
      if (['rules.margin','rules.discount','rules.transfer.discount','rules.transfer.commissionRate'].includes(path)) value = value===''?null:Number(value)/100;
      edit(path, value);
      if (path === 'startDate') { const end = document.querySelector?.('[data-ce-field="endDate"]'); if (end) end.min = value; }
    }
  }
  document.addEventListener('close',event=>{if(event.target?.id==='modal'){familyModalId='';event.target.classList?.remove('ce-family-dialog');}},true);
  document.addEventListener('keydown', event => {
    if (!['Home', 'End'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !event.target?.matches?.('.commercial-events .ce-table-scroll[tabindex="0"]')) return;
    event.preventDefault();
    event.target.scrollLeft = event.key === 'End' ? event.target.scrollWidth : 0;
  });
  document.addEventListener('error', event => { if (event.target?.dataset?.ceImage !== undefined) event.target.remove(); }, true);
  document.addEventListener('input', event => {
    const t = event.target;
    if (t.dataset.ceSearch !== undefined) { search = t.value; const node = document.getElementById('ce-products'); if (node && draft) node.innerHTML = productList(); return; }
    if (t.dataset.ceField && !['checkbox', 'select-one'].includes(t.type)) fieldChange(t);
  });
  document.addEventListener('change', event => {
    const t = event.target; if (busy) return;
    if(t.dataset.ceHistoryCampaign!==undefined){historyCampaign=t.value;historyLot='';historyRun=historyCampaign?'campaign:'+historyCampaign:'';historyGreen=false;historyPage=0;refreshHistory(t);return;}
    if(t.dataset.ceHistoryLot!==undefined){historyLot=t.value;historyRun=historyCampaign?'campaign:'+historyCampaign:'';historyGreen=false;historyPage=0;refreshHistory(t);return;}
    if(t.dataset.ceHistoryGreen!==undefined){historyGreen=t.checked;historyPage=0;redraw();return;}
    if (t.dataset.ceRow !== undefined) { choose(+t.dataset.ceRow, t.checked); redraw(); return; }
    if (t.dataset.ceAck !== undefined) { const r = preview?.rows?.[+t.dataset.ceAck]; if (r && eligible(r) && color(r) === 'red') { if (t.checked) acknowledged.add(key(r)); else { acknowledged.delete(key(r)); selected.delete(key(r)); } } redraw(); return; }
    if (!draft) return;
    if(t.dataset.taxFilter==='events'){edit('selection.categoryIds',(t.value||t.dataset.taxParent)?[t.value||t.dataset.taxParent]:[]);edit('selection.departments',[]);edit('selection.skus',[]);scope='all';redraw();return;}
    if (t.dataset.ceScope) { scope = t.dataset.ceScope; edit('selection.skus', []); redraw(); }
    if (t.dataset.ceArray) { const path = t.dataset.ceArray, list = path === 'markets' ? draft.markets : draft.selection[path.split('.')[1]]; edit(path, t.checked ? [...new Set([...list, t.value])] : list.filter(v => v !== t.value)); redraw(); }
    if (t.dataset.ceField) { fieldChange(t); if (['checkbox', 'select-one'].includes(t.type)) redraw(); }
  });
  document.addEventListener('submit', async event => { if (event.target.id !== 'commercial-events-form') return; event.preventDefault(); if (event.target.reportValidity()) await calculate(); });
  document.addEventListener('click', async event => {
    const b = event.target.closest('[data-ce-action], [data-ce-edit], [data-ce-preset]'); if (!b || busy) return;
    if (b.dataset.ceEdit !== undefined) { const target=events().find(e=>e.id===b.dataset.ceEdit);if(target&&!target.parentId)showFamily(target.id);else open(b.dataset.ceEdit);return; }
    if (b.dataset.cePreset !== undefined && draft) { edit('name', b.dataset.cePreset); redraw(); return; }
    const action = b.dataset.ceAction;
    if(action==='release-price'){
      pendingRelease={eventId:b.dataset.ceEventId,runId:b.dataset.ceRunId,sku:b.dataset.ceSku,market:b.dataset.ceMarket};
      showModal(`<div class="commercial-events ce-release-dialog"><span class="ce-eyebrow">REASIGNAR PRECIO DE CAMPAÑA</span><h2 id="modal-title">Volver a pendientes</h2><p><strong>${escape(pendingRelease.sku)}</strong> · ${escape(pendingRelease.market)}</p><p>Retira el precio asignado a este producto y canal de la campaña y sus lotes. Podrás calcularlo otra vez con otro descuento.</p><p>El guardado anterior seguirá disponible en el historial. Si este precio sigue siendo el vigente del canal, se recuperará su asignación interna anterior.</p><p data-ce-release-error role="alert"></p><div class="ce-toolbar">${button('confirm-release-price','Retirar y volver a pendientes')}${button('cancel-release-price','Conservar precio')}</div></div>`);return;
    }
    if(action==='cancel-release-price'){pendingRelease=null;document.getElementById('modal')?.close?.();return;}
    if(action==='confirm-release-price'&&pendingRelease){
      busy=true;
      try{await command('pricing.event.release',pendingRelease);pendingRelease=null;invalidate();notice='Precio retirado. El producto vuelve a pendientes en ese canal; su historial se conserva.';error='';document.getElementById('modal')?.close?.();}
      catch(e){const alert=document.querySelector?.('[data-ce-release-error]');if(alert)alert.textContent=e.message;else error=e.message;}
      finally{busy=false;redraw();}return;
    }
    if(action==='family-close'){closeFamily();return;}
    if(action==='family-edit'){closeFamily();open(b.dataset.ceEventId);return;}
    if(action==='family-new-lot'){closeFamily();open(undefined,b.dataset.ceEventId);return;}
    if(action==='family-history'){closeFamily();historyCampaign=b.dataset.ceEventId;historyLot=b.dataset.ceLotId||'';historyRun='campaign:'+historyCampaign;historyPage=0;historyGreen=false;redraw();document.getElementById('ce-history')?.scrollIntoView?.({block:'start',behavior:'instant'});return;}
    if(action==='delete'){pendingDelete=b.dataset.ceEventId;if(familyModalId)showFamily(familyModalId);else redraw();return;}
    if(action==='cancel-delete'){pendingDelete='';if(familyModalId)showFamily(familyModalId);else redraw();return;}
    if(action==='confirm-delete'||action==='restore'){const family=familyModalId;await changeAvailability(b.dataset.ceEventId,action==='confirm-delete');if(family)showFamily(family);return;}
    if(action==='history-campaign'){historyRun=historyRun==='campaign:'+b.dataset.ceEventId?'':'campaign:'+b.dataset.ceEventId;historyPage=0;historyGreen=false;redraw();return;}
    if(action==='history-run'){historyRun=historyRun===b.dataset.ceRunId?'':b.dataset.ceRunId;historyPage=0;historyGreen=false;redraw();return;}
    if(action==='history-prev'||action==='history-next'){historyPage=Math.max(0,historyPage+(action==='history-next'?1:-1));redraw();return;}
    if(action==='export-run'||action==='export-campaign'){exportPrices({...action==='export-run'?{runId:b.dataset.ceRunId}:{eventId:b.dataset.ceEventId,...b.dataset.ceLotId?{lotId:b.dataset.ceLotId}:{}},greenOnly:b.dataset.ceGreen==='1'});return;}
    if (action === 'new') { open(); return; }
    if (action === 'transfer-toggle' && draft) { edit('rules.transfer.enabled',!draft.rules.transfer.enabled); redraw(); return; }
    if (['prev-month', 'next-month', 'today'].includes(action)) { const [y, m] = month.split('-').map(Number); month = action === 'today' ? mexicoDate().slice(0, 7) : new Date(Date.UTC(y, m - 1 + (action === 'next-month' ? 1 : -1), 1)).toISOString().slice(0, 7); redraw(); return; }
    if (action === 'save') { const f = document.getElementById('commercial-events-form'); if (f?.reportValidity()) await calculate(true); return; }
    if (action === 'apply') { await apply(); return; }
    if (action === 'filter' && ['all', 'green', 'amber', 'red'].includes(b.dataset.ceFilter)) { signalFilter = b.dataset.ceFilter; page = 0; }
    if (action === 'view' && ['list', 'cards', 'matrix'].includes(b.dataset.ceView)) resultView = b.dataset.ceView;
    if (action === 'prev-page') page = Math.max(0, page - 1);
    if (action === 'next-page') page = Math.min(Math.max(0, Math.ceil(groupedResults().length / pageSize) - 1), page + 1);
    if (action === 'greens' && preview) { selected = new Set(preview.rows.filter(r => eligible(r) && color(r) === 'green').map(key)); acknowledged.clear(); }
    if (action === 'none') { selected.clear(); acknowledged.clear(); }
    if (action === 'add-reference' && draft) { draft.rules.marketReferences.push({ sku: '', market: draft.markets[0] || markets[0], price: '', store: '', url: '' }); invalidate(); }
    if (action === 'remove-reference' && draft) { draft.rules.marketReferences.splice(+b.dataset.ceIndex, 1); invalidate(); }
    if (action === 'lookup-reference' && draft && window.CompetitionPricing?.open) {
      const ref = draft.rules.marketReferences[+b.dataset.ceIndex], product = (state.products || []).find(p => p.sku === ref?.sku);
      if (!product) { error = 'Captura un SKU del inventario para buscar su referencia.'; redraw(); return; }
      const version = revision;
      window.CompetitionPricing.open({ name: product.name, upc: product.upc, onApply(price, source) { if (busy || version !== revision || !draft.rules.marketReferences.includes(ref)) throw new Error('La campaña cambió. Abre de nuevo la referencia.'); ref.price = price; ref.store = source.store; ref.url = source.url; invalidate(); redraw(); } });
    }
    redraw();
  });
  renderers.commercialEvents = pageHTML;
  function startSelection(skus,kind='liquidation',levels=[],warehouseId=''){
    if(busy)return;setWorkspace(kind);draft=blank();draft.selection.skus=[...new Set(skus)];draft.selection.onlyAvailable=true;draft.selection.warehouseId=warehouseId;draft.selection.rotationLevels=[...levels];draft.rules.mode='discount';draft.rules.discount=.1;savedJSON='';scope='selected';invalidate();redraw();
  }
  function renderLiquidation(){
    setWorkspace('liquidation');
    return `<section class="commercial-events ce-liquidation-workspace"><header class="ce-hero"><div><span class="ce-eyebrow">PLANES DE LIQUIDACIÓN</span><h2>Estrategia por marketplace</h2><p>Selecciona los productos de arriba y prepara su descuento, margen mínimo y canales. Los banderines de antigüedad son independientes del semáforo financiero.</p></div></header><div class="ce-liquidation-agenda">${agenda()}</div>${form()}<div class="ce-feedback" aria-live="polite">${error?`<p class="ce-error" role="alert">${escape(error)}</p>`:''}${notice?`<p class="ce-notice" role="status">${escape(notice)}</p>`:''}</div>${coverageHTML()}${previewHTML()}${historyHTML()}</section>`;
  }
  window.CommercialEventsUI = { render: pageHTML, renderLiquidation, startSelection, open, calculate, apply, mexicoDate, status };
})();
