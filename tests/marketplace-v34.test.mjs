import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {applyCommand} from '../lib/commands.mjs';
import {estimateOrder,estimateMarketplace34} from '../lib/reconciliation-v28.mjs';
const seed=JSON.parse(fs.readFileSync(new URL('../data/seed-v28.json',import.meta.url))),config=JSON.parse(fs.readFileSync(new URL('../data/pricing-config.json',import.meta.url)));
const ctx={workspace:'v28',now:'2026-10-30T20:00:00Z',actor:'QA V34'};let id=0;
const cmd=(s,type,payload)=>applyCommand(s,{id:'v34-test-'+(++id),type,payload},ctx);
function setup(){const s=structuredClone(seed);s.config=structuredClone(config);const o=s.orders.find(o=>o.market==='Liverpool'&&o.commercialStatus==='Activa'&&o.items.length===1&&o.items[0].qty===1);return {s,o};}
test('Liverpool promotion is informational; MSI affects fees once while original gross and all stock stay unchanged',()=>{
 const {s,o}=setup(),stock=JSON.stringify(s.products),total=o.totalCents;
 cmd(s,'marketplace.promotion.save',{orderId:o.id,amountCents:100,description:'Cupón V34',msiMonths:6});const updated=s.orders.find(x=>x.id===o.id),estimate=estimateOrder(updated,s.products,s.config,ctx);
 const without=structuredClone(updated);delete without.marketplace34;without.reconciliation.conditions.msi=6;const baseline=estimateOrder(without,s.products,s.config,ctx);
 assert.equal(estimate.version,34);assert.equal(estimate.grossCents,total);assert.equal(estimate.netCents,baseline.netCents);assert.equal(JSON.stringify(s.products),stock);assert.match(estimate.warnings.join(' '),/informativa/);
});
test('verified shipping, insurance and reverse charges distinguish deductions, external costs and credit notes without double counting',()=>{
 const {s,o}=setup();cmd(s,'marketplace.logistics.save',{orderId:o.id,confirmed:true,reference:'Estado de cuenta QA',charges:[{kind:'Envío',amountCents:10000,treatment:'Descontado',date:'2026-10-29',document:'QA-envio'},{kind:'Seguro',amountCents:1000,treatment:'Externo',date:'2026-10-29'},{kind:'Ajuste',amountCents:2000,treatment:'Descontado',credit:true,date:'2026-10-29'}]});
 const updated=s.orders.find(x=>x.id===o.id),r=estimateOrder(updated,s.products,s.config,ctx);assert.equal(r.shippingCents,8000);assert.equal(r.externalShippingCents,1000);assert.equal(r.netCents,r.grossCents-r.commissionCents-r.vatCents-r.incomeCents-8000);assert.equal(r.profitCents,r.netCents-r.costCents-1000);assert.equal(r.lines.reduce((n,l)=>n+l.shippingCents,0),8000);
});
test('Liverpool refund predicts a debit, cancellation without refund predicts zero, and partial refunds are held for breakdown',()=>{
 const {s,o}=setup(),stock=JSON.stringify(s.products);o.paymentStatus='refunded';o.refundCents=o.totalCents;
 let r=estimateMarketplace34(o,s.products,s.config,ctx);assert.equal(r.financialSign,-1);assert.ok(r.netCents<0);
 o.paymentStatus='paid';o.refundCents=0;o.status='cancelled';o.commercialStatus='Cancelada';r=estimateMarketplace34(o,s.products,s.config,ctx);assert.equal(r.netCents,0);assert.equal(r.grossCents,o.totalCents);
 o.refundCents=1;assert.throws(()=>estimateMarketplace34(o,s.products,s.config,ctx),/parcial/);assert.equal(JSON.stringify(s.products),stock);
});
test('series and IMEI validate unit counts and duplicates; rejected corrections preserve prior capture and history',()=>{
 const {s,o}=setup(),item=o.items[0];cmd(s,'marketplace.identifiers.save',{orderId:o.id,reason:'Etiqueta cotejada',units:[{lineId:item.id,unit:1,serial:'ABC-01',imei:'001234567890123'}]});let updated=s.orders.find(x=>x.id===o.id);assert.equal(updated.marketplace34.units[0].imei,'001234567890123');
 const before=JSON.stringify(s);assert.throws(()=>cmd(s,'marketplace.identifiers.save',{orderId:o.id,units:[{lineId:item.id,unit:1,imei:'1234'}]}),/IMEI/);assert.equal(JSON.stringify(s),before);
 cmd(s,'marketplace.identifiers.save',{orderId:o.id,reason:'Corrección cotejada',units:[{lineId:item.id,unit:1,serial:'ABC-02'}]});updated=s.orders.find(x=>x.id===o.id);assert.equal(updated.marketplace34.identifierHistory.at(-1).units[0].serial,'ABC-01');
});
test('closure requires matching recorded money, protects snapshots from individual and batch edits and supports audited reopening',()=>{
 const {s,o}=setup();cmd(s,'marketplace.estimate',{orderId:o.id});let updated=s.orders.find(x=>x.id===o.id),net=updated.reconciliation.estimate.netCents;
 cmd(s,'marketplace.deposit',{orderId:o.id,amountCents:net,date:'2026-10-29',notes:'QA depósito'});cmd(s,'marketplace.close',{orderId:o.id,reviewNote:'Guía pendiente cotejada con documento QA'});updated=s.orders.find(x=>x.id===o.id);const snapshot=JSON.stringify(updated.reconciliation.closure);
 for(const [type,payload]of [['reconciliation.estimate',{orderId:o.id}],['reconciliation.saveBatch',{ids:[o.id]}],['marketplace.promotion.save',{orderId:o.id,amountCents:0,msiMonths:0}]])assert.throws(()=>cmd(s,type,payload),/cerrada|cerrado|definitivo/);
 assert.equal(JSON.stringify(s.orders.find(x=>x.id===o.id).reconciliation.closure),snapshot);cmd(s,'marketplace.reopen',{orderId:o.id,reason:'Documento complementario'});updated=s.orders.find(x=>x.id===o.id);assert.equal(updated.reconciliation.closure,null);assert.equal(updated.reconciliation.closedHistory.at(-1).reopenReason,'Documento complementario');
});
test('signed statement debits require a V34 Liverpool refund estimate and notes; ordinary negative deposits remain invalid',()=>{
 const {s,o}=setup();const initial=JSON.stringify(s);assert.throws(()=>cmd(s,'marketplace.deposit',{orderId:o.id,amountCents:-100,date:'2026-10-29',notes:'QA'}));assert.equal(JSON.stringify(s),initial);
 o.paymentStatus='refunded';o.refundCents=o.totalCents;cmd(s,'marketplace.estimate',{orderId:o.id});let updated=s.orders.find(x=>x.id===o.id),net=updated.reconciliation.estimate.netCents;
 assert.throws(()=>cmd(s,'marketplace.deposit',{orderId:o.id,amountCents:net,date:'2026-10-29',notes:''}),/Documenta/);cmd(s,'marketplace.deposit',{orderId:o.id,amountCents:net,date:'2026-10-29',notes:'Débito del reporte'});assert.equal(s.orders.find(x=>x.id===o.id).reconciliation.depositCents,net);
});
test('prepared prices are calculated server-side, retain configuration snapshots, supersede older proposals and never pretend to be sent',()=>{
 const {s}=setup(),p=s.products.find(p=>p.status!=='INACTIVO'&&p.costCents>0&&p.upc),before=JSON.stringify(s.products),input={margin:.1,mode:'automatico',shippingType:'Pequeño'};
 cmd(s,'pricing.publication.prepare',{productSku:p.sku,channels:['T1 Comercios'],input});assert.equal(s.pricePublicationQueue[0].status,'awaiting_connection');assert.ok(s.pricePublicationQueue[0].configSnapshot);const price=s.pricePublicationQueue[0].discountCents;
 cmd(s,'pricing.publication.prepare',{productSku:p.sku,channels:['T1 Comercios'],input});assert.equal(s.pricePublicationQueue[1].status,'superseded');assert.equal(s.pricePublicationQueue[0].discountCents,price);assert.equal(JSON.stringify(s.products),before);
});
