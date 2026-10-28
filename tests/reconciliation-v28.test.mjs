import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateOrder, settlementRates, applyEstimate, setConditions, setDraft, saveDeposit, saveBatch, estimateBatch,
  reconciliationOf, selectOrders, filterOrders, summary, isPaymentPending, markFollowup, inferShipping, confirmInferredShipping, exportReconciliationCsv} from '../lib/reconciliation-v28.mjs';

const clock={now:'2026-10-28T04:00:00Z',today:'2026-10-27',actor:'Prueba'};
const config={version:28,parameters:{vatWithholding:0.08,incomeWithholding:0.025},
  commissions:{'T1 Comercios':[{category:'Todas las categorías',rate:0.18}],Liverpool:[{category:'Tecnología',rate:0.19}],Coppel:[{category:'Tecnología',rate:0.15}],Elektra:[{category:'Tecnología',rate:0.14}],'Mercado Libre':[{category:'Tecnología',rate:0.13,premiumRate:0.17}]},
  elektraMsi:[{label:'Sin MSI',rate:0},{label:'3',rate:0.03},{label:'6',rate:0.05}],tnBands:[{min:0,max:4999.99,usedRate:0.03},{min:5000,max:null,usedRate:0.05}],
  shipping:[{type:'Mediano',min:250,max:300,base:null}],settlement:{shippingTreatment:{Sears:'Externo',Sanborns:'Externo',Liverpool:'Por confirmar',Coppel:'Por confirmar',Elektra:'Descontado','Mercado Libre':'Descontado','Tienda Nube':'Descontado'},liverpoolIncludedMsi:0.0355,liverpoolMsi:[{months:0,rate:0},{months:3,rate:0.0295},{months:6,rate:0.0355}]}};
const product={sku:'SKU-A',upc:'00123',name:'Producto A',costCents:500000,shippingType:'Mediano',category:'Tecnología',categories:{Liverpool:'Tecnología',Coppel:'Tecnología',Elektra:'Tecnología','Mercado Libre':'Tecnología'},good:9,reserved:1,quarantine:0};
function order(market='Liverpool',id='O-1'){return {id,number:'ORIGINAL-'+id,sicar:'SC-'+id,market,documentDate:'2026-10-20',creationDate:'2026-10-21',date:'2026-10-20',status:'historical',commercialStatus:'Activa',stockMode:'historical',paymentStatus:'unknown',returnStatus:'none',shippingChargedCents:0,totalCents:1000000,items:[{id:id+'-1',sku:product.sku,upc:product.upc,name:product.name,qty:1,unitPriceCents:1000000,totalCents:1000000}],history:[]};}
function model(orders){return {orders,products:[structuredClone(product)],config:structuredClone(config)};}

