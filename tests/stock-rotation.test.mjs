import test from 'node:test';import assert from 'node:assert/strict';
import {rotationReport,completeMonths,civilDate,saveRotationPolicy} from '../lib/stock-rotation.mjs';
import {previewCommercialEvent,commercialEventCommand} from '../lib/commercial-events.mjs';
import {permissionFor} from '../lib/access-control.mjs';import {readFileSync} from 'node:fs';
const config=JSON.parse(readFileSync(new URL('../data/pricing-config.json',import.meta.url)));
const product={sku:'A',upc:'123456789012',skuAliases:['OLD'],name:'Producto',brand:'Apple',category:'AUDIFONOS',good:4,reserved:1,safety:1,priceCents:1249900,costCents:858996,averageCostMxn:8589.956625,shippingType:'Pequeño'};
const purchase=(date='2026-01-10',extra={})=>({id:'buy',documentDate:date,date:'2026-11-13',items:[{sku:'A',qty:4}],...extra});
const sale=(date='2026-03-10',extra={})=>({id:'sale',market:'Sears',documentDate:date,status:'historical',stockMode:'historical',items:[{sku:'A',qty:1}],...extra});
const state=()=>({products:[structuredClone(product)],purchases:[purchase()],orders:[],config:structuredClone(config)});
const report=s=>rotationReport(s,{asOf:'2026-11-14'})[0];
test('six calendar-month levels including 6+ critical and no artificial month from day counts',()=>{
 for(let n=0;n<=9;n++){const s=state();s.purchases=[purchase(`2026-${String(11-n).padStart(2,'0')}-14`)];assert.equal(report(s).level,Math.min(n,6));assert.equal(report(s).months,n);}
 assert.equal(completeMonths('2026-10-15','2026-11-14'),0);assert.equal(completeMonths('2026-01-31','2026-02-28'),1);assert.equal(completeMonths('2024-02-29','2025-02-28'),12);
});
test('last documentary sale across any market takes precedence; latest small replenishment never hides old idle stock',()=>{
 const s=state();s.orders=[sale('2026-04-01'),sale('2026-06-12',{market:'Coppel'}),sale('2026-05-11',{market:'Tienda Nube'})];s.purchases.push(purchase('2026-11-12'));
 const row=report(s);assert.equal(row.lastSale,'2026-06-12');assert.equal(row.firstPurchase,'2026-01-10');assert.equal(row.lastPurchase,'2026-11-12');assert.equal(row.months,5);assert.equal(row.anchorKind,'sale');assert.equal(row.available,2);assert.equal(row.averageCostCents,858996);
});
test('cancellations refunds reinstated returns and reservations do not reset effective rotation',()=>{
 const s=state();s.orders=[sale('2026-04-01'),sale('2026-11-01',{status:'cancelled'}),sale('2026-11-02',{commercialStatus:'Cancelada'}),sale('2026-11-03',{paymentStatus:'refunded'}),sale('2026-11-04',{returnStatus:'restocked'}),sale('2026-11-05',{items:[{sku:'A',qty:1,reintegratedQty:1}]}),sale('2026-11-06',{status:'reserved',stockMode:'live'})];assert.equal(report(s).lastSale,'2026-04-01');assert.equal(report(s).level,6);
});
test('old SKU and UPC match but ambiguous or unrelated descriptions never reset a product',()=>{
 const s=state();s.orders=[sale('2026-09-10',{items:[{sku:'OLD',qty:1}]}),sale('2026-10-12',{items:[{upc:'123456789012',qty:1}]}),sale('2026-11-01',{items:[{name:'Producto',qty:1}]})];assert.equal(report(s).lastSale,'2026-10-12');s.products.push({...product,sku:'B',upc:'123456789012',skuAliases:[]});assert.equal(report(s).lastSale,'2026-09-10');
});
test('incomplete history uses known sale; missing history stays unverified, never an invented critical age',()=>{
 const s=state();s.purchases=[];s.products[0].createdAt='2020-01-01';s.orders=[sale('2026-07-10')];let row=report(s);assert.equal(row.historyPartial,true);assert.equal(row.level,4);assert.equal(row.anchorKind,'sale');s.orders=[];row=report(s);assert.equal(row.status,'unknown');assert.equal(row.months,null);assert.equal(row.level,0);
});
test('stock zero and archived products are not liquidation candidates; dates future and invalid do not enter evidence',()=>{
 const s=state();s.products.push({...product,sku:'HIDDEN',lifecycle:{hidden:true}},{...product,sku:'DISC',lifecycle:{discontinued:true}});s.products[0].good=0;assert.equal(rotationReport(s).length,1);assert.equal(report(s).status,'no_stock');assert.equal(report(s).level,0);s.products[0].good=2;s.orders=[sale('2026-11-30'),sale('2026-02-30')];assert.equal(report(s).lastSale,null);assert.equal(report(s).futureRecords,1);assert.equal(civilDate('2026-11-14T03:00:00Z'),'2026-11-13');
});
test('cancelled purchases ignored; purchased-after-last-sale starts at first valid acquisition',()=>{
 const s=state();s.purchases=[purchase('2026-01-01',{status:'Cancelada'}),purchase('2026-08-14')];s.orders=[sale('2026-03-01')];assert.equal(report(s).anchorDate,'2026-08-14');assert.equal(report(s).level,3);
});
test('custom thresholds are validated atomically and require settings permission',()=>{
 const s=state();assert.equal(permissionFor('config.rotation.save'),'settings');const before=structuredClone(s);assert.throws(()=>saveRotationPolicy(s,{payload:{months:[1,2,2,4,5,6]}}));assert.deepEqual(s,before);saveRotationPolicy(s,{id:'rules',type:'config.rotation.save',payload:{months:[2,3,4,5,6,7]}},{now:'2026-11-14',actor:'QA'});s.purchases=[purchase('2026-10-14')];assert.equal(report(s).level,0);
});
test('event flags never change pricing signals; liquidation scope filters dynamically and sales invalidate preview',()=>{
 const s=state(),event={name:'Liquidación',kind:'liquidation',startDate:'2026-11-14',endDate:'2026-11-17',markets:['Tienda Nube'],selection:{skus:['A'],rotationLevels:[6],onlyAvailable:true},rules:{mode:'discount',discount:.5,margin:.1}};
 const before=structuredClone(s),preview=previewCommercialEvent(s,{event,asOf:'2026-11-14'});assert.deepEqual(s,before);assert.equal(preview.rows[0].rotation.level,6);assert.equal(preview.rows[0].traffic.color,'red');assert.equal(preview.rows[0].defaultSelected,false);
 const ctx={now:'2026-11-14T12:00:00Z',actor:'QA'},id=commercialEventCommand(s,{id:'save',type:'pricing.event.save',payload:{event}},ctx).eventId;const saved=previewCommercialEvent(s,{eventId:id});s.orders=[sale('2026-11-14')];assert.equal(previewCommercialEvent(s,{eventId:id}).rows.length,0);assert.throws(()=>commercialEventCommand(s,{id:'apply',type:'pricing.event.apply',payload:{eventId:id,previewFingerprint:saved.fingerprint,targets:[{sku:'A',market:'Tienda Nube'}]}},ctx),/recalcula/);
});
test('liquidation respects available units in selected warehouse rather than global stock',()=>{
 const s=state();s.warehouses=[{id:'a',active:true},{id:'b',active:true}];s.warehouseStock=[{warehouseId:'a',sku:'A',good:1,reserved:1,safety:0},{warehouseId:'b',sku:'A',good:3,reserved:0,safety:0}];
 const event={name:'Liquidación almacén',kind:'liquidation',startDate:'2026-11-14',endDate:'2026-11-17',markets:['Sears'],selection:{warehouseId:'a',onlyAvailable:true,rotationLevels:[6]},rules:{mode:'discount',discount:.1,margin:.1}};assert.equal(previewCommercialEvent(s,{event}).rows.length,0);event.selection.warehouseId='b';assert.equal(previewCommercialEvent(s,{event}).rows.length,1);
});
test('blank liquidation plans automatically restrict scope to flagged available stock',()=>{
 const s=state();s.products.push({...product,sku:'RECENT'},{...product,sku:'ZERO',good:0});s.orders=[sale('2026-11-14',{items:[{sku:'RECENT',qty:1}]})];
 const event={name:'Liquidación general',kind:'liquidation',startDate:'2026-11-14',endDate:'2026-11-17',markets:['Sears'],selection:{onlyAvailable:false},rules:{mode:'discount',discount:.1,margin:.1}};
 const p=previewCommercialEvent(s,{event});assert.deepEqual(p.rows.map(r=>r.sku),['A']);assert.equal(p.event.selection.onlyAvailable,true);assert.deepEqual(p.event.selection.rotationLevels,[1,2,3,4,5,6]);
});
