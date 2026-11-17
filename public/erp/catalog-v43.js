'use strict';
window.Catalog43={images:[],uploading:false,blobs:[],form:null,session:0,
 dispose(){
  this.controller?.abort();this.session++;
  for(const url of this.blobs)URL.revokeObjectURL(url);
  this.blobs=[];this.images=[];this.uploading=false;this.form=null;
 },
 revoke(url){if(!url)return;URL.revokeObjectURL(url);this.blobs=this.blobs.filter(item=>item!==url);},
 renderGallery(){
  const el=this.form?.querySelector('#catalog43-gallery');if(!el)return;
  el.innerHTML=this.images.map((i,n)=>`<div class="catalog43-photo">${i.preview?`<img src="${esc(i.preview)}" alt="Imagen ${n+1} del producto">`:window.ProductMedia.html({name:this.form.elements.namedItem('name')?.value,images:[i]},{className:'catalog43-image'})}<small>${i.primary?'✓ Principal':'Imagen '+(n+1)}${i.pending?' · Cargando…':i.error?' · No se cargó':''}</small><button class="btn small" type="button" data-catalog43-primary="${n}" aria-pressed="${i.primary===true}">Principal</button><button class="btn small" type="button" data-catalog43-remove="${n}" aria-label="Quitar imagen ${n+1}">Quitar</button></div>`).join('');
  const url=this.form.elements.namedItem('imageUrl')?.value.trim(),source=this.images.find(i=>i.primary)||this.images[0];
  const safeUrl=window.ProductTrace28.safeImage(url);
  if(!this.images.length)el.innerHTML=safeUrl?`<div class="catalog43-photo">${window.ProductMedia.html({imageUrl:safeUrl,name:this.form.elements.namedItem('name')?.value},{className:'catalog43-image'})}<small>Principal · URL existente</small><button type="button" class="btn small" data-catalog43-remove-url>Quitar</button></div>`:'<p class="tiny">Selecciona una o varias fotografías. Podrás elegir la principal antes de guardar.</p>';
  const preview=this.form.querySelector('#pt29-preview-photo');
  if(preview)preview.innerHTML=source?(source.preview?`<span class="pt29-thumb pt29-thumb-large pt29-has-image"><img src="${esc(source.preview)}" alt="Imagen principal del producto"></span>`:window.ProductMedia.html({images:[source],name:this.form.elements.namedItem('name')?.value},{large:true})):window.ProductTrace28.thumb({imageUrl:safeUrl,name:this.form.elements.namedItem('name')?.value},{large:true});
 },
 readForm(form,p){
  if(form!==this.form)throw new Error('Vuelve a abrir la ficha para cargar las fotografías.');
  if(this.uploading)throw new Error('Espera a que terminen de cargar las imágenes.');
  if(this.images.some(i=>i.error||i.pending))throw new Error('Quita las imágenes que no se cargaron y vuelve a seleccionarlas.');
  if(this.images.length||p.images?.length)p.images=this.images.map(({preview,pending,error,...i})=>i);
  // Keep unrendered legacy attributes and channel identifiers intact.
  for(const k of ['description','manufacturerPart','condition','countryOfOrigin','material']){
   const input=form.elements.namedItem('catalog43-'+k);if(input)p[k]=input.value;
  }
  p.dimensions={...(p.dimensions||{})};for(const k of ['weightKg','heightCm','widthCm','lengthCm']){const input=form.elements.namedItem('catalog43-'+k);if(input)p.dimensions[k]=Number(input.value||0);}
  p.channelIdentifiers=structuredClone(p.channelIdentifiers||{});for(const [n,k] of ['Sears','Sanborns','Liverpool','Elektra','Coppel','Mercado Libre','Tienda Nube'].entries()){
   p.channelIdentifiers[k]={...(p.channelIdentifiers[k]||{})};
   for(const [field,key] of [['sku','sellerSku'],['publication','publicationId'],['variant','variantId']]){const input=form.elements.namedItem('catalog43-'+field+'-'+n);if(input)p.channelIdentifiers[k][key]=input.value;}
  }
 },
 attachForm(form,p){
  this.dispose();this.form=form;this.images=structuredClone(p?.images||[]);
  const session=this.session;form.closest('dialog')?.addEventListener('close',()=>{if(this.session===session)this.dispose();},{once:true});
 const field=(key,label,type='text')=>`<div class="field"><label for="catalog43-${key}">${esc(label)}</label><input name="catalog43-${key}" id="catalog43-${key}" type="${type}" value="${esc(type==='number'?p?.dimensions?.[key]??'':p?.[key]??'')}" ${type==='number'?'min="0" step="0.001"':'maxlength="300"'}></div>`;
 form.querySelector('.pt29-form-preview').insertAdjacentHTML('beforebegin',`<section class="pt29-form-section catalog43-media-first"><h3>1. Fotografías del producto</h3><label class="catalog43-upload" for="catalog43-files">Sube fotografías desde tu equipo<input id="catalog43-files" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" multiple><small>JPG, PNG, WebP, GIF o AVIF · optimización automática · hasta 15 MB por archivo · hasta 12 cargas por ficha</small></label><div id="catalog43-gallery" class="catalog43-gallery" aria-label="Fotografías del producto"></div><p id="catalog43-progress" role="status" aria-live="polite"></p><details class="catalog43-url"><summary>Usar una URL existente · opcional</summary><p class="tiny">La URL se usa como imagen principal cuando no hay fotografías en la galería.</p></details></section>`);
 const imageInput=form.querySelector('[name="imageUrl"]');if(imageInput)form.querySelector('.catalog43-url').append(imageInput.closest('.field'));
 form.querySelector('.modal-actions').insertAdjacentHTML('beforebegin',`<details class="pt29-form-section"><summary>Descripción, empaque y atributos comerciales</summary><div class="form-grid">${field('description','Descripción comercial')}${field('manufacturerPart','Número de parte del fabricante')}${field('condition','Condición (nuevo, reacondicionado…)')}${field('material','Material')}${field('countryOfOrigin','País de origen')}${field('weightKg','Peso embalado (kg)','number')}${field('lengthCm','Largo embalado (cm)','number')}${field('widthCm','Ancho embalado (cm)','number')}${field('heightCm','Alto embalado (cm)','number')}</div></details><details class="pt29-form-section"><summary>Identificadores por canal</summary><p class="tiny">SKU vendedor, publicación y variante permiten cotejar cada canal con el SKU central. Las categorías se configuran en su sección.</p><div class="catalog43-channel-fields">${['Sears','Sanborns','Liverpool','Elektra','Coppel','Mercado Libre','Tienda Nube'].map((c,n)=>`<section><h4>${esc(c)}</h4>${['sku','publication','variant'].map((f,i)=>`<div class="field"><label for="catalog43-${f}-${n}">${['SKU vendedor','ID de publicación','ID de variante'][i]}</label><input id="catalog43-${f}-${n}" name="catalog43-${f}-${n}" value="${esc(p?.channelIdentifiers?.[c]?.[['sellerSku','publicationId','variantId'][i]]||'')}" maxlength="100"></div>`).join('')}</section>`).join('')}</div></details>`);
 this.renderGallery();
 }
};
const catalog43OriginalDetails=productDetails;
productDetails=function(sku,...args){catalog43OriginalDetails(sku,...args);const p=state.products.find(p=>p.sku===sku),hero=document.querySelector('#drawer .pt29-product-hero');if(!hero||!p?.images?.length)return;hero.insertAdjacentHTML('afterend',`<section><h3>Galería del producto</h3><div class="catalog43-gallery">${p.images.map((i,n)=>`<a class="catalog43-photo" href="${esc(i.url)}" target="_blank" rel="noopener">${window.ProductMedia.html({name:p.name,images:[i]},{className:'catalog43-image'})}<small>${i.primary?'Principal':'Imagen '+(n+1)} · Ver original</small></a>`).join('')}</div></section>`);};
window.ProductTrace28.show=productDetails;
document.addEventListener('change',async e=>{
 if(e.target.id!=='catalog43-files')return;
 const files=[...e.target.files],form=e.target.closest('form');if(!files.length||Catalog43.uploading||form!==Catalog43.form)return;
 const session=Catalog43.session,workspace=ERP.workspace,submit=form.querySelector('[type="submit"]'),progress=form.querySelector('#catalog43-progress');
 const active=()=>Catalog43.session===session&&form.isConnected&&workspace===ERP.workspace;
 let added=[];
 try{
  if(Catalog43.images.length+files.length>100||Catalog43.images.filter(i=>i.source!=='V43').length+files.length>12)throw new Error('Carga como máximo 12 fotografías por ficha, además de las imágenes de origen.');
  for(const file of files){
   if(!['image/png','image/jpeg','image/webp','image/gif','image/avif'].includes(file.type))throw new Error('Selecciona JPG, PNG, WebP, GIF o AVIF.');
   if(!file.size||file.size>15*1024*1024)throw new Error('Cada fotografía debe tener contenido y pesar hasta 15 MB.');
  }
  Catalog43.uploading=true;Catalog43.controller=new AbortController();submit.disabled=true;
  // Blob previews are available immediately; document GET authorizes images only after product.save.
  added=files.map((file,n)=>{const preview=URL.createObjectURL(file);Catalog43.blobs.push(preview);return {id:'pending-'+n,preview,pending:true,primary:!Catalog43.images.length&&n===0};});
  Catalog43.images.push(...added);Catalog43.renderGallery();
  let failures=0;
  for(const [n,file] of files.entries()){
   const image=added[n];if(!Catalog43.images.includes(image))continue;
   progress.textContent='Guardando fotografía: '+file.name;
   try{
    const data=new FormData();data.append('file',file);progress.textContent='Preparando versiones optimizadas: '+file.name;data.append('thumbnail',await window.ProductMedia.optimized(file,256),'thumbnail.webp');data.append('preview',await window.ProductMedia.optimized(file,1280),'preview.webp');
    const response=await fetch('/api/documents?workspace='+encodeURIComponent(workspace)+'&purpose=image',{method:'POST',body:data,signal:Catalog43.controller.signal}),result=await response.json();
    if(!active())return;
    if(!response.ok)throw new Error(result.error||'No se pudo cargar la fotografía.');
    if(!Catalog43.images.includes(image))continue;
    const duplicate=Catalog43.images.find(i=>i!==image&&i.id===result.document.id);
    if(duplicate){if(image.primary)Catalog43.images.forEach(i=>i.primary=i===duplicate);Catalog43.images.splice(Catalog43.images.indexOf(image),1);Catalog43.revoke(image.preview);}
    else Object.assign(image,result.document,{source:'upload',pending:false,url:'/api/documents/'+result.document.id+'?workspace='+encodeURIComponent(workspace)});
   }catch(error){if(!active())return;image.pending=false;image.error=error.message;failures++;}
   Catalog43.renderGallery();
  }
  if(active())progress.textContent=failures?'Algunas fotografías no se cargaron. Quítalas y vuelve a seleccionarlas.':'Fotografías cargadas. Guarda la ficha para vincularlas al producto.';
 }catch(error){if(active()){progress.textContent=error.message;toast(error.message,true);}}
 finally{if(Catalog43.session===session){Catalog43.uploading=false;submit.disabled=false;e.target.value='';}}
});
document.addEventListener('input',e=>{if(e.target.name==='imageUrl'&&e.target.closest('form')===Catalog43.form)Catalog43.renderGallery();});
document.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b||b.closest('form')!==Catalog43.form)return;
 if(b.hasAttribute('data-catalog43-primary')){Catalog43.images.forEach((i,n)=>i.primary=n===Number(b.dataset.catalog43Primary));Catalog43.renderGallery();}
 if(b.hasAttribute('data-catalog43-remove')){
  const [image]=Catalog43.images.splice(Number(b.dataset.catalog43Remove),1);Catalog43.revoke(image?.preview);
  if(!Catalog43.images.some(i=>i.primary)&&Catalog43.images.length)Catalog43.images[0].primary=true;
  // Removing all gallery images should not resurrect the previously selected principal URL.
  if(!Catalog43.images.length)Catalog43.form.elements.namedItem('imageUrl').value='';
  Catalog43.renderGallery();
 }
 if(b.hasAttribute('data-catalog43-remove-url')){Catalog43.form.elements.namedItem('imageUrl').value='';Catalog43.renderGallery();}
});
