'use strict';
// Load after the configuration renderer; all state reads happen when rendering/opening.
(function(){
 const TIME_ZONE='America/Mexico_City',MAX_BYTES=128*1024;
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const current=()=>typeof state==='undefined'?{}:state;
 const canEdit=()=>Boolean(window.ERP?.access?.active&&window.ERP.access.permissions?.includes('settings'));
 let selected=false,busy=false;
 function companyName(source=current()){
  const company=source?.config?.workspacePresentation?.company||{},fiscal=source?.config?.purchaseFiscal;
  const profile=fiscal?.profiles?.find(row=>row.id===fiscal.defaultProfileId&&row.active!==false);
  return [company.tradeName,company.commercialName,company.legalName,profile?.legalName].find(value=>typeof value==='string'&&value.trim())?.trim()||'';
 }
 function existingMarkets(source=current()){
  const defaults=typeof markets==='undefined'?['Liverpool','Sears','Sanborns','Coppel','Elektra','Tienda Nube','Mercado Libre']:markets;
  return [...new Set([...defaults,...Object.keys(source.config?.commissions||{}),...(source.orders||[]).map(row=>row.market)])].filter(name=>typeof name==='string'&&name.trim()&&name.length<=120&&!['__proto__','prototype','constructor'].includes(name));
 }
 function openSettings(){selected=true;if(typeof navigate==='function')navigate('configuration');}
 function preview(row){
  const market=row.dataset.wpMarket,input=row.querySelector('[data-wp-logo]'),color=row.querySelector('[data-wp-color]').value;
  const original=window.MarketUI?.get(market),safe=window.MarketUI?.safeLogoUrl(input.value)||'',src=safe||original?.fallbackLogoUrl||'';
  const area=row.querySelector('[data-wp-preview]');
  area.style.setProperty('--market-color',color||original?.color||'#64748b');
  area.innerHTML=src?`<img src="${escape(src)}" alt="Vista previa de ${escape(market)}" referrerpolicy="no-referrer" data-market-image${safe&&original?.fallbackLogoUrl?` data-market-fallback="${escape(original.fallbackLogoUrl)}"`:''}><span hidden>${escape(original?.initials||market.slice(0,2))}</span>`:`<span>${escape(original?.initials||market.slice(0,2))}</span>`;
  input.setCustomValidity(input.value.trim()&&!safe?'Usa una URL HTTPS o una imagen PNG/JPG de hasta 128 KB.':'');
 }
 function settingsPage(){
  const source=current(),settings=source.config?.workspacePresentation||{},company=settings.company||{},fiscal=source.config?.purchaseFiscal;
  const fallback=fiscal?.profiles?.find(row=>row.id===fiscal.defaultProfileId&&row.active!==false)?.legalName||'';
  const disabled=canEdit()?'':'disabled',rows=existingMarkets(source);
  const updated=settings.updatedAt?(window.ERPDate?.datetime?.(settings.updatedAt)||''):'';
  return `<section class="panel wp-settings" aria-labelledby="wp-title"><header class="wp-heading"><div><span class="eyebrow">CONFIGURACIÓN CENTRAL</span><h1 id="wp-title">Identidad y marketplaces</h1><p>El nombre de tu empresa, los logos y los colores que verás en el ERP.</p></div><button class="btn" type="button" data-wp-rules>Reglas del ERP</button></header>${!canEdit()?'<p class="info-box">Puedes consultar la identidad. Para editarla necesitas el permiso de configuración.</p>':''}<form id="workspace-presentation-form"><fieldset ${disabled}><legend>Tu empresa</legend><div class="wp-company"><label>Nombre comercial<input name="commercialName" maxlength="200" value="${escape(company.tradeName||company.commercialName||'')}" placeholder="Nombre que usas con tus clientes"></label><label>Razón social para mostrar<input name="legalName" maxlength="200" value="${escape(company.legalName||'')}" placeholder="${escape(fallback||'Razón social de tu empresa')}"></label></div><p class="small-note">El saludo usa el nombre comercial. Si está vacío, usa la razón social configurada o la empresa fiscal predeterminada${fallback?': '+escape(fallback):''}. Los datos fiscales de compras se administran en su catálogo.</p></fieldset><div class="wp-timezone"><strong>Fecha y hora de la operación</strong><span>${TIME_ZONE}</span><time data-erp-clock></time></div><fieldset ${disabled}><legend>Marketplaces existentes</legend><p class="small-note">Configura aquí la imagen que aparecerá en ventas, productos, precios y conciliación. PNG o JPG de hasta 128 KB; también puedes pegar una URL HTTPS. Deja el campo vacío para usar el logo integrado.</p><div class="wp-market-list">${rows.map((name,index)=>{
   const saved=Object.hasOwn(settings.marketplaces||{},name)?settings.marketplaces[name]:{},brand=window.MarketUI?.get(name)||{color:'#64748b',initials:name.slice(0,2)},logo=window.MarketUI?.safeLogoUrl(saved.logoUrl)||'',isUpload=logo.startsWith('data:'),src=logo||brand.fallbackLogoUrl||'';
   return `<article class="wp-market" data-wp-market="${escape(name)}"><div class="wp-market-name"><div class="wp-logo-preview" data-wp-preview style="--market-color:${escape(brand.color)}">${src?`<img src="${escape(src)}" alt="Logo de ${escape(name)}" referrerpolicy="no-referrer" data-market-image${logo&&brand.fallbackLogoUrl?` data-market-fallback="${escape(brand.fallbackLogoUrl)}"`:''}><span hidden>${escape(brand.initials)}</span>`:`<span>${escape(brand.initials)}</span>`}</div><h2>${escape(name)}</h2></div><label>Color<input type="color" data-wp-color value="${escape(brand.color)}" aria-label="Color de ${escape(name)}"></label><label class="wp-url">URL del logo<input data-wp-logo type="${isUpload?'hidden':'text'}" value="${escape(logo)}" maxlength="${4*Math.ceil(MAX_BYTES/3)+30}" placeholder="https://… o /erp/assets/…"><span data-wp-upload-label ${isUpload?'':'hidden'}>Imagen guardada en la configuración</span></label><label class="wp-file" for="wp-file-${index}">Subir imagen<input id="wp-file-${index}" data-wp-file type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg"></label><button class="btn small" type="button" data-wp-reset>Restablecer logo y color</button><p class="wp-row-status small-note" data-wp-row-status role="status"></p></article>`;
  }).join('')}</div></fieldset><p class="wp-status" data-wp-status role="status" aria-live="polite">${updated?'Último cambio: '+escape(updated):''}</p><div class="wp-actions"><button class="btn primary" type="submit" ${disabled}>Guardar identidad y marketplaces</button></div></form></section>`;
 }
 const original=typeof renderers==='undefined'?null:renderers.configuration;
 if(typeof renderers!=='undefined')renderers.configuration=function(...args){
  if(selected)return settingsPage();
  return `<section class="panel wp-entry"><div><h2>Identidad y marketplaces</h2><p>Configura el nombre de tu empresa, los logos y los colores de todos tus canales.</p></div><button class="btn primary" type="button" data-wp-open>Abrir identidad y marketplaces</button></section>`+(original?original.apply(this,args):'');
 };
 window.WorkspacePresentation={companyName,openSettings,open:openSettings,existingMarkets,timeZone:TIME_ZONE};
 document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button||button.disabled)return;
  if(button.hasAttribute('data-wp-open')){openSettings();return;}
  if(button.hasAttribute('data-wp-rules')){if(busy)return;selected=false;if(typeof render==='function')render();return;}
  if(button.hasAttribute('data-wp-reset')&&canEdit()&&!busy){
   const row=button.closest('[data-wp-market]'),input=row.querySelector('[data-wp-logo]'),source={config:{}};
   input.value='';input.type='text';row.querySelector('[data-wp-upload-label]').hidden=true;row.querySelector('[data-wp-file]').value='';
   row.querySelector('[data-wp-color]').value=window.MarketUI?.get(row.dataset.wpMarket,source).color||'#64748b';
   row.dataset.resetColor='true';preview(row);row.querySelector('[data-wp-row-status]').textContent='Se usará el logo y color integrado al guardar.';
  }
 });
 document.addEventListener('input',event=>{
  const input=event.target,row=input.closest('[data-wp-market]');if(!row||!canEdit()||busy)return;
  if(input.hasAttribute('data-wp-color'))delete row.dataset.resetColor;
  if(input.matches('[data-wp-logo],[data-wp-color]'))preview(row);
 });
 document.addEventListener('change',async event=>{
  const input=event.target;if(!input.matches('[data-wp-file]')||!canEdit()||busy)return;
  const file=input.files?.[0];if(!file)return;
  const row=input.closest('[data-wp-market]'),status=row.querySelector('[data-wp-row-status]'),form=row.closest('form');
  const submit=form.querySelector('[type="submit"]');submit.disabled=true;input.disabled=true;row.dataset.uploading='true';
  try{
   if(!['image/png','image/jpeg'].includes(file.type)||!file.size||file.size>MAX_BYTES)throw new Error('Selecciona una imagen PNG/JPG de hasta 128 KB.');
   const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('No se pudo leer la imagen.'));reader.readAsDataURL(file);});
   if(!window.MarketUI?.safeLogoUrl(data))throw new Error('El archivo no contiene una imagen PNG/JPG válida.');
   if(!row.isConnected)return;
   const target=row.querySelector('[data-wp-logo]');target.value=data;target.type='hidden';row.querySelector('[data-wp-upload-label]').hidden=false;preview(row);status.textContent=file.name+' · lista para guardar';
  }catch(error){status.textContent=error.message;}
  finally{delete row.dataset.uploading;input.disabled=false;input.value='';submit.disabled=!canEdit()||Boolean(form.querySelector('[data-uploading]'));}
 });
 document.addEventListener('submit',async event=>{
  const form=event.target;if(form.id!=='workspace-presentation-form')return;event.preventDefault();
  const status=form.querySelector('[data-wp-status]');if(!canEdit()){status.textContent='Necesitas permiso de configuración para guardar.';return;}
  if(busy||form.querySelector('[data-uploading]'))return;
  const marketplaces={};
  for(const row of form.querySelectorAll('[data-wp-market]')){
   preview(row);const input=row.querySelector('[data-wp-logo]');if(!input.checkValidity()){input.reportValidity();return;}
   marketplaces[row.dataset.wpMarket]={logoUrl:input.value.trim(),color:row.dataset.resetColor?'':row.querySelector('[data-wp-color]').value};
  }
  const values=new FormData(form),payload={company:{commercialName:values.get('commercialName'),legalName:values.get('legalName')},marketplaces,timeZone:TIME_ZONE};
  busy=true;form.querySelectorAll('fieldset,button[type="submit"]').forEach(el=>el.disabled=true);status.textContent='Guardando identidad…';
  try{
   const result=await window.ERP.command('config.workspacePresentation.save',payload);
   if(!result?.ok){if(!form.isConnected&&typeof render==='function')render();const visible=document.querySelector('#workspace-presentation-form [data-wp-status]');if(visible)visible.textContent=result?.error||'No se guardó la identidad. Revisa los datos y vuelve a intentar.';}
  }catch(error){status.textContent=error.message||'No se pudo guardar la identidad.';}
  finally{busy=false;form.querySelectorAll('fieldset,button[type="submit"]').forEach(el=>el.disabled=!canEdit());}
 });
})();
