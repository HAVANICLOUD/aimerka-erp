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
  function safeLogoUrl(value) {
    if(typeof value!=='string')return '';
    const url=value.trim();if(!url)return '';
    if(url.startsWith('data:')){
      const match=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
      if(!match||match[2].length%4||match[2].length>4*Math.ceil(128*1024/3))return '';
      try{
        const binary=atob(match[2]),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));if(bytes.length>128*1024)return '';
        const png=bytes.length>=33&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b)&&String.fromCharCode(...bytes.slice(12,16))==='IHDR';
        const jpeg=bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217;
        return (match[1]==='png'?png:jpeg)?url:'';
      }catch{return '';}
    }
    if(url.length>2048||/[\s\\\u0000-\u001f\u007f]/.test(url))return '';
    if(/^\/erp\/[A-Za-z0-9_./-]+$/.test(url)&&!url.includes('..'))return url;
    if(/^\/api\/documents\/[a-f0-9]{64}\?workspace=v43$/.test(url))return url;
    try{const parsed=new URL(url);return parsed.protocol==='https:'&&url.startsWith('https://')&&parsed.hostname&&!parsed.username&&!parsed.password?url:'';}catch{return '';}
  }
  function get(name,source=typeof state==='undefined'?{}:state) {
    const canonical=Object.hasOwn(aliases,name)?aliases[name]:name;
    const base=Object.hasOwn(brands,canonical)?brands[canonical]:{key:'other',color:'#64748b',tint:'#f1f5f9',initials:String(name||'?').slice(0,2).toUpperCase(),image:null};
    const rows=source?.config?.workspacePresentation?.marketplaces||{};
    const custom=Object.hasOwn(rows,name)?rows[name]:Object.hasOwn(rows,canonical)?rows[canonical]:{};
    const color=/^#[a-f0-9]{6}$/i.test(custom?.color||'')?custom.color:base.color;
    const tint=color===base.color?base.tint:color+'12';
    return {...base,color,tint,logoUrl:safeLogoUrl(custom?.logoUrl),fallbackLogoUrl:base.image?'/erp/assets/marketplaces/'+base.image:''};
  }
  function logo(name,size='sm') {
    const b=get(name),className=['sm','lg'].includes(size)?size:'sm';
    const src=b.logoUrl||b.fallbackLogoUrl;
    return `<span class="market-logo market-logo-${className} market-logo-${b.key}" style="--market-color:${b.color};--market-tint:${b.tint}" aria-hidden="true">${src?`<img src="${esc(src)}" alt="" width="32" height="32" decoding="async" referrerpolicy="no-referrer" data-market-image${b.logoUrl&&b.fallbackLogoUrl?` data-market-fallback="${esc(b.fallbackLogoUrl)}"`:''}><span class="market-initials" hidden>${esc(b.initials)}</span>`:`<span class="market-initials">${esc(b.initials)}</span>`}</span>`;
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
  function overview(orders,selectedStats) {
    return `<section class="channel-overview" aria-labelledby="channel-overview-title"><div class="channel-overview-head"><div><h2 id="channel-overview-title">Tus marketplaces</h2><p>${selectedStats?'Venta bruta activa y pedidos activos del periodo seleccionado':'Acceso directo al historial de cada canal'}</p></div><button class="btn text" type="button" data-view="integrations">Ver integraciones ${icon('arrow')}</button></div><div class="channel-cards">${markets.map(name=>{const row=selectedStats?.markets?.find(row=>row.market===name),count=selectedStats?(row?.activeCount||0):orders.filter(o=>o.market===name).length,b=get(name),amount=selectedStats?money(row?.activeGrossCents||0):'';return `<button type="button" class="channel-card" data-ui-channel="${esc(name)}" style="--market-color:${b.color};--market-tint:${b.tint}" aria-label="Ver historial de ${esc(name)}, ${count} pedidos${selectedStats?', venta activa '+esc(amount)+' MXN en el periodo seleccionado':''}"><span class="channel-card-head">${logo(name,'lg')}<strong>${esc(name)}</strong></span><span class="channel-card-total">${selectedStats?`${esc(amount)}<small>MXN · venta activa</small>`:`${count}<small>pedidos</small>`}</span>${selectedStats?`<span class="channel-card-period-count">${count} ${count===1?'pedido activo':'pedidos activos'}</span>`:''}<span class="channel-card-meta">Ver historial completo ${icon('arrow')}</span></button>`;}).join('')}</div></section>`;
  }
  return {get,logo,tag,chips,overview,safeLogoUrl};
})();
window.MarketUI=MarketUI;
marketTag=MarketUI.tag;
// Legacy modules that still consume the color map also read the latest shared settings.
for(const name of markets)Object.defineProperty(marketColors,name,{configurable:true,enumerable:true,get:()=>MarketUI.get(name).color});
document.addEventListener('error',event=>{
  const img=event.target;
  if(img instanceof HTMLImageElement && img.hasAttribute('data-market-image')){
    const builtin=img.getAttribute('data-market-fallback');
    if(builtin){img.removeAttribute('data-market-fallback');img.src=builtin;return;}
    img.hidden=true;
    const fallback=img.nextElementSibling;if(fallback)fallback.hidden=false;
  }
},true);
