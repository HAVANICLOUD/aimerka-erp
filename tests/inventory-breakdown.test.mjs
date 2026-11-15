import test from 'node:test';import assert from 'node:assert/strict';
import {inventoryPoolReport as report,INVENTORY_BUCKETS} from '../lib/inventory-breakdown.mjs';
import {applyInventory} from '../lib/inventory-v28.mjs';
const ctx={now:'2026-11-15T12:00:00Z',actor:'QA'};
function state(){return {products:[{sku:'A',upc:'123',skuAliases:['OLD'],name:'Producto A',status:'OK',good:10,reserved:0,quarantine:0,damaged:0,safety:0,costCents:10000,priceCents:20000}],orders:[],movements:[],events:[]};}
function apply(s,type,payload,id=type+'-'+s.events.length){return applyInventory(s,{id,type,payload},ctx);}
function sale(s,market,number,qty){return apply(s,'sale.create',{market,number,documentDate:'2026-11-14',items:[{sku:'A',qty,unitPriceCents:20000}]}).orderId;}
test('all six reports reconcile exactly to current quantities, preserve state and show deficits separately',()=>{
 const s=state();s.products[0].reserved=2;s.products[0].safety=1;s.products.push({...s.products[0],sku:'B',upc:'456',skuAliases:[],good:-2,reserved:0,safety:0});const before=structuredClone(s);
 for(const b of INVENTORY_BUCKETS){const r=report(s,b.key);assert.equal(r.total,b.key==='available'?7:s.products.reduce((n,p)=>n+p[b.key],0));assert.equal(r.rows.reduce((n,p)=>n+p.quantity,0),r.total);}assert.equal(report(s,'good').deficits,1);assert.deepEqual(s,before);assert.throws(()=>report(s,'invalid'));
});
test('operational reservations link exact market order and disappear when shipped',()=>{
 const s=state(),sears=sale(s,'Sears','S-001',2),coppel=sale(s,'Coppel','C-002',3);let r=report(s,'reserved');assert.equal(r.total,5);assert.equal(r.linkedQuantity,5);assert.equal(r.unverifiedQuantity,0);assert.deepEqual(r.rows[0].origins.map(o=>o.market).sort(),['Coppel','Sears']);assert.equal(r.rows[0].origins.find(o=>o.orderId===sears).quantity,2);
 apply(s,'sale.ship',{orderId:sears});r=report(s,'reserved');assert.equal(r.total,3);assert.equal(r.rows[0].origins.length,1);assert.equal(r.rows[0].origins[0].orderId,coppel);apply(s,'sale.cancel',{orderId:coppel,reason:'Pedido cancelado antes de enviar'});assert.equal(report(s,'reserved').total,0);
});
test('partial physical returns move from inspection to non-sellable and keep exact order and rejection reason',()=>{
 const s=state(),id=sale(s,'Mercado Libre','ML-001',3);apply(s,'sale.ship',{orderId:id});apply(s,'sale.return_request',{orderId:id,reason:'Producto con falla'});const line=s.orders[0].items[0];apply(s,'sale.return_receive',{orderId:id,items:[{id:line.id,qty:1}]});
 let r=report(s,'quarantine');assert.equal(r.total,1);assert.equal(r.rows[0].origins[0].orderNumber,'ML-001');apply(s,'sale.return_reject',{orderId:id,reason:'Pantalla rota al recibir'});assert.equal(report(s,'quarantine').total,0);r=report(s,'damaged');assert.equal(r.total,1);assert.equal(r.rows[0].origins[0].market,'Mercado Libre');assert.match(r.rows[0].origins[0].reason,/Pantalla rota/);
 apply(s,'sale.return_receive',{orderId:id,items:[{id:line.id,qty:2}]});assert.equal(report(s,'quarantine').total,2);apply(s,'sale.return_restock',{orderId:id,reason:'Revisión aprobada'});assert.equal(report(s,'quarantine').total,0);assert.equal(report(s,'damaged').total,1);
});
test('untraceable reductions never silently allocate remaining damaged goods to an arbitrary sale',()=>{
 const s=state(),id=sale(s,'Sears','SE-RETURN',3);apply(s,'sale.ship',{orderId:id});apply(s,'sale.return_request',{orderId:id});apply(s,'sale.return_receive',{orderId:id});apply(s,'sale.return_reject',{orderId:id,reason:'No funciona'});assert.equal(report(s,'damaged').linkedQuantity,3);
 apply(s,'inventory.adjust',{sku:'A',pool:'damaged',quantity:2,reason:'Se retira una pieza sin identificar de qué devolución'});const r=report(s,'damaged');assert.equal(r.total,2);assert.equal(r.linkedQuantity,0);assert.equal(r.unverifiedQuantity,2);assert.equal(r.rows[0].conflict,true);assert.equal(r.rows[0].lastMovement.reference,'Se retira una pieza sin identificar de qué devolución');
});
test('manual non-sellable entries explain their own documented reason without inventing a marketplace',()=>{
 const s=state();apply(s,'inventory.adjust',{sku:'A',pool:'damaged',quantity:2,reason:'Humedad detectada en almacén'});const r=report(s,'damaged');assert.equal(r.total,2);assert.equal(r.unverifiedQuantity,0);assert.equal(r.linkedQuantity,0);assert.equal(r.rows[0].origins[0].kind,'adjustment');assert.match(r.rows[0].origins[0].reason,/Humedad/);assert.equal(r.rows[0].origins[0].market,'');
});
test('historical sales do not claim current reserves or inspection by SKU alone',()=>{
 const s=state();s.products[0].reserved=2;s.products[0].quarantine=1;s.orders=[{id:'historic',sku:'A',qty:5,market:'Sears',status:'historical',stockMode:'historical',returnStatus:'inspection'}];assert.equal(report(s,'reserved').linkedQuantity,0);assert.equal(report(s,'reserved').unverifiedQuantity,2);assert.equal(report(s,'quarantine').unverifiedQuantity,1);
});
test('historical sale with new confirmed physical-return movements is correctly linked',()=>{
 const s=state();s.orders=[{id:'historic',number:'H-001',market:'Sanborns',status:'historical',stockMode:'historical',returnStatus:'requested',items:[{id:'line',sku:'A',qty:2}]}];apply(s,'sale.return_receive',{orderId:'historic',confirmPhysical:true});const r=report(s,'quarantine');assert.equal(r.total,2);assert.equal(r.linkedQuantity,2);assert.equal(r.rows[0].origins[0].market,'Sanborns');
});
test('declared reservations exceeding actual balance show candidates instead of fabricated allocations',()=>{
 const s=state();s.products[0].reserved=2;s.orders=[{id:'one',number:'1',market:'Sears',status:'reserved',stockMode:'operational',items:[{sku:'A',qty:3}]}];const r=report(s,'reserved');assert.equal(r.unverifiedQuantity,2);assert.equal(r.linkedQuantity,0);assert.equal(r.rows[0].relatedOrders.length,1);assert.equal(r.rows[0].relatedOrders[0].quantity,3);
});
test('SKU aliases preserve links; security is configuration and not a marketplace reservation',()=>{
 const s=state();s.products[0].safety=2;s.products[0].reserved=1;s.orders=[{id:'one',number:'1',market:'Coppel',status:'reserved',items:[{sku:'OLD',qty:1}]}];assert.equal(report(s,'reserved').linkedQuantity,1);const r=report(s,'safety');assert.equal(r.total,2);assert.equal(r.rows[0].available,7);assert.equal(r.rows[0].origins[0].kind,'configuration');assert.equal(r.rows[0].origins[0].orderId,undefined);
});
test('a cleared pool starts a fresh documented attribution instead of carrying old ambiguity forever',()=>{
 const s=state();apply(s,'inventory.adjust',{sku:'A',pool:'damaged',quantity:4,reason:'Saldo inicial'});apply(s,'inventory.adjust',{sku:'A',pool:'damaged',quantity:0,reason:'Baja de todas las piezas'});const id=sale(s,'Sears','NEW-RETURN',1);apply(s,'sale.ship',{orderId:id});apply(s,'sale.return_request',{orderId:id});apply(s,'sale.return_receive',{orderId:id});apply(s,'sale.return_reject',{orderId:id,reason:'Nueva falla documentada'});const r=report(s,'damaged');assert.equal(r.linkedQuantity,1);assert.equal(r.unverifiedQuantity,0);assert.equal(r.rows[0].conflict,false);
});
