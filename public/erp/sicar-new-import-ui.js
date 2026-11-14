(function(){
 'use strict';let bundle=null,busy=false;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const existing=row=>(state.products||[]).some(p=>[p.sku,p.upc,p.sellerSku,p.sicarCode,...(p.skuAliases||[])].some(c=>c&&row.codes.some(value=>String(value).toUpperCase()===String(c).toUpperCase())));
 function panel(){return `<div class="pt29-product-editor"><h2 id="modal-title">Importar productos nuevos de SICAR</h2><p>Agrega únicamente productos que todavía no existen. Conserva los SKU, costos promedio, UPC, datos fiscales e imágenes; los productos existentes y su historial no se modifican.</p><label>Archivo de cotejo preparado<input type="file" id="sicar-new-file" accept=".json,application/json"></label><div id="sicar-new-preview" role="status" style="margin:18px 0;max-height:45vh;overflow:auto"></div><div class="modal-actions"><button class="btn" type="button" data-sicar-new-close>Cerrar</button><button class="btn primary" type="button" id="sicar-new-apply" disabled>Importar productos nuevos</button></div></div>`;}
 function feedback(message){const p=document.getElementById('sicar-new-preview');if(p)p.textContent=message;}
 document.addEventListener('click',async event=>{
  if(event.target.closest('[data-sicar-new-import]')){bundle=null;showModal(panel());return;}
  if(event.target.closest('[data-sicar-new-close]')){if(!busy)document.getElementById('modal').close();return;}
  if(!event.target.closest('#sicar-new-apply')||!bundle||busy)return;
  busy=true;document.getElementById('sicar-new-apply').disabled=true;
  try{
   const products=[];
   for(const [index,row] of bundle.products.entries()){
    if(existing(row))continue;
    feedback(`Guardando fotografías: producto ${index+1} de ${bundle.products.length} · ${row.name}`);
    const images=[];
    for(const [n,image] of (row.images||[]).entries()){
     const raw=atob(image.base64),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),data=new FormData();data.append('file',new File([bytes],image.name,{type:image.mime}));
     const response=await fetch('/api/documents?workspace='+encodeURIComponent(ERP.workspace)+'&purpose=image',{method:'POST',body:data}),result=await response.json();if(!response.ok)throw Error(result.error||'No se pudo cargar una fotografía.');
     if(!images.some(i=>i.id===result.document.id))images.push({...result.document,primary:n===0,source:'upload'});
    }
    products.push({...row,images});
   }
   if(!products.length){feedback('Todos estos productos ya existen; no se hicieron cambios.');return;}
   feedback('Validando y guardando productos en el ERP…');
   const result=await ERP.command('inventory.importSicarNewProducts',{manifest:{...bundle,products}});
   if(!result?.ok)throw Error(result?.error||'No se pudo completar la importación.');
   bundle=null;feedback(result.result?.message||'Productos nuevos importados.');
  }catch(error){feedback(error.message||'No se pudo importar.');}finally{busy=false;const button=document.getElementById('sicar-new-apply');if(button)button.disabled=!bundle;}
 });
 document.addEventListener('change',async event=>{
  if(event.target.id!=='sicar-new-file'||busy)return;
  try{const file=event.target.files?.[0];bundle=null;if(!file)return;if(file.size>100*1024*1024)throw Error('Divide el archivo en lotes de hasta 100 MB.');feedback('Leyendo archivo y cotejando identificadores…');
   const data=JSON.parse(await file.text());if(data.format!=='AIMERKA-SICAR-NEW-1'||!Array.isArray(data.products)||!data.products.length||data.products.length>200||data.products.some(r=>!Array.isArray(r.codes)||!r.sku||!r.name||r.quantity!==0||!Array.isArray(r.images)||r.images.length>12))throw Error('Selecciona un archivo de cotejo válido de productos nuevos con inventario cero.');
   bundle=data;const rows=data.products.filter(r=>!existing(r)),p=document.getElementById('sicar-new-preview');p.innerHTML=`<strong>${rows.length} productos nuevos · ${rows.reduce((s,r)=>s+r.images.length,0)} fotografías</strong><p>${data.products.length-rows.length} productos existentes se conservarán.</p><ul>${rows.map(r=>`<li><strong>${esc(r.name)}</strong><br>SKU ${esc(r.sku)} · UPC ${esc(r.upc)} · Costo promedio $${Number(r.averageCostMxn).toFixed(2)} · Existencia 0 · ${r.images.length} imágenes</li>`).join('')}</ul>`;document.getElementById('sicar-new-apply').disabled=!rows.length;
  }catch(error){bundle=null;feedback(error.message||'Archivo inválido.');document.getElementById('sicar-new-apply').disabled=true;}
 });
})();
