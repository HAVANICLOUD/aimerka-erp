import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  applyOperation,installmentState,paymentRecommendation,installmentSchedule,creditPreview,
  dateOnly,dayInMonth,instrumentKey,salesStatistics,bestSellers,periodBounds,sicarComparison,financialSummary,
} from '../lib/operations-v28.mjs';

const ctx={today:'2026-10-27',now:'2026-10-28T01:00:00Z',user:'Prueba'};
const create=()=>({schema:1,version:28,purchases:[],expenses:[],purchasePayments:[],expensePayments:[],creditRules:[],events:[],
  catalogs:{lenders:['Empresa'],instruments:['Amex'],suppliers:['Proveedor'],expenseCategories:['Software'],expenseDescriptions:[]}});
const purchase={sicar:'C123',date:'2026-10-01',lender:'Empresa',instrument:'Amex',supplier:'Proveedor',term:3,amountCents:100000,
  receiptStatus:'Pendiente',satReviewed:'No',items:[]};

test('zoned timestamps use Mexico civil dates across midnight, month and year boundaries',()=>{
  assert.equal(dateOnly('2026-10-28T05:30:00.000Z'),'2026-10-27');
  assert.equal(dateOnly('2026-10-28T06:00:00Z'),'2026-10-28');
  assert.equal(dateOnly('2026-11-01T05:30:00Z'),'2026-10-31');
  assert.equal(dateOnly('2027-01-01T05:30:00Z'),'2026-12-31');
  assert.equal(dateOnly('2026-10-28T00:30:00+01:00'),'2026-10-27');
  assert.equal(dateOnly('2026-10-28T00:30:00-06:00'),'2026-10-28');
  assert.equal(dateOnly('2026-10-28T05:30:00+0000'),'2026-10-27');
  assert.equal(dateOnly('2026-10-28'),'2026-10-28');
  assert.equal(dateOnly('2026-10-28T05:30:00'),'2026-10-28');
  assert.equal(dateOnly('2026-10-28 05:30:00'),'2026-10-28');
  assert.equal(dateOnly('2026-02-30T05:30:00Z'),null);
  assert.equal(dateOnly('2026-10-28T25:30:00Z'),null);
});

test('daily creation and manual refund statistics use the Mexico date of zoned events',()=>{
  const s={orders:[{id:'operational',market:'Sears',totalCents:10000,commercialStatus:'Activa',documentDate:'2026-10-28',
    creationDate:'2026-10-28T05:30:00Z',paymentStatus:'partially_refunded',refundCents:1200,refundedAt:'2026-10-28T05:45:00Z'}]};
  const previous=salesStatistics(s,{from:'2026-10-27',to:'2026-10-27',basis:'Creacion'});
  assert.equal(previous.activeCount,1);assert.equal(previous.refundCount,1);assert.equal(previous.refundCents,1200);
  const next=salesStatistics(s,{from:'2026-10-28',to:'2026-10-28',basis:'Creacion'});
  assert.equal(next.activeCount,0);assert.equal(next.refundCount,0);
  const document=salesStatistics(s,{from:'2026-10-28',to:'2026-10-28',basis:'Documento'});
  assert.equal(document.activeCount,1);assert.equal(document.refundCount,0);
  s.orders[0].creationDate='2027-01-01T05:30:00Z';s.orders[0].refundedAt='2027-01-01T05:45:00Z';
  const december=salesStatistics(s,{from:'2026-12-01',to:'2026-12-31'});
  const january=salesStatistics(s,{from:'2027-01-01',to:'2027-01-31'});
  assert.equal(december.activeCount,1);assert.equal(december.refundCents,1200);
  assert.equal(january.activeCount,0);assert.equal(january.refundCount,0);
});

test('V28 adaptive installments and exact final rounding',()=>{
  const e={id:'C1',amountCents:100000,term:3};
  assert.equal(installmentState(e,[]).recommendedCents,33333);
  assert.deepEqual(installmentSchedule(e,[],[],'2026-10-27').map(r=>r.balanceCents),[33333,33333,33334]);
  const p=[{entityId:'C1',number:1,installmentsCovered:1,amountCents:20000}];
  assert.deepEqual(installmentState(e,p),{amountCents:100000,paidCents:20000,balanceCents:80000,covered:1,remaining:2,nextNumber:2,recommendedCents:40000});
  assert.deepEqual(installmentSchedule(e,p,[],'2026-10-27').map(r=>r.amountCents),[20000,40000,40000]);
  const liquidate=paymentRecommendation(e,p,{mode:'Liquidar saldo'});
  assert.equal(liquidate.amountCents,80000);assert.equal(liquidate.installmentsCovered,2);
});

