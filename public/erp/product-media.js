(function(){
 'use strict';
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const icon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 4h18v16H3zM3 16l5-5 5 5 3-3 5 5"/><circle cx="16" cy="8" r="2"/></svg>';
 const safe=value=>{if(typeof value!=='string'||!value.trim())return '';try{const u=new URL(value,location.origin);return (u.origin===location.origin||u.protocol==='https:')&&!u.username&&!u.password?u.href:'';}catch{return '';}};
 const workspace=()=>window.ERP?.workspace||'v43',uploaded=url=>{try{return new URL(url,location.origin).pathname.match(/^\/api\/documents\/([a-f0-9]{64})$/)?.[1]||'';}catch{return '';}};
 function smaller(value,variant='thumbnail'){const url=safe(value);if(!url)return '';const u=new URL(url);if(u.origin!==location.origin)return url;const staticId=u.pathname.match(/^\/erp\/catalog-v43\/([a-f0-9]{64})\.(?:jpg|png)$/i)?.[1];if(staticId)return '/erp/'+(variant==='preview'?'catalog-previews':'catalog-thumbs')+'/'+staticId+'.webp';const id=uploaded(url);return id?'/api/product-images/'+id+'?workspace='+encodeURIComponent(workspace())+(variant==='preview'?'&variant=preview':'')+'&v=2':url;}
 function sources(p){return [...new Set([...(p?.images||[]).filter(i=>i.primary).map(i=>i.url),...(p?.images||[]).map(i=>i.url),p?.imageUrl].map(safe).filter(Boolean))];}
 function html(p,{large=false,className='pt29-thumb'}={}){const originals=sources(p),first=originals[0],url=smaller(first,large?'preview':'thumbnail'),candidates=[...new Set([url,first,...originals.slice(1,4).flatMap(s=>[smaller(s),s])].filter(Boolean))];return `<span class="${className}${large?' pt29-thumb-large':''}${url?' pt29-has-image':''}" aria-label="${escape(p?.name||'Producto')}">${url?`<img data-product-image data-image-candidates="${escape(JSON.stringify(candidates))}" data-image-attempt="0" src="${escape(url)}" alt="${escape(p?.name||'Producto')}" width="${large?320:128}" height="${large?320:128}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:''}<span class="product-image-placeholder pt29-thumb-fallback" aria-hidden="true">${icon}</span></span>`;}
 document.addEventListener('error',event=>{const img=event.target;if(!img?.matches?.('img[data-product-image]'))return;event.stopImmediatePropagation();const choices=JSON.parse(img.dataset.imageCandidates||'[]'),attempt=Number(img.dataset.imageAttempt||0)+1;if(choices[attempt]){img.dataset.imageAttempt=String(attempt);img.src=choices[attempt];}else if(!img.dataset.imageRetried){img.dataset.imageRetried='1';setTimeout(()=>{if(img.isConnected){img.dataset.imageAttempt='0';img.src=choices[0]+(choices[0].includes('?')?'&':'?')+'retry=1';}},750);}else{img.hidden=true;img.closest('span')?.classList.add('pt29-image-failed','product-image-missing');}},true);
 document.addEventListener('load',event=>{const img=event.target;if(!img?.matches?.('img[data-product-image]'))return;img.hidden=false;img.closest('span')?.classList.remove('pt29-image-failed','product-image-missing');img.closest('span')?.classList.add('product-image-ready');},true);
 const mayOptimize=()=>window.ERP?.access?.owner||window.ERP?.access?.permissions?.includes('inventory');
 const button=()=>mayOptimize()?`<button type="button" class="btn product-image-optimize" data-product-image-optimize title="Prepara miniaturas y vistas de ficha sin modificar originales ni datos">${icon}Optimizar imágenes</button>`:'';
 const blobFromCanvas=(canvas,mime,quality)=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('No se pudo generar la miniatura.')),mime,quality));
 async function optimized(blob, size = 256, {allowUnsupported = false} = {}) {
  const bitmap = await createImageBitmap(blob);
  try {
   const scale = Math.min(1, size / bitmap.width, size / bitmap.height);
   const canvas = document.createElement('canvas');
   canvas.width = Math.max(1, Math.round(bitmap.width * scale));
   canvas.height = Math.max(1, Math.round(bitmap.height * scale));
   canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
   const output = await blobFromCanvas(canvas, 'image/webp', size > 256 ? .9 : .78);
   if (output.type === 'image/webp') return output;
   if (allowUnsupported) return null;
   throw Error('Este navegador no permite generar WebP.');
  } finally {
   bitmap.close();
  }
 }
 async function uploadForm(file) {
  const form = new FormData();
  form.append('file', file);
  for (const [variant, size] of [['thumbnail', 256], ['preview', 1280]]) {
   const webp = await optimized(file, size, {allowUnsupported: true});
   // Browsers that cannot encode WebP return PNG. The API can serve the original.
   if (!webp) break;
   form.append(variant, webp, variant + '.webp');
  }
  return form;
 }
 const ensuring=new Map();
 async function ensureImages(product){if(!mayOptimize())return;for(const image of product?.images||[]){const id=uploaded(image.url)||image.source!=='V43'&&/^[a-f0-9]{64}$/.test(image.id||'')&&image.id;if(!id||ensuring.has(id))continue;const work=(async()=>{for(const variant of ['thumbnail','preview'])try{await ensureVariant(id,variant);}catch{/* Originals remain available; maintenance can retry. */}})();ensuring.set(id,work);await work;}}
 async function ensureVariant(id,variant){const url='/api/product-images/'+id+'?workspace='+encodeURIComponent(workspace())+'&variant='+variant+'&v=2',response=await readImage(url);if(!response.ok)throw Error('No se pudo leer la fotografía (HTTP '+response.status+').');if(response.headers.get('X-Aimerka-Variant')===variant)return {existing:true};const original=await response.blob(),tiny=await optimized(original,variant==='preview'?1280:256),result=await fetch(url,{method:'POST',headers:{'Content-Type':'image/webp'},body:tiny});if(!result.ok)throw Error('No se pudo guardar la versión optimizada (HTTP '+result.status+').');return {originalBytes:original.size,bytes:tiny.size};}
 async function readImage(url){for(let attempt=0;attempt<3;attempt++){try{const response=await fetch(url);if(response.ok||![422,429,500,502,503,504].includes(response.status)||attempt===2)return response;}catch(error){if(attempt===2)throw error;}await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));}}
 let busy=false;
 async function optimize(){if(busy||!mayOptimize())return;busy=true;const images=new Map();for(const p of state.products||[])for(const image of p.images||[]){const id=uploaded(image.url);if(id)images.set(id,image);}showModal(`<h2 id="modal-title">${icon}Optimizar imágenes del catálogo</h2><p>Se preparan miniaturas para listas y vistas nítidas para fichas. Los originales, existencias, costos y precios se conservan.</p><p data-image-progress role="status">Preparando ${images.size} fotografías…</p><progress data-image-optimization-progress max="${images.size||1}" value="0" style="width:100%"></progress><p data-image-optimization-result></p><div data-image-optimization-errors></div><div class="modal-actions"><button type="button" class="btn" data-image-optimize-close disabled>Terminar</button></div>`);let done=0,failed=0,saved=0,existing=0;const queue=[...images],failures=[];try{let next=0;await Promise.all(Array.from({length:2},async()=>{while(next<queue.length){const [id,image]=queue[next++];try{for(const variant of ['thumbnail','preview']){const result=await ensureVariant(id,variant);if(result.existing)existing++;else saved++;}}catch(error){failed++;failures.push({name:image.name,message:error.message});}finally{done++;const text=document.querySelector('[data-image-progress]');if(text)text.textContent=`${done} de ${images.size} fotografías · ${failed} pendientes`;const bar=document.querySelector('[data-image-optimization-progress]');if(bar)bar.value=done;}}}));window.ProductMedia.lastOptimization={total:images.size,created:saved,existing,failed};const errors=document.querySelector('[data-image-optimization-errors]');if(errors&&failures.length)errors.innerHTML='<details><summary>Fotografías pendientes</summary><ul>'+failures.map(f=>'<li>'+escape(f.name)+': '+escape(f.message)+'</li>').join('')+'</ul></details>';const result=document.querySelector('[data-image-optimization-result]');if(result)result.textContent=`Listo: ${saved} versiones creadas y ${existing} ya disponibles. ${failed} fotografías pendientes.`;}finally{busy=false;const close=document.querySelector('[data-image-optimize-close]');if(close)close.disabled=false;}}
 document.addEventListener('click',event=>{if(event.target.closest('[data-product-image-optimize]'))optimize();if(event.target.closest('[data-image-optimize-close]')&&!busy){document.getElementById('modal').close();if(typeof render==='function')render();}});
 window.ProductMedia={html,smaller,sources,button,optimized,uploadForm,optimize,ensureImages,lastOptimization:null};
})();
