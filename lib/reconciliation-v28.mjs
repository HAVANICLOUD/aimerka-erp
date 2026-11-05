/**
 * Conciliación V28, port of Tarifas27 + Conciliacion27/28.
 * All money in integer MXN cents; rates in fractions. Changes only order.reconciliation.
 * A saved deposit is the confirmed TOTAL recorded for an order (replace, never add).
 * Workbook formulas are retained; source history is preserved separately from estimates.
 */
const CLOSED = new Set(['Conciliada', 'Resuelta']);
const FOLLOWUPS = new Set(['No pagada', 'Incongruencia', 'Incidencia', 'Resuelta']);
const SHIPPING_MODES = new Set(['Externo', 'Descontado', 'Por confirmar']);
const text = v => v == null ? '' : String(v).trim();
const normalized = v => text(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
const present = v => v !== null && v !== undefined && v !== '';
const clone = v => JSON.parse(JSON.stringify(v));
const rounded = v => Math.sign(v) * Math.round(Math.abs(v) + Number.EPSILON * Math.max(1, Math.abs(v)));
const cents = (v, label = 'Importe', allowNull = false) => {
  if (!present(v) && allowNull) return null;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new Error(`${label}: indica un importe no negativo en centavos.`);
  return v;
};
const rate = (v, label) => {
  if (!present(v) || typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v >= 1) throw new Error(`${label}: falta una tasa válida menor a 100%.`);
  return v;
};
const now = opts => opts?.now || new Date().toISOString();
export function mexicoToday() {
  return new Intl.DateTimeFormat('en-CA', {timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(value))) return false;
  const d = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value;
}
export function isCancelled(order) {
  return order.status === 'cancelled' || normalized(order.commercialStatus) === 'cancelada' || normalized(order.commercialStatus) === 'cancelado';
}
export function documentedMsi(order) {
  const desc = `${order.description || ''} ${order.notes || ''} ${order.originalDescription || ''}`.toUpperCase();
  const m = desc.match(/(?:^|\D)(24|18|12|9|6|3)\s*MSI\b/);
  return m ? Number(m[1]) : 0;
}
export function msiMonths(value) {
  if (!present(value) || normalized(value) === 'sin msi' || String(value) === '0') return 0;
  const str = text(value);
  if (!/^\d+(?:\s*MSI)?$/i.test(str)) throw new Error('Selecciona un plazo MSI válido.');
  const result = parseInt(str,10);
  if (!Number.isInteger(result) || result < 0 || result > 60) throw new Error('Selecciona un plazo MSI válido.');
  return result;
}
export function reconciliationOf(order) {
  const current = order.reconciliation || {};
  return {
    conditions: {publication:'CLASICA',msi:documentedMsi(order),shippingCents:null,...current.conditions},
    estimate:null,depositCents:null,depositDate:null,status:isCancelled(order)?'Cancelada por revisar':'Sin revisar',
    notes:'',selected:false,draft:null,history:[],...current,
    // Merge defaults even when an imported object has a partial conditions map.
    ...{conditions:{publication:'CLASICA',msi:documentedMsi(order),shippingCents:null,...current.conditions}}
  };
}
function ensure(order) { order.reconciliation = reconciliationOf(order); return order.reconciliation; }
function record(order, action, before, after, opts) {
  const r = ensure(order);
  r.history ||= [];
  r.history.push({action,at:now(opts),actor:opts?.actor||'Usuario',before:clone(before),after:clone(after),requestId:opts?.requestId||null});
}
export function conditionsFor(order) {
  const r=reconciliationOf(order), mk=order.market;
  return {publication:mk==='Mercado Libre'?text(r.conditions.publication).toUpperCase()||'CLASICA':'CLASICA',
    msi:mk==='Liverpool'||mk==='Elektra'?msiMonths(r.conditions.msi):0,
    shippingCents:cents(r.conditions.shippingCents,'Envío confirmado',true)};
}
export function categoryFor(product, market, config) {
  if (['Sears','Sanborns','T1 Comercios'].includes(market)) return config.commissions?.['T1 Comercios']?.[0]?.category || '';
  if (market==='Tienda Nube') return 'General';
  const aliases = {'Mercado Libre':['Mercado Libre','ML','ml'],'Tienda Nube':['Tienda Nube','TN','tn'],Liverpool:['Liverpool','liverpool'],Coppel:['Coppel','coppel'],Elektra:['Elektra','elektra']};
  const keys=aliases[market]||[market];
  for(const key of keys)if(present(product.categoryOverrides?.[key])&&normalized(product.categoryOverrides[key])!=='automatico')return text(product.categoryOverrides[key]);
  // Catalog-derived categories are live formulas in Excel. Current mapping edits
  // must feed new estimates; saved estimates keep their own rate snapshots.
  const mapping=config.categoryMappings?.find(x=>normalized(x.category)===normalized(product.category));
  for(const key of keys) if(present(mapping?.channels?.[key])) return text(mapping.channels[key]);
  for(const key of keys)if(present(product.categories?.[key]))return text(product.categories[key]);
  return '';
}
export function shippingTypeFor(product,config) {
  if(present(product.shippingException)&&normalized(product.shippingException)!=='automatico')return text(product.shippingException);
  const title=normalized(product.name);
  for(const rule of config.shippingRules||[])if(present(rule.keyword)&&title.includes(normalized(rule.keyword)))return text(rule.type);
  const mapping=config.categoryMappings?.find(x=>normalized(x.category)===normalized(product.category));
  return text(mapping?.shipping||product.shippingType);
}
export function settlementRates(config, market, category, publication='CLASICA', msi=0, unitPriceCents=0) {
  const months=msiMonths(msi); let base, extra=0, vat=0, income=0;
  if (market==='Tienda Nube') {
    let band;
    for(const b of config.tnBands||[]) if(Number.isFinite(b.min)&&unitPriceCents/100>=b.min) band=b;
    if(!band) throw new Error('Precio fuera de los tramos configurados de Tienda Nube.');
    base=rate(band.usedRate,'Comisión ponderada Tienda Nube');
  } else {
    const group=['Sears','Sanborns','T1 Comercios'].includes(market)?'T1 Comercios':market;
    if(!config.commissions?.[group]) throw new Error(`Marketplace sin configurar: ${market}.`);
    const rows=config.commissions[group];
    const row=group==='T1 Comercios'?rows[0]:rows.find(x=>normalized(x.category)===normalized(category));
    if(!row) throw new Error(`Categoría sin comisión configurada: ${category||'(vacía)'} / ${market}.`);
    if(market==='Mercado Libre' && !['CLASICA','PREMIUM'].includes(publication)) throw new Error('Selecciona publicación Clásica o Premium.');
    base=rate(market==='Mercado Libre'&&publication==='PREMIUM'?row.premiumRate:row.rate,`Comisión ${category} / ${market}`);
    vat=rate(config.parameters?.vatWithholding,'Retención de IVA');
    if(group==='T1 Comercios'&&config.parameters?.t1IncludedVat!=null)vat/=1+rate(config.parameters.t1IncludedVat,'IVA incluido T1');
    income=rate(config.parameters?.incomeWithholding,'Retención de ISR');
    if(group==='T1 Comercios'&&config.parameters?.t1IncludedVat!=null)income/=1+rate(config.parameters.t1IncludedVat,'IVA incluido T1');
    if(market==='Liverpool') {
      const included=rate(config.settlement?.liverpoolIncludedMsi,'Recargo ya incluido en catálogo Liverpool');
      base-=included;
      const term=config.settlement?.liverpoolMsi?.find(x=>Number(x.months)===months);
      if(!term) throw new Error('Plazo Liverpool no configurado; usa Sin MSI, 3 o 6.');
      extra=rate(term.rate,'Recargo MSI Liverpool');
    } else if(market==='Elektra' && months>0) {
      const term=config.elektraMsi?.find(x=>msiMonths(x.label ?? x.months)===months);
      if(!term) throw new Error('Plazo Elektra no configurado; no se puede suponer una comisión MSI.');
      extra=rate(term.rate,'Recargo MSI Elektra');
    }
  }
  // Tiny cancellation errors from subtraction are normalized; negative business rates block.
  if(base<0 && base>-0.000001) base=0;
  rate(base,`Comisión base ${market}`);rate(extra,`MSI ${market}`);rate(base+extra,`Comisión total ${market}`);
  return {baseRate:base,msiRate:extra,totalRate:base+extra,vatRate:vat,incomeRate:income};
}
export function shippingTreatment(config,market) {
  const mode=config.settlement?.shippingTreatment?.[market];
  if(!SHIPPING_MODES.has(mode)) throw new Error(`Configura el tratamiento del envío de ${market}.`);
  return mode;
}
function shippingTariff(config,type) {
  const row=config.shipping?.find(x=>normalized(x.type)===normalized(type));
  if(!row || !Number.isFinite(row.min) || row.min<0) throw new Error(`Tipo de envío no configurado: ${type||'(vacío)'}.`);
  return rounded(row.min*100);
}
function productFor(item,products) {
  return products.find(p => (present(item.upc)&&text(p.upc)===text(item.upc)) || (present(item.sku)&&text(p.sku)===text(item.sku)));
}
/** Pure: no mutations, stock writes or deposit writes. */
export function estimateOrder(order, products, config, opts={}) {
  if(order.marketplace34&&!opts.ignoreMarketplace34)return estimateMarketplace34(order,products,config,opts);
  if(isCancelled(order)) throw new Error('Venta cancelada: no se presupone un depósito.');
  const gross=cents(order.totalCents,'Importe de venta');
  if(gross<=0) throw new Error('Falta el importe de venta.');
  const items=order.items||[];
  if(!items.length) throw new Error('Faltan partidas verificadas; no se inventa una estimación.');
  const sum=items.reduce((a,i)=>a+cents(i.totalCents,'Importe de partida'),0);
  if(sum<=0) throw new Error('Faltan partidas verificadas con importe.');
  const charged=cents(order.shippingChargedCents??0,'Envío cobrado');
  if(Math.abs(sum+charged-gross)>2) throw new Error('El total no coincide con las partidas verificadas y el envío cobrado.');
  const conditions=conditionsFor(order),mode=shippingTreatment(config,order.market),lines=[];
  let totalCommission=0,totalVat=0,totalIncome=0,totalShipping=0,totalExternal=0,totalMsi=0,totalCost=0,missingCost=false;
  for(const item of items) {
    if(typeof item.qty!=='number'||!Number.isFinite(item.qty)||item.qty<=0) throw new Error('Cantidad inválida.');
    const product=productFor(item,products);
    if(!product) throw new Error(`UPC / SKU sin coincidencia: ${item.name||item.sku||item.upc||item.id}.`);
    const category=categoryFor(product,order.market,config),baseRaw=item.totalCents*gross/sum;
    const rates=settlementRates(config,order.market,category,conditions.publication,conditions.msi,baseRaw/item.qty);
    const line={orderId:order.id,lineId:item.id||`${order.id}/${lines.length+1}`,sku:item.sku,upc:item.upc,name:item.name||product.name,category,qty:item.qty,
      baseCents:rounded(baseRaw),commissionCents:rounded(baseRaw*rates.totalRate),vatCents:rounded(baseRaw*rates.vatRate),incomeCents:rounded(baseRaw*rates.incomeRate),
      msiCents:rounded(baseRaw*rates.msiRate),shippingCents:0,externalShippingCents:0,costCents:null,profitCents:null,margin:null,rates};
    if(mode==='Externo' && conditions.shippingCents!==null) line.externalShippingCents=rounded(conditions.shippingCents*baseRaw/gross);
    if(mode!=='Externo') {
      if(conditions.shippingCents!==null) line.shippingCents=rounded(conditions.shippingCents*baseRaw/gross);
      else if(mode==='Descontado') line.shippingCents=rounded(shippingTariff(config,shippingTypeFor(product,config))*item.qty);
    }
    const preciseCostMxn=typeof product.averageCostMxn==='number'?product.averageCostMxn:(typeof product.sourceCost==='number'?product.sourceCost:product.costCents/100);
    if(Number.isFinite(preciseCostMxn)&&preciseCostMxn>=0.01) {
      const exactLineCost=preciseCostMxn*item.qty*100;
      line.costBasisMxn=preciseCostMxn;line.costRawCents=exactLineCost;line.costCents=rounded(exactLineCost);totalCost+=exactLineCost;
      line.profitCents=rounded(baseRaw-line.commissionCents-line.vatCents-line.incomeCents-line.shippingCents-exactLineCost-line.externalShippingCents);
      line.margin=line.profitCents/baseRaw;
    } else missingCost=true;
    totalCommission+=line.commissionCents;totalVat+=line.vatCents;totalIncome+=line.incomeCents;
    totalShipping+=line.shippingCents;totalExternal+=line.externalShippingCents;totalMsi+=line.msiCents;lines.push(line);
  }
  if(conditions.shippingCents!==null) {
    const last=lines.at(-1),field=mode==='Externo'?'externalShippingCents':'shippingCents';
    const previous=last[field],total=mode==='Externo'?totalExternal:totalShipping;
    last[field]+=conditions.shippingCents-total;
    if(last.profitCents!==null){last.profitCents-=last[field]-previous;last.margin=last.profitCents/last.baseCents;}
    if(mode==='Externo')totalExternal=conditions.shippingCents;else totalShipping=conditions.shippingCents;
  }
  const net=gross-totalCommission-totalVat-totalIncome-totalShipping;
  const cost=missingCost?null:rounded(totalCost),profit=cost===null?null:net-cost-totalExternal;
  const warnings=[];
  if(mode==='Por confirmar'&&conditions.shippingCents===null) warnings.push('Neto y utilidad preliminares: guía por confirmar.');
  if(mode==='Externo'&&conditions.shippingCents===null) warnings.push('Guía externa sin confirmar: utilidad preliminar; no reduce el depósito.');
  if(cost===null)warnings.push('Costo de una o más partidas pendiente de validar; utilidad desconocida.');
  return {version:28,at:now(opts),configVersion:config.version??28,source:'Tarifas27 / Conciliacion27',conditions:clone(conditions),shippingTreatment:mode,
    configSnapshot:clone({source:config.source||'Configuración AIMERKA',version:config.version??28,parameters:config.parameters,settlement:config.settlement,
      shipping:config.shipping,elektraMsi:order.market==='Elektra'?config.elektraMsi:undefined,tnBands:order.market==='Tienda Nube'?config.tnBands:undefined}),
    grossCents:gross,commissionCents:totalCommission,baseCommissionCents:totalCommission-totalMsi,msiCents:totalMsi,vatCents:totalVat,incomeCents:totalIncome,
    shippingCents:totalShipping,externalShippingCents:totalExternal,netCents:net,costCents:cost,profitCents:profit,margin:profit===null?null:profit/gross,
    commissionRate:totalCommission/gross,baseCommissionRate:(totalCommission-totalMsi)/gross,msiRate:totalMsi/gross,warnings,lines};
}
export function estimateMarketplace34(order,products,config,opts={}){
 const metadata=order.marketplace34||{},draft=structuredClone(order),refunded=order.paymentStatus==='refunded'||order.refundCents>0||metadata.trace?.refundMarketplace||metadata.trace?.refundSeller;
 if(refunded&&order.refundCents>0&&order.refundCents!==order.totalCents)throw new Error('El reembolso parcial requiere desglose financiero; no se presupone un débito completo.');
 const sign=order.market==='Liverpool'?(refunded?-1:isCancelled(order)||metadata.trace?.cancelMarketplace||metadata.trace?.cancelSeller?0:1):1;
 if(order.market!=='Liverpool'&&isCancelled(order))throw new Error('Revisa el reembolso de esta venta cancelada antes de conciliar.');
 draft.status=isCancelled(draft)?'delivered':draft.status;draft.commercialStatus='Activa';
 draft.reconciliation??={};draft.reconciliation.conditions={...(draft.reconciliation.conditions||{})};
 if(metadata.promotion)draft.reconciliation.conditions.msi=metadata.promotion.msiMonths;
 if(metadata.logistics?.confirmed)draft.reconciliation.conditions.shippingCents=0;
 const result=estimateOrder(draft,products,config,{...opts,ignoreMarketplace34:true}),charges=metadata.logistics?.charges||[];
 if(metadata.logistics?.confirmed){
  const deducted=charges.filter(c=>c.treatment==='Descontado').reduce((sum,c)=>sum+c.amountCents*(c.credit?-1:1),0),external=charges.filter(c=>c.treatment==='Externo').reduce((sum,c)=>sum+c.amountCents*(c.credit?-1:1),0);
  result.shippingCents=deducted;result.externalShippingCents=external;result.netCents-=deducted;if(result.profitCents!==null)result.profitCents-=deducted+external;
  for(const line of result.lines){line.shippingCents=0;line.externalShippingCents=0;}
  for(const [field,total]of [['shippingCents',deducted],['externalShippingCents',external]]){let allocated=0;result.lines.forEach((line,index)=>{line[field]=index===result.lines.length-1?total-allocated:Math.round(total*line.baseCents/result.grossCents);allocated+=line[field];});}
  for(const line of result.lines){if(line.costCents!==null){line.profitCents=line.baseCents-line.commissionCents-line.vatCents-line.incomeCents-line.shippingCents-line.externalShippingCents-line.costCents;line.margin=line.profitCents/line.baseCents;}}
  result.warnings=result.warnings.filter(w=>!/guía.*confirmar|guía.*confirmad/i.test(w));
 }else result.warnings.push('V34: cargos logísticos aún sin cotejar contra el estado de cuenta; no representan un cero confirmado.');
 result.version=34;result.source='Liverpool34 / Conciliacion29-30';result.marketplace34Snapshot=structuredClone(metadata);result.financialSign=sign;
 if(order.market==='Liverpool'&&metadata.promotion?.amountCents)result.warnings.push('Promoción informativa: Liverpool liquida el importe completo. No se descuenta ni suma el cupón otra vez.');
 if(sign<=0){result.netCents=sign*Math.abs(result.netCents);if(result.profitCents!==null)result.profitCents=sign*result.profitCents;result.warnings.push(sign<0?'Débito por reembolso estimado. Restituciones de comisión y retenciones pendientes de cotejar.':'Cancelación sin reembolso: neto cero; conserva el bruto para cotejar cargos.');}
 result.margin=result.profitCents===null?null:result.profitCents/result.grossCents;return result;
}
export function setConditions(order, patch, opts={}) {
  const r=ensure(order),before=clone(r.conditions),next={...before};
  if(Object.hasOwn(patch,'shippingCents'))next.shippingCents=cents(patch.shippingCents,'Envío confirmado',true);
  if(Object.hasOwn(patch,'publication')) {
    const pub=text(patch.publication).toUpperCase();
    if(order.market!=='Mercado Libre' || !['CLASICA','PREMIUM'].includes(pub))throw new Error('La publicación Clásica/Premium corresponde a Mercado Libre.');
    next.publication=pub;
  }
  if(Object.hasOwn(patch,'msi')) {
    if(!['Liverpool','Elektra'].includes(order.market))throw new Error('Este marketplace no utiliza el selector MSI de conciliación.');
    const months=msiMonths(patch.msi),options=order.market==='Liverpool'?[0,3,6]:[0,3,6,9,12,24];
    if(!options.includes(months))throw new Error(`Plazo MSI no disponible para ${order.market}.`);
    next.msi=months;
  }
  if(JSON.stringify(before)===JSON.stringify(next))return r;
  const previousEstimate=r.estimate;r.conditions=next;r.estimate=null;r.estimateError='Condiciones editadas. Calcula de nuevo la estimación.';
  if(CLOSED.has(r.status))r.status=r.depositCents===null?'Sin revisar':'Depósito registrado';
  record(order,'Cambiar condiciones',{conditions:before,estimate:previousEstimate},{conditions:next,estimate:null},opts);
  return r;
}
function recalculateStatus(r) {
  if(r.estimate&&r.depositCents!==null&&r.depositCents!==undefined) {
    r.differenceCents=r.depositCents-r.estimate.netCents;
    if(r.status!=='Incidencia')r.status=Math.abs(r.differenceCents)<1?'Conciliada':'Incongruencia';
  } else r.differenceCents=null;
}
export function applyEstimate(order, products, config, opts={}) {
  const estimate=estimateOrder(order,products,config,opts),r=ensure(order),before={estimate:r.estimate,status:r.status};
  r.estimate=estimate;r.estimateError=null;
  if(r.status==='Sin revisar')r.status='Pendiente de pago';
  recalculateStatus(r);record(order,'Estimar conciliación',before,{estimate,status:r.status},opts);return estimate;
}
export function setDraft(order, patch, opts={}) {
  const r=ensure(order),before=clone(r.draft),draft={amountCents:null,date:r.depositDate||opts.today||mexicoToday(),notes:r.notes,...r.draft};
  if(Object.hasOwn(patch,'amountCents'))draft.amountCents=cents(patch.amountCents,'Depósito preliminar',true);
  if(Object.hasOwn(patch,'date'))draft.date=patch.date||null;
  if(Object.hasOwn(patch,'notes'))draft.notes=text(patch.notes);
  draft.updatedAt=now(opts);r.draft=draft;
  record(order,'Capturar borrador',before,draft,opts);return draft;
}
export function discardDraft(order, opts={}) {
  const r=ensure(order),previous=r.draft;r.draft=null;if(previous)record(order,'Descartar borrador',previous,null,opts);return r;
}
export function visibleDeposit(order) {
  const r=reconciliationOf(order);return present(r.draft?.amountCents)?r.draft.amountCents:r.depositCents;
}
export function saveDeposit(order, input={}, opts={}) {
  const r=ensure(order),draft=r.draft||{},amount=Object.hasOwn(input,'amountCents')?input.amountCents:(present(draft.amountCents)?draft.amountCents:r.depositCents),
    depositDate=Object.hasOwn(input,'date')?input.date:(Object.hasOwn(draft,'date')?draft.date:r.depositDate),notes=text(input.notes??draft.notes??r.notes),state=text(input.status);
  if(state&&!FOLLOWUPS.has(state))throw new Error('Estado de seguimiento no válido.');
  if(state&&!notes)throw new Error('Agrega un comentario para documentar este seguimiento.');
  if(state==='No pagada'&&((r.depositCents||0)>0||(amount||0)>0))throw new Error('Hay un depósito registrado. Marca la diferencia como Incongruencia o Incidencia.');
  const signedDebit=opts.allowSignedDebit&&order.market==='Liverpool'&&r.estimate?.version===34&&r.estimate.financialSign===-1&&typeof amount==='number'&&Number.isSafeInteger(amount)&&amount<0;
  if(signedDebit&&!notes)throw new Error('Documenta el débito del estado de cuenta.');
  const checkedAmount=signedDebit?amount:cents(amount,'Depósito registrado',true);
  if(checkedAmount!==null) {
    if(!validDate(depositDate))throw new Error('Selecciona una fecha de depósito válida.');
    if(depositDate>(opts.today||mexicoToday()))throw new Error('El depósito no puede tener una fecha futura.');
  }
  const before={amountCents:r.depositCents,date:r.depositDate,notes:r.notes,status:r.status};
  if(checkedAmount!==null){r.depositCents=checkedAmount;r.depositDate=depositDate;if(!r.estimate&&!state)r.status='Depósito registrado';}
  r.notes=notes;r.updatedAt=now(opts);
  if(state)r.status=state;else recalculateStatus(r);
  const after={amountCents:r.depositCents,date:r.depositDate,notes:r.notes,status:r.status};
  r.draft=null;
  if(JSON.stringify(before)!==JSON.stringify(after))record(order,state?'Registrar seguimiento':'Guardar total depositado',before,after,opts);
  return r;
}
export function markFollowup(order,status,notes,opts={}) {return saveDeposit(order,{status,notes},opts);}
export function isPaymentPending(order) {
  const r=reconciliationOf(order);
  if(isCancelled(order)||CLOSED.has(r.status))return false;
  if(r.depositCents===null||r.depositCents===0)return true;
  return r.estimate? r.depositCents+0.5<r.estimate.netCents:false;
}
export function selectOrders(state, ids, selected=true) {
  const set=new Set(ids);let count=0;for(const order of state.orders)if(set.has(order.id)){ensure(order).selected=Boolean(selected);count++;}return count;
}
export function clearSelection(state) {for(const order of state.orders)ensure(order).selected=false;}
export function filterOrders(orders, filter={}) {
  const q=normalized(filter.q),from=filter.from||'',to=filter.to||'';
  if(from&&!validDate(from))throw new Error('Fecha inicial no válida.');
  if(to&&!validDate(to))throw new Error('Fecha final no válida.');
  if(from&&to&&from>to)throw new Error('La fecha inicial debe ser anterior o igual a la final.');
  return orders.filter(order=>{
    const r=reconciliationOf(order),date=text(order.documentDate||order.date).slice(0,10);
    if(filter.market&&filter.market!=='Todos'&&order.market!==filter.market)return false;
    if(filter.onlySelected&&!r.selected)return false;
    if(q&&!normalized([order.number,order.sicar,order.id,...(order.items||[]).flatMap(i=>[i.name,i.sku,i.upc])].join(' ')).includes(q))return false;
    if(from&&date<from || to&&date>to)return false;
    switch(filter.status){
      case undefined:case '':case 'Todos':break;
      case 'Pagos pendientes':if(!isPaymentPending(order))return false;break;
      case 'Sin revisar':if(!['Sin revisar','Cancelada por revisar'].includes(r.status))return false;break;
      case 'Seguimientos abiertos':if(CLOSED.has(r.status))return false;break;
      default:if(r.status!==filter.status)return false;
    }
    return true;
  }).sort((a,b)=>text(b.creationDate||b.date||b.documentDate).localeCompare(text(a.creationDate||a.date||a.documentDate))||text(b.id).localeCompare(text(a.id)));
}
export function summary(orders) {
  const out={count:orders.length,grossCents:0,netCents:null,profitCents:null,receivedCents:null,visibleDifferenceCents:null,matchedDifferenceCents:null,
    estimatedCount:0,profitCount:0,depositCount:0,draftCount:0,draftTotalCents:null,matchedCount:0,selectedCount:0,pendingCount:0,cancelledCount:0};
  // Dashboard totals describe saved confirmations. Draft edits remain separate
  // until saveDeposit/saveBatch validates and commits their amount and date.
  for(const order of orders){const r=reconciliationOf(order),deposit=r.depositCents;out.grossCents+=order.totalCents||0;
    if(r.selected)out.selectedCount++;if(isCancelled(order))out.cancelledCount++;if(isPaymentPending(order))out.pendingCount++;
    if(r.estimate){out.netCents=(out.netCents||0)+r.estimate.netCents;out.estimatedCount++;if(r.estimate.profitCents!==null){out.profitCents=(out.profitCents||0)+r.estimate.profitCents;out.profitCount++;}}
    if(present(deposit)){out.receivedCents=(out.receivedCents||0)+deposit;out.depositCount++;}
    if(present(r.draft?.amountCents)){out.draftCount++;out.draftTotalCents=(out.draftTotalCents||0)+r.draft.amountCents;}
    if(r.estimate&&present(deposit)){out.matchedDifferenceCents=(out.matchedDifferenceCents||0)+deposit-r.estimate.netCents;out.matchedCount++;}
  }
  if(out.estimatedCount&&out.depositCount)out.visibleDifferenceCents=out.receivedCents-out.netCents;
  out.completeComparison=out.matchedCount===orders.length&&orders.length>0;return out;
}
export function estimateBatch(state,ids,opts={}) {
  const set=new Set(ids),results=[];
  for(const order of state.orders){if(!set.has(order.id)||(opts.selectedOnly!==false&&!reconciliationOf(order).selected))continue;
    try{const estimate=applyEstimate(order,state.products,state.config||state.pricingConfig,opts);results.push({id:order.id,number:order.number,ok:true,netCents:estimate.netCents});}
    catch(error){ensure(order).estimateError=error.message;results.push({id:order.id,number:order.number,ok:false,error:error.message});}
  }
  return {total:results.length,succeeded:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,results};
}
export function saveBatch(state,ids,opts={}) {
  const set=new Set(ids),results=[];
  for(const order of state.orders){const r=reconciliationOf(order);if(!set.has(order.id)||(opts.selectedOnly!==false&&!r.selected)||!present(r.draft?.amountCents))continue;
    try{const result=saveDeposit(order,{},opts);results.push({id:order.id,number:order.number,ok:true,depositCents:result.depositCents,status:result.status});}
    catch(error){results.push({id:order.id,number:order.number,ok:false,error:error.message});}
  }
  return {total:results.length,succeeded:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,results};
}
/** Hypothesis only. No automatic change of freight or deposit. */
export function inferShipping(order) {
  const r=reconciliationOf(order),deposit=visibleDeposit(order);
  if(!r.estimate||deposit===null||deposit===undefined)return {residualCents:null,canApply:false,message:'Captura un depósito y calcula una estimación para comparar.'};
  const e=r.estimate,residual=e.grossCents-e.commissionCents-e.vatCents-e.incomeCents-deposit;
  if(e.shippingTreatment==='Externo')return {residualCents:residual,canApply:false,message:'El envío se paga por fuera. La diferencia requiere aclaración.'};
  if(residual<0)return {residualCents:residual,canApply:false,message:'El depósito supera la base neta calculada.'};
  return {residualCents:residual,canApply:true,message:'Posible envío u otra deducción. Confirma la causa antes de aplicarla.'};
}
export function confirmInferredShipping(order,products,config,opts={}) {
  const inference=inferShipping(order);if(!inference.canApply)throw new Error(inference.message);
  setConditions(order,{shippingCents:inference.residualCents},opts);return applyEstimate(order,products,config,opts);
}
export function updateSettlementConfig(state, settlement, opts={}) {
  if(!settlement||typeof settlement!=='object')throw new Error('Configuración de conciliación inválida.');
  const previous=clone(state.config?.settlement||{}),next=clone(settlement);
  for(const market of ['Sears','Sanborns','Liverpool','Coppel','Elektra','Tienda Nube','Mercado Libre']) {
    if(!SHIPPING_MODES.has(next.shippingTreatment?.[market]))throw new Error(`Tratamiento de envío no válido para ${market}.`);
  }
  rate(next.liverpoolIncludedMsi,'MSI incluido Liverpool');
  if(!Array.isArray(next.liverpoolMsi)||next.liverpoolMsi.length!==3)throw new Error('Configura los tres plazos de Liverpool: Sin MSI, 3 y 6.');
  const terms=new Set();
  for(const item of next.liverpoolMsi){if(![0,3,6].includes(item.months)||terms.has(item.months))throw new Error('Plazos Liverpool duplicados o no válidos.');terms.add(item.months);rate(item.rate,'Recargo Liverpool');}
  if(next.liverpoolMsi.find(x=>x.months===0).rate!==0)throw new Error('Sin MSI debe tener recargo de 0%.');
  if((state.config?.commissions?.Liverpool||[]).some(x=>Number.isFinite(x.rate)&&x.rate+0.000001<next.liverpoolIncludedMsi))throw new Error('El MSI incluido supera alguna tarifa total del catálogo Liverpool. Revisa sus comisiones.');
  state.config||={};state.config.settlement=next;
  state.configHistory||=[];state.configHistory.push({action:'Actualizar reglas de conciliación',at:now(opts),actor:opts.actor||'Usuario',before:previous,after:clone(next)});
  return {message:'Reglas guardadas. Las estimaciones existentes conservan sus valores; recalcula las ventas que quieras revisar.',settlement:next};
}
const csvCell=value=>{
  let s=value==null?'':String(value);if(typeof value==='string'&&/^[\s]*[=+@\-]/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
};
export function exportReconciliationCsv(orders,{detail=false}={}) {
  const header=detail?['Pedido','SICAR','Marketplace','Producto','SKU','UPC','Categoría','Cantidad','Base MXN','Comisión base %','MSI %','Comisión MXN','Retención IVA MXN','Retención ISR MXN','Envío descontado MXN','Envío externo MXN','Costo MXN','Utilidad estimada MXN']:
    ['Pedido','SICAR','Marketplace','Fecha documento','Estado','Venta bruta MXN','Neto estimado MXN','Utilidad estimada MXN','Total depositado confirmado MXN','Borrador MXN','Fecha depósito','Diferencia confirmada MXN','Notas'];
  const rows=[header];const mxn=v=>present(v)?v/100:null;
  for(const order of orders){const r=reconciliationOf(order);
    if(detail){for(const l of r.estimate?.lines||[])rows.push([order.number,order.sicar,order.market,l.name,l.sku,l.upc,l.category,l.qty,mxn(l.baseCents),l.rates.baseRate*100,l.rates.msiRate*100,mxn(l.commissionCents),mxn(l.vatCents),mxn(l.incomeCents),mxn(l.shippingCents),mxn(l.externalShippingCents),mxn(l.costCents),mxn(l.profitCents)]);}
    else rows.push([order.number,order.sicar,order.market,order.documentDate||order.date,r.status,mxn(order.totalCents),mxn(r.estimate?.netCents),mxn(r.estimate?.profitCents),mxn(r.depositCents),mxn(r.draft?.amountCents),r.depositDate,mxn(r.differenceCents),r.notes]);
  }
  return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