test('small multi-installment payment has no negative allocation and preserves sum',()=>{
  const e={id:'C1',amountCents:100,term:18};
  const rows=installmentSchedule(e,[{entityId:'C1',number:1,installmentsCovered:18,amountCents:100}],[],'2026-10-27');
  assert.ok(rows.every(r=>r.paidCents>=0));assert.equal(rows.reduce((a,b)=>a+b.paidCents,0),100);
});

test('purchase save preserves explicit header total and line discrepancy',()=>{
  const s=create();const r=applyOperation(s,{type:'purchase.create',payload:{...purchase,items:[{name:'Equipo',qty:2,unitCostCents:40000}]}},ctx);
  assert.equal(s.purchases[0].amountCents,100000);assert.equal(r.lineDifferenceCents,20000);
  assert.equal(s.purchases[0].items[0].totalCents,80000);
  const before=JSON.stringify(s);
  assert.throws(()=>applyOperation(s,{type:'purchase.create',payload:purchase},ctx),/ya está registrado/);
  assert.equal(JSON.stringify(s),before);
});

test('purchase fills missing total from lines without requiring catalog SKU',()=>{
  const s=create();applyOperation(s,{type:'purchase.create',payload:{...purchase,amountCents:null,items:[{name:'Material',qty:1.5,unitCostCents:10000}]}},ctx);
  assert.equal(s.purchases[0].amountCents,15000);
});

test('editing a received purchase preserves stock receipt counters and line identity',()=>{
  const s=create();applyOperation(s,{type:'purchase.create',payload:{...purchase,items:[{name:'Equipo',skuOrUpc:'S1',qty:3,unitCostCents:20000},{name:'Accesorio',skuOrUpc:'S2',qty:1,unitCostCents:10000}]}},ctx);
  const e=s.purchases[0];e.items[0].receivedQty=2;e.items[0].sku='S1';
  applyOperation(s,{type:'purchase.update',payload:{id:e.id,notes:'Factura revisada'}},ctx);
  assert.equal(e.items[0].receivedQty,2);assert.equal(e.items[0].sku,'S1');
  for(const change of [[],[{...e.items[0],qty:1}],[{...e.items[0],skuOrUpc:'OTRO'}]]){
    const before=JSON.stringify(s);assert.throws(()=>applyOperation(s,{type:'purchase.update',payload:{id:e.id,items:change}},ctx));assert.equal(JSON.stringify(s),before);
  }
  applyOperation(s,{type:'purchase.update',payload:{id:e.id,items:[e.items[0],{name:'Nuevo',skuOrUpc:'S3',qty:1,unitCostCents:10000}]}},ctx);
  assert.equal(e.items[0].id,e.id+'-001');assert.equal(e.items[1].id,e.id+'-003');
});

test('payment recalculates future cuotas and duplicate request is idempotent',()=>{
  const s=create();applyOperation(s,{type:'purchase.create',payload:purchase},ctx);
  const id=s.purchases[0].id;
  const op={id:'payment-one',type:'purchase.payment',payload:{entityId:id,mode:'Otro monto',amountCents:20000,installmentsCovered:1,date:'2026-10-10'}};
  applyOperation(s,op,ctx);assert.equal(s.purchases[0].balanceCents,80000);
  assert.equal(installmentState(s.purchases[0],s.purchasePayments).recommendedCents,40000);
  assert.equal(applyOperation(s,op,ctx).duplicate,true);assert.equal(s.purchasePayments.length,1);
  applyOperation(s,{type:'purchase.payment',payload:{entityId:id,mode:'Liquidar saldo',date:'2026-10-11'}},ctx);
  assert.equal(s.purchases[0].balanceCents,0);
  assert.equal(s.purchasePayments[1].installmentsCovered,2);
});

