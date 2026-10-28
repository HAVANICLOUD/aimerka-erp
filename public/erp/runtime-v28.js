'use strict';
const ERP={
 workspace:localStorage.getItem('aimerka-workspace-v28')||'v28',revision:null,engines:{},ready:false,busy:false,lastCommand:null,updatedAt:null,
 async reload(){
   const response=await fetch('/api/state?workspace='+encodeURIComponent(this.workspace),{cache:'no-store'}),data=await response.json();
   if(!response.ok)throw new Error(data.error||'No se pudo cargar la operación.');
   state=data.state;this.revision=data.revision;this.updatedAt=data.updatedAt;this.ready=true;render();return data;
 },
 async command(type,payload={},options={}){
   if(this.busy||!this.ready){toast('Espera a que termine la operación actual.',true);return {ok:false};}
   const command=options.command||{id:this.makeId(),type,payload,workspace:this.workspace,revision:this.revision};
   this.busy=true;this.setStatus('Guardando…','saving');
   try{
     const response=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)}),data=await response.json();
     if(data.state){state=data.state;this.revision=data.revision;this.updatedAt=data.updatedAt;}
     if(!response.ok){if(data.state)render();throw new Error(data.error||'No se pudo guardar.');}
     this.lastCommand=command;render();toast(data.result?.message||'Cambios guardados.');this.setStatus('Guardado','saved');return {ok:true,result:data.result,state:data.state};
   }catch(error){toast(error.message,true);this.setStatus('No se guardó · reintentar','error');return {ok:false,error:error.message};}
   finally{this.busy=false;}
 },
 makeId(){if(typeof crypto.randomUUID==='function')return crypto.randomUUID();return 'op-'+Array.from(crypto.getRandomValues(new Uint8Array(16))).map(x=>x.toString(16).padStart(2,'0')).join('');},
 setStatus(label,tone){const el=document.getElementById('save-status');if(el){el.textContent=label;el.className='save-status '+tone;}},
 download(name,body,type='text/plain;charset=utf-8'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([body],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);},
 downloadCSV(name,rows){const safe=v=>{const s=String(v??'');return '"'+(/^[\s]*[=+@-]/.test(s)?"'"+s:s).replaceAll('"','""')+'"';};let data=rows;if(Array.isArray(data)&&data.length&&!Array.isArray(data[0])&&typeof data[0]==='object'){const keys=Object.keys(data[0]);data=[keys,...data.map(row=>keys.map(key=>row[key]))];}const csv=typeof data==='string'?data:data.map(row=>row.map(safe).join(',')).join('\r\n');this.download(name.endsWith('.csv')?name:name+'.csv','\ufeff'+csv,'text/csv;charset=utf-8');},
 field(id,label,value='',type='text',extra=''){return `<div class="field"><label for="${id}">${esc(label)}</label><input id="${id}" type="${type}" value="${esc(value??'')}" ${extra}></div>`;},
 select(id,label,values,current='',empty='Seleccionar'){return `<div class="field"><label for="${id}">${esc(label)}</label><select id="${id}"><option value="">${esc(empty)}</option>${values.map(v=>{const value=typeof v==='object'?v.value:v,label=typeof v==='object'?v.label:v;return `<option value="${esc(value)}" ${String(current)===String(value)?'selected':''}>${esc(label)}</option>`;}).join('')}</select></div>`;},
 today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
};
window.ERP=ERP;
const legacyViews={dashboard,orders:ordersPage,inventory:inventoryPage,products:productsPage,pricing:pricingPage,settlements:settlementsPage,incidents:incidentsPage,integrations:integrationsPage,project:projectPage};
const navDefinitions=[['dashboard','Resumen','grid','OPERACIÓN'],['orders','Pedidos y ventas','bag'],['inventory','Inventario','box'],['products','Productos','tag'],['purchases','Compras y mercancía','truck'],['expenses','Gastos y abonos','wallet'],['calendar','Calendario de pagos','clock'],['pricing','Precios y comisiones','calculator','CONTROL COMERCIAL'],['settlements','Conciliación y lotes','wallet'],['incidents','Incidencias','alert'],['statistics','Estadísticas','arrowup'],['bestsellers','Más vendidos','arrowup'],['configuration','Reglas y tarifas','layers','MI ESPACIO'],['catalogs','Catálogos','tag'],['audit','Bitácora y respaldo','clock'],['integrations','Integraciones','plug'],['project','Alcance V28','shield']];
nav.splice(0,nav.length,...navDefinitions.map(([a,b,c])=>[a,b,c]));
sidebar=function(){document.getElementById('sidebar').innerHTML=`<a class="brand" href="#dashboard" aria-label="AiMerka, ir al resumen"><svg viewBox="49 166 685 173" role="img" aria-label="Logotipo AiMerka"><image href="/erp/assets/aimerka-logo-original.jpeg" width="1448" height="1086"/></svg></a><div class="workspace-picker"><label for="workspace-picker">ESPACIO DE TRABAJO</label><select id="workspace-picker"><option value="v28" ${ERP.workspace==='v28'?'selected':''}>HAVANI · datos V28</option><option value="practice" ${ERP.workspace==='practice'?'selected':''}>Práctica · datos ficticios</option></select><small>${ERP.workspace==='v28'?'Copia operativa del archivo':'Prueba los flujos con libertad'}</small></div>${navDefinitions.map(([id,label,ic,group])=>`${group?'<div class="nav-group-label">'+group+'</div>':''}<button class="nav-item ${view===id?'active':''}" data-view="${id}" ${view===id?'aria-current="page"':''}>${icon(ic)}<span>${label}</span>${id==='orders'?'<span class="nav-count">'+state.orders.length+'</span>':''}</button>`).join('')}<div class="sidebar-bottom"><div class="pilot-card"><div class="pilot-top">${icon('shield')} AIMERKA · V28</div><p>Operación con guardado en servidor y trazabilidad de los cambios.</p><button data-v28="guide">Recorrido de la operación ↗</button></div><div class="workspace"><div class="workspace-icon">HT</div><div><strong>HAVANI Technologies</strong><small>Acceso privado</small></div></div></div>`;};
const oldRender=render;
render=function(){
 if(!ERP.ready)return;
 oldRender();
 const pill=document.querySelector('.demo-pill');if(pill)pill.innerHTML=`<span></span>${ERP.workspace==='v28'?'Datos V28':'Práctica'}`;
 document.querySelector('.app-footer').innerHTML=`<span>AiMerka · Operación V28</span><span>Versión de datos ${ERP.revision} · Guardado en servidor · APIs por conectar</span>`;
 if(!document.getElementById('save-status')){const s=document.createElement('span');s.id='save-status';s.className='save-status saved';s.textContent='Guardado';document.querySelector('.topbar').insertBefore(s,document.querySelector('.demo-pill'));}
};
persist=function(){toast('Utiliza Guardar en el formulario para registrar los cambios en el servidor.',true);};
primaryNew=function(){return `<button class="btn primary" data-v28="sale-new">${icon('plus')} Registrar venta</button>`;};
execute=async function(type,id,extra={}){const map={ship:'sale.ship',deliver:'sale.deliver',cancel:'sale.cancel',refund:'sale.refund',receive_return:'sale.return_receive',restock:'sale.return_restock',reject_return:'sale.return_reject',return_request:'sale.return_request'};return ERP.command(map[type]||type,{orderId:id,...extra});};
function nullMoney(value){return value===null||value===undefined?'<span class="muted">Sin informar</span>':money(value);}
function datasetNote(){return ERP.workspace==='v28'?'Datos importados de V28. Los registros históricos conservan su procedencia.':'Espacio de práctica con datos ficticios, separado de V28.';}
function pageTabs(tabs,current,attr){return `<div class="tabs">${tabs.map(([id,label])=>`<button class="tab ${id===current?'active':''}" ${attr}="${esc(id)}">${esc(label)}</button>`).join('')}</div>`;}

