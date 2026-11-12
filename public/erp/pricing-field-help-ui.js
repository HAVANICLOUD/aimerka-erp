/* Load after pricing-ui.js, before boot. Decoration never writes pricing state. */
(() => {
  'use strict';
  const original = window.price28Form;
  if (typeof original !== 'function' || original.price28FieldHelp) return;

  const metadata = {
    productKey: ['product', 'search', 'Escribe el nombre, UPC o SKU y selecciona un producto del catálogo para recuperar sus datos. También puedes explorar el inventario.'],
    name: ['product', 'box', 'Escribe un nombre que identifique el producto. Se utiliza para buscar una categoría sugerida; revisa y confirma la categoría del marketplace.'],
    category: ['product', 'layers', 'Elige la categoría del marketplace que corresponde al producto. Esta selección determina la comisión del escenario.'],
    channel: ['product', 'store', 'Selecciona el marketplace para utilizar sus categorías, comisiones y reglas de venta configuradas.'],
    cost: ['money', 'wallet', 'Captura el costo de compra o costo promedio en pesos mexicanos. Se descuenta al calcular la utilidad; no es el precio de venta.'],
    marketPrice: ['money', 'search', 'Captura el último precio de venta observado en el mercado, en pesos mexicanos. Sirve como referencia y como precio de venta en modo competitivo.'],
    alternateMarketPrice: ['money', 'search', 'Captura una referencia de mercado en pesos mexicanos. Si lo dejas vacío, se conserva el precio general del producto como referencia.'],
    shippingType: ['shipping', 'truck', 'Elige el tamaño del envío para usar su tarifa configurada. Cuando esté disponible, Automático usa las reglas del producto.'],
    manualShipping: ['shipping', 'truck', 'Opcional: captura el importe del envío en pesos mexicanos para este escenario. Vacío usa la tarifa automática; 0 significa envío de $0.'],
    manualDiscount: ['money', 'tag', 'Captura el precio final de venta con descuento, en pesos mexicanos. En modo manual se ajusta hacia arriba a la siguiente terminación 99 para calcular el resultado.'],
    manualRegular: ['money', 'tag', 'Opcional: captura el precio regular antes del descuento, en pesos mexicanos. Si lo dejas vacío, se genera con el inflado elegido.'],
    mlType: ['rules', 'store', 'Selecciona Clásica o Premium según la publicación de Mercado Libre que vas a cotizar. Cambia la comisión utilizada.'],
    msi: ['rules', 'calendar', 'Selecciona el plazo de meses sin intereses de Elektra. Su comisión se incluye en el escenario; a un mismo precio, más comisión reduce la caja disponible.'],
    msiComparisonPrice: ['money', 'calendar', 'Opcional: indica un mismo precio en pesos para comparar los plazos MSI. Vacío usa la referencia indicada en el formulario. Esta comparación no cambia la cotización.'],
    margin: ['rates', 'percent', 'Captura la utilidad objetivo como porcentaje del precio de venta: 10 significa 10%. De 0% a 100%, con pasos de 5%. Si la utilidad no es alcanzable tras comisiones y retenciones se indica, sin inventar un precio.'],
    minimumDiscount: ['rates', 'tag', 'Descuento mínimo que deseas mostrar al cliente. Se ajusta el regular sin bajar el precio calculado por utilidad; ambos terminan en 99.'],
    inflation: ['rates', 'percent', 'Captura el porcentaje de aumento para generar el precio regular a partir del precio con descuento. Por ejemplo, 10 significa 10%; no es el margen de utilidad.'],
    zeroMarginInflation: ['rates', 'percent', 'Con utilidad objetivo de 0%, elige por separado el porcentaje de inflado del precio regular. Por ejemplo, 10 significa 10%.'],
    competitiveInflation: ['rates', 'percent', 'Elige el porcentaje para generar el precio regular sobre la referencia competitiva. El precio de venta competitivo sigue la referencia de mercado.'],
    t1CommissionMode: ['rules', 'layers', 'Usa la comisión configurada de T1 o el 14% inferido para simular este escenario. La simulación no modifica la tarifa general guardada.']
  };
  // Static paths only; labels and help text are always assigned as textContent.
  const paths = {
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    box: '<path d="m12 3 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8M7.5 5.5l9 5"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
    store: '<path d="M4 10v11h16V10M3 10l2-7h14l2 7M3 10h18M9 21v-7h6v7"/>',
    wallet: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 8h18M16 12h5v5h-5z"/>',
    truck: '<path d="M3 5h11v12H3zM14 9h4l3 4v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
    tag: '<path d="M3 3h8l10 10-8 8L3 11z"/><circle cx="7.5" cy="7.5" r="1"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2"/>',
    percent: '<path d="m5 19 14-14"/><circle cx="7" cy="7" r="3"/><circle cx="17" cy="17" r="3"/>'
  };
  let sequence = 0;
  function decorate(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const form = template.content.querySelector('#price28-form');
    if (!form) return html;
    form.querySelectorAll('input[data-price28-field], select[data-price28-field], textarea[data-price28-field]').forEach(input => {
      if (input.type === 'hidden' || input.dataset.price28HelpDecorated) return;
      const field = input.closest('.field');
      const label = [...(field?.querySelectorAll('label') || [])].find(item => item.htmlFor === input.id && input.id);
      if (!label) return;
      const [group, vector, help] = metadata[input.dataset.price28Field] || ['product', 'box', 'Completa este dato según la etiqueta y las indicaciones del campo para el escenario actual.'];
      const id = `price28-field-help-${++sequence}`;
      const editable = !input.readOnly && !input.disabled;
      input.dataset.price28HelpDecorated = 'true';
      input.classList.add(editable ? 'price28-fill-control' : 'price28-read-control');
      field.classList.add('price28-help-field', `price28-help-${group}`);
      const heading = document.createElement('div');
      heading.className = 'price28-help-heading';
      label.before(heading);
      heading.append(label); // Preserve the native label and its for/id association.
      label.classList.add('price28-help-label');
      if (!label.querySelector('svg')) {
        const icon = document.createElement('span');
        icon.className = 'price28-help-vector';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[vector]}</svg>`;
        label.prepend(icon);
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'price28-help-trigger';
      button.textContent = 'i';
      button.setAttribute('aria-label', `Información: ${label.textContent.trim()}`);
      button.setAttribute('aria-controls', id);
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-describedby', id);
      heading.append(button);
      const tooltip = document.createElement('div');
      tooltip.id = id;
      tooltip.className = 'price28-field-tooltip';
      tooltip.setAttribute('role', 'tooltip');
      tooltip.textContent = editable ? help : `Dato de consulta; no se captura aquí. ${help}`;
      tooltip.hidden = true;
      heading.after(tooltip);
      input.setAttribute('aria-describedby', [...new Set([...(input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean), id])].join(' '));
    });
    return template.innerHTML;
  }
  function wrappedForm(...args) { return decorate(original.apply(this, args)); }
  wrappedForm.price28FieldHelp = true;
  window.price28Form = wrappedForm;

  // Delegated help events only: no input replacement, input listeners or pricing calls.
  let active = null;
  let pinned = false;
  function hide() {
    if (active) {
      active.setAttribute('aria-expanded', 'false');
      const tip = document.getElementById(active.getAttribute('aria-controls'));
      if (tip) tip.hidden = true;
    }
    active = null;
    pinned = false;
  }
  function show(button) {
    if (active !== button) hide();
    active = button;
    button.setAttribute('aria-expanded', 'true');
    const tip = document.getElementById(button.getAttribute('aria-controls'));
    if (tip) tip.hidden = false;
  }
  function trigger(target) { return target?.closest?.('#price28-form .price28-help-trigger'); }
  function withinHelp(target) {
    return active && (active.closest('.price28-help-heading')?.contains(target) || active.contains(target) || document.getElementById(active.getAttribute('aria-controls'))?.contains(target));
  }
  document.addEventListener('mouseover', event => {
    const button = trigger(event.target);
    if (button) show(button);
  });
  document.addEventListener('mouseout', event => {
    if (withinHelp(event.target) && !withinHelp(event.relatedTarget) && !pinned && document.activeElement !== active) hide();
  });
  document.addEventListener('focusin', event => {
    const button = trigger(event.target);
    if (button) show(button);
    else if (!withinHelp(event.target)) hide();
  });
  document.addEventListener('focusout', event => {
    if (trigger(event.target) && !pinned && !withinHelp(event.relatedTarget)) hide();
  });
  document.addEventListener('click', event => {
    const button = trigger(event.target);
    if (button) {
      if (active === button && pinned) hide();
      else { show(button); pinned = true; }
    } else if (!withinHelp(event.target)) hide();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && active) hide();
  });
})();