test('payment rejects overpayment, unknown amount, cancellation, bad dates atomically',()=>{
  const s=create();applyOperation(s,{type:'purchase.create',payload:purchase},ctx);const id=s.purchases[0].id;
  for(const patch of [{amountCents:100001},{date:'2026-11-01'},{date:'2026-09-30'}]){
    const before=JSON.stringify(s);
    assert.throws(()=>applyOperation(s,{type:'purchase.payment',payload:{entityId:id,mode:'Otro monto',amountCents:1000,date:'2026-10-10',...patch}},ctx));
    assert.equal(JSON.stringify(s),before);
  }
  s.purchases[0].amountCents=null;assert.throws(()=>applyOperation(s,{type:'purchase.payment',payload:{entityId:id,date:'2026-10-10'}},ctx),/confirmado/);
  s.purchases[0].amountCents=100000;s.purchases[0].status='Cancelada';assert.throws(()=>applyOperation(s,{type:'purchase.payment',payload:{entityId:id,date:'2026-10-10'}},ctx),/cancelado/);
});

test('credit cutoff includes purchase on day, next day moves cycle, Feb31 caps',()=>{
  const rule={active:true,cutoffDay:15,paymentDay:5};
  assert.equal(creditPreview('2026-10-15',rule).cutoffDate,'2026-10-15');
  assert.equal(creditPreview('2026-10-15',rule).paymentDate,'2026-11-05');
  assert.equal(creditPreview('2026-10-16',rule).cutoffDate,'2026-11-15');
  assert.equal(creditPreview('2026-10-16',rule).paymentDate,'2026-12-05');
  assert.equal(dayInMonth('2028-02-01',31),'2028-02-29');
  assert.equal(dayInMonth('2026-02-01',31),'2026-02-28');
  assert.equal(creditPreview('2026-10-15',{active:true,cutoffDay:15,paymentDay:15}).paymentDate,'2026-11-15');
});

test('manual first date preserved and later installments stay undated without day',()=>{
  const entity={id:'C1',date:'2026-01-01',amountCents:30000,term:3,firstPaymentDate:'2026-01-12',lender:'Empresa',instrument:'Amex'};
  const rows=installmentSchedule(entity,[],[],'2026-10-27');
  assert.deepEqual(rows.map(r=>r.dueDate),['2026-01-12',null,null]);
  assert.deepEqual(rows.map(r=>r.status),['Vencida programada','Por configurar','Por configurar']);
});

test('expense update preserves provenance and cannot drop amount below paid',()=>{
  const s=create();applyOperation(s,{type:'expense.create',payload:{date:'2026-10-01',category:'Software',description:'Servicio',lender:'Empresa',instrument:'Amex',term:2,amountCents:50000}},ctx);
  const expense=s.expenses[0];expense.sourceFile='origen.xlsm';
  applyOperation(s,{type:'expense.payment',payload:{entityId:expense.id,date:'2026-10-10',mode:'Otro monto',amountCents:20000}},ctx);
  const before=JSON.stringify(s);assert.throws(()=>applyOperation(s,{type:'expense.update',payload:{id:expense.id,amountCents:19999}},ctx),/menor/);assert.equal(JSON.stringify(s),before);
  applyOperation(s,{type:'expense.update',payload:{id:expense.id,amountCents:60000,term:3}},ctx);
  assert.equal(expense.sourceFile,'origen.xlsm');assert.equal(expense.balanceCents,40000);assert.equal(expense.term,3);
});

test('catalog duplicates reject and credit matching normalizes only lookup',()=>{
  const s=create();applyOperation(s,{type:'catalog.add',payload:{catalog:'suppliers',value:'Otro'}},ctx);
  assert.throws(()=>applyOperation(s,{type:'catalog.add',payload:{catalog:'suppliers',value:' otro '}},ctx),/ya existe/);
  assert.equal(instrumentKey('American Express de HAVANI MÉXICO'),instrumentKey('AMEX HAVANI MEXICO'));
  applyOperation(s,{type:'credit.save',payload:{lender:'Empresa',instrument:'Amex',cutoffDay:31,paymentDay:5}},ctx);
  assert.equal(s.creditRules[0].cutoffDay,31);
});

