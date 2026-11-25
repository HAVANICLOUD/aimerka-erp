'use strict';
(function(){
 const engine=()=>import('/erp/modules/purchase-recognition-profiles.mjs?v=20261124-retail');
 const prior=renderers.catalogs;
 renderers.catalogs=()=>`<section class="buy-catalog-entry"><div>${icon('file')}<span><strong>Lectura de compras por proveedor</strong><small>Reglas de orden o ticket y equivalencias conservadas en este espacio.</small></span></div><button class="btn" type="button" data-recognition-open>Configurar lectura</button></section>`+prior();
 async function open(supplier='Costco'){
  if(!ERP.access?.permissions?.includes('settings')){toast('Necesitas permiso de configuración.',true);return;}
  const m=await engine(),p=m.recognitionProfile(supplier,state.config?.purchaseRecognition),suppliers=[...new Set(['Costco',...(state.catalogs?.suppliers||[]).map(s=>typeof s==='string'?s:s.name||s.value),...(state.config?.purchaseRecognition?.profiles||[]).map(p=>p.supplier)])].filter(Boolean);
  op28showModal(`<h2 id="modal-title">Lectura de compras por proveedor</h2><p class="modal-subtitle">Una factura puede originar una compra. Cada proveedor conserva sus reglas; los códigos de artículo confirmados se guardan en Equivalencias.</p><form id="purchase-recognition-form"><div class="form-grid"><label class="field">${icon('box')} Proveedor<select name="supplier">${suppliers.map(s=>`<option ${s===supplier?'selected':''}>${esc(s)}</option>`).join('')}</select></label><div class="field"><label>${icon('file')} Versión de la regla</label><input value="${esc(p.version)}" readonly></div></div><label class="buy-check"><input name="acceptTicket" type="checkbox" ${p.acceptTicket?'checked':''}> Aceptar ticket cuando no exista número de orden</label><div class="field spacer-top"><label>Etiquetas del ticket en el documento</label><textarea name="ticketLabels" rows="3" required>${esc(p.ticketLabels.join('\n'))}</textarea><small>Una etiqueta por línea, por ejemplo «Número de Ticket». Nunca sustituye una orden distinta ni omite la validación fiscal.</small></div><p class="info-box blue">Se guardan para este proveedor y este espacio. Cambiar una regla no reescribe documentos históricos ni elimina equivalencias o lectores anteriores.</p><p data-recognition-error class="form-error" hidden></p><div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Cerrar</button><button class="btn primary" type="submit">Guardar regla</button></div></form>`);
 }
 document.addEventListener('click',e=>{if(e.target.closest('[data-recognition-open]'))open();});
 document.addEventListener('change',e=>{if(e.target.matches('#purchase-recognition-form [name="supplier"]'))open(e.target.value);});
 document.addEventListener('submit',async e=>{
  if(e.target.id!=='purchase-recognition-form')return;e.preventDefault();const f=e.target,button=f.querySelector('[type="submit"]');button.disabled=true;
  try{const result=await ERP.command('config.purchaseRecognition.save',{supplier:f.elements.supplier.value,acceptTicket:f.elements.acceptTicket.checked,ticketLabels:f.elements.ticketLabels.value.split('\n').map(s=>s.trim()).filter(Boolean)});if(!result.ok)throw Error(result.error||'No se guardó la regla.');op28closeModal();}catch(error){const target=f.querySelector('[data-recognition-error]');target.hidden=false;target.textContent=error.message;button.disabled=false;}
 });
})();
