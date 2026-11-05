import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseCheque,parseBankStatement,allocateCents,linkCheque,compareV43,reconcileLedger,pendingBalanceCents} from '../lib/settlement-documents.mjs';
import {applyCommand} from '../lib/commands.mjs';
import {resolveCommission} from '../lib/pricing-v28.mjs';
const seed=()=>JSON.parse(fs.readFileSync(new URL('../data/seed-v43.json',import.meta.url)));
const read=name=>fs.readFileSync(new URL('./fixtures/v43/'+name+'.txt',import.meta.url),'utf8');
const cfg={companyRfc:'AAA010101AAA'};
let serial=0;
function apply(state,type,text,id){id??=(++serial).toString(16).padStart(64,'0');return applyCommand(state,{id:'proof-'+(++serial),type:'settlement.'+type,payload:{text,documentId:id}},{workspace:'v43',now:'2026-11-04T18:00:00Z',actor:'test',accountHash:'test-account',verifiedDocuments:[{id,name:type+'.pdf',mime:'application/pdf'}]});}
function bank(state,month){state.config.bankReconciliation.companyRfc=cfg.companyRfc;return apply(state,'statement',read('BANAMEX_'+month));}
const stock=state=>JSON.stringify({products:state.products.map(p=>[p.sku,p.good,p.reserved,p.quarantine,p.damaged,p.costCents,p.averageCostMxn]),movements:state.movements});

