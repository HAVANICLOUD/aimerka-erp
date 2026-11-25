import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {applyMarketplaceOrderEvidence,verifiedOrderStatus,REFUND_RETURN_POLICY} from '../lib/marketplace-order-status.mjs';
import {classifyOrder,orderNoteEvidence,orderLineIdentifiers} from '../lib/order-workspace.mjs';
const order=(extra={})=>({id:'1',number:'123',market:'Sears',status:'historical',stockMode:'historical',totalCents:99900,items:[{sku:'SKU',qty:1}],paymentStatus:'unknown',comments:'Comentario normal',...extra});
const evidence=(extra={})=>({orderId:'1',number:'123',market:'Sears',nativeStatus:'Entregado',verified:true,source:'T1',observedAt:'2026-11-24',totalCents:99900,skus:['SKU'],...extra});
test('verified evidence completes historical state, never bank or stock, idempotently',()=>{
 const o=order(),before=structuredClone(o),s={orders:[o],products:[{sku:'SKU',good:2}],movements:[],config:{}};
 const b={id:'test',rows:[evidence()]};assert.deepEqual(applyMarketplaceOrderEvidence(s,b),{applied:1,skipped:0});
 const {marketplaceStatusEvidence,...original}=o;assert.deepEqual(original,before);assert.equal(classifyOrder(o).delivered,true);assert.equal(o.paymentStatus,'unknown');assert.deepEqual(s.movements,[]);assert.equal(s.products[0].good,2);assert.equal(applyMarketplaceOrderEvidence(s,b),null);
 assert.equal(s.config.marketplaceRefundReturnPolicy.automaticIncidents,false);assert.equal(REFUND_RETURN_POLICY.enabled,false);
});
test('identity, total, SKU ambiguity, duplicate evidence or existing snapshots are never overwritten',()=>{
 for(const change of [{number:'999'},{market:'Coppel'},{totalCents:100},{skus:['OTHER']},{verified:false}]){const s={orders:[order()],config:{}};assert.equal(applyMarketplaceOrderEvidence(s,{id:'test',rows:[evidence(change)]}).applied,0);assert.equal(s.orders[0].marketplaceStatusEvidence,undefined);}
 const s={orders:[order()],config:{}};assert.equal(applyMarketplaceOrderEvidence(s,{id:'dup',rows:[evidence(),evidence()]}).applied,0);
 assert.equal(verifiedOrderStatus(order({marketplaceStatusEvidence:evidence({number:'999'})})),null);
});
test('already confirmed recorded state is preserved, closed does not prove delivery, refund does not move merchandise',()=>{
 const c=classifyOrder(order({status:'cancelled',marketplaceStatusEvidence:evidence()}));assert.equal(c.cancelled,true);assert.equal(c.delivered,false);
 const closed=order({market:'Coppel',marketplaceStatusEvidence:evidence({market:'Coppel',nativeStatus:'Cerrado'})});assert.equal(classifyOrder(closed).delivered,false);
 const refund=order({market:'Liverpool',marketplaceStatusEvidence:evidence({market:'Liverpool',nativeStatus:'Reembolsado'})});assert.equal(classifyOrder(refund).refunded,true);assert.equal(refund.returnStatus,undefined);assert.equal(refund.paymentStatus,'unknown');
});
test('labels and source notes never imply an incidence; meaningful open return followup does',()=>{
 assert.equal(classifyOrder(order({followupStatus:'Pendiente',review:'Revisar datos',comments:'Cotejo directo SICAR: cancelado en fuente no verificada'})).incidence,false);
 assert.equal(classifyOrder(order({followupStatus:'Pendiente',comments:'Reintegrar mercancía de devolución'})).incidence,true);
});
test('series and IMEI leave display notes only, preserving raw evidence, and multi-line allocation stays unresolved',()=>{
 const o=order({comments:'IMEI: 123456789012345\nSerie: AB12345678\nOtra nota'}),raw=o.comments;
 const notes=orderNoteEvidence(o);assert.equal(notes.comments,'Otra nota');assert.equal(notes.identifiers.length,2);assert.equal(orderLineIdentifiers(o,o.items[0],0).length,2);assert.equal(o.comments,raw);
 const multi={...o,items:[o.items[0],{sku:'OTHER',qty:1}]};assert.ok(orderNoteEvidence(multi).identifiers.every(i=>i.lineIndex===null));assert.deepEqual(orderLineIdentifiers(multi,multi.items[0],0),[]);
 assert.equal(orderNoteEvidence(order({comments:'***123 AB12345678***'})).identifiers[0].value,'AB12345678');
 assert.equal(orderNoteEvidence(order({comments:'***456 AB12345678***'})).identifiers.length,0);
});
test('production documentary batch has no customer data; preserves every original source field',()=>{
 const base=new URL('../',import.meta.url),batch=JSON.parse(fs.readFileSync(new URL('data/marketplace-order-evidence-20261124.json',base)));
 const s={orders:batch.rows.map(r=>({id:r.orderId,number:r.number,market:r.market,totalCents:r.totalCents,items:r.skus.map(sku=>({sku,qty:1})),status:'historical',paymentStatus:'unknown',reconciliation:{depositCents:12345},comments:'Origen intacto'})),config:{},products:[{good:5}],movements:[],events:[]},before=structuredClone(s);
 const result=applyMarketplaceOrderEvidence(s,batch);assert.equal(result.applied,batch.rows.length);
 for(let i=0;i<s.orders.length;i++){const {marketplaceStatusEvidence,marketplaceRefundEvidence,...original}=s.orders[i];assert.deepEqual(original,before.orders[i]);}
 for(const key of Object.keys(before).filter(k=>!['orders','config','events'].includes(k)))assert.deepEqual(s[key],before[key]);
 for(const row of batch.rows)assert.deepEqual(Object.keys(row).filter(k=>/email|customer|address|phone/i.test(k)),[]);
});
test('refund request dates and reasons attach only to the exact already-refunded order; no claim or return is created',()=>{
 const s={orders:[order({market:'Liverpool',paymentStatus:'refunded'})],config:{},movements:[]};
 const row={orderId:'1',number:'123',market:'Liverpool',totalCents:99900,refunds:[{id:'refund-1',requestDate:'2026-11-14',refundDate:'2026-11-16',reason:'Llegó tarde',amountCents:99900}]};
 assert.equal(applyMarketplaceOrderEvidence(s,{id:'refund',rows:[],refundRows:[row]}).refundsApplied,1);assert.equal(s.orders[0].marketplaceRefundEvidence.refunds[0].requestDate,'2026-11-14');assert.equal(s.orders[0].returnStatus,undefined);assert.equal(s.orders[0].incident,undefined);assert.deepEqual(s.movements,[]);assert.equal(s.config.marketplaceRefundReturnPolicy.enabled,false);
 const wrong={orders:[order({market:'Liverpool'})],config:{}};applyMarketplaceOrderEvidence(wrong,{id:'wrong',rows:[],refundRows:[row]});assert.equal(wrong.orders[0].marketplaceRefundEvidence,undefined);
});
