/** Current estimates are separate from documentary fees and historical pricing snapshots. */
export const T1_COMMISSION_RATE = .14;
const migrationId='searsSanborns14_20261120';
const isT1=o=>['Sears','Sanborns','T1 Comercios'].includes(o.market);
const oldRate=n=>Number.isFinite(n)&&Math.abs(n-.18)<1e-7;
const oldEstimate=e=>e&&(oldRate(e.commissionRate)||oldRate(e.baseCommissionRate)||(e.grossCents>0&&oldRate(e.commissionCents/e.grossCents))||(e.lines||[]).some(l=>oldRate(l.rates?.baseRate)||oldRate(l.rates?.totalRate)));
const modeledFields=['expectedCommissionMxn','expectedVatMxn','expectedIsrMxn','expectedNetMxn','expectedProfitMxn','profitDifferenceMxn'];
/** One-time owner-requested migration. Never writes payments, fees inferred from evidence, stock or saved prices. */
export function migrateT1Commission14(state,ctx={}){
 const config=state.config;if(!config||config.commissionMaintenance?.[migrationId])return null;
 const before={commissions:structuredClone(config.commissions?.['T1 Comercios']||[]),bankRate:config.bankReconciliation?.commissionRate??null},orders=[];
 for(const row of config.commissions?.['T1 Comercios']||[]){row.rate=T1_COMMISSION_RATE;row.note='Comisión vigente confirmada: 14% para Sears y Sanborns. El historial conserva las comisiones efectivamente cobradas.';}
 if(config.bankReconciliation)config.bankReconciliation.commissionRate=T1_COMMISSION_RATE;
 for(const order of state.orders||[]){
  if(!isT1(order))continue;
  const r=order.reconciliation,c=order.v43Comparison,archived={orderId:order.id,market:order.market};let changed=false;
  if(oldEstimate(r?.estimate)){
   archived.estimate=structuredClone(r.estimate);r.estimate=null;r.estimateError='Estimación del 18% retirada. La tarifa vigente es 14%; vuelve a calcular si necesitas guardar una estimación.';
   if(Object.hasOwn(r,'differenceCents')){archived.differenceCents=r.differenceCents;delete r.differenceCents;}changed=true;
  }
  // Imported Excel comparisons at 18% are obsolete forecasts, never payment evidence.
  if(c&&Number.isFinite(c.expectedCommissionMxn)&&Math.abs(c.expectedCommissionMxn-order.totalCents/100*.18)<.011){
   archived.comparison={};for(const field of modeledFields)if(Object.hasOwn(c,field)){archived.comparison[field]=c[field];delete c[field];}
   if(r&&Object.hasOwn(r,'modelDifferenceCents')){archived.modelDifferenceCents=r.modelDifferenceCents;delete r.modelDifferenceCents;}changed=true;
  }
  if(changed)orders.push(archived);
 }
 const report={id:migrationId,appliedAt:ctx.now||null,rate:T1_COMMISSION_RATE,before,orders};
 (state.commissionPolicyHistory??=[]).push(report);
 (config.commissionMaintenance??={})[migrationId]={appliedAt:report.appliedAt,rate:T1_COMMISSION_RATE,archivedEstimates:orders.length};
 (state.events??=[]).unshift({id:ctx.requestId||migrationId,type:'config.commission.currentT1',date:ctx.now,actor:ctx.actor||'Sistema',result:'ok',message:'Sears y Sanborns: comisión vigente 14%. Estimaciones del 18% retiradas de la operación y conservadas en auditoría; depósitos, documentos y comisiones reales sin cambios.'});
 return {rate:T1_COMMISSION_RATE,archivedOrders:orders.length};
}
