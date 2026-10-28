/* V28 pricing screens. The earlier free calculator remains available as a tab. */
'use strict';
const price28LegacyPage = pricingPage;
const price28Tabs = [['calculadora','Calculadora V28'],['cotizador','Cotizador'],['recomendador','Precios por UPC'],['comparar','Comparar canales'],['libre','Escenario libre']];
let price28Tab = 'calculadora';
let price28SettingsTab = 'parameters';
let price28CommissionChannel = 'Liverpool';
let price28ConfigQuery = '';
let price28ConfigDrafts = {};
let price28Busy = false;
let price28ModalData = null;
const price28Forms = {
  calculadora:{name:'',cost:'8434',marketPrice:'12799',channel:'T1 Comercios',category:'Todas las categorías',shippingType:'Mediano',manualShipping:'',mode:'tasas',margin:'10',inflation:'20',manualDiscount:'',manualRegular:'',mlType:'CLASICA',msi:'Sin MSI',alternateMarketPrice:'',productKey:'',zeroMarginInflation:'0',competitiveInflation:'10'},
  cotizador:{name:'',cost:'',marketPrice:'',channel:'T1 Comercios',category:'Todas las categorías',shippingType:'Pequeño',manualShipping:'',mode:'tasas',margin:'10',inflation:'10',manualDiscount:'',manualRegular:'',mlType:'CLASICA',msi:'Sin MSI',alternateMarketPrice:'',productKey:'',zeroMarginInflation:'0',competitiveInflation:'10'},
  recomendador:{name:'',channel:'T1 Comercios',shippingType:'Automático',manualShipping:'',mode:'automatico',margin:'10',inflation:'10',manualDiscount:'',manualRegular:'',mlType:'CLASICA',msi:'Sin MSI',alternateMarketPrice:'',productKey:'',zeroMarginInflation:'0',competitiveInflation:'10'},
  comparar:{name:'',channel:'T1 Comercios',shippingType:'Automático',manualShipping:'',mode:'automatico',margin:'10',inflation:'10',manualDiscount:'',manualRegular:'',mlType:'CLASICA',msi:'Sin MSI',alternateMarketPrice:'',productKey:'',zeroMarginInflation:'0',competitiveInflation:'10'}
};

function price28Engine(){return window.ERP?.engines?.pricing;}
function price28Config(){return state.config || {};}
function price28Mxn(value){return value===null||value===undefined?'—':money(Number(value)*100);}
function price28Timestamp(value){
  const source=String(value??'');
  // A civil date has no timezone and must never move to the previous day.
  if(!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(source))return source;
  const instant=new Date(source);if(!Number.isFinite(instant.getTime()))return source;
  return new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(instant);
}
function price28Pct(value){return value===null||value===undefined?'—':`${new Intl.NumberFormat('es-MX',{maximumFractionDigits:3}).format(Number(value)*100)}%`;}
function price28Text(value){return String(value??'').trim();}
function price28PercentInput(value){return Number.isFinite(Number(value))?String(Number((Number(value)*100).toFixed(8))):'';}
function price28Products(){return state.products||[];}
function price28FindProduct(value){return price28Products().find(p=>String(p.upc||'')===String(value)||String(p.sku)===String(value));}
function price28Btn(text,action,extra='',primary=false){return `<button type="button" class="btn ${primary?'primary':''}" data-price28-action="${action}" ${extra}>${text}</button>`;}
function price28Field(name,label,value,options={}){
  const id=`price28-${name}`;
  return `<div class="field ${options.wide?'wide':''}"><label for="${id}">${esc(label)}</label><input id="${id}" data-price28-field="${name}" type="${options.type||'number'}" value="${esc(value??'')}" ${options.type==='text'?'':`step="${options.step||'any'}"`} ${options.min!==undefined?`min="${options.min}"`:''} ${options.max!==undefined?`max="${options.max}"`:''} ${options.placeholder?`placeholder="${esc(options.placeholder)}"`:''} ${options.readonly?'readonly':''}>${options.note?`<small>${esc(options.note)}</small>`:''}</div>`;
}
function price28Select(name,label,value,values,options={}){
  const id=`price28-${name}`;
  return `<div class="field ${options.wide?'wide':''}"><label for="${id}">${esc(label)}</label><select id="${id}" data-price28-field="${name}" ${options.disabled?'disabled':''}>${values.map(item=>{const [val,title]=Array.isArray(item)?item:[item,item];return `<option value="${esc(val)}" ${String(val)===String(value)?'selected':''}>${esc(title)}</option>`;}).join('')}</select>${options.note?`<small>${esc(options.note)}</small>`:''}</div>`;
}
function price28Styles(){return `<style>
  .price28-results .badge{white-space:normal;line-height:1.6}.price28-grid{display:grid;grid-template-columns:minmax(320px,.95fr) minmax(360px,1.15fr);gap:20px;align-items:start}.price28-pills{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.price28-pills button{border:1px solid #dfe6f1;background:#f4f7fc;color:#476083;border-radius:5px;font-size:10px;padding:5px 8px}.price28-pills button.active{background:#e9efff;border-color:#aac0ff;color:#174dce}.price28-info{padding:13px;border:1px solid #e5ebf5;border-radius:7px;margin:0 0 16px;line-height:1.6;color:#637797;font-size:11px}.price28-info strong{display:block;color:#344968}.price28-error{padding:14px;border-radius:7px;background:#fff5e7;color:#99682b;font-size:12px;line-height:1.7}.price28-error ul{padding-left:19px;margin:4px 0}.price28-result-table td,.price28-result-table th{padding:10px 13px;white-space:normal}.price28-result-table th:first-child{width:46%}.price28-result-table td:not(:first-child),.price28-result-table th:not(:first-child){text-align:right;white-space:nowrap}.price28-success{color:#1d8a65}.price28-negative{color:#bb4855}.price28-note{color:#7d8ea7;font-size:10px;line-height:1.7;margin-top:12px}.price28-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:18px}.price28-setting-table td{padding:10px 13px}.price28-setting-table input,.price28-setting-table select{border:1px solid #dfe6f1;border-radius:5px;padding:8px;font-size:11px;max-width:140px;min-width:80px;width:100%;color:#405677;background:#fff}.price28-setting-table input[type=checkbox]{width:auto;min-width:0}.price28-setting-table td:first-child{white-space:normal;max-width:250px}.price28-setting-table .price28-name-input{min-width:180px;max-width:240px}.price28-setting-table .price28-long-input{min-width:230px;max-width:360px}.price28-table-title{font-weight:600;color:#385274}.price28-settings-footer{padding:14px 20px;background:#fbfcff;border-top:1px solid #edf1f7;display:flex;justify-content:space-between;gap:15px;align-items:center;flex-wrap:wrap}.price28-modal{max-height:75vh;overflow:auto}.price28-modal .form-grid{margin-top:18px}.price28-subtabs{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px}.price28-subtabs .btn.active{background:#eef3ff;border-color:#aebfff;color:#2155cf}.price28-config-search{max-width:380px}.price28-amount-group{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}.price28-amount-group div{padding:16px;background:#f3f6fc;border-radius:8px}.price28-amount-group small{font-size:10px;color:#7f90aa;display:block}.price28-amount-group strong{font-size:21px;display:block;color:#314968}.price28-save-name{max-width:280px}.price28-breakdown h3{margin:0 0 12px}.price28-fields-disabled input{background:#f5f7fc;color:#7f8da3}.price28-compare-table td{white-space:normal;min-width:110px}.price28-compare-table td:first-child{min-width:170px}.price28-scroll-list{max-height:520px;overflow:auto}.price28-card-gap{margin-top:18px}.price28-quote-results .panel-body{padding-top:0}.price28-chip{background:#f2f5fb;border:1px solid #dfe7f4;padding:5px 9px;border-radius:5px;color:#5a7296;font-size:10px}.price28-source-line{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.price28-status{padding:12px 14px;background:#eef4ff;color:#3c5f9a;border:1px solid #dbe6fc;border-radius:7px;font-size:12px;line-height:1.6;margin-bottom:16px}.price28-status.warn{background:#fff7e8;color:#926329;border-color:#f3e1c5}.price28-status.danger{background:#fff0f0;color:#ae4551;border-color:#f0d2d7}.price28-settings-title{font-size:13px;color:#3b5171}.price28-config-empty{padding:25px;color:#8493aa;font-size:11px}
  @media(max-width:1150px){.price28-grid{grid-template-columns:1fr}.price28-results{min-width:0}}@media(max-width:740px){.price28-amount-group strong{font-size:18px}.price28-result-table td,.price28-result-table th{padding:9px 8px;font-size:10px}.price28-settings-footer{padding:12px}.price28-amount-group{gap:8px}.price28-setting-table input{max-width:115px}.price28-grid{display:block}.price28-results{margin-top:18px}}
  </style>`;}

