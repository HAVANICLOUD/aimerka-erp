'use strict';
window.Catalog43={images:[],uploading:false,blobs:[],
 renderGallery(){const el=document.getElementById('catalog43-gallery');if(!el)return;el.innerHTML=this.images.map((i,n)=>`<div class="catalog43-photo"><img src="${esc(i.preview||i.url)}" alt="Imagen ${n+1} del producto"><small>${i.primary?'✓ Principal':'Imagen '+(n+1)}</small><button class="btn small" type="button" data-catalog43-primary="${n}">Principal</button><button class="btn small" type="button" data-catalog43-remove="${n}">Quitar</button></div>`).join('')||'<p class="tiny">Agrega fotografías para tu ficha y publicaciones.</p>';},
 readForm(form,p){
  if(this.uploading)throw new Error('Espera a que terminen de cargar las imágenes.');
  if(this.images.length||p.images?.length)p.images=this.images.map(({preview,...i})=>i);
  for(const k of ['description','manufacturerPart','condition','unitSat','countryOfOrigin','material'])p[k]=form.elements.namedItem('catalog43-'+k)?.value||'';
  p.dimensions={};for(const k of ['weightKg','heightCm','widthCm','lengthCm'])p.dimensions[k]=Number(form.elements.namedItem('catalog43-'+k)?.value||0);
  p.channelIdentifiers={};for(const [n,k] of ['Sears','Sanborns','Liverpool','Elektra','Coppel','Mercado Libre','Tienda Nube'].entries())p.channelIdentifiers[k]={sellerSku:form.elements.namedItem('catalog43-sku-'+n)?.value||'',publicationId:form.elements.namedItem('catalog43-publication-'+n)?.value||'',variantId:form.elements.namedItem('catalog43-variant-'+n)?.value||''};
 }
};
const catalog43OriginalForm=c28ProductForm;
const catalog43OriginalDetails=productDetails;
productDetails=function(sku){catalog43OriginalDetails(sku);const p=state.products.find(p=>p.sku===sku),hero=document.querySelector('#drawer .pt29-product-hero');if(!hero||!p?.images?.length)return;hero.insertAdjacentHTML('afterend',`<section><h3>Galería del producto</h3><div class="catalog43-gallery">${p.images.map((i,n)=>`<a class="catalog43-photo" href="${esc(i.url)}" target="_blank" rel="noopener"><img src="${esc(i.url)}" alt="${esc(p.name)} · imagen ${n+1}" loading="lazy"><small>${i.primary?'Principal':'Imagen '+(n+1)}</small></a>`).join('')}</div></section>`);};
c28ProductForm=function(sku){
 for(const url of Catalog43.blobs)URL.revokeObjectURL(url);Catalog43.blobs=[];
 catalog43OriginalForm(sku);const form=document.getElementById('pt29-product-form');if(!form)return;
 const p=sku?state.products.find(p=>p.sku===sku):{};Catalog43.images=structuredClone(p?.images||[]);
 const imageInput=form.querySelector('[name="imageUrl"]');if(imageInput)imageInput.closest('.field').hidden=true;
 const field=(key,label,type='text')=>`<div class="field"><label for="catalog43-${key}">${esc(label)}</label><input name="catalog43-${key}" id="catalog43-${key}" type="${type}" value="${esc(type==='number'?p?.dimensions?.[key]??'':p?.[key]??'')}" ${type==='number'?'min="0" step="0.001"':'maxlength="300"'}></div>`;
 form.querySelector('.pt29-form-preview').insertAdjacentHTML('afterend',`<section class="pt29-form-section"><h3>Fotografías del producto</h3><div id="catalog43-gallery" class="catalog43-gallery"></div><label class="catalog43-upload">Sube tus imágenes directamente<input id="catalog43-files" type="file" accept="image/png,image/jpeg" multiple><small>JPG o PNG · hasta 15 MB por archivo · elige una imagen principal</small></label><p id="catalog43-progress" role="status" aria-live="polite"></p></section>`);
 form.querySelector('.modal-actions').insertAdjacentHTML('beforebegin',`<details class="pt29-form-section"><summary>Descripción, empaque y atributos comerciales</summary><div class="form-grid">${field('description','Descripción comercial')}${field('manufacturerPart','Número de parte del fabricante')}${field('condition','Condición (nuevo, reacondicionado…)')}${field('material','Material')}${field('unitSat','Unidad SAT')}${field('countryOfOrigin','País de origen')}${field('weightKg','Peso embalado (kg)','number')}${field('lengthCm','Largo embalado (cm)','number')}${field('widthCm','Ancho embalado (cm)','number')}${field('heightCm','Alto embalado (cm)','number')}</div></details><details class="pt29-form-section"><summary>Identificadores por canal</summary><p class="tiny">SKU vendedor, publicación y variante permiten cotejar cada canal con el SKU central. Las categorías se configuran en su sección.</p><div class="catalog43-channel-fields">${['Sears','Sanborns','Liverpool','Elektra','Coppel','Mercado Libre','Tienda Nube'].map((c,n)=>`<section><h4>${esc(c)}</h4>${['sku','publication','variant'].map((f,i)=>`<div class="field"><label for="catalog43-${f}-${n}">${['SKU vendedor','ID de publicación','ID de variante'][i]}</label><input id="catalog43-${f}-${n}" name="catalog43-${f}-${n}" value="${esc(p?.channelIdentifiers?.[c]?.[['sellerSku','publicationId','variantId'][i]]||'')}" maxlength="100"></div>`).join('')}</section>`).join('')}</div></details>`);
 Catalog43.renderGallery();
};
document.addEventListener('change',async e=>{
 if(e.target.id!=='catalog43-files')return;const files=[...e.target.files];if(!files.length||Catalog43.uploading)return;
 Catalog43.uploading=true;const form=e.target.closest('form'),submit=form.querySelector('[type="submit"]');submit.disabled=true;const workspace=ERP.workspace;
 try{
  if(Catalog43.images.filter(i=>i.source!=='V43').length+files.length>12)throw new Error('Carga como máximo 12 imágenes nuevas por ficha.');
  for(const file of files){
   if(!['image/png','image/jpeg'].includes(file.type))throw new Error('Selecciona fotografías JPG o PNG.');
   document.getElementById('catalog43-progress').textContent='Guardando imagen: '+file.name;
   const data=new FormData();data.append('file',file);const response=await fetch('/api/documents?workspace='+workspace+'&purpose=image',{method:'POST',body:data}),result=await response.json();if(!response.ok)throw new Error(result.error);
   if(workspace!==ERP.workspace||!form.isConnected)throw new Error('La ficha se cerró o cambió el espacio. Vuelve a abrirla.');
   if(!Catalog43.images.some(i=>i.id===result.document.id)){const preview=URL.createObjectURL(file);Catalog43.blobs.push(preview);Catalog43.images.push({...result.document,source:'upload',preview,url:'/api/documents/'+result.document.id+'?workspace='+workspace,primary:!Catalog43.images.length});Catalog43.renderGallery();}
  }
  document.getElementById('catalog43-progress').textContent='Imágenes cargadas. Guarda la ficha para vincularlas al producto.';
 }catch(error){const el=document.getElementById('catalog43-progress');if(el)el.textContent=error.message;toast(error.message,true);}finally{Catalog43.uploading=false;submit.disabled=false;e.target.value='';}
});
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-catalog43-primary')){Catalog43.images.forEach((i,n)=>i.primary=n===Number(b.dataset.catalog43Primary));Catalog43.renderGallery();}if(b.hasAttribute('data-catalog43-remove')){Catalog43.images.splice(Number(b.dataset.catalog43Remove),1);if(Catalog43.images.length&&!Catalog43.images.some(i=>i.primary))Catalog43.images[0].primary=true;Catalog43.renderGallery();}});
