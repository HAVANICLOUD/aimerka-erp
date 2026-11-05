/** Financial evidence parser. All amounts are integer MXN cents. Unknowns block confirmation. */
export const chequeKey=v=>String(v??'').replace(/\s/g,'').replace(/^0+(?=\d)/,'');
const clean=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
const fail=m=>{throw new Error(m);};
const moneyRE=/\(?-?\$?\s*\d[\d,]*\.\d{2}\)?/g;
export function moneyCents(v){const s=String(v).replace(/[$,\s()]/g,'');const n=Math.round(Number(s)*100);if(!Number.isSafeInteger(n))fail('Importe ilegible.');return /\(/.test(v)?-Math.abs(n):n;}
const marketFrom=text=>/GS\s+TIENDAS/.test(clean(text))?'Sears':/SANBORNS?\s+HERMANOS/.test(clean(text))?'Sanborns':null;
function dateDMY(v){const [d,m,y]=v.split('/');const iso=y+'-'+m.padStart(2,'0')+'-'+d.padStart(2,'0');if(new Date(iso+'T12:00:00Z').toISOString().slice(0,10)!==iso)fail('Fecha documental inválida.');return iso;}
export function parseCheque(text){
 if(typeof text!=='string'||text.length>600000)fail('Lectura documental inválida.');
 const market=marketFrom(text),number=chequeKey(text.match(/Cheque\s*:\s*(\d+)/i)?.[1]),date=text.match(/Fecha\s+de\s+Cheque\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1];
 if(!market||!number||!date)fail('No se identificaron marketplace, número y fecha del cheque. Revisa la imagen o activa OCR.');
 const totalSection=text.match(/Totales\s+de[\s\S]{0,180}/i)?.[0],totalValues=totalSection?.match(moneyRE),totalCents=totalValues?.length?moneyCents(totalValues[0]):null;
 const lines=[];let buffer='';
 for(const row of text.split(/\r?\n/)){
  if(/^\s*\d+\/?\s+\d{1,2}\/\d{1,2}\/\d{4}/.test(row))buffer=row;
  else if(buffer)buffer+=' '+row;
  if(!buffer)continue;
  const match=buffer.match(/^\s*(\d+)\/?\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\S+)\s+([A-Z]{2})\b([\s\S]*)$/);
  if(!match)continue;
  const amounts=match[6].match(moneyRE);if(!amounts?.length)continue;
  const code=match[5],value=moneyCents(amounts.at(-1));
  if(!['LP','NP','NT','LD','ND','CR','DR','DV','SI','SV'].includes(code))fail('Tipo de movimiento no reconocido: '+code);
  if(['LD','ND','CR','DR','DV','SV'].includes(code)&&value>0)fail('El movimiento '+code+' no muestra un importe negativo. Revisa el OCR.');
  lines.push({id:number+'-'+lines.length,orderNumber:match[1],documentNumber:match[4],code,amountCents:value,orderId:null});buffer='';
 }
 if(!lines.length||totalCents==null)fail('No se pudieron leer todas las partidas y el total del cheque.');
 const count=text.match(/Totales\s+de\s+(\d+)/i)?.[1];if(count&&Number(count)!==lines.length)fail('El número de partidas leídas no coincide con el cheque.');
 if(lines.reduce((s,r)=>s+r.amountCents,0)!==totalCents)fail('La suma de partidas no coincide con el total impreso. Revisa el reconocimiento.');
 return {id:market+'|'+number,market,number,date:dateDMY(date),totalCents,lines};
}
const months={ENE:'01',FEB:'02',MAR:'03',ABR:'04',MAY:'05',JUN:'06',JUL:'07',AGO:'08',SEP:'09',OCT:'10',NOV:'11',DIC:'12'};
/** Column positions are retained by the reader; the final amount may be a balance. */
export function parseBankStatement(text,config={}){
 if(typeof text!=='string'||text.length>2000000)fail('El estado de cuenta es demasiado extenso.');
 const upper=clean(text),expectedRfc=clean(config.companyRfc||'');
 if(!/BANAMEX/.test(upper)||!expectedRfc||!upper.includes(expectedRfc))fail('El estado de cuenta debe ser Banamex de la empresa configurada. Revisa el RFC.');
 const year=text.match(/ESTADO DE CUENTA AL[^\n]*?(20\d{2})/i)?.[1];
 const account=text.match(/CLABE\s+Interbancaria\s+(\d{18})/i)?.[1]||text.match(/CONTRATO\s+(\d{8,20})/i)?.[1];
 if(!year||!account)fail('No se identificaron año y cuenta del estado bancario.');
 const transactions=[],issues=[];let buffer=[],date=null,columns=null;
 const finish=()=>{
  const block=buffer.join('\n'),market=marketFrom(block);if(!market||!/PAGO\s+RECIBIDO\s+DE\s+INBURSA/i.test(block))return;
  const reference=block.match(/REF\s*\.?\s*(\d+)/i)?.[1],trace=block.match(/RASTREO\s*:\s*([A-Z0-9]+)/i)?.[1];
  // Only an amount in the DEPOSITOS column is a credit. Never infer it from balance.
  const amountRows=buffer.map(row=>({row,values:[...row.matchAll(moneyRE)]})).filter(x=>x.values.length);
  const credits=[];
  for(const {values} of amountRows)for(const value of values){
   const end=value.index+value[0].length;
   if(columns&&end>columns.depositStart&&end<=columns.balanceStart+2)credits.push(moneyCents(value[0]));
  }
  if(!date||!reference||!trace||credits.length!==1||credits[0]<=0){issues.push({date,market,reference:reference||'',reason:'No se pudo confirmar una sola cifra en la columna Depósitos. Revisa el original.'});return;}
  transactions.push({id:trace,trace,market,date,reference,chequeNumber:chequeKey(reference),amountCents:credits[0],accountLast4:account.slice(-4),chequeId:null});
 };
 for(const row of text.split(/\r?\n/)){
  if(/SALDO\s+MINIMO\s+REQUERIDO|COMISIONES\s+COBRADAS\s+EN\s+EL\s+PERIODO/i.test(clean(row))){finish();buffer=[];date=null;continue;}
  if(/FECHA\s+CONCEPTO\s+RETIROS\s+DEPOSITOS\s+SALDO/i.test(row)){columns={depositStart:row.toUpperCase().indexOf('DEPOSITOS')-4,balanceStart:row.toUpperCase().indexOf('SALDO')-3};continue;}
  const m=row.match(/^\s*(\d{2})\s+(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC)\s+/i);
  if(m){finish();date=year+'-'+months[m[2].toUpperCase()]+'-'+m[1];buffer=[row];}
  else buffer.push(row);
 }
 finish();if(!transactions.length)fail('No se identificaron abonos Sears/Sanborns con referencia, rastreo e importe verificables. Usa un PDF con columnas legibles.');
 if(new Set(transactions.map(t=>t.id)).size!==transactions.length)fail('El estado contiene rastreos repetidos; requiere revisión.');
 return {account,accountLast4:account.slice(-4),year,transactions,issues};
}
/** Stable largest remainder allocation, including negative totals, conserves every cent. */
export function allocateCents(total,entries){
 if(!Number.isSafeInteger(total)||!entries.length)fail('Reparto inválido.');
 const sum=entries.reduce((s,e)=>s+e.weight,0);if(!(sum>0))fail('No hay base para distribuir el ajuste.');
 const sign=total<0?-1:1,n=Math.abs(total),rows=entries.map((e,i)=>{const x=n*e.weight/sum;return {...e,i,value:Math.floor(x),fraction:x-Math.floor(x)};});
 let remaining=n-rows.reduce((s,r)=>s+r.value,0);for(const r of [...rows].sort((a,b)=>b.fraction-a.fraction||a.i-b.i)){if(!remaining--)break;r.value++;}
 return Object.fromEntries(rows.map(r=>[r.id,r.value*sign]));
}
export function linkCheque(state,cheque){
 const missing=[];
 for(const line of cheque.lines){
  if(['CR','DR'].includes(line.code)){line.orderId=null;continue;}
  const candidates=state.orders.filter(o=>o.market===cheque.market&&String(o.number).replace(/\/$/,'')===line.orderNumber);
  line.orderId=candidates.length===1?candidates[0].id:null;
  if(!line.orderId)missing.push(line.orderNumber);
 }
 const totals={};let global=0;
 for(const l of cheque.lines){if(l.orderId)totals[l.orderId]=(totals[l.orderId]||0)+l.amountCents;else if(['CR','DR'].includes(l.code))global+=l.amountCents;}
 if(global){
  const eligible=cheque.lines.filter(l=>l.orderId&&['LP','NP','NT','LD','ND'].includes(l.code));
  const sourceComplete=eligible.length&&eligible.every(l=>typeof l.sourceAllocatedRetentionMxn==='number');
  const weights={};
  for(const l of eligible){
   const order=state.orders.find(o=>o.id===l.orderId),sign=['LD','ND'].includes(l.code)?-1:1;
   // V43 already identifies signed bases and the exact fractional tax allocation,
   // including negative allocation on returns and zero on SI/SV adjustments.
   const weight=sourceComplete?l.sourceAllocatedRetentionMxn:typeof l.allocationBaseGrossCents==='number'?l.allocationBaseGrossCents:sign*(order?.totalCents||0);
   weights[l.orderId]=(weights[l.orderId]||0)+weight;
  }
  const entries=Object.entries(weights).map(([id,weight])=>({id,weight}));
  if(!entries.length||entries.reduce((s,e)=>s+e.weight,0)<=0)missing.push('Retención sin base');
  else{const allocated=allocateCents(global,entries);for(const [id,n] of Object.entries(allocated))totals[id]+=n;}
 }
 if(Object.values(totals).reduce((s,n)=>s+n,0)!==cheque.totalCents)missing.push('Total sin asignar');
 cheque.allocations=totals;cheque.unresolved=[...new Set(missing)];return cheque;
}
export function compareV43(order,products,config){
 const cfg=config.bankReconciliation||{},gross=order.totalCents/100,round=n=>Math.round((n+Number.EPSILON)*100)/100;
 const commissionRate=config.commissions?.['T1 Comercios']?.[0]?.rate??cfg.commissionRate??.18,vatIncluded=config.parameters?.t1IncludedVat??cfg.vatIncluded??.16,vatRate=config.parameters?.vatWithholding??cfg.vatWithholding??.08,isrRate=config.parameters?.incomeWithholding??cfg.incomeWithholding??.025;
 const commission=round(gross*commissionRate),vat=round(gross/(1+vatIncluded)*vatRate),isr=round(gross/(1+vatIncluded)*isrRate);
 const shipping=order.reconciliation?.conditions?.shippingCents!=null?order.reconciliation.conditions.shippingCents/100:order.t1Source?.shippingCents!=null?order.t1Source.shippingCents/100:null;
 const cost=order.items?.length?order.items.reduce((s,l)=>{const p=products.find(p=>p.sku===l.sku),unit=p?.averageCostMxn??(l.costCents==null?null:l.costCents/100);return s==null||unit==null?null:s+unit*l.qty;},0):order.v43Comparison?.costMxn??null;
 const expectedNet=round(gross-commission-vat-isr),deposit=order.reconciliation?.depositCents;
 const retention=order.t1Source?.withholdingMxn??round(vat+isr),draft=order.reconciliation?.draft?.amountCents??(typeof order.reconciliation?.sourceDraft?.[1]==='number'?Math.round(order.reconciliation.sourceDraft[1]*100):null),used=deposit??draft;
 const returned=/Cancelad|Devuel|Reembols/i.test(order.commercialStatus+' '+order.sourceReturnStatus+' '+order.sourcePaymentStatus)||Number(order.v43Comparison?.returnsMxn)<0;
 const inferredCommission=returned?order.v43Comparison?.inferredCommissionMxn??null:used!=null?round(gross-used/100-retention):order.v43Comparison?.inferredCommissionMxn??null;
 return {commission,commissionRate,vat,isr,retention,inferredCommission,inferredRate:inferredCommission==null||!gross?null:inferredCommission/gross,expectedNet,shipping,cost,expectedProfit:shipping==null||cost==null?null:round(expectedNet-shipping-cost),realProfit:deposit==null||shipping==null||cost==null||returned?null:round(deposit/100-shipping-cost)};
}
export function reconcileLedger(state,context={}){
 const ledger=state.settlementLedger,config=state.config.bankReconciliation||{},windowDays=config.dateWindowDays??90;
 for(const cheque of ledger.cheques){
  linkCheque(state,cheque);
  if(cheque.status==='awaiting_ocr')continue;
  const candidates=ledger.transactions.filter(t=>t.market===cheque.market&&t.chequeNumber===cheque.number&&(!t.chequeId||t.chequeId===cheque.id)&&Math.abs(new Date(t.date)-new Date(cheque.date))/86400000<=windowDays);
  cheque.bankCandidates=candidates.map(t=>t.id);
  if(cheque.unresolved.length){cheque.status='review';continue;}
  if(candidates.length!==1){cheque.status=candidates.length?'ambiguous':'documented';continue;}
  const tx=candidates[0];if(tx.amountCents!==cheque.totalCents){cheque.status='amount_difference';cheque.bankDifferenceCents=tx.amountCents-cheque.totalCents;continue;}
  cheque.status='reconciled';cheque.bankTransactionId=tx.id;cheque.bankDifferenceCents=0;tx.chequeId=cheque.id;cheque.confirmedAt??=context.now;
 }
 for(const order of state.orders.filter(o=>['Sears','Sanborns'].includes(o.market))){
  const related=ledger.cheques.filter(c=>c.lines.some(l=>l.orderId===order.id)),confirmed=related.filter(c=>c.status==='reconciled'),r=order.reconciliation??={};
  r.bankProofRequired=true;r.bankProofIds=confirmed.map(c=>c.bankTransactionId);
  r.documentaryNetCents=related.length?related.reduce((s,c)=>s+(c.allocations[order.id]||0),0):null;
  r.sourceRoundingDifferenceCents=r.documentaryNetCents==null||order.t1Source?.documentaryNetCents==null?null:r.documentaryNetCents-order.t1Source.documentaryNetCents;
  r.depositCents=confirmed.length?confirmed.reduce((s,c)=>s+(c.allocations[order.id]||0),0):null;
  r.depositDate=confirmed.length?ledger.transactions.filter(t=>r.bankProofIds.includes(t.id)).map(t=>t.date).sort().at(-1):null;
  r.status=related.length&&confirmed.length===related.length?'Conciliada':confirmed.length?'Conciliación parcial':'Pendiente de banco';
  const calc=compareV43(order,state.products,state.config);r.realProfitCents=calc.realProfit==null?null:Math.round(calc.realProfit*100);r.modelDifferenceCents=r.depositCents==null?null:r.depositCents-Math.round(calc.expectedNet*100);order.paidCents=r.depositCents;
 }
}
export function documentaryNetCents(order){
 if(order.reconciliation&&Object.hasOwn(order.reconciliation,'documentaryNetCents'))return order.reconciliation.documentaryNetCents;
 return /\d/.test(order.t1Source?.cheques||'')?order.t1Source?.documentaryNetCents??null:null;
}
export function pendingBalanceCents(order,products,config){
 if(order.reconciliation?.status==='Conciliada'||/Cancelad|Devuel|Reembols/i.test(order.commercialStatus+' '+order.sourceReturnStatus+' '+order.sourcePaymentStatus))return 0;
 return Math.max(0,(documentaryNetCents(order)??Math.round(compareV43(order,products,config).expectedNet*100))-(order.reconciliation?.depositCents||0));
}
export function applySettlementCommand(state,command,context={}){
 if(!state.settlementLedger)fail('Selecciona Laboratorio V43 para conciliar documentos T1.');
 const p=command.payload||{},ledger=state.settlementLedger;
 if(command.type==='settlement.config'){
  const c=p.config||{};for(const k of ['commissionRate','vatIncluded','vatWithholding','incomeWithholding'])if(!Number.isFinite(c[k])||c[k]<0||c[k]>=1)fail('Revisa las tasas de conciliación.');
  if(!Number.isInteger(c.dateWindowDays)||c.dateWindowDays<0||c.dateWindowDays>365||!/^\w{12,13}$/.test(c.companyRfc||''))fail('Revisa ventana de fechas y RFC de empresa.');
  state.config.bankReconciliation={...c};
  Object.assign(state.config.parameters,{t1IncludedVat:c.vatIncluded,vatWithholding:c.vatWithholding,incomeWithholding:c.incomeWithholding});
  for(const row of state.config.commissions['T1 Comercios'])row.rate=c.commissionRate;
 }else if(['settlement.cheque','settlement.statement'].includes(command.type)){
  const doc=context.verifiedDocuments?.find(d=>d.id===p.documentId);if(!doc)fail('Primero carga el documento original.');
  if(ledger.documents.some(d=>d.id===doc.id))return {ok:true,duplicate:true,message:'El archivo ya está registrado; no se duplicó el pago.'};
  if(command.type==='settlement.cheque'){
   const parsed=parseCheque(p.text),existing=ledger.cheques.find(c=>c.id===parsed.id);linkCheque(state,parsed);
   if(existing){
    const signature=c=>JSON.stringify({date:c.date,total:c.totalCents,lines:c.lines.map(l=>[l.orderNumber,l.documentNumber,l.code,l.amountCents]).sort()});
    if(signature(existing)!==signature(parsed))fail('El cheque ya existe con datos diferentes. No se sustituyó la evidencia previa.');
    if(existing.documentId)fail('Este número de cheque ya tiene un comprobante registrado.');
    for(const line of parsed.lines){const original=existing.lines.find(l=>l.orderNumber===line.orderNumber&&l.documentNumber===line.documentNumber&&l.code===line.code&&l.amountCents===line.amountCents);if(original)for(const k of ['sourceRetentionMxn','sourceAllocatedRetentionMxn','allocationBaseGrossCents'])if(original[k]!=null)line[k]=original[k];}
    linkCheque(state,parsed);
    Object.assign(existing,parsed,{status:'documented',documentId:doc.id});
   }else ledger.cheques.push({...parsed,status:'documented',documentId:doc.id});
  }else{
   const parsed=parseBankStatement(p.text,state.config.bankReconciliation),accountHash=context.accountHash;
   if(!accountHash)fail('Falta verificar la cuenta bancaria.');
   for(const t of parsed.transactions){const old=ledger.transactions.find(x=>x.id===accountHash+':'+t.trace);if(old&&(old.amountCents!==t.amountCents||old.date!==t.date||old.market!==t.market||old.reference!==t.reference))fail('Rastreo bancario repetido con información contradictoria.');}
   for(const t of parsed.transactions){t.id=accountHash+':'+t.trace;if(!ledger.transactions.some(x=>x.id===t.id))ledger.transactions.push({...t,accountHash,documentId:doc.id});}
   ledger.statements.push({id:doc.id,accountLast4:parsed.accountLast4,accountHash,year:parsed.year,transactionIds:parsed.transactions.map(t=>t.id),issues:parsed.issues});
  }
  ledger.documents.push({...doc,kind:command.type.split('.')[1],importedAt:context.now,actor:context.actor,extraction:p.extraction==='ocr'?'ocr':'pdf-text'});
 }else fail('Operación documental inválida.');
 reconcileLedger(state,context);
 (state.events??=[]).unshift({id:command.id,type:command.type,date:context.now,actor:context.actor,result:'ok',message:'Evidencia de conciliación registrada. Confirmados solo los cheques que coinciden con banco.'});
 return {ok:true,message:'Documento cotejado. Los depósitos se confirman únicamente con cheque y abono coincidentes.'};
}
