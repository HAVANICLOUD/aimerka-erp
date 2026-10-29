import * as pricing from './modules/pricing-v28.mjs';
import * as operations from './modules/operations-v28.mjs?v=20261029-documents';
import * as reconciliation from './modules/reconciliation-v28.mjs';
import * as inventory from './modules/inventory-v28.mjs?v=20261029-documents';
ERP.engines={pricing,operations,reconciliation,inventory};
D.available=inventory.available;D.orderTotal=inventory.orderTotal;D.expectedNet=inventory.expectedNet;
document.getElementById('main').innerHTML='<div class="loading-state"><div class="loader"></div><h2>Abriendo tu operación…</h2><p>Productos, pedidos, compras y gastos de AIMERKA.</p></div>';
try{await ERP.reload();navigate(initialRoute);}catch(error){document.getElementById('main').innerHTML='<div class="empty"><h2>No se pudo abrir la operación</h2><p>'+esc(error.message)+'</p><button class="btn primary" id="retry-load">Volver a intentar</button></div>';document.getElementById('retry-load').addEventListener('click',()=>location.reload());}
