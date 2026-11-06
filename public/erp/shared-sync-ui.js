'use strict';
(function(){
 localStorage.removeItem('aimerka-workspace-v28');
 const address=new URL(location.href);if(address.searchParams.has('workspace')){address.searchParams.delete('workspace');history.replaceState(null,'',address.pathname+address.search+address.hash);}
 ERP.workspace='v43';
 ERP.hasOpenDraft=()=>Boolean(document.querySelector('dialog[open],#drawer:not([hidden]),#main form'))||Boolean(document.activeElement?.closest?.('#main')&&document.activeElement.matches('input,textarea,select,[contenteditable="true"]'));
 let checking=false,pending=false;
 function status(text){let button=document.getElementById('shared-data-update');if(!button){button=document.createElement('button');button.id='shared-data-update';button.className='btn small';button.type='button';button.setAttribute('aria-label','Actualizar datos compartidos');button.addEventListener('click',()=>ERP.checkSharedUpdates(true));document.querySelector('.topbar')?.append(button);}button.textContent=text;}
 ERP.checkSharedUpdates=async function(force=false){
  if(checking||!ERP.ready||ERP.busy||document.hidden)return;
  if(force&&ERP.hasOpenDraft()){toast('Guarda o cierra el formulario o la ficha para actualizar sin perder lo capturado.');return;}
  checking=true;
  try{const response=await fetch('/api/revision',{cache:'no-store'});if(!response.ok)throw new Error('No se pudo comprobar la actualización.');const meta=await response.json();
   const changed=meta.revision>ERP.revision||meta.teamRevision>Number(ERP.access?.teamRevision||0);if(!changed&&!force){if(!pending)status('Al día');return;}
   if(ERP.busy)return;
   if(ERP.hasOpenDraft()){pending=true;status('Cambios disponibles');return;}
   const loaded=await ERP.reload({passive:true});if(loaded.skipped){pending=true;status('Cambios disponibles');return;}
   pending=false;status('Al día');if(force)toast('Datos compartidos actualizados.');
  }catch(error){status('Reintentar actualización');if(force)toast(error.message,true);}finally{checking=false;}
 };
 status('Actualización compartida');
 setInterval(()=>ERP.checkSharedUpdates(),10000);
 window.addEventListener('focus',()=>ERP.checkSharedUpdates());
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)ERP.checkSharedUpdates();});
})();
