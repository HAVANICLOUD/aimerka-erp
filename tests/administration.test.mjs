import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyCommand} from '../lib/commands.mjs';
import {accessView,assertPermission,applyAccessCommand} from '../lib/access-control.mjs';
import {warehouseBalances,POOLS} from '../lib/warehouses.mjs';
import {pricePolicy,quote,roundRegular99} from '../lib/pricing-v28.mjs';
const config=JSON.parse(readFileSync(new URL('../data/pricing-config.json',import.meta.url)));
let sequence=0;const ctx={workspace:'v28',now:'2026-10-30T20:00:00.000Z',actor:'QA',ownerEmail:'owner@example.com'};
const command=(s,type,payload)=>applyCommand(s,{id:'qa-admin-'+(++sequence),type,payload},ctx);
function state(){return {config:structuredClone(config),products:[{sku:'QA',upc:'885609037998',name:'Producto QA',brand:'Prueba',status:'OK',good:10,reserved:2,quarantine:1,damaged:0,safety:1,costCents:10000,priceCents:50000}],orders:[],events:[],purchases:[],movements:[]};}
const totals=s=>Object.fromEntries(POOLS.map(k=>[k,warehouseBalances(s).reduce((n,r)=>n+r[k],0)]));
test('creating and editing warehouses preserve every aggregate stock pool; transfer only redistributes available units',()=>{
 const s=state(),stock=structuredClone(s.products),r=command(s,'warehouse.save',{name:'Full',code:'FULL'}),initial=totals(s);
 command(s,'warehouse.transfer',{from:'principal',to:r.id,sku:'QA',qty:3,reason:'Ubicación física confirmada'});
 assert.deepEqual(s.products,stock);assert.deepEqual(totals(s),initial);assert.equal(warehouseBalances(s).find(x=>x.warehouseId===r.id).good,3);
 assert.equal(s.warehouseTransfers.length,1);assert.throws(()=>command(s,'warehouse.save',{id:r.id,name:'Full',code:'FULL',active:false}),/existencias/);
 const before=JSON.stringify(s);assert.throws(()=>command(s,'warehouse.transfer',{from:'principal',to:r.id,sku:'QA',qty:5,reason:'Invade reservas'}),/disponibles/);assert.equal(JSON.stringify(s),before);
});
test('warehouse-specific sale reserves and ships only its own stock; a global surplus cannot bypass local availability',()=>{
 const s=state(),r=command(s,'warehouse.save',{name:'Secundario',code:'SEC'});command(s,'warehouse.transfer',{from:'principal',to:r.id,sku:'QA',qty:3,reason:'Prueba'});
 const payload={market:'Sears',number:'QA-1',documentDate:'2026-10-30',warehouseId:r.id,items:[{sku:'QA',qty:4,unitPriceCents:30000}]},before=JSON.stringify(s);
 assert.throws(()=>command(s,'sale.create',payload),/almacén/);assert.equal(JSON.stringify(s),before);
 payload.items[0].qty=2;const sale=command(s,'sale.create',payload);assert.equal(s.orders[0].warehouseId,r.id);
 command(s,'sale.ship',{orderId:sale.id});const local=warehouseBalances(s).find(x=>x.warehouseId===r.id);assert.equal(local.good,1);assert.equal(local.reserved,0);assert.equal(s.products[0].good,8);assert.equal(s.products[0].reserved,2);
 assert.deepEqual(totals(s),Object.fromEntries(POOLS.map(k=>[k,s.products[0][k]])));
});
test('owner is protected; unassigned shared visitors are read-only; suspended members cannot read or mutate',()=>{
 const s=state(),owner=accessView(s,{email:'OWNER@example.com'},ctx.ownerEmail),viewer=accessView(s,{email:'viewer@example.com'},ctx.ownerEmail);
 assert.doesNotThrow(()=>assertPermission(owner,'access.user.save'));assert.throws(()=>assertPermission(viewer,'purchase.importDocuments'),/rol/);
 applyAccessCommand(s,{id:'qa',type:'access.user.save',payload:{email:'viewer@example.com',roleId:'operations',active:false}},ctx);
 const suspended=accessView(s,{email:'viewer@example.com'},ctx.ownerEmail);assert.equal(suspended.active,false);assert.equal(suspended.permissions.length,0);
 assert.throws(()=>applyAccessCommand(s,{id:'qa',type:'access.user.save',payload:{email:ctx.ownerEmail,roleId:'reader',active:false}},ctx),/propietario/);
});
test('custom role permissions come from saved policy and cannot authorize unknown commands',()=>{
 const s=state();command(s,'access.role.save',{name:'Facturación',permissions:['purchases']});const role=s.security.roles.at(-1);
 command(s,'access.user.save',{email:'invoices@example.com',roleId:role.id});const member=accessView(s,{email:'invoices@example.com'},ctx.ownerEmail);
 assert.doesNotThrow(()=>assertPermission(member,'purchase.importDocuments'));assert.doesNotThrow(()=>assertPermission(member,'inventory.receivePurchase'));
 for(const type of ['warehouse.transfer','config.pricing.save','inventory.adjust','practice.reset','unknown.action'])assert.throws(()=>assertPermission(member,type));
});
test('nondefault rounding affects automatic, manual-regular and competitive prices; invalid configuration is rejected',()=>{
 const s=state();Object.assign(s.config.parameters,{priceEnding:9,priceStep:10});
 const input={context:'calculadora',cost:100,marketPrice:500,channel:'T1 Comercios',category:'Todas las categorías',shippingType:'Pequeño',margin:.1,inflation:.1};
 for(const mode of ['tasas','competitivo','precios']){const r=quote(s.config,{...input,mode,manualDiscount:309});assert.equal(r.valid,true);assert.equal(r.regular.price%10,9);if(mode!=='precios')assert.equal(r.discount.price%10,9);}
 assert.equal(roundRegular99(309,.1,pricePolicy(s.config))%10,9);
 assert.throws(()=>command(s,'config.pricing.save',{section:'parameters',value:{...s.config.parameters,priceEnding:10}}),/terminación/);
});
test('zero-ending grids never produce a free price and transfer fees are configurable',()=>{
 const s=state();Object.assign(s.config.parameters,{priceEnding:0,priceStep:1,transferDiscount:.05,transferCommission:.01});
 const r=quote(s.config,{cost:100,marketPrice:500,channel:'Tienda Nube',shippingType:'Pequeño',margin:.1,inflation:.1});assert.equal(r.valid,true);assert.ok(r.discount.price>0);assert.equal(r.transfer.price,r.discount.price*.95);assert.equal(r.transfer.commission,r.transfer.price*.01);
});
