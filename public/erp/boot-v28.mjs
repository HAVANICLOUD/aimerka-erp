import * as retentions from './modules/retention-certificates.mjs?v=20261106-sat';
import * as productIdentity from './modules/product-identity.mjs?v=20261105-restore-sku';
import * as inventoryWorkspace from './modules/inventory-workspace.mjs?v=20261105-restore-sku';
import * as purchaseCatalogs from './modules/purchase-catalogs.mjs?v=20261105-fiscal';
import * as purchases from './modules/purchase-workspace.mjs?v=20261105-fiscal';
import * as payments from './modules/payment-reconciliation.mjs?v=20261106-sat';
import * as pricing from './modules/pricing-v28.mjs?v=20261106-flujo-v1';
import * as warehouses from './modules/warehouses.mjs';
import * as payouts from './modules/payout-schedules.mjs';
import * as settlements from './modules/settlement-documents.mjs?v=20261105-payment-differences';
import * as operations from './modules/operations-v28.mjs?v=20261029-documents';
import * as reconciliation from './modules/reconciliation-v28.mjs?v=20261106-flujo-v1';
import * as inventory from './modules/inventory-v28.mjs?v=20261105-restore-sku';
ERP.engines={retentions,productIdentity,inventoryWorkspace,purchaseCatalogs,purchases,payments,pricing,operations,reconciliation,inventory,warehouses,payouts,settlements};
D.available=inventory.available;D.orderTotal=inventory.orderTotal;D.expectedNet=inventory.expectedNet;
document.getElementById('main').innerHTML='<div class="loading-state"><div class="loader"></div><h2>Abriendo tu operación…</h2><p>Productos, pedidos, compras y gastos de AIMERKA.</p></div>';
try{await ERP.reload();navigate(initialRoute);}catch(error){document.getElementById('main').innerHTML='<div class="empty"><h2>No se pudo abrir la operación</h2><p>'+esc(error.message)+'</p><button class="btn primary" id="retry-load">Volver a intentar</button></div>';document.getElementById('retry-load').addEventListener('click',()=>location.reload());}
