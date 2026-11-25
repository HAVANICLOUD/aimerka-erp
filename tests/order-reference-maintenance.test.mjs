import test from 'node:test';import assert from 'node:assert/strict';
import {maintainOrderReference} from '../lib/order-reference-maintenance.mjs';
import {verifiedOrderStatus} from '../lib/marketplace-order-status.mjs';
import {classifyOrder} from '../lib/order-workspace.mjs';
import {orderGrossValidation} from '../lib/order-gross-validation.mjs';
import {commissionEvidence} from '../lib/payment-reconciliation.mjs';
const o=(id,market='Sears',extra={})=>({id,market,number:'123',sicar:'SE1',totalCents:10000,status:'historical',stockMode:'historical',items:[{sku:'INTERNAL',qty:1}],reconciliation:{depositCents:7500,status:'Conciliada'},...extra});
const e=(id,market='Sears',extra={})=>({orderId:id,number:'123',market,totalCents:10000,verified:true,nativeStatus:'Entregado',matchBasis:'marketplace-order-number',skus:['EXTERNAL'],source:'T1',...extra});
test('unique marketplace and order identify status despite different external SKU; product mapping and bank stay intact',()=>{
 const order=o('one'),s={orders:[order],config:{},products:[{sku:'INTERNAL',good:1}],movements:[]},before=structuredClone(s);const r=maintainOrderReference(s,{id:'test',rows:[e('one')],referenceRows:[]});assert.equal(r.applied,1);assert.equal(classifyOrder(order).delivered,true);const {marketplaceStatusEvidence,...original}=order;assert.deepEqual(original,before.orders[0]);assert.deepEqual(s.products,before.products);assert.deepEqual(s.movements,[]);assert.equal(maintainOrderReference(s,{id:'test',rows:[]}),null);
});
test('a gross mismatch never blocks documentary status and remains a separate alert with no inferred fee',()=>{
 const order=o('one') ;order.market='Sears';const row=e('one','Sears',{totalCents:10100});order.marketplaceGrossEvidence={...row,currency:'MXN'};const s={orders:[order],config:{}};maintainOrderReference(s,{id:'mismatch',rows:[row],referenceRows:[]});assert.equal(verifiedOrderStatus(order).mappedStatus,'delivered');assert.equal(orderGrossValidation(order).differenceCents,100);assert.equal(commissionEvidence(order,s).rate,null);assert.equal(order.reconciliation.status,'Conciliada');
});
test('cross-market order number never links the cancelled Sears error to the valid Sanborns sale',()=>{
 const a=o('error','Sears',{sicar:'SE913',status:'cancelled',commercialStatus:'Cancelada',followupStatus:'Pendiente',comments:'Error de venta cancelada'}),b=o('valid','Sanborns',{sicar:'SA71'}),ml=o('excluded','Mercado Libre'),s={orders:[a,b,ml],config:{}},old=structuredClone(ml);
 maintainOrderReference(s,{id:'cross',rows:[e('valid','Sanborns'),e('excluded','Mercado Libre')],referenceRows:[{orderId:'error',market:'Sears',number:'123',sicar:'SE913',registrationError:true,verified:true,comment:'ERROR DE VENTA, SE HIZO MAL'}]});assert.equal(classifyOrder(a).cancelled,true);assert.equal(classifyOrder(a).followup,false);assert.equal(classifyOrder(a).incidence,false);assert.equal(classifyOrder(b).delivered,true);assert.deepEqual(ml,old);assert.equal(a.number,'123');
});
test('duplicate identities and statuses without a verified unique order cannot attach',()=>{
 const s={orders:[o('one'),o('two')],config:{}};const r=maintainOrderReference(s,{id:'dup',rows:[e('one')],referenceRows:[]});assert.equal(r.applied,0);assert.equal(r.skipped,1);assert.equal(s.orders[0].marketplaceStatusEvidence,undefined);
});
test('already matched orders are counted separately from pending and references do not execute stock comments',()=>{
 const a=o('one') ;a.market='Sears';a.marketplaceStatusEvidence=e('one');const s={orders:[a],config:{},movements:[]};const r=maintainOrderReference(s,{id:'existing',rows:[e('one')],referenceRows:[{orderId:'one',market:'Sears',number:'123',sicar:'SE1',verified:true,registrationError:false,comment:'REINTEGRAR A INVENTARIO'}]});assert.equal(r.alreadyMatched,1);assert.equal(r.skipped,0);assert.deepEqual(s.movements,[]);assert.equal(a.items[0].sku,'INTERNAL');
});
