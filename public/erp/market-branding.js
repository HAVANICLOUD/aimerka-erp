'use strict';

// Presentation only. Channel names and business rules remain owned by V28.
const MarketUI = (() => {
  const brands = {
    'Liverpool': {key:'liverpool', color:'#e10098', tint:'#fdf0f8', initials:'L', image:'liverpool.png'},
    'Sears': {key:'sears', color:'#cf2334', tint:'#fff1f3', initials:'S', image:'sears.png'},
    'Sanborns': {key:'sanborns', color:'#e52230', tint:'#fff1f2', initials:'S', image:'sanborns.jpg'},
    'Coppel': {key:'coppel', color:'#006db5', tint:'#fff9db', initials:'C', image:'coppel.png'},
    'Elektra': {key:'elektra', color:'#db1532', tint:'#fff4d9', initials:'E', image:'elektra.png'},
    'Tienda Nube': {key:'tiendanube', color:'#0050c3', tint:'#eef5ff', initials:'TN', image:'tiendanube.png'},
    'Mercado Libre': {key:'mercadolibre', color:'#c0a000', tint:'#fffbdc', initials:'ML', image:'mercadolibre.svg'},
    'T1 Comercios': {key:'t1', color:'#6534df', tint:'#f4efff', initials:'T1', image:null}
  };
  const aliases = {'Tiendanube':'Tienda Nube','TiendaNube':'Tienda Nube','T1':'T1 Comercios'};
  function get(name) {
    return brands[aliases[name]||name] || {key:'other',color:'#64748b',tint:'#f1f5f9',initials:String(name||'?').slice(0,2).toUpperCase(),image:null};
  }
  function logo(name,size='sm') {
    const b=get(name),className=['sm','lg'].includes(size)?size:'sm';
    return `<span class="market-logo market-logo-${className} market-logo-${b.key}" style="--market-color:${b.color};--market-tint:${b.tint}" aria-hidden="true">${b.image?`<img src="/erp/assets/marketplaces/${b.image}" alt="" width="32" height="32" decoding="async" data-market-image><span class="market-initials" hidden>${esc(b.initials)}</span>`:`<span class="market-initials">${esc(b.initials)}</span>`}</span>`;
  }
  function tag(name) {
    if(!name)return '<span class="muted">Sin canal</span>';
    const b=get(name);
    return `<span class="market-tag" style="--market-color:${b.color};--market-tint:${b.tint}">${logo(name)}<span class="market-name">${esc(name)}</span></span>`;
  }
  function chips(current='',counts={}) {
    const all=Object.values(counts).reduce((sum,count)=>sum+count,0);
    return `<div class="market-filter-bar" role="group" aria-label="Filtrar pedidos por marketplace"><button class="market-chip ${!current?'active':''}" type="button" data-ui-market="" aria-pressed="${!current}">${icon('layers')}<span>Todos</span><small class="count">${all}</small></button>${markets.map(name=>`<button class="market-chip ${current===name?'active':''}" type="button" data-ui-market="${esc(name)}" aria-pressed="${current===name}" style="--market-color:${get(name).color};--market-tint:${get(name).tint}">${logo(name)}<span>${esc(name)}</span><small class="count">${counts[name]||0}</small></button>`).join('')}</div>`;
  }
  function overview(orders) {
    return `<section class="channel-overview" aria-labelledby="channel-overview-title"><div class="channel-overview-head"><div><h2 id="channel-overview-title">Tus marketplaces</h2><p>Acceso directo al historial de cada canal</p></div><button class="btn text" type="button" data-view="integrations">Ver integraciones ${icon('arrow')}</button></div><div class="channel-cards">${markets.map(name=>{const count=orders.filter(o=>o.market===name).length,b=get(name);return `<button type="button" class="channel-card" data-ui-channel="${esc(name)}" style="--market-color:${b.color};--market-tint:${b.tint}" aria-label="Ver historial de ${esc(name)}, ${count} pedidos"><span class="channel-card-head">${logo(name,'lg')}<strong>${esc(name)}</strong></span><span class="channel-card-total">${count}<small>pedidos</small></span><span class="channel-card-meta">Ver historial ${icon('arrow')}</span></button>`;}).join('')}</div></section>`;
  }
  return {get,logo,tag,chips,overview};
})();
window.MarketUI=MarketUI;
marketTag=MarketUI.tag;
for(const name of markets)marketColors[name]=MarketUI.get(name).color;
document.addEventListener('error',event=>{
  const img=event.target;
  if(img instanceof HTMLImageElement && img.hasAttribute('data-market-image')){
    img.hidden=true;
    const fallback=img.nextElementSibling;if(fallback)fallback.hidden=false;
  }
},true);
