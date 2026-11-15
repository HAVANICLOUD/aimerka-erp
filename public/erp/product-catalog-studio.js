'use strict';
(function () {
  const markets = ['Sears', 'Sanborns', 'Coppel', 'Mercado Libre', 'Liverpool', 'Tienda Nube', 'Elektra'];
  const pools = ['good', 'reserved', 'quarantine', 'damaged', 'safety'];
  const labels = {published: 'Publicado · declarado', registered: 'ID registrado · por verificar', unknown: 'Publicación por verificar', not_published: 'No publicado · declarado', paused: 'Pausado · declarado', pending_approval: 'Pendiente de aprobación · declarado', all: 'Todos los estados'};
  const filters = {market: '', warehouse: '', status: 'published', query: '', brand: '', department: '', categoryId:'', page: 1, pageSize: 30, layout: 'table', lifecycle: 'visible'};
  const data = () => typeof state !== 'undefined' ? state : {};
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const engine = () => window.ERP?.engines?.productPrices;
  const listing = (p, market) => engine()?.listingStatus?.(p, market) || window.ProductChannels?.status?.(p, market) || {status: 'unknown'};
  const channelPrice = (p, market) => engine()?.channelPrice?.(data(), p.sku, market) || window.ProductChannels?.price?.(p, market);
  const logo = market => window.MarketUI?.logo?.(market) || '<span class="pcs-logo-fallback" aria-hidden="true">' + escape(market.slice(0, 2)) + '</span>';
  const money = cents => cents !== null && cents !== undefined && Number.isFinite(Number(cents)) ? new Intl.NumberFormat('es-MX', {style: 'currency', currency: 'MXN'}).format(Number(cents) / 100) : '—';
  const nonzero = row => pools.some(k => Number.isFinite(Number(row[k])) && Number(row[k]) !== 0);
  function warehouses(s = data()) {
    const provider = window.ERP?.engines?.warehouses;
    const rows = typeof provider?.warehouses === 'function' ? provider.warehouses(s) : typeof provider === 'function' ? provider(s) : s.warehouses;
    return rows?.length ? rows : [{id: 'principal', name: 'Almacén principal'}];
  }
  function warehouseSkus(s, id) {
    if (!id) return null;
    // An explicitly empty warehouse ledger is evidence of no balances, not a reason to use aggregates.
    if (s.warehouseStock != null) return new Set(s.warehouseStock.filter(r => r.warehouseId === id && nonzero(r)).map(r => r.sku));
    return new Set(id === 'principal' ? (s.products || []).filter(nonzero).map(p => p.sku) : []);
  }
  const lifecycle = () => window.ERP?.engines?.productLifecycle;
  const hidden = p => lifecycle()?.isHidden(p) ?? !!p.lifecycle?.hidden;
  const discontinued = p => lifecycle()?.isDiscontinued(p) ?? !!p.lifecycle?.discontinued;
  function filterProducts(s = data(), f = filters) {
    const eligible = warehouseSkus(s, f.warehouse), q = normalize(f.query);
    return (s.products || []).filter(p => (f.lifecycle === 'archived' ? (hidden(p) || discontinued(p)) : (lifecycle()?.catalogVisible(p) ?? !hidden(p))) && (!eligible || eligible.has(p.sku)) && (!f.brand || normalize(p.brand) === normalize(f.brand)) && (window.ProductTaxonomyUI?.matches(p,f.categoryId?[f.categoryId]:[])??true) && (!f.department || p.department === f.department)
      && (!q || (window.ERP?.engines?.productSearch?.productSearchMatch(s,p,f.query)??normalize([p.name,p.sku,p.upc,p.brand,p.model,p.category,...(p.skuAliases||[])].join(' ')).includes(q)))
      && (!f.market || f.status === 'all' || listing(p, f.market).status === f.status)).sort((a,b)=>q&&window.ERP?.engines?.productSearch?window.ERP.engines.productSearch.productSearchScore(s,b,f.query)-window.ERP.engines.productSearch.productSearchScore(s,a,f.query):0);
  }
  function paginate(rows, f = filters) {
    const size = [15, 30, 60, 120].includes(Number(f.pageSize)) ? Number(f.pageSize) : 30;
    const pages = Math.max(1, Math.ceil(rows.length / size)), page = Math.max(1, Math.min(pages, Math.floor(Number(f.page) || 1)));
    return {rows: rows.slice((page - 1) * size, page * size), page, pages, size, total: rows.length};
  }
  function setFilters(patch) {
    Object.assign(filters, patch);
    if (Object.keys(patch).some(k => !['page', 'layout'].includes(k))) filters.page = 1;
    if (Object.hasOwn(patch, 'market')) filters.status = 'published';
    return filters;
  }
  function safeImage(value) {
    const url = String(value || '').trim();
    return /^(https:\/\/|\/(?!\/))[^\s\\<>"']+$/i.test(url) ? url : '';
  }
  function thumbnail(p) {
    const url = safeImage(p.images?.find(i => i.primary)?.url || p.images?.[0]?.url || p.imageUrl);
    return `<span class="pcs-thumb">${url ? `<img src="${escape(url)}" loading="lazy" alt="${escape(p.name)}">` : '<span aria-hidden="true">▧</span>'}</span>`;
  }
  const options = (values, selected) => values.map(([value, title]) => `<option value="${escape(value)}" ${value === selected ? 'selected' : ''}>${escape(title)}</option>`).join('');
  function selectFilter(key, title, values) {
    return `<label class="pcs-field"><span>${window.ProductTaxonomyUI?.glyph(key==='warehouse'?'box':'tree')||''}${title}${window.ProductTaxonomyUI?.info(({warehouse:'Consulta los productos con saldos registrados en este almacén. Sin seleccionar uno, se muestra todo el catálogo.',lifecycle:'Alterna entre el catálogo visible y los productos descontinuados u ocultos.',status:'Filtra el estado declarado de publicación en el marketplace elegido.',pageSize:'Cantidad de productos que se muestran en cada página.'})[key]||'Acota los productos de esta consulta.')||''}</span><select aria-label="${title}" data-pcs-filter="${key}">${options(values, filters[key])}</select></label>`;
  }
  function costDisplay(p) {
    const cents = p.averageCostMxn != null ? Number(p.averageCostMxn) * 100 : p.costCents;
    return p.costStatus === 'Por confirmar' && !(Number(cents) > 0) ? 'Por confirmar' : money(cents);
  }
  function row(p) {
    const sku = escape(p.sku), m = filters.market, price = m ? channelPrice(p, m) : null;
    return `<tr><td><div class="pcs-product">${thumbnail(p)}<div><button type="button" class="pcs-name" data-pcs-open="${sku}">${escape(p.name)}</button>${discontinued(p)?'<span class="pcs-lifecycle-badge">Descontinuado</span>':''}${hidden(p)?'<span class="pcs-lifecycle-badge">Oculto</span>':''}<small>${escape(p.brand || 'Sin marca')} · ${escape(window.ProductTaxonomyUI?.labels(p).join(' · ') || 'Clasificación por revisar')}</small></div></div></td><td class="pcs-identifiers"><span><small>SKU</small> ${sku}</span><span><small>UPC</small> ${escape(p.upc || 'Pendiente')}</span></td><td class="pcs-value"><small>Costo promedio</small><strong>${costDisplay(p)}</strong></td><td class="pcs-value"><small>Precio general</small><strong>${money(p.priceCents)}</strong>${m ? `<div class="pcs-saved"><small>${escape(m)} · regular / descuento</small><b>${money(price?.regularCents)} / ${money(price?.discountCents)}</b><small>${price ? 'Precio virtual guardado · pendiente de envío' : 'Sin precio guardado'}</small></div>` : ''}</td><td>${m ? `<span class="pcs-status pcs-${escape(listing(p, m).status)}">${escape(labels[listing(p, m).status] || labels.unknown)}</span>` : window.ProductChannels?.strip?.(p) || '<span class="pcs-muted">Canales por verificar</span>'}</td><td><div class="pcs-actions"><button type="button" class="btn small" data-pcs-open="${sku}">Ver ficha</button><button type="button" class="btn small" data-pcs-edit="${sku}">Editar</button><button type="button" class="btn small" data-pcs-quote="${sku}">Calcular precios</button></div></td></tr>`;
  }
  function render() {
    const s = data(), all = filterProducts(s), page = paginate(all); filters.page = page.page;
    const base = filterProducts(s, {...filters, market: ''});
    const empty = filters.market && filters.status === 'published' ? '<tr><td colspan="6" class="pcs-empty"><strong>Sin publicaciones declaradas para este canal.</strong><p>Revisa Todos los estados para completar sus fichas.</p><button type="button" class="btn small" data-pcs-statusall>Todos los estados</button></td></tr>' : '<tr><td colspan="6" class="pcs-empty"><strong>No hay coincidencias</strong><p>Prueba otro estado de publicación o limpia los filtros.</p></td></tr>';
    const distinct = key => [...new Set((s.products || []).map(p => p[key]).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'es')).map(v => [v,v]);
    return `<section id="product-catalog-studio" class="pcs-workspace"><header class="pcs-heading"><div><span class="eyebrow">CATÁLOGO COMERCIAL</span><h2>Productos</h2><p>Una identidad central. Una ficha para cada canal.</p></div><div class="pcs-actions"><button type="button" class="btn" data-view="inventory">Ver inventario</button><button type="button" class="btn" data-sicar-new-import>Importar nuevos de SICAR</button><button type="button" class="btn primary" data-pcs-new>Registrar producto</button></div></header><nav class="pcs-channels" aria-label="Catálogo por canal">${['', ...markets].map(m => {const count = m ? base.filter(p => listing(p,m).status === 'published').length : base.length;return `<button type="button" data-pcs-market="${escape(m)}" class="${filters.market === m ? 'active' : ''}" aria-pressed="${filters.market === m}">${m ? logo(m) : '<span class="pcs-erp-logo">ERP</span>'}<span>${escape(m || 'Todos los productos')}</span><b aria-label="${count} ${m ? 'publicados declarados' : 'productos'}">${count}</b></button>`;}).join('')}</nav><section class="pcs-filter-panel" aria-label="Buscar y filtrar productos"><div class="pcs-filter-heading">${window.ProductTaxonomyUI?.glyph('search')||''}Buscar y filtrar productos${window.ProductTaxonomyUI?.info('Todos estos campos se combinan. La marca se limita a la ruta seleccionada. Usa Limpiar filtros para volver a todo el catálogo.')||''}</div><label class="pcs-search"><span>${window.ProductTaxonomyUI?.glyph('search')||''}Buscar producto${window.ProductTaxonomyUI?.info('Busca por nombre, SKU, UPC, marca o equivalencia del proveedor. Se combina con categoría, marca, almacén y canal.')||''}</span><input type="search" aria-label="Buscar producto" data-pcs-filter="query" value="${escape(filters.query)}" placeholder="Nombre, marca, modelo, categoría, SKU o UPC…"></label>${selectFilter('lifecycle', 'Ciclo de vida', [['visible','Catálogo visible'],['archived','Descontinuados y ocultos']])}${selectFilter('warehouse', 'Almacén', [['','Todos los almacenes'], ...warehouses(s).map(w => [w.id, w.name])])}${window.ProductTaxonomyUI?.filters('products',filters.categoryId,filters.brand,filterProducts(s,{...filters,brand:'',query:''}))||''}${filters.market ? selectFilter('status','Publicación',Object.entries(labels)) : ''}<button type="button" class="btn small" data-pcs-clear title="Quitar los filtros de búsqueda, categoría, marca, almacén y estado">${window.ProductTaxonomyUI?.glyph('search')||''}Limpiar filtros</button></section><div class="pcs-results"><div><strong>${all.length}</strong> de ${(s.products || []).length} productos${filters.market ? ` · ${escape(filters.market)} · ${escape(labels[filters.status])}` : ''}<small>${filters.warehouse ? 'Productos con existencias en almacén' + (s.warehouseStock == null ? ' · respaldo de saldos generales en principal; asociación no verificada.' : ' · según saldos registrados, incluidos reservas y déficits.') : 'Catálogo completo · sin filtro de existencias'}</small></div><div class="pcs-actions" role="group" aria-label="Vista del catálogo"><button type="button" class="btn small" data-pcs-layout="table" aria-pressed="${filters.layout === 'table'}">Tabla</button><button type="button" class="btn small" data-pcs-layout="grid" aria-pressed="${filters.layout === 'grid'}">Tarjetas</button></div></div><div class="pcs-table-wrap ${filters.layout === 'grid' ? 'pcs-grid' : ''}"><table class="pcs-table"><caption class="pcs-sr">Catálogo de productos y precios en MXN</caption><thead><tr><th>Producto</th><th>Identificación</th><th>Costo promedio</th><th>Precio de venta</th><th>${filters.market ? 'Publicación declarada' : 'Canales'}</th><th>Acciones</th></tr></thead><tbody>${page.rows.map(row).join('') || empty}</tbody></table></div><footer class="pcs-pagination"><span role="status" aria-live="polite">${page.total ? (page.page-1)*page.size+1 : 0}–${Math.min(page.page*page.size,page.total)} de ${page.total} · Página ${page.page} de ${page.pages}</span><div class="pcs-actions">${selectFilter('pageSize','Por página',[15,30,60,120].map(n => [n,String(n)]))}<button type="button" class="btn small" data-pcs-page="${page.page-1}" ${page.page===1?'disabled':''}>Anterior</button><button type="button" class="btn small" data-pcs-page="${page.page+1}" ${page.page===page.pages?'disabled':''}>Siguiente</button></div></footer><p class="pcs-footnote">Los precios guardados no acreditan una publicación. Los estados declarados están pendientes de verificación con cada tienda.</p></section>`;
  }
  function refresh(focusKey, selection) {
    const root = document.getElementById('product-catalog-studio');
    if (!root) return;
    if(focusKey==='query'&&document.createElement){const template=document.createElement('template');template.innerHTML=render();for(const selector of ['.pcs-channels','.pcs-results','.pcs-table-wrap','.pcs-pagination']){const current=root.querySelector(selector),next=template.content.querySelector(selector);if(current&&next)current.replaceWith(next);}return;}
    root.outerHTML = render();
    if (focusKey) {const input = document.querySelector(`[data-pcs-filter="${focusKey}"]`); input?.focus(); if (selection != null && input?.type === 'search') input.setSelectionRange(selection, selection);}
  }
  let openSku = '', profileMarket = markets[0];
  const getProduct = sku => (data().products || []).find(p => p.sku === sku);
  function profileFor(p, market) {
    return p.channelProfiles?.[market] || (data().productChannelProfiles || []).find(r => r.sku === p.sku && r.market === market)?.profile || {};
  }
  const attributeFields = [['brand','Marca'], ['model','Modelo'], ['weightKg','Peso embalado (kg)'], ['lengthCm','Largo embalado (cm)'], ['widthCm','Ancho embalado (cm)'], ['heightCm','Alto embalado (cm)']];
  const publicationStatuses = ['unknown', 'published', 'not_published', 'paused', 'pending_approval'];
  document.addEventListener('change',event=>{const t=event.target;if(t.dataset.taxBrand==='products'){setFilters({brand:t.value});refresh();return;}if(t.dataset.taxFilter==='products'){setFilters({categoryId:t.value||t.dataset.taxParent,brand:''});refresh();}});
  const fieldLimits = {title:250, description:10000, categoryId:160, categoryName:250, condition:80, warranty:1000, sellerSku:100, publicationId:150};
  const predefinedAttribute = name => attributeFields.some(([key]) => key.toLowerCase() === String(name).toLowerCase());
  function attributeRow(attribute = {}) {
    return `<div class="pcs-attribute-row" data-pcs-attribute-row><label class="pcs-field"><span>Nombre del atributo</span><input data-pcs-attribute-name maxlength="100" value="${escape(attribute.name)}" placeholder="Material, voltaje…"></label><label class="pcs-field"><span>Valor</span><input data-pcs-attribute-value maxlength="1000" value="${escape(attribute.value)}"></label><button type="button" class="btn small" data-pcs-remove-attribute aria-label="Quitar atributo">Quitar</button></div>`;
  }
  function profileContent(p, market) {
    const profile = profileFor(p,market), attrs = profile.attributes || [], ids = p.channelIdentifiers?.[market] || {};
    const declared = listing(p, market).status;
    const publicationStatus = publicationStatuses.includes(declared) ? declared : 'unknown';
    const dimensions = (title, values) => `<section><h4>${escape(title)} · consulta central</h4><dl class="pcs-dimensions">${[['weightKg','Peso (kg)'],['lengthCm','Largo (cm)'],['widthCm','Ancho (cm)'],['heightCm','Alto (cm)']].map(([key,label])=>`<div><dt>${label}</dt><dd>${escape(values?.[key] ?? 'Sin registrar')}</dd></div>`).join('')}</dl></section>`;
    const field = (name, title, value, area = false) => `<label class="pcs-field"><span>${escape(title)}</span>${area ? `<textarea name="${name}" rows="5" maxlength="${fieldLimits[name] || 1000}">${escape(value)}</textarea>` : `<input name="${name}" value="${escape(value)}" maxlength="${fieldLimits[name] || 1000}">`}</label>`;
    return `<section class="pcs-profile"><header><h3>Ficha del canal</h3><p>SKU central <strong>${escape(p.sku)}</strong> · UPC ${escape(p.upc || 'Pendiente')}</p><p>Guarda una adaptación comercial para el canal. Publicar y verificar en la tienda está pendiente de conexión.</p></header><label class="pcs-field"><span>Canal</span><select data-pcs-profile-market>${options(markets.map(m=>[m,m]),market)}</select></label><form data-pcs-profile-form data-sku="${escape(p.sku)}" data-market="${escape(market)}"><div class="pcs-profile-fields">${field('title','Título en el canal',profile.title ?? p.name)}${field('description','Descripción en el canal',profile.description ?? p.description,true)}${field('categoryId','ID de categoría externa',profile.categoryId)}${field('categoryName','Categoría externa',profile.categoryName)}${field('sellerSku','SKU vendedor',profile.sellerSku ?? ids.sellerSku)}${field('publicationId','ID de publicación',profile.publicationId ?? ids.publicationId)}<label class="pcs-field"><span>Estado de publicación · declaración manual</span><select name="publicationStatus">${options(publicationStatuses.map(status=>[status,labels[status]]),publicationStatus)}</select></label>${field('condition','Condición',profile.condition ?? p.condition)}${field('warranty','Garantía',profile.warranty ?? p.warranty)}${attributeFields.map(([key,title])=>field('attr-'+key,title,attrs.find(a=>a.name.toLowerCase()===key.toLowerCase())?.value ?? p[key] ?? p.dimensions?.[key])).join('')}</div><details class="pcs-media" open><summary>Atributos específicos del canal</summary><p>Agrega los atributos que requiere la categoría de este canal. Hasta 50 en total, incluidos marca, modelo y empaque.</p><div data-pcs-attribute-rows>${attrs.filter(a=>!predefinedAttribute(a.name)).map(attributeRow).join('')}</div><button type="button" class="btn small" data-pcs-add-attribute>Agregar atributo</button></details><details class="pcs-media"><summary>Dimensiones centrales · solo lectura</summary>${dimensions('Producto',p.productDimensions)}${dimensions('Empaque',p.packageDimensions || p.dimensions)}</details><details class="pcs-media"><summary>Imágenes centrales · URLs de consulta</summary>${[...new Set([...(p.images || []).map(i=>i.url),p.imageUrl].filter(Boolean))].map(url=>`<label class="pcs-field"><span>URL de imagen</span><input readonly value="${escape(url)}"></label>`).join('') || '<p>Sin imágenes registradas.</p>'}</details><p class="pcs-profile-feedback" role="status" aria-live="polite"></p><button type="submit" class="btn primary">Guardar ficha del canal</button><small class="pcs-profile-note">Los valores centrales se usan como referencia inicial. Solo este canal recibe los cambios al guardar.</small></form></section>`;
  }
  function decorate(sku) {
    const tabs = document.querySelector('#drawer .pt29-tabs');
    if (!tabs || !getProduct(sku)) return;
    const detail = document.querySelector('#drawer .pt29-product-detail');
    const commercial = typeof view !== 'undefined' && view === 'products';
    detail?.classList.toggle('pcs-commercial-detail', commercial);
    const actions = detail?.querySelector('.pt29-detail-actions');
    if (actions && !detail.querySelector('[data-pcs-inventory-toggle]')) {
      const toggle = `<button type="button" class="btn" data-pcs-inventory-toggle="${escape(sku)}" aria-expanded="false" aria-controls="pcs-inventory-mini">Consultar inventario</button>`;
      const adjust = commercial ? actions.querySelector('[data-c28-adjust]') : null;
      if (adjust) adjust.outerHTML = toggle;
      else actions.insertAdjacentHTML('beforeend',toggle);
      actions.insertAdjacentHTML('afterend','<section id="pcs-inventory-mini" class="pcs-inventory-mini" aria-label="Inventario del producto" hidden></section>');
    }
    openSku = sku;
    if (!document.getElementById('pcs-profile-tab')) tabs.insertAdjacentHTML('beforeend','<button type="button" id="pcs-profile-tab" class="pt29-tab" role="tab" aria-selected="false" aria-controls="pt29-history-panel" data-pcs-profile-tab>Ficha del canal</button>');
  }
  function inventoryIcon(key) {
    const paths = {
      good: '<path d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm-9 5 9 5 9-5M12 13v9M7 5l10 6"/>',
      reserved: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
      quarantine: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M10 7v6M7 10h6"/>',
      damaged: '<path d="m12 3 10 18H2L12 3ZM12 9v5m0 3v1"/>',
      safety: '<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z"/><path d="m8 12 3 3 5-6"/>',
      available: '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
      jump: '<path d="M14 3h7v7m0-7L10 14M10 4H4v16h16v-6"/>'
    };
    return `<svg class="pcs-inventory-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[key] || ''}</svg>`;
  }
  function inventoryMini(p) {
    const labels = [['good','Físico'],['reserved','Reserva'],['quarantine','Inspección'],['damaged','No vendible'],['safety','Seguridad'],['available','Disponible']];
    const available = row => window.ERP?.engines?.inventory?.available?.(row) ?? (typeof D !== 'undefined' ? D.available(row) : null);
    const balance = (row, name) => `<section class="pcs-mini-balance"><h4>${escape(name)}</h4><dl class="pcs-mini-grid">${labels.map(([key,label])=>{const value=key==='available'?available(row):row[key]||0;return `<div data-pcs-pool="${key}"><dt>${inventoryIcon(key)}<span>${label}</span></dt><dd>${value==null?'—':Number(value).toLocaleString('es-MX')}</dd></div>`;}).join('')}</dl></section>`;
    const provider = window.ERP?.engines?.warehouses;
    const balances = provider?.warehouseBalances ? provider.warehouseBalances(data()) : data().warehouseStock;
    const rows = balances?.filter(row=>row.sku===p.sku);
    return `<p>Consulta de existencias · SKU ${escape(p.sku)} · UPC ${escape(p.upc || 'Pendiente')}</p><p class="pcs-mini-caption">Existencias por producto y almacén · solo lectura</p>${balance(p,'Total')}${rows?.map(row=>balance(row,warehouses().find(w=>w.id===row.warehouseId)?.name||row.warehouseId)).join('')||''}<button type="button" class="btn small" data-pcs-inventory-jump="${escape(p.sku)}">${inventoryIcon('jump')}Consultar en módulo Inventario</button>`;
  }
  function showProfile(sku = openSku, market = profileMarket) {
    const p = getProduct(sku), panel = document.getElementById('pt29-history-panel');
    if (!p || !panel || !markets.includes(market)) return;
    decorate(sku); profileMarket = market;
    document.querySelectorAll('#drawer .pt29-tab').forEach(tab=>{const active=tab.id==='pcs-profile-tab';tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));});
    panel.setAttribute('aria-labelledby','pcs-profile-tab'); panel.innerHTML = profileContent(p,market);
  }
  function profilePayload(form, p = getProduct(form.dataset.sku)) {
    const value = name => String(form.elements.namedItem(name)?.value || '').trim();
    const attributes = [...form.querySelectorAll('[data-pcs-attribute-row]')].map(row=>({name:row.querySelector('[data-pcs-attribute-name]').value.trim(),value:row.querySelector('[data-pcs-attribute-value]').value.trim()})).filter(a=>a.name || a.value);
    attributeFields.forEach(([key])=>{const v=value('attr-'+key);if(v)attributes.push({name:key,value:v});});
    if (attributes.length > 50) throw Error('Usa hasta 50 atributos por canal, incluidos marca, modelo y empaque.');
    if (attributes.some(a=>!a.name || !a.value || a.name.length>100 || a.value.length>1000)) throw Error('Completa el nombre y valor de cada atributo (hasta 100 y 1000 caracteres).');
    if (new Set(attributes.map(a=>a.name.toLocaleLowerCase('es-MX'))).size !== attributes.length) throw Error('No repitas nombres de atributos en el mismo canal.');
    const publicationStatus = form.elements.namedItem('publicationStatus');
    return {sku: form.dataset.sku, market: form.dataset.market, profile: Object.fromEntries([...['title','description','categoryId','categoryName','condition','warranty','sellerSku','publicationId'].map(k=>[k,value(k)]),['attributes',attributes], ...(publicationStatus && publicationStatuses.includes(publicationStatus.value) ? [['publicationStatus',publicationStatus.value]] : [])])};
  }
  // Compose with the current public entry point; do not replace the shared showDrawer chain.
  const previousShow = window.ProductTrace28?.show;
  if (previousShow) {
    window.ProductTrace28.show = function(sku, ...args) {const result=previousShow.call(this,sku,...args);decorate(sku);return result;};
    if (typeof productDetails !== 'undefined') productDetails = window.ProductTrace28.show;
  }
  document.addEventListener('click', event => {
    const b = event.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.pcsInventoryToggle) {
      const panel=document.getElementById('pcs-inventory-mini'),p=getProduct(b.dataset.pcsInventoryToggle);
      if(panel&&p){panel.hidden=!panel.hidden;if(!panel.hidden)panel.innerHTML=inventoryMini(p);b.setAttribute('aria-expanded',String(!panel.hidden));}
    }
    if (b.dataset.pcsInventoryJump) window.InventoryWorkspace?.openProduct(b.dataset.pcsInventoryJump);
    if (b.hasAttribute('data-pcs-market')) {setFilters({market:b.dataset.pcsMarket});refresh();}
    if (b.hasAttribute('data-pcs-page')) {setFilters({page:Number(b.dataset.pcsPage)});refresh();}
    if (b.hasAttribute('data-pcs-layout')) {setFilters({layout:b.dataset.pcsLayout});refresh();}
    if (b.hasAttribute('data-pcs-clear')) {setFilters({query:'',brand:'',department:'',categoryId:'',warehouse:'',status:'published',lifecycle:'visible'});refresh();}
    if (b.hasAttribute('data-pcs-new')) window.ProductTrace28?.form();
    if (b.dataset.pcsOpen) {window.ProductTrace28?.show(b.dataset.pcsOpen);decorate(b.dataset.pcsOpen);}
    if (b.dataset.pcsEdit) window.ProductTrace28?.form(b.dataset.pcsEdit);
    if (b.dataset.pcsQuote) window.Price28?.openProduct(b.dataset.pcsQuote,filters.market || undefined);
    if (b.hasAttribute('data-pcs-statusall')) {setFilters({status:'all'});refresh();}
    if (b.hasAttribute('data-pcs-profile-tab')) showProfile(openSku, filters.market || profileMarket);
    if (b.hasAttribute('data-pcs-add-attribute')) {
      const form=b.closest('form'), rows=form.querySelector('[data-pcs-attribute-rows]');
      const predefined=attributeFields.filter(([key])=>form.elements.namedItem('attr-'+key)?.value.trim()).length;
      if (rows.children.length + predefined >= 50) {form.querySelector('.pcs-profile-feedback').textContent='Usa hasta 50 atributos por canal, incluidos marca, modelo y empaque.';return;}
      rows.insertAdjacentHTML('beforeend',attributeRow());rows.lastElementChild.querySelector('input').focus();
    }
    if (b.hasAttribute('data-pcs-remove-attribute')) b.closest('[data-pcs-attribute-row]')?.remove();
  });
  document.addEventListener('input', event => {if(event.target.dataset?.pcsFilter==='query'){setFilters({query:event.target.value});refresh('query',event.target.selectionStart);}});
  document.addEventListener('change', event => {
    const el=event.target;
    if(el.dataset?.pcsFilter && el.dataset.pcsFilter!=='query'){setFilters({[el.dataset.pcsFilter]:el.dataset.pcsFilter==='pageSize'?Number(el.value):el.value});refresh(el.dataset.pcsFilter);}
    if(el.hasAttribute('data-pcs-profile-market')) showProfile(openSku,el.value);
  });
  document.addEventListener('submit', async event => {
    const form=event.target; if(!form.hasAttribute('data-pcs-profile-form'))return;
    event.preventDefault();if(form.dataset.busy)return;
    const button=form.querySelector('[type="submit"]'), feedback=form.querySelector('.pcs-profile-feedback');
    form.dataset.busy='1';button.disabled=true;feedback.textContent='Guardando ficha…';
    try {
      const result=await window.ERP.command('pricing.productChannel.save',profilePayload(form));
      feedback.textContent=result?.ok===true?'Ficha del canal guardada. Pendiente de envío a la tienda.':result?.error || 'No se guardó la ficha. Puedes reintentar.';
      if (result?.ok===true) {
        const latest=getProduct(form.dataset.sku), strip=document.querySelector('#drawer .pcp-detail-channels .pcp-market-strip');
        if (latest && strip && window.ProductChannels?.strip) strip.outerHTML=window.ProductChannels.strip(latest);
      }
    }
    catch(error){feedback.textContent=error.message || 'No se guardó la ficha.';}
    finally{delete form.dataset.busy;button.disabled=false;}
  });
  window.ProductCatalogStudio = {render, filters, setFilters, filterProducts, paginate, warehouses, warehouseSkus, escape, safeImage, profileFor, profileContent, profilePayload, decorate, showProfile, inventoryMini};
  if (typeof renderers !== 'undefined') renderers.products = render;
  if (typeof productsPage !== 'undefined') productsPage = render;
})();