document.addEventListener('change',async e=>{if(e.target.id!=='workspace-picker')return;if(ERP.busy||!ERP.ready){e.target.value=ERP.workspace;return;}const previous=ERP.workspace;ERP.workspace=e.target.value;ERP.ready=false;ERP.lastCommand=null;e.target.disabled=true;window.Price28?.discardDrafts();try{closeDrawer();document.getElementById('modal').close();document.getElementById('main').innerHTML='<div class="loading-state"><div class="loader"></div><h2>Cargando espacio de trabajo…</h2></div>';await ERP.reload();localStorage.setItem('aimerka-workspace-v28',ERP.workspace);toast('Espacio de trabajo cargado.');}catch(error){ERP.workspace=previous;ERP.ready=true;render();toast(error.message,true);}});
// Intercept only mutations from the original prototype. Its calculator and
// operational concepts remain available; changes now go through the server.
document.addEventListener('click',async e=>{
 const el=e.target.closest('button');if(!el)return;const a=el.dataset.action;
 if(el.dataset.settle){e.preventDefault();e.stopImmediatePropagation();const o=state.orders.find(o=>o.id===el.dataset.settle);const amountCents=Math.round(Number(document.getElementById('paid-'+o.id).value)*100);await ERP.command('reconciliation.save',{orderId:o.id,input:{amountCents,date:ERP.today(),notes:'Registro desde conciliación individual.'}});return;}
 if(!['save-rule','duplicate','confirm-reset','reset','new','guide','guide-start'].includes(a))return;
 e.preventDefault();e.stopImmediatePropagation();
 if(a==='new'||a==='guide-start'){document.getElementById('modal').close();window.saleFormV28?.();}
 else if(a==='save-rule'){if([...document.querySelectorAll('[data-calc]')].some(f=>!f.reportValidity()))return;await ERP.command('pricing.legacyScenario.save',{calc});}
 else if(a==='duplicate'){if(!ERP.lastCommand){toast('Registra primero una operación para probar un aviso repetido.');return;}await ERP.command(ERP.lastCommand.type,ERP.lastCommand.payload,{command:ERP.lastCommand});}
 else if(a==='reset'){if(ERP.workspace!=='practice'){toast('Selecciona Práctica para reiniciar el escenario de ejemplo.');return;}showModal(`<h2 id="modal-title">Restablecer la práctica</h2><p>Se repondrán los pedidos y productos ficticios. Los registros del espacio V28 se conservan.</p><div class="modal-actions"><button class="btn" data-action="close-modal">Cancelar</button><button class="btn primary" data-action="confirm-reset">Restablecer práctica</button></div>`);}
 else if(a==='confirm-reset'){const r=await ERP.command('practice.reset');if(r.ok)document.getElementById('modal').close();}
 else window.guideV28?.();
},true);
