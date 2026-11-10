/* Presentation only. Load with date-presentation-ui.css; no ERP state dependency.
 * ERPDate.refresh(root) also synchronizes silent programmatic native .value writes
 * (which browsers do not publish as DOM mutations). Dirty drafts always win.
 */
(function (window) {
  'use strict';
  if (window.ERPDate) return;
  const zone = 'America/Mexico_City';
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/;
  const isoStamp = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?$/;
  const partsFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  function isCalendarDate(value) {
    const m = isoDate.exec(value);
    if (!m) return false;
    const y = +m[1], month = +m[2], day = +m[3];
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    return y >= 1 && month >= 1 && month <= 12 && day >= 1 &&
      day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  }
  function parse(value) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value).trim());
    if (!m) return null;
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    return isCalendarDate(iso) ? iso : null;
  }
  function civil(value) {
    return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
  }
  function instantParts(value) {
    const instant = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(instant.getTime())) return null;
    return Object.fromEntries(partsFormatter.formatToParts(instant).map(p => [p.type, p.value]));
  }
  function inspect(value) {
    if (value instanceof Date) return instantParts(value);
    if (typeof value !== 'string') return null;
    if (isCalendarDate(value)) return {civil: value};
    const m = isoStamp.exec(value);
    if (!m || !isCalendarDate(m[1]) || +m[2] > 23 || +m[3] > 59 || +(m[4] || 0) > 59) return null;
    if (!m[6]) return {civil: m[1], hour: m[2], minute: m[3], second: m[4] || '00'};
    if (m[6] !== 'Z') {
      const hours = +m[6].slice(1, 3), minutes = +m[6].slice(4);
      if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null;
    }
    // Explicit offset = instant; no offset = a Mexico civil time, never host time.
    return instantParts(`${m[1]}T${m[2]}:${m[3]}:${m[4] || '00'}${m[5] ? '.' + m[5].slice(0, 3) : ''}${m[6]}`);
  }
  function format(value, withTime) {
    const p = inspect(value);
    if (!p) return value == null ? '' : String(value);
    const day = p.civil ? civil(p.civil) : `${p.day}/${p.month}/${p.year.padStart(4, '0')}`;
    return day + (withTime && p.hour != null ? ` ${p.hour}:${p.minute}` : '');
  }
  const date = value => format(value, false);
  const datetime = value => format(value, true);
  function formatText(value) {
    // Conservative token boundaries exclude SKUs, filenames, URLs, JSON keys,
    // slash paths, and glued identifiers. Only displayed text nodes are visited.
    return value.replace(/(^|[\s([¿¡])((?:\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?)(?=$|[\s,;!?)\]]|\.(?:\s|$))/g,
      (match, prefix, token, offset, text) => {
        // Do not partially convert malformed timestamps or dates used as keys.
        const rest = text.slice(offset + match.length);
        if (/^\s*:/.test(rest) || /^\s+\d{2}:/.test(rest)) return match;
        return prefix + (isoDate.test(token) ? date(token) : datetime(token));
      });
  }
  function dayNumber(value) {
    const d = new Date(0);
    d.setUTCFullYear(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10));
    return d.getTime() / 86400000;
  }
  function validate(value, constraints = {}) {
    if (!value.trim()) return constraints.required ? {iso: null, error: 'Captura una fecha en dd/mm/aaaa.'} : {iso: '', error: ''};
    const iso = parse(value);
    if (!iso) return {iso: null, error: 'Fecha inválida. Usa dd/mm/aaaa y una fecha que exista.'};
    if (isCalendarDate(constraints.min) && iso < constraints.min) return {iso: null, error: `La fecha mínima es ${date(constraints.min)}.`};
    if (isCalendarDate(constraints.max) && iso > constraints.max) return {iso: null, error: `La fecha máxima es ${date(constraints.max)}.`};
    const step = constraints.step === 'any' ? 0 : Number(constraints.step || 1);
    const base = isCalendarDate(constraints.min) ? constraints.min :
      isCalendarDate(constraints.base) ? constraints.base : '1970-01-01';
    if (step > 0 && Math.abs((dayNumber(iso) - dayNumber(base)) / step - Math.round((dayNumber(iso) - dayNumber(base)) / step)) > 1e-7) {
      return {iso: null, error: 'La fecha no coincide con los días permitidos por este campo.'};
    }
    return {iso, error: ''};
  }

  const document = window.document;
  const controls = new WeakMap();
  const roots = new Map();
  const excluded = 'script,style,textarea,code,pre,option,select,[contenteditable],[data-erp-date-skip],[data-identifier],[data-filepath],.identifier,.identifiers,.sku,.code,.filepath,.file-path';
  const skip = `${excluded},input,.erp-date-control`;
  const api = {date, datetime, parse, isCalendarDate, validate, formatText, timeZone: zone, refresh, observe};
  window.ERPDate = api;
  if (!document) return;

  function decorate(native) {
    if (controls.has(native)) { controls.get(native).sync(); return; }
    if (native.closest(excluded)) return;
    const wrapper = document.createElement('span');
    wrapper.className = 'erp-date-control';
    const proxy = document.createElement('input');
    proxy.type = 'text';
    proxy.className = 'erp-date-proxy';
    proxy.placeholder = 'dd/mm/aaaa';
    proxy.inputMode = 'numeric';
    proxy.autocomplete = 'off';
    proxy.setAttribute('aria-label', `${native.getAttribute('aria-label') || Array.from(native.labels || []).map(l => l.textContent.trim()).join(' ') || 'Fecha'} (dd/mm/aaaa)`);
    const description = native.getAttribute('aria-describedby');
    if (description) proxy.setAttribute('aria-describedby', description);
    const icon = document.createElement('span');
    icon.className = 'erp-date-calendar';
    // Static vector only; never interpolate document data into markup.
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/></svg>';
    icon.setAttribute('aria-hidden', 'true');
    native.before(wrapper);
    wrapper.append(proxy, icon, native);
    let dirty = false;
    const constraints = () => ({required: native.required, min: native.min, max: native.max, step: native.step, base: native.defaultValue});
    function validity() {
      const result = validate(proxy.value, constraints());
      proxy.setCustomValidity(result.error);
      proxy.setAttribute('aria-invalid', result.error ? 'true' : 'false');
      return result;
    }
    function sync() {
      proxy.disabled = native.disabled;
      proxy.readOnly = native.readOnly;
      proxy.required = native.required;
      if (!dirty) {
        const visible = date(native.value);
        if (proxy.value !== visible) proxy.value = visible;
      }
      validity();
    }
    function commit() {
      if (!dirty || native.disabled || native.readOnly) return;
      const result = validity();
      if (result.error) return;
      dirty = false;
      if (native.value === result.iso) return;
      native.value = result.iso;
      native.dispatchEvent(new window.Event('input', {bubbles: true}));
      native.dispatchEvent(new window.Event('change', {bubbles: true}));
    }
    controls.set(native, {sync});
    proxy.addEventListener('focus', sync);
    proxy.addEventListener('input', event => {
      event.stopPropagation();
      dirty = true;
      validity();
    });
    proxy.addEventListener('change', event => { event.stopPropagation(); commit(); });
    proxy.addEventListener('blur', commit);
    proxy.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        // Keep a failing draft out of existing form/delegated keyboard handlers.
        commit();
        if (!proxy.checkValidity()) { event.preventDefault(); event.stopPropagation(); proxy.reportValidity(); }
      }
    });
    for (const name of ['input', 'change']) native.addEventListener(name, () => {
      // Synthetic background updates may not erase a person's unfinished draft.
      // A real calendar selection is an explicit replacement of that draft.
      // Proxy commits already cleared dirty before dispatching these events.
      sync();
    });
    native.addEventListener('change', event => { if (event.isTrusted) { dirty = false; sync(); } });
    native.addEventListener('invalid', event => {
      event.preventDefault();
      proxy.setCustomValidity(native.validationMessage || 'Revisa la fecha.');
      proxy.focus();
      proxy.reportValidity();
    });
    native.form?.addEventListener('reset', event => window.setTimeout(() => {
      if (!event.defaultPrevented) { dirty = false; sync(); }
    }, 0));
    sync();
  }
  function refresh(root = document.body) {
    if (!root) return;
    if (root.nodeType === 3) {
      if (root.parentElement && !root.parentElement.closest(skip)) {
        const next = formatText(root.nodeValue);
        if (next !== root.nodeValue) root.nodeValue = next;
      }
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1 && root.closest(skip)) {
      if (root.matches('input[type="date"]')) controls.has(root) ? controls.get(root).sync() : decorate(root);
      return;
    }
    if (root.matches?.('input[type="date"]')) decorate(root);
    root.querySelectorAll('input[type="date"]').forEach(decorate);
    const walker = document.createTreeWalker(root, 4); // SHOW_TEXT only; never attributes.
    let node;
    while ((node = walker.nextNode())) refresh(node);
  }
  function observe(root = document.body) {
    if (!root || roots.has(root)) return;
    refresh(root);
    const observer = new window.MutationObserver(records => {
      const pending = new Set();
      for (const record of records) {
        if (record.type === 'characterData') pending.add(record.target);
        else if (record.type === 'attributes') {
          if (record.target.matches('input[type="date"]')) pending.add(record.target);
        } else for (const node of record.addedNodes) pending.add(node);
      }
      for (const node of pending) if (root.contains(node)) refresh(node);
      updateClocks(root);
    });
    observer.observe(root, {subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['value', 'min', 'max', 'step', 'required', 'disabled', 'readonly']});
    roots.set(root, observer);
    updateClocks(root);
  }
  function updateClocks(root) {
    const nodes = [...root.querySelectorAll('[data-erp-clock]')];
    if (root.matches?.('[data-erp-clock]')) nodes.unshift(root);
    const now = new Date();
    for (const clock of nodes) {
      if (clock.closest(`${excluded},input`)) continue;
      const mode = clock.getAttribute('data-erp-clock');
      const value = mode === 'date' ? date(now) : mode === 'time' ? datetime(now).slice(-5) : datetime(now);
      // A clock is a dedicated text slot; do not replace dashboard child markup.
      if (!clock.children.length && clock.textContent !== value) clock.textContent = value;
    }
  }
  function start() {
    observe(document.body);
    // One timer regardless of how many dashboard clocks or observed roots exist.
    window.setInterval(() => { for (const root of roots.keys()) updateClocks(root); }, 60000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
  else start();
})(window);