test('statistics use event dates and avoid manual/SICAR double refund',()=>{
  const s={orders:[
    {id:'1',market:'Sears',documentDate:'2026-09-30',creationDate:'2026-10-01',commercialStatus:'Activa',totalCents:10000,items:[{upc:'X',sku:'S',qty:2,totalCents:10000}]},
    {id:'2',market:'Sears',documentDate:'2026-09-01',creationDate:'2026-09-01',commercialStatus:'Cancelada',totalCents:5000,cancelledAt:'2026-10-03',paymentStatus:'refunded',refundedAt:'2026-10-04'},
  ],sicarMovements:[{id:'R',orderId:'2',market:'Sears',type:'REEMBOLSO',amountCents:-5000,date:'2026-10-04'}],products:[{sku:'S',upc:'X',name:'P'}]};
  const f={from:'2026-10-01',to:'2026-10-31',basis:'Creacion'};
  const r=salesStatistics(s,f);assert.equal(r.activeGrossCents,10000);assert.equal(r.cancelledCents,5000);assert.equal(r.refundCents,5000);assert.equal(r.refundCount,1);
  assert.equal(salesStatistics(s,{...f,basis:'Documento'}).activeGrossCents,0);
  assert.equal(bestSellers(s,f)[0].qty,2);
});

test('period boundaries use Monday week and inclusive ranges',()=>{
  assert.deepEqual(periodBounds('Semana','2026-10-28'),{from:'2026-10-26',to:'2026-11-01',endExclusive:'2026-11-02'});
  assert.deepEqual(periodBounds('Mes','2028-02-15'),{from:'2028-02-01',to:'2028-02-29',endExclusive:'2028-03-01'});
  assert.throws(()=>periodBounds('Rango','2026-10-28','2026-10-27'));
});

test('partial operational refunds use the recorded amount and source-linked refunds remain deduplicated',()=>{
  const s={orders:[{id:'partial',market:'Sears',totalCents:10000,paymentStatus:'partially_refunded',refundCents:1200,refundedAt:'2026-10-27',commercialStatus:'Activa',creationDate:'2026-10-25'},
    {id:'source',market:'Sears',totalCents:10000,paymentStatus:'refunded',refundCents:10000,refundedAt:'2026-10-27',commercialStatus:'Activa',creationDate:'2026-10-25'}],
    sicarMovements:[{id:'R1',orderId:'source',market:'Sears',type:'REEMBOLSO',amountCents:-2000,date:'2026-10-26'},{id:'R2',orderId:'source',market:'Sears',type:'REEMBOLSO',amountCents:-1000,date:'2026-10-27'}]};
  const r=salesStatistics(s,{from:'2026-10-01',to:'2026-10-31'});
  assert.equal(r.activeGrossCents,20000);assert.equal(r.refundCents,4200);assert.equal(r.refundCount,3);
  assert.equal(r.refundAmountsByOrder.partial,1200);assert.equal(r.refundAmountsByOrder.source,3000);
  assert.deepEqual(r.refundOrderIds,['partial','source']);
});

test('actual V28 seed retains counts, separate date bases, confirmed unknown-date payments',()=>{
  const seed=JSON.parse(fs.readFileSync(new URL('../data/seed-v28.json',import.meta.url)));
  assert.equal(seed.products.length,326);assert.equal(seed.orders.length,492);assert.equal(seed.purchases.length,49);assert.equal(seed.expenses.length,42);
  assert.equal(seed.expensePayments.length,2);assert.ok(seed.expensePayments.every(p=>p.date===null));
  assert.ok(seed.orders.every(o=>o.stockMode==='historical'));
  assert.equal(seed.orders.reduce((n,o)=>n+o.items.length,0),440);
  const rows=sicarComparison(seed,2026).filter(r=>r.sicarCreationCents!=null);
  assert.equal(rows.length,10);assert.ok(rows.every(r=>r.differenceCents===0));
  assert.equal(rows.reduce((n,r)=>n+r.erpCreationCents,0),383888500);
  assert.equal(rows.reduce((n,r)=>n+r.erpDocumentCents,0),375842200);
  const expenses=financialSummary(seed,'expense',{year:2026},ctx.today);
  assert.equal(expenses.paidCents,1500000);
});