function price28Input(){
  const f=price28Forms[price28Tab]||price28Forms.calculadora;
  const n=(value,fallback=null)=>value===''||value===undefined||value===null?fallback:Number(value);
  return {name:f.name,context:price28Tab==='calculadora'?'calculadora':price28Tab==='cotizador'?'cotizador':'recomendador',cost:n(f.cost),marketPrice:n(f.marketPrice,0),channel:f.channel,category:f.category,
    shippingType:f.shippingType,manualShipping:n(f.manualShipping),mode:f.mode,margin:n(f.margin,0)/100,inflation:n(f.mode==='competitivo'&&!['recomendador','comparar'].includes(price28Tab)?f.competitiveInflation:f.inflation,0)/100,
    manualDiscount:n(f.manualDiscount),manualRegular:n(f.manualRegular),mlType:f.mlType,msi:f.msi,alternateMarketPrice:n(f.alternateMarketPrice),zeroMarginInflation:n(f.zeroMarginInflation,0)/100,competitiveInflation:n(f.competitiveInflation,10)/100};
}
function price28Calculate(){
  const engine=price28Engine(); if(!engine)return null;
  const input=price28Input(),config=price28Config(),form=price28Forms[price28Tab];
  if(['recomendador','comparar'].includes(price28Tab)){
    const p=price28FindProduct(form.productKey);
    if(!p)return {valid:false,errors:[{message:'Selecciona un producto por su UPC o SKU para calcular.'}],discount:null};
    return price28Tab==='comparar'?engine.compareChannels(config,p,input):engine.recommend(config,p,input);
  }
  return engine.quote(config,input);
}
function price28RateButtons(field,value){return `<div class="price28-pills" aria-label="Porcentajes rápidos de ${field==='margin'?'utilidad':'inflado'}">${[0,5,10,15,20,25,30].map(n=>`<button type="button" data-price28-rate="${field}" data-price28-value="${n}" class="${Number(value)===n?'active':''}">${n}%</button>`).join('')}</div>`;}
function price28Form(){
  const f=price28Forms[price28Tab],engine=price28Engine(),config=price28Config(),isProduct=['recomendador','comparar'].includes(price28Tab);
  if(isProduct&&!f.productKey&&price28Products().length)f.productKey=String(price28Products()[0].upc||price28Products()[0].sku);
  const p=isProduct?price28FindProduct(f.productKey):null;
  const categories=engine.listCategories(config,f.channel);
  if(!isProduct&&!categories.some(c=>c===f.category))f.category=categories[0]||'';
  const modes=isProduct?[['automatico','Automático · utilidad e inflado vinculados'],['manual_tasas','Manual por tasas'],['manual_precios','Manual por precios'],['competitivo','Precio competitivo']]:[['tasas','Calcular por utilidad'],['precios','Precios manuales'],['competitivo','Precio competitivo']];
  const manual=['precios','manual_precios'].includes(f.mode),competitive=f.mode==='competitivo';
  const rateMin=price28Tab==='cotizador'?0:-50;
  const modeNote=isProduct?'Automático vincula el inflado al margen elegido. En 0% puedes ajustar el inflado por separado.':'Los precios automáticos terminan en 99 y buscan el margen más cercano sin pérdida.';
  return `<section class="panel"><div class="panel-head"><div><h2>${isProduct?'Producto y reglas de cálculo':price28Tab==='cotizador'?'Evaluar una compra':'Captura de datos V28'}</h2><div class="panel-sub">${isProduct?'El costo y las categorías provienen del catálogo.':'Importes MXN. Tasas configuradas en el ERP.'}</div></div>${badge('V28','blue')}</div><div class="panel-body"><form id="price28-form"><div class="form-grid">
    ${isProduct?`<div class="field wide"><label for="price28-productKey">UPC / EAN / SKU</label><input id="price28-productKey" data-price28-field="productKey" type="text" value="${esc(f.productKey)}" list="price28-products" autocomplete="off" placeholder="Busca un UPC completo o SKU"><datalist id="price28-products">${price28Products().map(p=>`<option value="${esc(p.upc||p.sku)}">${esc(p.name)} · ${esc(p.sku)}</option>`).join('')}</datalist></div>`:price28Field('name',price28Tab==='cotizador'?'Nombre del producto (opcional)':'Nombre del escenario (opcional)',f.name,{type:'text',wide:true})}
    ${isProduct?`<div class="field wide price28-info" id="price28-product-info"><strong>${esc(p?.name||'Producto pendiente de seleccionar')}</strong>${p?`${esc(p.sku)} · ${esc(p.category)}<br>Costo promedio ${price28Mxn(p.averageCostMxn??p.costCents/100)} · Mercado ${money(p.priceCents)}`:'Elige una opción del catálogo para recuperar costo, precio y categorías.'}</div>`:price28Field('cost','Costo de compra / promedio ($)',f.cost,{min:0})}
    ${!isProduct?price28Field('marketPrice','Precio de mercado ($)',f.marketPrice,{min:0}):price28Field('alternateMarketPrice','Mercado alternativo opcional ($)',f.alternateMarketPrice,{min:0,note:'Vacío conserva el mercado del catálogo.'})}
    ${price28Tab!=='comparar'?price28Select('channel','Marketplace',f.channel,engine.CHANNELS):'<div class="field"><label>Comparación</label><div class="price28-info">Se calculan los seis canales configurados. T1 agrupa Sears y Sanborns.</div></div>'}
    ${!isProduct?price28Select('category','Categoría del marketplace',f.category,categories,{wide:true}):price28Tab!=='comparar'?`<div class="field"><label>Categoría para comisión</label><div class="price28-info">${esc(p?engine.resolveCategory(config,p,f.channel):'—')}</div></div>`:''}
    ${!isProduct&&f.name?`<div class="field wide">${price28Suggestion(f)}</div>`:''}
    ${f.channel==='Mercado Libre'||price28Tab==='comparar'?price28Select('mlType','Publicación Mercado Libre',f.mlType,[['CLASICA','Clásica'],['PREMIUM','Premium']]):''}
    ${f.channel==='Elektra'||price28Tab==='comparar'?price28Select('msi','MSI Elektra',f.msi,(config.elektraMsi||[]).map(r=>r.label)):''}
    ${price28Select('shippingType','Tipo de envío',f.shippingType,isProduct?['Automático','Pequeño','Mediano','Grande']:['Pequeño','Mediano','Grande'])}
    ${price28Field('manualShipping','Tarifa de envío manual opcional ($)',f.manualShipping,{min:0,note:'Vacío usa tarifa automática; 0 significa envío de $0.'})}
    ${price28Select('mode','Forma de calcular',f.mode,modes,{wide:true,note:modeNote})}
    ${manual?`${price28Field('manualDiscount','Precio con descuento manual ($)',f.manualDiscount,{min:0})}${price28Field('manualRegular','Precio regular manual opcional ($)',f.manualRegular,{min:0,note:'Vacío genera el regular con el inflado elegido.'})}`:''}
    ${!competitive&&!manual?`<div class="field"><label for="price28-margin">${isProduct?'Utilidad objetivo sobre venta (%)':'Utilidad esperada sobre venta (%)'}</label><input id="price28-margin" data-price28-field="margin" type="number" step="0.1" min="${rateMin}" max="${price28Tab==='cotizador'?30:50}" value="${esc(f.margin)}">${price28RateButtons('margin',f.margin)}</div>`:''}
    ${competitive?`${price28Field('competitiveInflation','Inflado del precio competitivo (%)',f.competitiveInflation,{min:0,max:30})}<div class="field"><label>Condición</label><div class="price28-info">${isProduct?`Utilidad positiva y tolerancia máxima ${price28Pct(config.parameters?.competitiveTolerance)} sobre mercado.`:'Utilidad positiva y precio con descuento dentro del mercado.'}</div></div>`:isProduct&&f.mode==='automatico'&&Number(f.margin)!==0?`<div class="field"><label>Inflado del precio regular</label><div class="price28-info">${esc(f.margin)}%, vinculado a la utilidad seleccionada.</div></div>`:isProduct&&Number(f.margin)===0&&!manual?price28Field('zeroMarginInflation','Inflado con utilidad 0% (%)',f.zeroMarginInflation,{min:0,max:30}):`<div class="field"><label for="price28-inflation">Inflado del precio regular (%)</label><input id="price28-inflation" data-price28-field="inflation" type="number" step="0.1" min="0" max="${price28Tab==='cotizador'?30:50}" value="${esc(f.inflation)}">${price28RateButtons('inflation',f.inflation)}</div>`}
    </div><div class="price28-actions">${price28Btn(`${icon('calculator')} Calcular`,'calculate','',true)}${price28Btn('Limpiar captura','clear')}</div></form></div></section>`;
}
function price28Suggestion(f){
  const suggestion=price28Engine().suggestCategory(price28Config(),f.name,f.channel,price28Products());
  return suggestion?`<div class="price28-info">Sugerencia: <strong>${esc(suggestion)}</strong>${price28Btn('Usar sugerencia','suggestion',`data-price28-category="${esc(suggestion)}"`)}</div>`:'<div class="tiny">Sin sugerencia de categoría para este nombre. Selecciona la categoría del marketplace.</div>';
}
function price28ResultTable(r){
  const row=(label,key,format=price28Mxn,strong=false)=>`<tr><td>${label}</td><td class="${strong?'price28-table-title':''}">${format(r.discount?.[key])}</td><td class="${strong?'price28-table-title':''}">${format(r.regular?.[key])}</td></tr>`;
  return `<div class="table-wrap"><table class="price28-result-table"><thead><tr><th>Desglose V28</th><th>Con descuento</th><th>Regular</th></tr></thead><tbody>${row('Precio de venta','price',price28Mxn,true)}${row('Costo del producto','cost')}${row('Envío aplicado','shipping')}${row(`Comisión (${price28Pct(r.commissionRate)})`,'commission')}${row(`Retención IVA (${price28Pct(r.vatRate)})`,'vat')}${row(`Retención ISR (${price28Pct(r.isrRate)})`,'isr')}${row('Pago neto del marketplace','netPayout',price28Mxn,true)}${row('Utilidad estimada según V28','profit',price28Mxn,true)}${row('Margen sobre precio','margin',price28Pct)}${row('Utilidad objetivo sobre venta','targetProfit')}${row('Diferencia vs. objetivo sobre venta','targetDifference')}${r.context==='calculadora'?row('Diferencia vs. esperada sobre costo + envío (B53 / D53)','costBasedTargetDifference'):''}</tbody></table></div>`;
}
function price28Result(r){
  if(!r)return '<div class="empty">Cargando motor de cálculo…</div>';
  if(!r.valid)return `<div class="price28-error"><strong>Revisa estos datos</strong><ul>${(r.errors||[]).map(e=>`<li>${esc(e.message)}</li>`).join('')}</ul></div>`;
  const tone=/PÉRDIDA/.test(r.status)?'danger':/REVISAR|SUPERA|NO SE PUEDE|NO COMPITE|FALTA/.test(r.status)?'warn':'';
  return `<div class="price28-status ${tone}">${esc(r.status)}</div>${r.discount?`<div class="price28-amount-group"><div><small>Precio con descuento</small><strong>${price28Mxn(r.discount.price)}</strong></div><div><small>Precio regular</small><strong>${price28Mxn(r.regular?.price)}</strong></div></div>${price28ResultTable(r)}`:'<div class="empty"><h3>No hay un precio válido en este escenario.</h3><p>Revisa costo, mercado, comisiones o margen.</p></div>'}
    <div class="price28-source-line"><span class="price28-chip">${esc(r.category)}</span><span class="price28-chip">${esc(r.shippingDetails?.type)} · ${price28Mxn(r.shipping)}</span>${r.msiRate?`<span class="price28-chip">MSI incluido ${price28Pct(r.msiRate)}</span>`:''}</div>
    <p class="price28-note">El pago neto todavía no descuenta el costo del producto. La utilidad V28 ya descuenta las retenciones de su fórmula. Estas tasas son las configuradas en el libro y el ERP.</p>
    ${(r.warnings||[]).map(w=>`<div class="price28-error price28-card-gap">${esc(w)}</div>`).join('')}
    ${r.competitive?`<div class="price28-info price28-card-gap"><strong>Control de competitividad</strong>Mínimo rentable terminado en 99: ${price28Mxn(r.competitive.minimumProfitable)}<br>Máximo permitido: ${price28Mxn(r.competitive.maximumAllowed)} · tolerancia ${price28Pct(r.competitive.tolerance)}</div>`:''}
    ${r.transfer?price28Transfer(r.transfer):''}${r.mlComparison?price28ML(r.mlComparison):''}
    <div class="price28-actions">${price28Btn(`${icon('check')} Guardar escenario`,'save',`${!r.discount||price28Busy?'disabled':''}`,true)}${price28Btn(`${icon('download')} Exportar desglose`,'export',`${!r.discount?'disabled':''}`)}</div>`;
}
function price28Transfer(t){return `<section class="price28-breakdown price28-card-gap"><h3>Tienda Nube · transferencia bancaria</h3><div class="table-wrap"><table class="price28-result-table"><tbody>${[['Precio al cliente (−10%)',price28Mxn(t.price)],['Comisión transferencia (0.6%)',price28Mxn(t.commission)],['Utilidad final',price28Mxn(t.profit)],['Margen final',price28Pct(t.margin)],['Diferencia vs. utilidad normal',price28Mxn(t.differenceVsNormal)],['Objetivo de comparación',price28Mxn(t.comparisonTarget)]].map(([l,v])=>`<tr><td>${l}</td><td>${v}</td></tr>`).join('')}</tbody></table></div><p class="price28-note">Base de comparación: ${esc(t.targetBasis)}. ${esc(t.decision)}.</p></section>`;}
function price28ML(m){return `<section class="price28-breakdown price28-card-gap"><h3>Mercado Libre · Clásica y Premium</h3><div class="table-wrap"><table class="price28-result-table"><thead><tr><th>Concepto</th><th>Clásica</th><th>Premium</th></tr></thead><tbody>${[['Comisión',r=>price28Pct(r.commissionRate)],['Descuento',r=>price28Mxn(r.discount?.price)],['Utilidad descuento',r=>price28Mxn(r.discount?.profit)],['Regular',r=>price28Mxn(r.regular?.price)],['Utilidad regular',r=>price28Mxn(r.regular?.profit)],['Pago neto descuento',r=>price28Mxn(r.discount?.netPayout)]].map(([l,fn])=>`<tr><td>${l}</td><td>${fn(m.classic)}</td><td>${fn(m.premium)}</td></tr>`).join('')}</tbody></table></div></section>`;}
function price28Compare(rows){
  if(!Array.isArray(rows))return price28Result(rows);
  return `<div class="panel-head"><div><h2>Resultados por canal</h2><div class="panel-sub">Cada canal usa su categoría y configuración.</div></div>${price28Btn(`${icon('download')} Exportar`,'export')}</div><div class="table-wrap"><table class="price28-compare-table"><thead><tr><th>Canal / categoría</th><th>Comisión</th><th>Descuento</th><th>Regular</th><th>Utilidad desc.</th><th>Pago neto</th><th>Decisión</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.channel)}</strong><span class="subtext">${esc(r.category)}</span></td><td>${price28Pct(r.commissionRate)}</td><td>${price28Mxn(r.discount?.price)}</td><td>${price28Mxn(r.regular?.price)}</td><td>${price28Mxn(r.discount?.profit)}</td><td>${price28Mxn(r.discount?.netPayout)}</td><td>${esc(r.valid?r.status:(r.errors||[]).map(e=>e.message).join(' '))}</td></tr>`).join('')}</tbody></table></div><div class="panel-body"><p class="price28-note">Liverpool conserva en las calculadoras el recargo incluido del catálogo. En conciliación se aplica el MSI real del pedido. Esta comparación no publica precios en marketplaces.</p></div>`;
}
function price28Saved(){
  const scenarios=state.pricingScenarios||[];
  return `<section class="panel price28-card-gap"><div class="panel-head"><div><h2>Escenarios V28 guardados</h2><div class="panel-sub">Conservan sus entradas y resultado. Los acuerdos futuros no cambian un escenario ya guardado.</div></div>${badge(String(scenarios.length),'slate')}</div><div class="table-wrap"><table><thead><tr><th>Escenario</th><th>Origen</th><th>Canal</th><th>Descuento</th><th>Utilidad</th><th></th></tr></thead><tbody>${scenarios.length?scenarios.slice(0,20).map((s,i)=>`<tr><td>${esc(s.name||'Escenario V28')}<span class="subtext">${esc(price28Timestamp(s.createdAt||s.date))}</span></td><td>${esc(s.context||s.input?.context||'V28')}</td><td>${esc(s.result?.channel||s.input?.channel||'')}</td><td>${price28Mxn(s.result?.discount?.price)}</td><td>${price28Mxn(s.result?.discount?.profit)}</td><td>${price28Btn('Ver','scenario',`data-price28-index="${i}"`)}</td></tr>`).join(''):'<tr><td colspan="6"><div class="empty">Guarda un cálculo para conservarlo en este espacio.</div></td></tr>'}</tbody></table></div></section>`;
}
function price28Page(){
  const tabs=`<div class="tabs">${price28Tabs.map(([id,label])=>`<button class="tab ${price28Tab===id?'active':''}" data-price28-tab="${id}">${label}</button>`).join('')}</div>`;
  if(price28Tab==='libre')return `${price28Styles()}${tabs}${price28LegacyPage()}`;
  if(!price28Engine()||!state.config)return `${price28Styles()}${tabs}<div class="empty">Cargando configuración V28…</div>`;
  const heading={calculadora:['Calculadora V28','Reproduce el cálculo de precios, deducciones y utilidad del Excel.'],cotizador:['Cotizador de compras','Evalúa un producto antes de comprarlo, con la categoría y comisión de cada canal.'],recomendador:['Precios por UPC','Consulta tu catálogo y compara precio automático, manual o competitivo.'],comparar:['Comparar canales','Evalúa un mismo producto con las condiciones de los seis canales configurados.']}[price28Tab];
  const form=price28Form(),result=price28Calculate();
  return `${price28Styles()}${pageHead('PRECIOS / MOTOR V28',heading[0],heading[1],price28Btn(`${icon('layers')} Configuración`,'configuration'))}${tabs}<div class="price28-grid">${form}<section class="panel price28-results" id="price28-result-panel">${price28Tab==='comparar'?`<div id="price28-results">${price28Compare(result)}</div>`:`<div class="panel-head"><h2>Resultado del cálculo</h2>${badge('Fórmulas V28','blue')}</div><div class="panel-body" id="price28-results">${price28Result(result)}</div>`}</section></div>${price28Saved()}`;
}
function price28RefreshResult(){const el=document.getElementById('price28-results');if(el){const r=price28Calculate();el.innerHTML=price28Tab==='comparar'?price28Compare(r):price28Result(r);}}

const price28SettingTabs=[['parameters','Parámetros'],['shipping','Envíos'],['shippingRules','Reglas de envío'],['commissions','Comisiones'],['mappings','Mapeo de categorías'],['elektraMsi','MSI Elektra'],['tnBands','Tramos Tienda Nube'],['tnGateways','Pasarelas Tienda Nube'],['settlement','Reglas de conciliación']];
function price28Draft(section){if(!Object.hasOwn(price28ConfigDrafts,section))price28ConfigDrafts[section]=JSON.parse(JSON.stringify(price28Config()[section]??([])));return price28ConfigDrafts[section];}
function price28ConfigInput(section,index,field,value,{percent=false,text=false,wide=false,readonly=false}={}){
  return `<input aria-label="${esc(field)} ${index===null?'':index+1}" data-price28-config="${section}" data-price28-row="${index===null?'':index}" data-price28-key="${field}" data-price28-percent="${percent?'1':'0'}" type="${text?'text':'number'}" ${text?'':'step="any" min="0"'} class="${wide?'price28-long-input':''}" value="${esc(percent?price28PercentInput(value):value??'')}" ${readonly?'readonly':''}>`;
}
function price28ConfigFooter(section,add=false){return `<div class="price28-settings-footer"><div class="tiny">Los cambios se aplican al guardar. Los pedidos liquidados y escenarios guardados conservan su historial.</div><div class="head-actions">${add?price28Btn('Agregar fila','config-add',`data-price28-section="${section}"`):''}${price28Btn('Descartar cambios','config-discard',`data-price28-section="${section}"`)}${price28Btn(`${icon('check')} Guardar cambios`,'config-save',`data-price28-section="${section}" ${price28Busy?'disabled':''}`,true)}</div></div>`;}
function price28ConfigTable(headers,rows){return `<div class="table-wrap price28-scroll-list"><table class="price28-setting-table"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td colspan="${headers.length}" class="price28-config-empty">No hay registros.</td></tr>`}</tbody></table></div>`;}
function price28SettingsContent(){
  const tab=price28SettingsTab,c=price28Config(),engine=price28Engine();
  if(tab==='parameters'){
    const p=price28Draft('parameters');
    return `<section class="panel"><div class="panel-head"><div><h2>Parámetros generales</h2><div class="panel-sub">Valores de trabajo del Excel, editables para este espacio.</div></div></div>${price28ConfigTable(['Parámetro','Valor','Uso'],[
      `<tr><td>Retención IVA</td><td>${price28ConfigInput(tab,null,'vatWithholding',p.vatWithholding,{percent:true})}%</td><td>Se aplica al precio, salvo Tienda Nube.</td></tr>`,
      `<tr><td>Retención ISR</td><td>${price28ConfigInput(tab,null,'incomeWithholding',p.incomeWithholding,{percent:true})}%</td><td>Se aplica al precio, salvo Tienda Nube.</td></tr>`,
      `<tr><td>Tolerancia competitiva</td><td>${price28ConfigInput(tab,null,'competitiveTolerance',p.competitiveTolerance,{percent:true})}%</td><td>Precio por UPC; el Cotizador exige quedar dentro del mercado.</td></tr>`,
      `<tr><td>Terminación del precio</td><td>${price28ConfigInput(tab,null,'priceEnding',p.priceEnding,{readonly:true})}</td><td>Las fórmulas V28 utilizan terminación 99.</td></tr>`])}${price28ConfigFooter(tab)}</section>`;
  }
  if(tab==='shipping'){
    const rows=price28Draft(tab);
    return `<section class="panel"><div class="panel-head"><div><h2>Tarifas de envío</h2><div class="panel-sub">La tarifa usada corresponde a la columna B del Excel.</div></div></div>${price28ConfigTable(['Tipo','Tarifa usada $','Tope $','Base auxiliar $'],rows.map((r,i)=>`<tr><td>${esc(r.type)}</td><td>${price28ConfigInput(tab,i,'min',r.min)}</td><td>${price28ConfigInput(tab,i,'max',r.max)}</td><td>${price28ConfigInput(tab,i,'base',r.base)}</td></tr>`))}${price28ConfigFooter(tab)}</section>`;
  }
  if(tab==='shippingRules'){
    const rows=price28Draft(tab);
    return `<section class="panel"><div class="panel-head"><div><h2>Detección del tipo de envío</h2><div class="panel-sub">Se usa la primera palabra coincidente, en el orden mostrado. Si no coincide, aplica el envío de la categoría.</div></div></div>${price28ConfigTable(['Orden','Texto en el nombre','Tipo','Criterio',''],rows.map((r,i)=>`<tr><td>${i+1}</td><td>${price28ConfigInput(tab,i,'keyword',r.keyword,{text:true})}</td><td><select aria-label="Envío regla ${i+1}" data-price28-config="${tab}" data-price28-row="${i}" data-price28-key="type">${['Pequeño','Mediano','Grande'].map(t=>`<option ${r.type===t?'selected':''}>${t}</option>`).join('')}</select></td><td>${price28ConfigInput(tab,i,'note',r.note,{text:true,wide:true})}</td><td>${price28Btn('Quitar','config-remove',`data-price28-section="${tab}" data-price28-index="${i}"`)}</td></tr>`))}${price28ConfigFooter(tab,true)}</section>`;
  }
  if(tab==='commissions'){
    const rows=(c.commissions?.[price28CommissionChannel]||[]).filter(r=>r.category.toLowerCase().includes(price28ConfigQuery.toLowerCase()));
    const included=c.settlement?.liverpoolIncludedMsi??.0355;
    return `<div class="filterbar"><select id="price28-commission-channel" aria-label="Canal de comisiones">${engine.CHANNELS.filter(c=>c!=='Tienda Nube').map(ch=>`<option ${ch===price28CommissionChannel?'selected':''}>${esc(ch)}</option>`).join('')}</select><label class="field-search price28-config-search">${icon('search')}<input id="price28-config-query" value="${esc(price28ConfigQuery)}" placeholder="Buscar categoría…" aria-label="Buscar categoría de comisión"></label>${price28Btn(`${icon('plus')} Nueva categoría`,'commission-new')}</div><section class="panel"><div class="panel-head"><div><h2>${esc(price28CommissionChannel)}</h2><div class="panel-sub">${price28CommissionChannel==='Liverpool'?`Base + ${price28Pct(included)} incluido en catálogo. Conciliación elige el MSI real.`:price28CommissionChannel==='T1 Comercios'?'La tasa general se aplica a todas las categorías T1, Sears y Sanborns.':'Categorías y tasas configuradas en V28.'}</div></div></div>${price28ConfigTable(['Categoría','Base / Clásica','Premium / MSI incluido','Tasa total',''],rows.map(r=>`<tr><td><strong>${esc(r.category)}</strong><span class="subtext">${esc(r.path||'')}</span></td><td>${price28Pct(price28CommissionChannel==='Liverpool'?r.rate-included:r.rate)}</td><td>${price28CommissionChannel==='Mercado Libre'?price28Pct(r.premiumRate):price28CommissionChannel==='Liverpool'?price28Pct(included):'—'}</td><td>${price28Pct(r.rate)}</td><td>${price28Btn('Editar','commission-edit',`data-price28-category="${esc(r.category)}"`)}</td></tr>`))}</section>`;
  }
  if(tab==='mappings'){
    const rows=(c.categoryMappings||[]).filter(r=>r.category.toLowerCase().includes(price28ConfigQuery.toLowerCase()));
    return `<div class="filterbar"><label class="field-search price28-config-search">${icon('search')}<input id="price28-config-query" value="${esc(price28ConfigQuery)}" placeholder="Buscar categoría de inventario…" aria-label="Buscar mapeo"></label>${price28Btn(`${icon('plus')} Nueva categoría de inventario`,'mapping-new')}</div><section class="panel"><div class="panel-head"><div><h2>Equivalencias por marketplace</h2><div class="panel-sub">Los cambios del mapa conservan las excepciones por UPC.</div></div></div>${price28ConfigTable(['Categoría inventario','Coppel','Mercado Libre','Liverpool','Elektra','Envío','Productos',''],rows.map(r=>`<tr><td><strong>${esc(r.category)}</strong></td><td>${esc(r.channels?.Coppel)}</td><td>${esc(r.channels?.['Mercado Libre'])}</td><td>${esc(r.channels?.Liverpool)}</td><td>${esc(r.channels?.Elektra)}</td><td>${esc(r.shipping)}</td><td>${price28Products().filter(p=>p.category===r.category).length}</td><td>${price28Btn('Editar','mapping-edit',`data-price28-category="${esc(r.category)}"`)}</td></tr>`))}</section>`;
  }
  if(tab==='elektraMsi'){
    const rows=price28Draft(tab);
    return `<section class="panel"><div class="panel-head"><div><h2>MSI Elektra</h2><div class="panel-sub">El cargo se suma una sola vez a la comisión de categoría.</div></div></div>${price28ConfigTable(['Plazo','Cargo adicional %',''],rows.map((r,i)=>`<tr><td>${price28ConfigInput(tab,i,'label',r.label,{text:true})}</td><td>${price28ConfigInput(tab,i,'rate',r.rate,{percent:true})}%</td><td>${price28Btn('Quitar','config-remove',`data-price28-section="${tab}" data-price28-index="${i}"`)}</td></tr>`))}${price28ConfigFooter(tab,true)}</section>`;
  }
  if(tab==='tnBands'){
    const rows=price28Draft(tab);
    return `<div class="intro-strip">${icon('info')}<span>El motor toma la <strong>tasa usada</strong> del tramo. En V28 estas tasas son valores guardados; cambiar pesos o pasarelas no las recalcula automáticamente.</span></div><section class="panel"><div class="panel-head"><div><h2>Tramos de Tienda Nube</h2><div class="panel-sub">Se aplica el último límite inferior que no supera el precio de referencia.</div></div></div>${price28ConfigTable(['Tramo','Desde $','Hasta $','Tasa usada %','Media simple %','Media ponderada %','Máxima %'],rows.map((r,i)=>`<tr><td>${price28ConfigInput(tab,i,'label',r.label,{text:true})}</td><td>${price28ConfigInput(tab,i,'min',r.min)}</td><td>${price28ConfigInput(tab,i,'max',r.max)}</td><td>${price28ConfigInput(tab,i,'usedRate',r.usedRate,{percent:true})}</td><td>${price28ConfigInput(tab,i,'simpleMean',r.simpleMean,{percent:true})}</td><td>${price28ConfigInput(tab,i,'weightedMean',r.weightedMean,{percent:true})}</td><td>${price28ConfigInput(tab,i,'maxRate',r.maxRate,{percent:true})}</td></tr>`))}${price28ConfigFooter(tab)}</section>`;
  }
  if(tab==='tnGateways'){
    const rows=price28Draft(tab);
    return `<div class="intro-strip">${icon('info')}<span>Conserva los componentes y pesos de cada escenario. Para cambiar la tasa efectiva del motor, guarda también el tramo correspondiente.</span></div><section class="panel"><div class="panel-head"><div><h2>Pasarelas y escenarios MSI</h2><div class="panel-sub">Importes y tasas del modelo V28.</div></div></div>${price28ConfigTable(['Pasarela / modalidad','MSI','Mínimo $','Máximo $','Tasa efectiva %','Peso','Incluir','MSI %','IVA MSI','Adicional %'],rows.map((r,i)=>`<tr><td><strong>${esc(r.gateway)}</strong><span class="subtext">${esc(r.mode)}</span></td><td>${price28ConfigInput(tab,i,'months',r.months)}</td><td>${price28ConfigInput(tab,i,'min',r.min)}</td><td>${price28ConfigInput(tab,i,'max',r.max)}</td><td>${price28ConfigInput(tab,i,'effectiveRate',r.effectiveRate,{percent:true})}</td><td>${price28ConfigInput(tab,i,'weight',r.weight)}</td><td><select aria-label="Incluir pasarela ${i+1}" data-price28-config="${tab}" data-price28-row="${i}" data-price28-key="included">${['SI','NO'].map(v=>`<option ${r.included===v?'selected':''}>${v}</option>`).join('')}</select></td><td>${price28ConfigInput(tab,i,'msiRate',r.msiRate,{percent:true})}</td><td><select aria-label="IVA MSI pasarela ${i+1}" data-price28-config="${tab}" data-price28-row="${i}" data-price28-key="msiVat">${['SI','NO'].map(v=>`<option ${r.msiVat===v?'selected':''}>${v}</option>`).join('')}</select></td><td>${price28ConfigInput(tab,i,'extraRate',r.extraRate,{percent:true})}</td></tr>`))}${price28ConfigFooter(tab)}</section>`;
  }
  if(tab==='settlement'){
    const p=price28Draft(tab),shipping=p.shippingTreatment||{};
    return `<section class="panel"><div class="panel-head"><div><h2>Reglas de conciliación</h2><div class="panel-sub">El tratamiento de envío se guarda por canal; los casos por confirmar requieren revisión.</div></div></div>${price28ConfigTable(['Marketplace','Tratamiento del envío'],Object.entries(shipping).map(([channel,value])=>`<tr><td>${esc(channel)}</td><td><select aria-label="Tratamiento envío ${esc(channel)}" data-price28-settlement-channel="${esc(channel)}">${['Externo','Descontado','Por confirmar'].map(v=>`<option ${value===v?'selected':''}>${v}</option>`).join('')}</select></td></tr>`))}<div class="panel-head"><h2>Liverpool · MSI y catálogo</h2></div>${price28ConfigTable(['Concepto','Tasa %'],[`<tr><td>Recargo incluido en el catálogo</td><td>${price28ConfigInput(tab,null,'liverpoolIncludedMsi',p.liverpoolIncludedMsi,{percent:true})}</td></tr>`,...(p.liverpoolMsi||[]).map((r,i)=>`<tr><td>${r.months===0?'Sin MSI':r.months+' MSI'}</td><td><input type="number" step="any" min="0" value="${price28PercentInput(r.rate)}" aria-label="Recargo Liverpool ${r.months} meses" data-price28-liverpool-msi="${i}"></td></tr>`)])}${price28ConfigFooter(tab)}</section>`;
  }
  return '';
}
function price28Settings(){
  if(!price28Engine()||!state.config)return '<div class="empty">Cargando configuración…</div>';
  return `${price28Styles()}${pageHead('CONFIGURACIÓN / V28','Reglas del ERP','Consulta y actualiza las tablas que utilizan las calculadoras y la conciliación.',price28Btn(`${icon('calculator')} Volver a precios`,'back-pricing'))}<div class="price28-subtabs">${price28SettingTabs.map(([id,label])=>`<button class="btn ${price28SettingsTab===id?'active':''}" data-price28-settings-tab="${id}">${label}</button>`).join('')}</div>${price28SettingsContent()}`;
}