test('V43 source has 706 sales,66 cheques,420 movements and 1468 commercial photographs; source stays unconfirmed',()=>{
 const s=seed();assert.equal(s.orders.length,706);assert.equal(s.settlementLedger.cheques.length,66);assert.equal(s.settlementLedger.sourceCounts.lines,420);assert.equal(s.products.reduce((n,p)=>n+(p.images?.length||0),0),1468);
 assert.equal(s.settlementLedger.transactions.length,0);assert.ok(s.orders.filter(o=>o.t1Source).every(o=>o.reconciliation.depositCents===null));
});
test('actual Sears and Sanborns cheque layouts preserve net NP and separate CR withholding',()=>{
 const a=parseCheque(read('SEARS_32798')),b=parseCheque(read('SANBORNS_11457'));assert.equal(a.totalCents,1054037);assert.equal(a.lines.length,2);assert.equal(b.totalCents,230769);assert.equal(b.lines[1].amountCents,-27145);assert.equal(b.lines[1].orderNumber,'02026411');
 const s=seed();linkCheque(s,b);assert.equal(b.allocations.V001084,230769);assert.deepEqual(b.unresolved,[]);
});
test('bank reader finds real deposits, normalizes leading zero reference, retains across-page transaction and ignores final balance',()=>{
 const p=parseBankStatement(read('BANAMEX_OCTUBRE'),cfg),tx=p.transactions.find(t=>t.chequeNumber==='32798');assert.equal(tx.reference,'0032798');assert.equal(tx.amountCents,1054037);assert.equal(tx.date,'2026-10-26');
 const b=parseBankStatement(read('BANAMEX_SEPTIEMBRE'),cfg).transactions.find(t=>t.chequeNumber==='11457');assert.equal(b.amountCents,230769);assert.equal(b.market,'Sanborns');assert.equal(b.reference,'0011457');
 assert.throws(()=>parseBankStatement(read('BANAMEX_OCTUBRE'),{companyRfc:'XXX010101XXX'}),/empresa configurada/);
});
test('bank and cheque can arrive in either order; only their exact match confirms deposit and real profit without touching stock',()=>{
 for(const firstBank of [false,true]){const s=seed(),before=stock(s);if(firstBank){bank(s,'OCTUBRE');bank(s,'SEPTIEMBRE');}
  apply(s,'cheque',read('SEARS_32798'));apply(s,'cheque',read('SANBORNS_11457'));
  if(!firstBank){for(const id of s.settlementLedger.testOrderIds)assert.equal(s.orders.find(o=>o.id===id).reconciliation.depositCents,null);bank(s,'OCTUBRE');bank(s,'SEPTIEMBRE');}
  for(const [id,deposit,profit] of [['V000996',938692,128776],['V000997',115345,61626],['V001084',230769,61782]]){const o=s.orders.find(o=>o.id===id);assert.equal(o.reconciliation.status,'Conciliada');assert.equal(o.reconciliation.depositCents,deposit);assert.equal(o.reconciliation.realProfitCents,profit);assert.notEqual(o.reconciliation.modelDifferenceCents,0);}
  assert.equal(stock(s),before);
 }
});
test('file, cheque and overlapping statement duplicates cannot double a deposit; conflicting trace rolls back',()=>{
 const s=seed();apply(s,'cheque',read('SEARS_32798'),'a'.repeat(64));bank(s,'OCTUBRE');const value=s.orders.find(o=>o.id==='V000996').reconciliation.depositCents,n=s.settlementLedger.transactions.length;
 const r=apply(s,'cheque',read('SEARS_32798'),'a'.repeat(64));assert.equal(r.duplicate,true);
 assert.throws(()=>apply(s,'cheque',read('SEARS_32798')),/ya tiene un comprobante/);
 bank(s,'OCTUBRE');assert.equal(s.settlementLedger.transactions.length,n);assert.equal(s.orders.find(o=>o.id==='V000996').reconciliation.depositCents,value);
 const before=JSON.stringify(s);assert.throws(()=>apply(s,'statement',read('BANAMEX_OCTUBRE').replace('10,540.37','10,540.38')),/contradictoria/);assert.equal(JSON.stringify(s),before);
});
test('wrong amount, wrong origin, duplicate candidate and unmatched order never become reconciled',()=>{
 for(const kind of ['amount','market','ambiguous','order']){const s=seed();apply(s,'cheque',read('SEARS_32798'));s.config.bankReconciliation.companyRfc=cfg.companyRfc;let text=read('BANAMEX_OCTUBRE');if(kind==='amount')text=text.replace('10,540.37','10,540.38');if(kind==='market')text=text.replaceAll('GS TIENDAS','SANBORN HERMANOS');
  apply(s,'statement',text);const c=s.settlementLedger.cheques.find(c=>c.id==='Sears|32798');
  if(kind==='ambiguous'){const t=s.settlementLedger.transactions.find(t=>t.chequeNumber==='32798');s.settlementLedger.transactions.push({...t,id:t.id+'-other',chequeId:null});reconcileLedger(s);}
  if(kind==='order'){c.lines[0].orderNumber='no-such-order';reconcileLedger(s);}
  assert.notEqual(c.status,'reconciled',kind);assert.equal(s.orders.find(o=>o.id==='V000996').reconciliation.depositCents,null,kind);
 }
});
test('manual legacy routes cannot confirm a bank-required sale or bypass batch controls',()=>{
 const s=seed();for(const type of ['reconciliation.save','reconciliation.saveBatch','marketplace.deposit','marketplace.close']){assert.throws(()=>applyCommand(s,{id:'manual-proof',type,payload:{orderId:'V000996',ids:['V000996'],amountCents:938692,input:{amountCents:938692,date:'2026-10-26'}}},{workspace:'v43'}),/requieren cheque/);}
});
test('all 713 available expected net/profit values match V43 within a cent and all source cheque lines balance',()=>{
 const s=seed();let checked=0;
 for(const c of s.settlementLedger.cheques){linkCheque(s,c);assert.deepEqual(c.unresolved,[],c.id);assert.equal(Object.values(c.allocations).reduce((a,b)=>a+b,0),c.totalCents);}
 for(const o of s.orders.filter(o=>o.t1Source)){const calc=compareV43(o,s.products,s.config),source=o.v43Comparison;for(const [key,ref] of [['expectedNet','expectedNetMxn'],['expectedProfit','expectedProfitMxn']])if(typeof source?.[ref]==='number'){checked++;assert.ok(Math.abs(calc[key]-source[ref])<.011,o.id+' '+key);}}
 assert.equal(checked,713);
});
test('cent allocation conserves positive/negative totals with deterministic fractional retention splits',()=>{
 for(const n of [1,100,27145,-27145]){const a=allocateCents(n,[{id:'a',weight:100},{id:'b',weight:100},{id:'c',weight:100}]);assert.equal(Object.values(a).reduce((s,v)=>s+v,0),n);assert.equal(Math.abs(a.a-a.c)<=1,true);}
});
test('signed retention allocations reproduce every cheque-linked source payment within one cent and conserve returns',()=>{
 const s=seed();reconcileLedger(s);let checked=0;
 for(const o of s.orders.filter(o=>o.t1Source&&o.reconciliation.documentaryNetCents!=null)){checked++;assert.ok(Math.abs(o.reconciliation.documentaryNetCents-o.t1Source.documentaryNetCents)<=1,o.id);}
 assert.ok(checked>200);assert.equal(s.orders.find(o=>o.id==='V002552').reconciliation.documentaryNetCents,117663);
 const allocation=allocateCents(-824991,[{id:'paid',weight:100},{id:'returned',weight:-10}]);assert.equal(allocation.paid+allocation.returned,-824991);assert.ok(allocation.returned>0);
});
test('unpaid orders with no cheque and later documentary adjustments stay in marketplace debt until bank proof arrives',()=>{
 const s=seed();reconcileLedger(s);const unpaid=s.orders.find(o=>o.t1Source&&!o.t1Source.cheques&&o.commercialStatus==='Activa');assert.ok(unpaid);assert.ok(pendingBalanceCents(unpaid,s.products,s.config)>0);
 apply(s,'cheque',read('SEARS_32798'));bank(s,'OCTUBRE');const o=s.orders.find(o=>o.id==='V000996');assert.equal(pendingBalanceCents(o,s.products,s.config),0);
 s.settlementLedger.cheques.push({id:'Sears|99999',market:'Sears',number:'99999',date:'2026-10-28',totalCents:10000,status:'documented',lines:[{orderId:o.id,orderNumber:o.number,documentNumber:'ADJ1',code:'SI',amountCents:10000}]});reconcileLedger(s);assert.equal(o.reconciliation.status,'Conciliación parcial');assert.equal(pendingBalanceCents(o,s.products,s.config),10000);
});
test('V43 pricing calculators use nominal withholding on the VAT-exclusive T1 base and keep other channels unchanged',()=>{
 const s=seed(),config=structuredClone(s.config);config.parameters.t1IncludedVat=.16;
 const rates=resolveCommission(config,{channel:'T1 Comercios'});assert.ok(Math.abs(rates.vatRate-.08/1.16)<1e-12);assert.ok(Math.abs(rates.isrRate-.025/1.16)<1e-12);
 const old=structuredClone(config);delete old.parameters.t1IncludedVat;assert.equal(resolveCommission(old,{channel:'T1 Comercios'}).vatRate,.08);
});