test('Liverpool extracts already included MSI, applies actual term once; manual guide changes payout',()=>{
  const o=order();setConditions(o,{msi:3},clock);const e=estimateOrder(o,[product],config,clock);
  assert.equal(e.commissionCents,184000);assert.equal(e.msiCents,29500);assert.equal(e.baseCommissionCents,154500);
  assert.equal(e.vatCents,80000);assert.equal(e.incomeCents,25000);assert.equal(e.netCents,711000);assert.equal(e.profitCents,211000);assert.equal(e.warnings.length,1);
  setConditions(o,{shippingCents:25000},clock);const withGuide=estimateOrder(o,[product],config,clock);assert.equal(withGuide.netCents,686000);assert.equal(withGuide.warnings.length,0);
});
test('External guide lowers estimated profit and leaves expected deposit untouched',()=>{
  const o=order('Sears');setConditions(o,{shippingCents:25000},clock);const e=estimateOrder(o,[product],config,clock);
  assert.equal(e.netCents,715000);assert.equal(e.shippingCents,0);assert.equal(e.externalShippingCents,25000);assert.equal(e.profitCents,190000);
});
test('Missing category cannot be disguised by a valid MSI term',()=>{
  const o=order('Elektra'),p={...product,categories:{},category:''};setConditions(o,{msi:3},clock);
  assert.throws(()=>estimateOrder(o,[p],config,clock),/Categoría sin comisión/);
  const rate=settlementRates(config,'Elektra','Tecnología','CLASICA',3,1000000);assert.equal(rate.totalRate,0.17);
  assert.throws(()=>settlementRates(config,'Elektra','Tecnología','CLASICA',24,1000000),/Plazo Elektra no configurado/);
});
test('Multiple lines allocate charged shipping into commission base and preserve manual-guide cents',()=>{
  const o=order('Sears');o.totalCents=1030001;o.shippingChargedCents=30001;
  o.items=[1,2,3].map((n)=>({id:'l'+n,sku:product.sku,upc:product.upc,qty:1,totalCents:n===3?333334:333333,name:'L'+n}));
  setConditions(o,{shippingCents:10001},clock);const e=estimateOrder(o,[product],config,clock);
  assert.equal(e.lines.reduce((a,l)=>a+l.externalShippingCents,0),10001);assert.equal(e.externalShippingCents,10001);
  assert.equal(e.netCents,o.totalCents-e.commissionCents-e.vatCents-e.incomeCents);assert.equal(e.lines.length,3);
});
test('Zero and absent shipping are distinct; automatic per-product shipping is deducted only where configured',()=>{
  const o=order('Elektra');const auto=estimateOrder(o,[product],config,clock);assert.equal(auto.shippingCents,25000);
  setConditions(o,{shippingCents:0},clock);assert.equal(estimateOrder(o,[product],config,clock).shippingCents,0);
  setConditions(o,{shippingCents:null},clock);assert.equal(estimateOrder(o,[product],config,clock).shippingCents,25000);
});
test('New estimates use live category and shipping mappings while explicit exceptions win',()=>{
  const c=structuredClone(config);c.categoryMappings=[{category:'Interna',channels:{Elektra:'Tecnología'},shipping:'Mediano'}];c.shipping.push({type:'Grande',min:400});
  const p={...product,category:'Interna',categories:{Elektra:'Categoría obsoleta'},categoryOverrides:{Elektra:'Automático'},shippingType:'Obsoleto',shippingException:'Automático'};
  assert.equal(estimateOrder(order('Elektra'),[p],c,clock).shippingCents,25000);
  c.categoryMappings[0].shipping='Grande';assert.equal(estimateOrder(order('Elektra'),[p],c,clock).shippingCents,40000);
  p.shippingException='Mediano';assert.equal(estimateOrder(order('Elektra'),[p],c,clock).shippingCents,25000);
  c.categoryMappings[0].channels.Elektra='Sin tarifa';assert.throws(()=>estimateOrder(order('Elektra'),[p],c,clock),/Categoría sin comisión/);
  p.categoryOverrides.Elektra='Tecnología';assert.equal(estimateOrder(order('Elektra'),[p],c,clock).shippingCents,25000);
});
test('Unknown cost produces unknown profit without blocking a valid payout estimate',()=>{
  const e=estimateOrder(order('Coppel'),[{...product,costCents:0}],config,clock);
  assert.equal(e.costCents,null);assert.equal(e.profitCents,null);assert.equal(e.margin,null);assert.equal(e.netCents,745000);
});
test('Average unit cost retains source precision until extended cost is rounded',()=>{
  const o=order('Sears');o.items[0].qty=3;const precise={...product,costCents:1235,averageCostMxn:12.345678};
  const e=estimateOrder(o,[precise],config,clock);assert.equal(e.costCents,3704);assert.equal(e.lines[0].costBasisMxn,12.345678);assert.equal(e.lines[0].costCents,3704);
  assert.deepEqual(e.configSnapshot.parameters,config.parameters);assert.notEqual(e.configSnapshot.parameters,config.parameters);
});
test('Canceled, unmatched and inconsistent source lines never create fabricated estimates',()=>{
  const cancelled=order();cancelled.commercialStatus='Cancelada';assert.throws(()=>estimateOrder(cancelled,[product],config,clock),/cancelada/);
  const mismatch=order();mismatch.totalCents+=3;assert.throws(()=>estimateOrder(mismatch,[product],config,clock),/no coincide/);
  const missing=order();missing.items=[];assert.throws(()=>estimateOrder(missing,[product],config,clock),/partidas verificadas/);
  assert.throws(()=>estimateOrder(order(),[],config,clock),/sin coincidencia/);
});
test('Rate changes preserve last snapshot; recalculations never mutate stock, refund or sale states',()=>{
  const o=order();o.paymentStatus='refunded';const products=[structuredClone(product)],beforeProduct=structuredClone(products),beforeStates={status:o.status,paymentStatus:o.paymentStatus,returnStatus:o.returnStatus};
  applyEstimate(o,products,config,clock);const old=structuredClone(o.reconciliation.estimate),changed=structuredClone(config);changed.commissions.Liverpool[0].rate=.21;
  assert.deepEqual(o.reconciliation.estimate,old);applyEstimate(o,products,changed,clock);
  assert.notEqual(o.reconciliation.estimate.netCents,old.netCents);assert.deepEqual(products,beforeProduct);
  for(const key in beforeStates)assert.equal(o[key],beforeStates[key]);
  setConditions(o,{shippingCents:100},clock);assert.equal(o.reconciliation.estimate,null);assert.equal(o.reconciliation.depositCents,null);
});
test('Draft is durable separately from confirmed amount; zero is captured, date is required and future is rejected',()=>{
  const o=order();setDraft(o,{amountCents:0,date:'2026-10-27',notes:'Aún sin pago'},clock);
  assert.equal(o.reconciliation.depositCents,null);assert.equal(o.reconciliation.draft.amountCents,0);
  saveDeposit(o,{},clock);assert.equal(o.reconciliation.depositCents,0);assert.equal(o.reconciliation.status,'Depósito registrado');assert.equal(o.reconciliation.draft,null);
  setDraft(o,{amountCents:15000,date:'2026-10-28'},clock);assert.throws(()=>saveDeposit(o,{},clock),/futura/);assert.equal(o.reconciliation.depositCents,0);assert.equal(o.reconciliation.draft.amountCents,15000);
  setDraft(o,{date:null},clock);assert.throws(()=>saveDeposit(o,{},clock),/fecha de depósito válida/);
});
test('Saving total repeatedly is idempotent, does not add it, and leaves refund intact',()=>{
  const o=order('Sears');o.paymentStatus='refunded';applyEstimate(o,[product],config,clock);const expected=o.reconciliation.estimate.netCents;
  setDraft(o,{amountCents:expected,date:'2026-10-27'},clock);saveDeposit(o,{},clock);const audit=o.reconciliation.history.length;
  assert.equal(o.reconciliation.status,'Conciliada');assert.equal(o.paymentStatus,'refunded');
  saveDeposit(o,{amountCents:expected,date:'2026-10-27'},clock);assert.equal(o.reconciliation.depositCents,expected);assert.equal(o.reconciliation.history.length,audit);
  setDraft(o,{amountCents:expected-1,date:'2026-10-27'},clock);saveDeposit(o,{},clock);assert.equal(o.reconciliation.status,'Incongruencia');assert.equal(o.reconciliation.differenceCents,-1);
});
test('Followups require notes; incident survives recalculation; positive deposit cannot be marked unpaid',()=>{
  const o=order();assert.throws(()=>markFollowup(o,'Incidencia','',clock),/comentario/);markFollowup(o,'Incidencia','Revisión pendiente',clock);
  applyEstimate(o,[product],config,clock);saveDeposit(o,{amountCents:o.reconciliation.estimate.netCents,date:'2026-10-27'},clock);assert.equal(o.reconciliation.status,'Incidencia');
  assert.throws(()=>markFollowup(o,'No pagada','No llegó completo',clock),/depósito registrado/);
  markFollowup(o,'Resuelta','Aclaración documentada',clock);assert.equal(o.reconciliation.status,'Resuelta');assert.equal(isPaymentPending(o),false);
});
test('Batch respects each own condition, only selected supplied IDs, errors stay isolated',()=>{
  const a=order('Liverpool','A'),b=order('Liverpool','B'),c=order('Liverpool','C'),d=order('Elektra','D');
  setConditions(a,{msi:3},clock);setConditions(b,{msi:6,shippingCents:5000},clock);d.items=[];
  const state=model([a,b,c,d]);selectOrders(state,['A','B','C','D']);
  const result=estimateBatch(state,['A','B','D'],clock);assert.equal(result.succeeded,2);assert.equal(result.failed,1);assert.equal(reconciliationOf(c).estimate,null);
  assert.equal(a.reconciliation.estimate.commissionCents,184000);assert.equal(b.reconciliation.estimate.commissionCents,190000);assert.equal(b.reconciliation.estimate.shippingCents,5000);
  setDraft(a,{amountCents:711000,date:'2026-10-27'},clock);setDraft(b,{amountCents:700000,date:'2026-10-28'},clock);setDraft(c,{amountCents:500000,date:'2026-10-27'},clock);
  const saved=saveBatch(state,['A','B','D'],clock);assert.equal(saved.succeeded,1);assert.equal(saved.failed,1);assert.equal(a.reconciliation.draft,null);assert.notEqual(b.reconciliation.draft,null);assert.equal(c.reconciliation.depositCents,null);
});
test('Filtering and summaries distinguish unknown/zero and comparison coverage',()=>{
  const a=order('Sears','A'),b=order('Liverpool','B'),c=order('Elektra','C');c.status='cancelled';a.reconciliation={selected:true};applyEstimate(a,[product],config,clock);setDraft(a,{amountCents:700000,date:'2026-10-27'},clock);
  setDraft(b,{amountCents:0,date:'2026-10-27'},clock);
  assert.equal(filterOrders([a,b,c],{q:'SC-A'}).length,1);assert.equal(filterOrders([a,b,c],{onlySelected:true}).length,1);
  assert.equal(filterOrders([a,b,c],{status:'Pagos pendientes'}).length,2);assert.equal(isPaymentPending(c),false);
  assert.throws(()=>filterOrders([a],{from:'2026-10-28',to:'2026-10-27'}),/anterior/);
  const draftSummary=summary([a,b,c]);assert.equal(draftSummary.estimatedCount,1);assert.equal(draftSummary.depositCount,0);assert.equal(draftSummary.receivedCents,null);assert.equal(draftSummary.matchedCount,0);assert.equal(draftSummary.matchedDifferenceCents,null);assert.equal(draftSummary.draftCount,2);assert.equal(draftSummary.draftTotalCents,700000);
  saveDeposit(a,{},clock);saveDeposit(b,{},clock);
  const s=summary([a,b,c]);assert.equal(s.estimatedCount,1);assert.equal(s.depositCount,2);assert.equal(s.receivedCents,700000);assert.equal(s.matchedCount,1);assert.equal(s.matchedDifferenceCents,-15000);assert.equal(s.completeComparison,false);assert.equal(s.draftCount,0);assert.equal(s.draftTotalCents,null);
});
test('A replacement draft never alters confirmed dashboard metrics until saved',()=>{
  const o=order('Sears');applyEstimate(o,[product],config,clock);saveDeposit(o,{amountCents:0,date:'2026-10-27'},clock);
  const before=summary([o]),expected=o.reconciliation.estimate.netCents;
  assert.equal(before.receivedCents,0);assert.equal(before.depositCount,1);assert.equal(before.matchedDifferenceCents,-expected);assert.equal(before.matchedCount,1);
  setDraft(o,{amountCents:expected,date:'2026-10-27'},clock);const during=summary([o]);
  for(const key of ['receivedCents','depositCount','matchedDifferenceCents','matchedCount','visibleDifferenceCents'])assert.equal(during[key],before[key],key);
  assert.equal(during.draftCount,1);assert.equal(during.draftTotalCents,expected);assert.equal(o.reconciliation.depositCents,0);
  saveDeposit(o,{},clock);const after=summary([o]);
  assert.equal(after.receivedCents,expected);assert.equal(after.depositCount,1);assert.equal(after.matchedDifferenceCents,0);assert.equal(after.matchedCount,1);assert.equal(after.draftCount,0);assert.equal(after.draftTotalCents,null);
});
test('Tienda Nube uses configured weighted band without withholding; ML validates publication',()=>{
  const tn=estimateOrder(order('Tienda Nube'),[product],config,clock);assert.equal(tn.commissionCents,50000);assert.equal(tn.vatCents,0);assert.equal(tn.incomeCents,0);
  assert.throws(()=>settlementRates(config,'Mercado Libre','Tecnología','OTHER',0,1000000),/Clásica o Premium/);
  const ml=order('Mercado Libre');setConditions(ml,{publication:'PREMIUM'},clock);assert.equal(estimateOrder(ml,[product],config,clock).commissionCents,170000);
});
test('Inferred shipping remains a hypothesis until explicit confirmation and is blocked for external guides',()=>{
  const o=order();setConditions(o,{msi:3},clock);applyEstimate(o,[product],config,clock);setDraft(o,{amountCents:686000,date:'2026-10-27'},clock);
  assert.equal(inferShipping(o).residualCents,25000);assert.equal(o.reconciliation.conditions.shippingCents,null);
  confirmInferredShipping(o,[product],config,clock);assert.equal(o.reconciliation.conditions.shippingCents,25000);assert.equal(o.reconciliation.depositCents,null);
  const external=order('Sears');applyEstimate(external,[product],config,clock);setDraft(external,{amountCents:700000,date:'2026-10-27'},clock);assert.equal(inferShipping(external).canApply,false);
  assert.throws(()=>confirmInferredShipping(external,[product],config,clock),/por fuera/);
});
test('CSV exports confirmed and draft values separately, protects spreadsheet-formula strings',()=>{
  const o=order();o.number='=HYPERLINK("bad")';setDraft(o,{amountCents:50000,date:'2026-10-27'},clock);
  const csv=exportReconciliationCsv([o]);assert.ok(csv.includes('Total depositado confirmado'));assert.ok(csv.includes("'=HYPERLINK"));assert.ok(csv.includes('Borrador MXN'));
});