function price28CommissionModal(category=''){
  const channel=price28CommissionChannel,c=price28Config(),existing=c.commissions?.[channel]?.find(r=>r.category===category),included=channel==='Liverpool'?(c.settlement?.liverpoolIncludedMsi??.0355):0;
  price28ModalData={type:'commission',channel,existingCategory:category};
  showModal(`<div class="price28-modal"><h2>${existing?'Editar comisión':'Nueva categoría y comisión'}</h2><p class="modal-subtitle">${esc(channel)}${channel==='Liverpool'?` · El catálogo sumará ${price28Pct(included)} de MSI incluido.`:''}</p><form id="price28-commission-form"><div class="form-grid"><div class="field wide"><label for="price28-c-category">Categoría</label><input id="price28-c-category" name="category" type="text" value="${esc(existing?.category||'')}" required ${existing?'readonly':''}></div><div class="field"><label for="price28-c-base">${channel==='Mercado Libre'?'Clásica':'Comisión base'} (%)</label><input id="price28-c-base" name="baseRate" type="number" step="any" min="0" max="99.999" value="${existing?price28PercentInput(existing.rate-included):''}" required></div>${channel==='Mercado Libre'?`<div class="field"><label for="price28-c-premium">Premium (%)</label><input id="price28-c-premium" name="premiumRate" type="number" step="any" min="0" max="99.999" value="${existing?price28PercentInput(existing.premiumRate):''}" required></div>`:''}<div class="field wide"><label for="price28-c-path">Ruta / descripción</label><input id="price28-c-path" name="path" type="text" value="${esc(existing?.path||'')}"></div><div class="field wide"><label for="price28-c-note">Notas</label><input id="price28-c-note" name="note" type="text" value="${esc(existing?.note||'')}"></div></div><div id="price28-modal-error"></div><div class="modal-actions"><button type="button" class="btn" data-price28-action="modal-close">Cancelar</button><button class="btn primary" type="submit">Guardar comisión</button></div></form></div>`);
}
function price28MappingModal(category=''){
  const c=price28Config(),engine=price28Engine(),existing=c.categoryMappings?.find(r=>r.category===category);
  price28ModalData={type:'mapping',existingCategory:category};
  showModal(`<div class="price28-modal"><h2>${existing?'Editar mapeo':'Nueva categoría de inventario'}</h2><p class="modal-subtitle">Las excepciones individuales de cada producto se conservarán.</p><form id="price28-mapping-form"><div class="form-grid"><div class="field wide"><label for="price28-m-category">Categoría inventario</label><input id="price28-m-category" name="category" type="text" value="${esc(existing?.category||'')}" required ${existing?'readonly':''}></div>${engine.CHANNELS.map((ch,i)=>`<div class="field"><label for="price28-m-channel-${i}">${esc(ch)}</label><select id="price28-m-channel-${i}" name="channel-${i}">${engine.listCategories(c,ch,{mapping:true}).map(cat=>`<option ${existing?.channels?.[ch]===cat?'selected':''}>${esc(cat)}</option>`).join('')}</select></div>`).join('')}<div class="field"><label for="price28-m-shipping">Envío sugerido</label><select id="price28-m-shipping" name="shipping">${['Pequeño','Mediano','Grande'].map(type=>`<option ${existing?.shipping===type?'selected':''}>${type}</option>`).join('')}</select></div><div class="field wide"><label for="price28-m-note">Notas</label><input id="price28-m-note" name="note" type="text" value="${esc(existing?.note||'')}"></div></div><div id="price28-modal-error"></div><div class="modal-actions"><button type="button" class="btn" data-price28-action="modal-close">Cancelar</button><button class="btn primary" type="submit">Guardar mapeo</button></div></form></div>`);
}
function price28ModalError(errors){const e=document.getElementById('price28-modal-error');if(e)e.innerHTML=`<div class="price28-error price28-card-gap">${errors.map(x=>esc(x.message||x)).join('<br>')}</div>`;}
async function price28Command(type,payload){
  if(price28Busy)return false; price28Busy=true;
  try{const r=await ERP.command(type,payload);if(r?.ok===false){toast(r.error?.message||r.error||'No se pudo guardar.',true);return false;}return true;}
  catch(e){toast(e.message||'No se pudo guardar.',true);return false;}finally{price28Busy=false;}
}
function price28ExportCSV(filename,rows){
  const cell=v=>{let s=String(v??'');if(/^[=+@]/.test(s))s="'"+s;return `"${s.replace(/"/g,'""')}"`;};
  const blob=new Blob(['\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function price28Export(){
  const r=price28Calculate();
  if(Array.isArray(r)){price28ExportCSV('AIMERKA_comparativo_V28.csv',[['Canal','Categoría','Comisión','Precio descuento','Precio regular','Utilidad descuento','Pago neto descuento','Decisión'],...r.map(v=>[v.channel,v.category,v.commissionRate,v.discount?.price,v.regular?.price,v.discount?.profit,v.discount?.netPayout,v.status])]);return;}
  if(!r?.valid||!r.discount)return;
  const fields=[['Precio','price'],['Costo','cost'],['Envío','shipping'],['Comisión','commission'],['Retención IVA','vat'],['Retención ISR','isr'],['Pago neto','netPayout'],['Utilidad V28','profit'],['Margen','margin'],['Utilidad objetivo','targetProfit'],['Diferencia sobre venta','targetDifference']];
  price28ExportCSV('AIMERKA_precio_V28.csv',[['Contexto',r.context],['Canal',r.channel],['Categoría',r.category],['Concepto','Con descuento','Regular'],...fields.map(([label,key])=>[label,r.discount[key],r.regular?.[key]]),['Decisión',r.status]]);
}
function price28Clear(){
  const f=price28Forms[price28Tab];f.name='';f.manualDiscount='';f.manualRegular='';f.manualShipping='';f.alternateMarketPrice='';
  if(['recomendador','comparar'].includes(price28Tab)){f.mode='automatico';f.margin='10';f.inflation='10';f.zeroMarginInflation='0';}
  else {f.cost='';f.marketPrice='';f.mode='tasas';f.margin='10';f.inflation='10';}
  render();
}

document.addEventListener('input',event=>{
  const field=event.target.dataset.price28Field;
  if(field&&price28Forms[price28Tab]){price28Forms[price28Tab][field]=event.target.value;price28RefreshResult();return;}
  if(event.target.dataset.price28Config){
    const t=event.target,s=t.dataset.price28Config,d=price28Draft(s),row=t.dataset.price28Row,field=t.dataset.price28Key;
    let value=t.type==='number'?(t.value===''?null:Number(t.value)):t.value;if(t.dataset.price28Percent==='1'&&value!==null)value/=100;
    if(row==='')d[field]=value;else if(d[Number(row)])d[Number(row)][field]=value;
  }
  if(event.target.dataset.price28SettlementChannel)price28Draft('settlement').shippingTreatment[event.target.dataset.price28SettlementChannel]=event.target.value;
  if(event.target.dataset.price28LiverpoolMsi!==undefined)price28Draft('settlement').liverpoolMsi[Number(event.target.dataset.price28LiverpoolMsi)].rate=event.target.value===''?null:Number(event.target.value)/100;
  if(event.target.id==='price28-config-query'){price28ConfigQuery=event.target.value;const cursor=event.target.selectionStart;render();const i=document.getElementById('price28-config-query');i?.focus();i?.setSelectionRange(cursor,cursor);}
});
document.addEventListener('change',event=>{
  if(event.target.id==='price28-commission-channel'){price28CommissionChannel=event.target.value;price28ConfigQuery='';render();return;}
  const field=event.target.dataset.price28Field;
  if(field&&price28Forms[price28Tab]){
    price28Forms[price28Tab][field]=event.target.value;
    if(['channel','mode','productKey','name','margin'].includes(field))render();else price28RefreshResult();
  }
});
document.addEventListener('click',async event=>{
  const tab=event.target.closest('[data-price28-tab]');if(tab){price28Tab=tab.dataset.price28Tab;render();return;}
  const setting=event.target.closest('[data-price28-settings-tab]');if(setting){price28SettingsTab=setting.dataset.price28SettingsTab;price28ConfigQuery='';render();return;}
  const rate=event.target.closest('[data-price28-rate]');if(rate){const f=price28Forms[price28Tab],value=rate.dataset.price28Value;f[rate.dataset.price28Rate]=value;if(rate.dataset.price28Rate==='margin'){f.inflation=value;f.zeroMarginInflation='0';f.mode=['recomendador','comparar'].includes(price28Tab)?'automatico':'tasas';}if(rate.dataset.price28Rate==='inflation'&&['precios','manual_precios'].includes(f.mode)&&Number(f.manualDiscount)>0)f.manualRegular=String(price28Engine().roundRegular99(Number(f.manualDiscount),Number(value)/100));render();return;}
  const b=event.target.closest('[data-price28-action]');if(!b)return;const action=b.dataset.price28Action;
  if(action==='calculate'){price28RefreshResult();return;}
  if(action==='clear'){price28Clear();return;}
  if(action==='configuration'){navigate('configuration');return;}
  if(action==='back-pricing'){navigate('pricing');return;}
  if(action==='modal-close'){document.getElementById('modal').close();return;}
  if(action==='suggestion'){price28Forms[price28Tab].category=b.dataset.price28Category;render();return;}
  if(action==='export'){price28Export();return;}
  if(action==='save'){
    const r=price28Calculate();if(!r?.valid||!r.discount)return;
    const f=price28Forms[price28Tab],p=price28FindProduct(f.productKey),name=f.name||`${price28Tab==='recomendador'?(p?.name||'Producto'):'Escenario'} · ${r.channel}`;
    if(await price28Command('pricing.scenario.save',{name,context:r.context,input:price28Input(),productSku:price28Tab==='recomendador'?p?.sku:null})){toast('Escenario V28 guardado.');render();}return;
  }
  if(action==='scenario'){
    const s=state.pricingScenarios?.[Number(b.dataset.price28Index)];if(!s)return;
    showModal(`<div class="price28-modal"><h2>${esc(s.name||'Escenario guardado')}</h2><p class="modal-subtitle">Resultado conservado al guardar. No recalcula con cambios posteriores.</p>${s.result?price28ResultTable(s.result):'<div class="empty">Sin resultado guardado.</div>'}<p class="price28-note">${esc(s.result?.status||'')}</p><div class="modal-actions">${price28Btn('Cerrar','modal-close')}</div></div>`);return;
  }
  if(action==='commission-new'||action==='commission-edit'){price28CommissionModal(b.dataset.price28Category||'');return;}
  if(action==='mapping-new'||action==='mapping-edit'){price28MappingModal(b.dataset.price28Category||'');return;}
  const section=b.dataset.price28Section;
  if(action==='config-discard'){delete price28ConfigDrafts[section];render();return;}
  if(action==='config-remove'){price28Draft(section).splice(Number(b.dataset.price28Index),1);render();return;}
  if(action==='config-add'){const d=price28Draft(section);d.push(section==='shippingRules'?{priority:d.length+1,keyword:'',type:'Pequeño',note:''}:{label:'',rate:0});render();return;}
  if(action==='config-save'){
    const value=price28Draft(section);if(section==='shippingRules')value.forEach((r,i)=>r.priority=i+1);
    if(await price28Command('config.pricing.save',{section,value})){delete price28ConfigDrafts[section];toast('Configuración guardada. Los próximos cálculos usarán estos valores.');render();}return;
  }
});
document.addEventListener('submit',async event=>{
  if(event.target.id==='price28-form'){event.preventDefault();price28RefreshResult();return;}
  if(!['price28-commission-form','price28-mapping-form'].includes(event.target.id))return;
  event.preventDefault();const values=Object.fromEntries(new FormData(event.target)),engine=price28Engine();let payload,validation,type;
  if(event.target.id==='price28-commission-form'){
    payload={channel:price28ModalData.channel,category:values.category,baseRate:Number(values.baseRate)/100,premiumRate:values.premiumRate===undefined?null:Number(values.premiumRate)/100,path:values.path,note:values.note,includedMsi:price28ModalData.channel==='Liverpool'?(price28Config().settlement?.liverpoolIncludedMsi??.0355):0};
    validation=engine.validateCommission(price28Config(),payload);type='config.commission.save';
  }else{
    payload={category:values.category,channels:Object.fromEntries(engine.CHANNELS.map((c,i)=>[c,values[`channel-${i}`]])),shipping:values.shipping,note:values.note};validation=engine.validateMapping(price28Config(),payload);type='config.mapping.save';
    if(!price28ModalData.existingCategory&&(price28Config().categoryMappings||[]).some(r=>r.category.toLocaleLowerCase('es-MX')===String(payload.category).trim().toLocaleLowerCase('es-MX'))){validation.valid=false;validation.errors.push({message:'La categoría ya existe. Usa Editar para modificar su mapeo.'});}
  }
  if(!validation.valid){price28ModalError(validation.errors);return;}
  if(await price28Command(type,payload)){document.getElementById('modal').close();toast(type==='config.mapping.save'?'Mapeo guardado; excepciones por producto conservadas.':'Comisión guardada.');render();}
});

renderers.pricing=price28Page;
renderers.configuration=price28Settings;
if(!nav.some(n=>n[0]==='configuration'))nav.push(['configuration','Configuración','layers']);
window.Price28={openProduct(sku){price28Tab='recomendador';price28Forms.recomendador.productKey=String(sku);navigate('pricing');},openSettings(section='parameters'){price28SettingsTab=section;navigate('configuration');},discardDrafts(){price28ConfigDrafts={};}};