test('Sears Operadora bank origin is recognized alongside GS Tiendas, without changing date or reference',()=>{
 const text=read('BANAMEX_OCTUBRE').replaceAll('GS TIENDAS','SEARS OPERADORA');const parsed=parseBankStatement(text,cfg);assert.equal(parsed.period,'2026-10');const tx=parsed.transactions.find(t=>t.chequeNumber==='32798');assert.equal(tx.market,'Sears');assert.equal(tx.reference,'0032798');assert.equal(tx.amountCents,1054037);
 const previousYear=parseBankStatement(text.replaceAll('2026','2025'),cfg);assert.equal(previousYear.period,'2025-10');assert.ok(previousYear.transactions.every(t=>t.date.startsWith('2025-')));
});

test('cancelled sales without cheque carry no expected bank payment while active sales remain pending',()=>{const s=seed();reconcileLedger(s);const unrelated=s.orders.filter(o=>['Sears','Sanborns'].includes(o.market)&&!s.settlementLedger.cheques.some(c=>c.lines.some(l=>l.orderId===o.id)));assert.equal(unrelated.length,66);assert.equal(unrelated.filter(o=>o.reconciliation.status==='Cancelada · sin pago esperado').length,50);assert.equal(unrelated.filter(o=>o.reconciliation.status==='Pendiente de banco').length,16);assert.ok(unrelated.filter(o=>o.commercialStatus==='Cancelada').every(o=>pendingBalanceCents(o,s.products,s.config)===0));});
