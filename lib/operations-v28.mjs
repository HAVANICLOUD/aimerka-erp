/**
 * AIMERKA V28 business operations. Money is integer MXN centavos, dates ISO.
 * Ports: ComprasERP, MercanciaCompras, GastosERP/Gastos27, ParcialidadesERP,
 * CalendarioCredito, ConfigCreditoERP, Catalogos28, EstadisticasERP, RankingERP.
 * No bank, SAT, marketplace or physical-stock write occurs in this module.
 */

export const PAYMENT_MODES = ['Recomendado', 'Otro monto', 'Liquidar saldo'];
export const CATALOG_KEYS = ['lenders', 'instruments', 'suppliers', 'expenseCategories', 'expenseDescriptions'];
export const RECEIPT_STATES = ['Pendiente', 'Recibida parcialmente', 'Recibida completa'];
export const PAYMENT_ALERT_WINDOW_DAYS = 7;
const DAY = 86400000;
const text = v => v == null ? '' : String(v).trim();
const normal = v => text(v).toLocaleUpperCase('es-MX');
const validMoney = (v, min = 0) => Number.isSafeInteger(v) && v >= min;
const fail = message => { throw new Error(message); };
const sum = (list, fn) => list.reduce((acc, value) => acc + fn(value), 0);

export function instrumentKey(value) {
  return normal(value).replaceAll('AMERICAN EXPRESS', 'AMEX').replaceAll(' DE ', ' ')
    .replaceAll('JAVANI', 'HAVANI').replaceAll('MÉXICO', 'MEXICO').replaceAll(' ', '');
}

export function dateOnly(value) {
  const raw = text(value), s = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (y < 2000 || y > 9999 || m < 1 || m > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  // Excel dates and wall-clock times have no timezone and retain their civil
  // day. Explicitly zoned timestamps represent instants in the Mexican ledger.
  if (raw.length > 10 && /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const instant = new Date(raw);
    return Number.isFinite(instant.getTime()) ? mexicoToday(instant) : null;
  }
  return s;
}

export function mexicoToday(now = new Date()) {
  const dt = now instanceof Date ? now : new Date(now);
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(dt);
  const value = type => parts.find(p => p.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

const dateNumber = s => Date.parse(dateOnly(s) + 'T00:00:00Z');
const fromNumber = n => new Date(n).toISOString().slice(0,10);
const dayPlus = (date, count) => fromNumber(dateNumber(date) + count * DAY);

/** Day 29–31 is capped to the final day of the selected month. */
export function dayInMonth(reference, day, monthOffset = 0) {
  const date = dateOnly(reference);
  if (!date || !Number.isInteger(day) || day < 1 || day > 31) return null;
  const [y, m] = date.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + monthOffset, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return fromNumber(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day,last)));
}

export function creditRuleFor(creditRules, lender, instrument) {
  return (creditRules || []).find(r => text(r.lender) === text(lender) && instrumentKey(r.instrument) === instrumentKey(instrument));
}

export function creditPreview(date, rule) {
  date = dateOnly(date);
  if (!date || !rule || rule.active === false || !rule.cutoffDay || !rule.paymentDay) {
    return {cutoffDate:null,paymentDate:null,cycleStart:null,days:null,status:'Por configurar'};
  }
  let cutoffDate = dayInMonth(date,rule.cutoffDay);
  if (!cutoffDate) return {cutoffDate:null,paymentDate:null,cycleStart:null,days:null,status:'Por configurar'};
  if (date > cutoffDate) cutoffDate = dayInMonth(date,rule.cutoffDay,1);
  let paymentDate = dayInMonth(cutoffDate,rule.paymentDay);
  if (paymentDate <= cutoffDate) paymentDate = dayInMonth(cutoffDate,rule.paymentDay,1);
  return {cutoffDate,paymentDate,cycleStart:dayPlus(dayInMonth(cutoffDate,rule.cutoffDay,-1),1),
    days:Math.round((dateNumber(paymentDate)-dateNumber(date))/DAY),status:'Estimado por corte'};
}

function safeTerm(term) {
  if (!Number.isInteger(term) || term < 1 || term > 18) fail('Selecciona de 1 a 18 parcialidades enteras.');
  return term;
}

/** V28 adaptive installments: every confirmed payment may redefine future cuotas. */
export function installmentState(entity, payments = []) {
  const term = Math.max(1,Math.min(18,Number(entity.term) || 1));
  const selected = payments.filter(p => p.entityId === entity.id && validMoney(p.amountCents,1));
  const paidCents = sum(selected,p => p.amountCents);
  if (!validMoney(entity.amountCents)) return {amountCents:null,paidCents,balanceCents:null,covered:0,remaining:term,nextNumber:1,recommendedCents:null};
  const balanceCents = Math.max(0,entity.amountCents-paidCents);
  let covered = Math.max(0,...selected.map(p => Math.max(1,Number(p.number)||1) + Math.max(1,Number(p.installmentsCovered)||1) - 1));
  if (balanceCents === 0) covered = term;
  if (balanceCents > 0 && covered >= term) covered = term - 1;
  const remaining = term - covered;
  return {amountCents:entity.amountCents,paidCents,balanceCents,covered,remaining,
    nextNumber:Math.min(term,covered+1),recommendedCents:remaining ? Math.round(balanceCents/remaining) : 0};
}

export function paymentRecommendation(entity, payments = [], options = {}) {
  const current = installmentState(entity,payments);
  const mode = options.mode || 'Recomendado';
  if (!PAYMENT_MODES.includes(mode)) fail('La modalidad de pago no es válida.');
  if (current.balanceCents == null) fail('El documento no tiene importe confirmado.');
  const count = options.installmentsCovered == null ? 1 : Number(options.installmentsCovered);
  if (!Number.isInteger(count) || count < 1 || count > Math.max(1,current.remaining)) fail('Las parcialidades a cubrir deben estar dentro del plazo pendiente.');
  let recommendedCents = Math.min(current.balanceCents,current.recommendedCents*count);
  if (count === current.remaining || mode === 'Liquidar saldo') recommendedCents = current.balanceCents;
  const amountCents = mode === 'Otro monto' ? options.amountCents : recommendedCents;
  return {...current,number:current.nextNumber,installmentsCovered:mode === 'Liquidar saldo' ? current.remaining : count,
    mode,recommendedCents,amountCents};
}

export function installmentSchedule(entity, payments = [], creditRules = [], today = mexicoToday()) {
  const current = installmentState(entity,payments);
  if (current.balanceCents == null || entity.status === 'Cancelada') return [];
  const term = Math.max(1,Math.min(18,Number(entity.term)||1));
  const applied = Array(term).fill(0);
  for (const payment of payments.filter(p => p.entityId === entity.id && validMoney(p.amountCents,1))) {
    const first = Math.max(1,Number(payment.number)||1);
    const count = Math.min(Math.max(1,Number(payment.installmentsCovered)||1),term-first+1);
    let used = 0;
    for (let q=first;q<first+count;q++) {
      const amount = q === first+count-1 ? payment.amountCents-used : Math.min(payment.amountCents-used,Math.round(payment.amountCents/count));
      applied[q-1] += amount; used += amount;
    }
  }
  const rule = creditRuleFor(creditRules,entity.lender,entity.instrument);
  const preview = creditPreview(entity.date,rule);
  const manual = dateOnly(entity.firstPaymentDate);
  const firstDate = manual || preview.paymentDate;
  const paymentDay = rule?.active !== false ? rule?.paymentDay : null;
  let remaining = current.balanceCents;
  const schedule = [];
  for (let number=1;number<=term;number++) {
    let balanceCents = 0;
    if (number > current.covered) {
      balanceCents = number === term ? remaining : Math.min(remaining,current.recommendedCents);
      remaining -= balanceCents;
    }
    const dueDate = firstDate && (number === 1 || paymentDay) ? (number === 1 ? firstDate : dayInMonth(firstDate,paymentDay,number-1)) : null;
    const cutoffDate = !manual && preview.cutoffDate ? dayInMonth(preview.cutoffDate,rule.cutoffDay,number-1) : null;
    let status = 'Programada';
    if (balanceCents === 0) status = 'Pagada';
    else if (!dueDate) status = 'Por configurar';
    else if (dueDate < today) status = 'Vencida programada';
    else if (dueDate <= dayPlus(today,PAYMENT_ALERT_WINDOW_DAYS)) status = 'Próximos 7 días';
    schedule.push({entityId:entity.id,number,term,lender:entity.lender,instrument:entity.instrument,
      amountCents:applied[number-1]+balanceCents,paidCents:applied[number-1],balanceCents,dueDate,cutoffDate,
      cycleStart:cutoffDate ? dayPlus(dayInMonth(cutoffDate,rule.cutoffDay,-1),1) : null,
      origin:dueDate ? (manual ? 'Fecha registrada' : 'Estimado por corte') : 'Por configurar',status});
  }
  return schedule;
}

export function buildCalendar(state,today = mexicoToday()) {
  return [
    ...(state.purchases||[]).flatMap(e => installmentSchedule(e,state.purchasePayments,state.creditRules,today).map(row => ({...row,kind:'purchase',reference:e.sicar,description:e.supplier}))),
    ...(state.expenses||[]).flatMap(e => installmentSchedule(e,state.expensePayments,state.creditRules,today).map(row => ({...row,kind:'expense',reference:e.id,description:e.description})))
  ].sort((a,b) => (a.dueDate||'9999').localeCompare(b.dueDate||'9999') || a.entityId.localeCompare(b.entityId) || a.number-b.number);
}

/** Outstanding supplier installments for the current workspace, independent of sales/report filters. */
export function supplierPaymentAlerts(state,today = mexicoToday()) {
  today = dateOnly(today);
  if (!today) fail('La fecha de referencia de los pagos no es válida.');
  const throughDate = dayPlus(today,PAYMENT_ALERT_WINDOW_DAYS);
  const groups = {overdue:[],dueToday:[],upcoming:[],missing:[]};
  for (const row of buildCalendar(state,today)) {
    if (row.kind !== 'purchase' || !(row.balanceCents > 0)) continue;
    const daysUntil = row.dueDate ? Math.round((dateNumber(row.dueDate)-dateNumber(today))/DAY) : null;
    const group = daysUntil == null ? 'missing' : daysUntil < 0 ? 'overdue' : daysUntil === 0 ? 'dueToday' : daysUntil <= PAYMENT_ALERT_WINDOW_DAYS ? 'upcoming' : null;
    if (group) groups[group].push({...row,alertKind:group === 'dueToday' ? 'today' : group,daysUntil});
  }
  const summary = rows => ({rows,count:rows.length,purchaseCount:new Set(rows.map(row=>row.entityId)).size,
    amountCents:sum(rows,row=>row.balanceCents)});
  const actionableRows = [...groups.overdue,...groups.dueToday,...groups.upcoming];
  return {today,throughDate,windowDays:PAYMENT_ALERT_WINDOW_DAYS,
    overdue:summary(groups.overdue),dueToday:summary(groups.dueToday),upcoming:summary(groups.upcoming),missing:summary(groups.missing),
    actionableRows,actionableCount:actionableRows.length,actionableCents:sum(actionableRows,row=>row.balanceCents)};
}

function required(value,label) {
  value = text(value);
  if (!value) fail(`Completa ${label}.`);
  if (value.length > 1000) fail(`${label} excede la longitud permitida.`);
  return value;
}

function requiredDate(value,label,today,{past=true,optional=false}={}) {
  if (optional && !text(value)) return null;
  const parsed = dateOnly(value);
  if (!parsed) fail(`${label} debe ser una fecha válida.`);
  if (past && parsed > today) fail(`${label} no puede estar en el futuro.`);
  return parsed;
}

function chooseCatalog(state,key,value,label) {
  value = required(value,label);
  if (!(state.catalogs?.[key]||[]).some(x => normal(x) === normal(value))) fail(`Selecciona ${label} del catálogo o agrégalo en Configuración.`);
  return value;
}

function nextId(items,prefix) {
  const max = Math.max(0,...items.map(i => Number(String(i.id||'').replace(new RegExp(`^${prefix}`),''))||0));
  return prefix+String(max+1).padStart(6,'0');
}

function purchaseInput(state,payload,today,prior) {
  const base = {...prior,...payload};
  const sicar = required(base.sicar,'el consecutivo SICAR');
  if ((state.purchases||[]).some(p => p.id !== prior?.id && normal(p.sicar) === normal(sicar))) fail('Ese consecutivo SICAR ya está registrado.');
  const date = requiredDate(base.date,'La fecha de compra',today);
  const lender = chooseCatalog(state,'lenders',base.lender,'el dador de crédito');
  const instrument = chooseCatalog(state,'instruments',base.instrument,'el instrumento de pago');
  const supplier = chooseCatalog(state,'suppliers',base.supplier,'el proveedor');
  const term = safeTerm(base.term);
  const firstPaymentDate = requiredDate(base.firstPaymentDate,'El primer pago',today,{past:false,optional:true});
  const receiptStatus = base.receiptStatus || 'Pendiente';
  if (!RECEIPT_STATES.includes(receiptStatus)) fail('Selecciona un estado válido de recepción de mercancía.');
  const satReviewed = base.satReviewed || 'No';
  if (!['Sí','No'].includes(satReviewed)) fail('La revisión en SAT debe ser Sí o No.');
  if (base.items != null && !Array.isArray(base.items)) fail('Las partidas de la compra no son válidas.');
  const previousItems = new Map((prior?.items||[]).map(item => [item.id,item]));
  const itemIds = new Set();
  const items = (base.items||[]).map((item,index) => {
    const previous = item.id ? previousItems.get(item.id) : null;
    if (item.id && prior && !previous) fail('Una partida no pertenece a esta compra.');
    if (item.id && itemIds.has(item.id)) fail('La compra contiene una partida repetida.');
    if (item.id) itemIds.add(item.id);
    const name = required(item.name,'la descripción de la mercancía');
    if (typeof item.qty !== 'number' || !Number.isFinite(item.qty) || item.qty <= 0) fail('La cantidad de mercancía debe ser positiva.');
    if (!validMoney(item.unitCostCents)) fail('El costo unitario no puede ser negativo ni contener fracciones de centavo.');
    const totalCents = Math.round(item.qty*item.unitCostCents);
    if (!validMoney(totalCents)) fail('El importe de una partida excede el límite permitido.');
    const skuOrUpc = text(item.skuOrUpc||item.sku||item.upc);
    if ((previous?.receivedQty||0) > 0) {
      if (item.qty < previous.receivedQty) fail('La cantidad no puede ser menor que la mercancía ya recibida.');
      if (skuOrUpc !== text(previous.skuOrUpc||previous.sku||previous.upc)) fail('No se puede cambiar el producto de una partida recibida.');
    }
    return {...(previous||{}),id:previous?.id||'',skuOrUpc,name,qty:item.qty,unitCostCents:item.unitCostCents,totalCents,
      receivedQty:previous?.receivedQty||0,...(previous?.sku?{sku:previous.sku}:{})};
  });
  for (const item of previousItems.values()) if ((item.receivedQty||0)>0 && !itemIds.has(item.id)) fail('No se puede eliminar una partida con mercancía recibida.');
  const linesTotalCents = sum(items,item => item.totalCents);
  const amountCents = base.amountCents == null && linesTotalCents > 0 ? linesTotalCents : base.amountCents;
  if (!validMoney(amountCents,1)) fail('El importe de la compra debe ser mayor que cero.');
  const paid = prior ? installmentState(prior,state.purchasePayments).paidCents : 0;
  if (amountCents < paid) fail('El importe no puede ser menor que lo ya pagado.');
  return {sicar,date,lender,instrument,supplier,term,firstPaymentDate,receiptStatus,satReviewed,amountCents,
    taxInvoice:text(base.taxInvoice),supplierOrder:text(base.supplierOrder),notes:text(base.notes),items,
    linesTotalCents,lineDifferenceCents:items.length ? amountCents-linesTotalCents : null};
}

function expenseInput(state,payload,today,prior) {
  const base = {...prior,...payload};
  const date = requiredDate(base.date,'La fecha del gasto',today);
  const category = chooseCatalog(state,'expenseCategories',base.category,'la categoría del gasto');
  const description = required(base.description,'la descripción');
  const lender = chooseCatalog(state,'lenders',base.lender,'el dador de crédito');
  const instrument = chooseCatalog(state,'instruments',base.instrument,'el instrumento de pago');
  if (!validMoney(base.amountCents,1)) fail('El importe del gasto debe ser mayor que cero.');
  const paid = prior ? installmentState(prior,state.expensePayments).paidCents : 0;
  if (base.amountCents < paid) fail('El nuevo importe no puede ser menor que lo ya pagado.');
  return {date,category,description,lender,instrument,amountCents:base.amountCents,term:safeTerm(base.term),
    firstPaymentDate:requiredDate(base.firstPaymentDate,'El primer pago',today,{past:false,optional:true}),
    invoiceDate:requiredDate(base.invoiceDate,'La fecha de facturación',today,{past:false,optional:true}),
    taxInvoice:text(base.taxInvoice),merchantReference:text(base.merchantReference),notes:text(base.notes)};
}

function updateBalances(entity,payments,kind) {
  const current = installmentState(entity,payments);
  entity.paidCents = current.paidCents;
  entity.balanceCents = current.balanceCents;
  if (kind === 'expense') entity.status = current.balanceCents === 0 ? 'Pagado' : 'Pendiente';
}

function savePayment(state,payload,context,kind) {
  const listKey = kind === 'purchase' ? 'purchases' : 'expenses';
  const paymentKey = kind === 'purchase' ? 'purchasePayments' : 'expensePayments';
  const entity = (state[listKey]||[]).find(e => e.id === payload.entityId);
  if (!entity) fail('Selecciona un documento válido antes de registrar el abono.');
  if (entity.status === 'Cancelada') fail('El documento está cancelado. No se admiten abonos.');
  const recommendation = paymentRecommendation(entity,state[paymentKey],payload);
  if (!validMoney(recommendation.amountCents,1) || recommendation.amountCents > recommendation.balanceCents) fail('El abono debe ser positivo y no superar el saldo pendiente.');
  const date = requiredDate(payload.date,'La fecha del abono',context.today);
  if (dateOnly(entity.date) && date < dateOnly(entity.date)) fail('El pago no puede ser anterior al documento.');
  const payment = {id:nextId(state[paymentKey]||[],'A'),entityId:entity.id,number:recommendation.number,
    amountCents:recommendation.amountCents,date,notes:text(payload.notes),recordedAt:context.now,
    installmentsCovered:recommendation.installmentsCovered,recommendedCents:recommendation.recommendedCents,
    mode:recommendation.mode,source:'AIMERKA'};
  if (!state[paymentKey]) state[paymentKey] = [];
  state[paymentKey].push(payment);
  updateBalances(entity,state[paymentKey],kind);
  entity.updatedAt = context.now;
  return {ok:true,id:entity.id,paymentId:payment.id,message:'Abono registrado. Saldo y parcialidades restantes actualizados.',balanceCents:entity.balanceCents};
}

/** Mutates only after validation. The caller commits state atomically with version checks. */
export function applyOperation(state,operation,context = {}) {
  const ctx = {now:context.now || new Date().toISOString(),today:context.today || mexicoToday(context.now),user:context.user || 'Usuario'};
  if (!state || !operation || typeof operation.type !== 'string') fail('La operación no es válida.');
  if (!dateOnly(ctx.today)) fail('La fecha de operación no es válida.');
  if (operation.id && (state.operationIds||[]).includes(operation.id)) return {ok:true,duplicate:true,message:'La operación ya se registró; no se repitió.',id:null};
  const p = operation.payload || {};
  let result;
  if (operation.type === 'purchase.create' || operation.type === 'purchase.update') {
    const prior = operation.type.endsWith('update') ? (state.purchases||[]).find(e => e.id === p.id) : null;
    if (operation.type.endsWith('update') && !prior) fail('La compra no existe.');
    const data = purchaseInput(state,p,ctx.today,prior);
    const id = prior?.id || nextId(state.purchases||[],'C');
    let nextLineNumber = Math.max(0,...(prior?.items||[]).map(item => Number(String(item.id||'').split('-').at(-1))||0));
    data.items = data.items.map(item => ({...item,id:item.id||`${id}-${String(++nextLineNumber).padStart(3,'0')}`,purchaseId:id}));
    const entity = {...prior,...data,id,status:prior?.status||'Activa',createdAt:prior?.createdAt||ctx.now,updatedAt:ctx.now,source:prior?.source||'AIMERKA'};
    updateBalances(entity,state.purchasePayments,'purchase');
    if (prior) Object.assign(prior,entity); else {if(!state.purchases)state.purchases=[];state.purchases.push(entity);}
    result = {ok:true,id,message:prior ? 'Compra actualizada.' : 'Compra registrada con sus partidas.',lineDifferenceCents:data.lineDifferenceCents};
  } else if (operation.type === 'purchase.receipt') {
    const entity = (state.purchases||[]).find(e => e.id === p.id);
    if (!entity) fail('La compra no existe.');
    if (!RECEIPT_STATES.includes(p.receiptStatus)) fail('El estado de recepción no es válido.');
    entity.receiptStatus = p.receiptStatus;entity.updatedAt=ctx.now;
    result = {ok:true,id:entity.id,message:'Recepción documental actualizada. No se creó un movimiento de inventario.'};
  } else if (operation.type === 'expense.create' || operation.type === 'expense.update') {
    const prior = operation.type.endsWith('update') ? (state.expenses||[]).find(e => e.id === p.id) : null;
    if (operation.type.endsWith('update') && !prior) fail('El gasto no existe.');
    const data = expenseInput(state,p,ctx.today,prior);
    const entity = {...prior,...data,id:prior?.id||nextId(state.expenses||[],'G'),createdAt:prior?.createdAt||ctx.now,updatedAt:ctx.now,source:prior?.source||'AIMERKA'};
    updateBalances(entity,state.expensePayments,'expense');
    if (prior) Object.assign(prior,entity); else {if(!state.expenses)state.expenses=[];state.expenses.push(entity);}
    result = {ok:true,id:entity.id,message:prior ? 'Gasto actualizado; se conserva su historial.' : 'Gasto registrado.'};
  } else if (operation.type === 'purchase.payment' || operation.type === 'expense.payment') {
    result = savePayment(state,p,ctx,operation.type.split('.')[0]);
  } else if (operation.type === 'credit.save') {
    const lender = chooseCatalog(state,'lenders',p.lender,'el dador');
    const instrument = chooseCatalog(state,'instruments',p.instrument,'el instrumento');
    const day = (value,label) => {
      if (value == null || value === '') return null;
      if (!Number.isInteger(value)||value<1||value>31) fail(`${label} debe ser un entero de 1 a 31 o quedar vacío.`);
      return value;
    };
    const cutoffDay = day(p.cutoffDay,'El día de corte'), paymentDay = day(p.paymentDay,'El día de pago');
    const prior = creditRuleFor(state.creditRules,lender,instrument);
    const entity = {...prior,id:prior?.id||nextId(state.creditRules||[],'CR'),lender,instrument,cutoffDay,paymentDay,
      active:p.active!==false,issuer:text(p.issuer),note:text(p.note),updatedAt:ctx.now};
    if(prior)Object.assign(prior,entity);else{if(!state.creditRules)state.creditRules=[];state.creditRules.push(entity);}
    result={ok:true,id:entity.id,message:'Corte y fecha de pago guardados. El calendario se actualizó.'};
  } else if (operation.type === 'catalog.add') {
    if (!CATALOG_KEYS.includes(p.catalog)) fail('El catálogo no es válido.');
    const value = required(p.value,'el nombre o descripción');
    if ((state.catalogs?.[p.catalog]||[]).some(v => normal(v) === normal(value))) fail('Ese valor ya existe en el catálogo.');
    if (!state.catalogs)state.catalogs={};if(!state.catalogs[p.catalog])state.catalogs[p.catalog]=[];
    state.catalogs[p.catalog].push(value);
    result={ok:true,id:value,message:'Valor agregado al catálogo. Los registros históricos conservan sus nombres.'};
  } else fail('Operación de compras, gastos o configuración no reconocida.');
  if (!state.events)state.events=[];
  state.events.unshift({id:operation.id||`${operation.type}:${result.id}:${ctx.now}`,type:operation.type,entityId:result.id,
    message:result.message,date:ctx.now,user:ctx.user,result:'ok',source:'AIMERKA'});
  if(operation.id){if(!state.operationIds)state.operationIds=[];state.operationIds.push(operation.id);}
  return result;
}

function entityFilter(entity,filters,payments,rules,today) {
  if (filters.query && !normal([entity.id,entity.sicar,entity.supplier,entity.description,entity.taxInvoice,entity.merchantReference,entity.notes].join(' ')).includes(normal(filters.query))) return false;
  for (const key of ['lender','instrument','category','supplier','status','receiptStatus','satReviewed']) {
    if (filters[key] && filters[key] !== 'Todos' && text(entity[key]) !== text(filters[key])) return false;
  }
  const date = dateOnly(entity.date);
  if (filters.year && (!date || +date.slice(0,4)!==+filters.year)) return false;
  if (filters.month && filters.month !== 'Todos' && (!date || +date.slice(5,7)!==+filters.month)) return false;
  if (filters.from && (!date || date<filters.from)) return false;
  if (filters.to && (!date || date>filters.to)) return false;
  const balance = installmentState(entity,payments).balanceCents;
  if (filters.paymentStatus === 'pending' && !(balance>0)) return false;
  if (filters.paymentStatus === 'paid' && balance!==0) return false;
  if (filters.paymentStatus === 'unknown' && balance!==null) return false;
  if (filters.paymentStatus === 'overdue' && !installmentSchedule(entity,payments,rules,today).some(row=>row.status==='Vencida programada')) return false;
  return true;
}

export function queryEntities(state,kind,filters={},today=mexicoToday()) {
  const items = kind==='purchase' ? state.purchases||[] : state.expenses||[];
  const payments = kind==='purchase' ? state.purchasePayments : state.expensePayments;
  return items.filter(e=>entityFilter(e,filters,payments,state.creditRules,today)).sort((a,b)=>(b.date||'').localeCompare(a.date||'')||b.id.localeCompare(a.id));
}

export function financialSummary(state,kind,filters={},today=mexicoToday()) {
  const entities = queryEntities(state,kind,filters,today);
  const payments = kind==='purchase' ? state.purchasePayments : state.expensePayments;
  const currentYear = +today.slice(0,4), year = Number(filters.year)||currentYear;
  const out={count:entities.length,amountCents:0,paidCents:0,balanceCents:0,unknownAmountCount:0,overdueCents:0,next7Cents:0,
    withoutDateCount:0,reviewCount:0,monthly:Array.from({length:12},(_,i)=>({month:i+1,amountCents:0,paidCents:0,balanceCents:0,count:0})),categories:[],lenders:[],instruments:[]};
  const groups={categories:new Map(),lenders:new Map(),instruments:new Map()};
  for(const entity of entities){
    if(entity.status==='Cancelada')continue;
    const current=installmentState(entity,payments);
    if(current.amountCents==null){out.unknownAmountCount++;continue;}
    out.amountCents+=current.amountCents;out.paidCents+=current.paidCents;out.balanceCents+=current.balanceCents;
    if(entity.review)out.reviewCount++;
    const schedule=installmentSchedule(entity,payments,state.creditRules,today);
    out.overdueCents+=sum(schedule.filter(x=>x.status==='Vencida programada'),x=>x.balanceCents);
    out.next7Cents+=sum(schedule.filter(x=>x.status==='Próximos 7 días'),x=>x.balanceCents);
    if(schedule.some(x=>x.balanceCents>0&&!x.dueDate))out.withoutDateCount++;
    const d=dateOnly(entity.date);
    if(d&&+d.slice(0,4)===year){const month=out.monthly[+d.slice(5,7)-1];month.amountCents+=current.amountCents;month.paidCents+=current.paidCents;month.balanceCents+=current.balanceCents;month.count++;}
    for(const [group,key] of [['categories','category'],['lenders','lender'],['instruments','instrument']]){
      const label=entity[key]||'Sin asignar', value=groups[group].get(label)||{label,amountCents:0,paidCents:0,balanceCents:0,count:0};
      value.amountCents+=current.amountCents;value.paidCents+=current.paidCents;value.balanceCents+=current.balanceCents;value.count++;groups[group].set(label,value);
    }
  }
  for(const key of Object.keys(groups))out[key]=[...groups[key].values()].sort((a,b)=>b.amountCents-a.amountCents);
  out.averageMonthlyCents=Math.round(sum(out.monthly,x=>x.amountCents)/(year===currentYear?+today.slice(5,7):12));
  return out;
}

export function periodBounds(mode,anchor=mexicoToday(),end=anchor) {
  anchor=dateOnly(anchor);end=dateOnly(end);
  if(!anchor)fail('Selecciona una fecha válida para el periodo.');
  let from=anchor,to=anchor;
  if(['Semana','week'].includes(mode)) {const weekday=new Date(dateNumber(anchor)).getUTCDay();from=dayPlus(anchor,-((weekday+6)%7));to=dayPlus(from,6);}
  else if(['Mes','month'].includes(mode)){from=anchor.slice(0,7)+'-01';to=dayPlus(dayInMonth(from,1,1),-1);}
  else if(['Año','year'].includes(mode)){from=anchor.slice(0,4)+'-01-01';to=anchor.slice(0,4)+'-12-31';}
  else if(['Rango','range'].includes(mode)){if(!end||end<anchor)fail('La fecha final debe ser igual o posterior a la inicial.');to=end;}
  return{from,to,endExclusive:dayPlus(to,1)};
}

function orderDate(order,basis) {
  return dateOnly(basis==='Documento'||basis==='document' ? order.documentDate||order.date : order.creationDate||order.date);
}
function matchesDate(date,filters) {return date && (!filters.from||date>=filters.from)&&(!filters.to||date<=filters.to);}
function active(order) {return order.commercialStatus ? order.commercialStatus==='Activa' : order.status!=='cancelled';}
function orderGross(order) {return validMoney(order.totalCents)?order.totalCents:((order.items||[]).length?sum(order.items,i=>i.totalCents||Math.round(i.qty*i.unitPriceCents)):Math.round((order.qty||0)*(order.unitPriceCents||0)))+(order.shippingChargedCents||0);}

export function salesStatistics(state,filters={}) {
  const byMarket=new Map();
  const summary={activeCount:0,activeGrossCents:0,averageTicketCents:0,cancelledCount:0,cancelledCents:0,refundCount:0,refundCents:0,
    activeOrderIds:[],cancelledOrderIds:[],refundOrderIds:[],refundAmountsByOrder:Object.create(null),missingLinesCount:0,basis:filters.basis||'Creacion'};
  const get=market=>{if(!byMarket.has(market))byMarket.set(market,{market,activeCount:0,activeGrossCents:0,cancelledCount:0,cancelledCents:0,refundCount:0,refundCents:0});return byMarket.get(market);};
  const marketMatches=m=>!filters.market||filters.market==='Todos'||filters.market===m;
  const refundSeen=new Set((state.sicarMovements||[]).filter(m=>m.type==='REEMBOLSO'&&m.orderId).map(m=>m.orderId));
  for(const order of state.orders||[]){
    if(!marketMatches(order.market))continue;
    const row=get(order.market),gross=orderGross(order);
    if(active(order)&&matchesDate(orderDate(order,summary.basis),filters)){
      summary.activeCount++;summary.activeGrossCents+=gross;summary.activeOrderIds.push(order.id);row.activeCount++;row.activeGrossCents+=gross;
      if(!(order.items||[]).length)summary.missingLinesCount++;
    }
    if(!active(order)&&matchesDate(dateOnly(order.cancelledAt),filters)){
      summary.cancelledCount++;summary.cancelledCents+=gross;summary.cancelledOrderIds.push(order.id);row.cancelledCount++;row.cancelledCents+=gross;
    }
    if(['refunded','partially_refunded','Reembolsada'].includes(order.paymentStatus)&&!refundSeen.has(order.id)&&matchesDate(dateOnly(order.refundedAt),filters)){
      const refunded=validMoney(order.refundCents,1)?order.refundCents:order.paymentStatus==='partially_refunded'?0:gross;
      if(refunded>0){summary.refundCount++;summary.refundCents+=refunded;summary.refundOrderIds.push(order.id);summary.refundAmountsByOrder[order.id]=refunded;row.refundCount++;row.refundCents+=refunded;}
    }
  }
  for(const movement of state.sicarMovements||[]){
    if(movement.type!=='REEMBOLSO'||!marketMatches(movement.market)||!matchesDate(dateOnly(movement.date),filters))continue;
    const amount=Math.abs(movement.amountCents||0),row=get(movement.market);
    summary.refundCount++;summary.refundCents+=amount;row.refundCount++;row.refundCents+=amount;
    if(movement.orderId){if(!summary.refundOrderIds.includes(movement.orderId))summary.refundOrderIds.push(movement.orderId);summary.refundAmountsByOrder[movement.orderId]=(summary.refundAmountsByOrder[movement.orderId]||0)+amount;}
  }
  summary.averageTicketCents=summary.activeCount?Math.round(summary.activeGrossCents/summary.activeCount):0;
  return {...summary,markets:[...byMarket.values()].sort((a,b)=>b.activeGrossCents-a.activeGrossCents)};
}

export function bestSellers(state,filters={}) {
  const productMap=new Map((state.products||[]).map(p=>[p.upc||p.sku,p]));
  const productBySku=new Map((state.products||[]).map(p=>[p.sku,p]));
  const quantities=new Map();
  for(const order of state.orders||[]){
    if(!active(order)||!matchesDate(orderDate(order,filters.basis||'Creacion'),filters)||(filters.market&&filters.market!=='Todos'&&filters.market!==order.market))continue;
    const items=(order.items||[]).length?order.items:order.sku&&order.qty>0&&validMoney(order.unitPriceCents)?[{sku:order.sku,qty:order.qty,totalCents:order.qty*order.unitPriceCents}]:[];
    for(const item of items){
      const key=item.upc||item.sku,product=productMap.get(key)||productBySku.get(item.sku);
      if(!product)continue;
      const row=quantities.get(key)||{sku:product.sku,upc:product.upc,name:product.name,qty:0,grossCents:0,stock:product.sourceStock??product.good};
      row.qty+=Number(item.qty)||0;row.grossCents+=item.totalCents||0;quantities.set(key,row);
    }
  }
  return [...quantities.values()].sort((a,b)=>b.qty-a.qty||a.name.localeCompare(b.name)).map((r,i)=>({...r,rank:i+1}));
}

export function stockAlerts(state,{today=mexicoToday(),threshold=3,topN=10,basis='Creacion'}={}) {
  const ranking=bestSellers(state,{from:dayPlus(today,-29),to:today,basis});
  const best=new Map(ranking.slice(0,topN).map(r=>[r.sku,r.qty]));
  return (state.products||[]).flatMap(product=>{
    const stock=product.sourceStock==null&&product.source==='V28'?null:product.good;
    if(stock==null)return[{sku:product.sku,upc:product.upc,name:product.name,stock:null,qty30:best.get(product.sku)||0,type:'Existencia por confirmar'}];
    if(stock<=0)return[{sku:product.sku,upc:product.upc,name:product.name,stock,qty30:best.get(product.sku)||0,type:'Sin stock'}];
    if(best.has(product.sku)&&stock<=threshold)return[{sku:product.sku,upc:product.upc,name:product.name,stock,qty30:best.get(product.sku),type:'Bestseller bajo'}];
    return [];
  }).sort((a,b)=>(b.type==='Bestseller bajo')-(a.type==='Bestseller bajo')||b.qty30-a.qty30);
}

export function sicarComparison(state,year=2026) {
  return Array.from({length:12},(_,index)=>{
    const month=`${year}-${String(index+1).padStart(2,'0')}`,from=month+'-01',to=dayPlus(dayInMonth(from,1,1),-1);
    const creation=salesStatistics(state,{from,to,basis:'Creacion'}).activeGrossCents;
    const document=salesStatistics(state,{from,to,basis:'Documento'}).activeGrossCents;
    const reference=(state.sicarMonthlyReference||[]).find(r=>r.month===month);
    return{month,erpCreationCents:creation,erpDocumentCents:document,sicarCreationCents:reference?.sicarCreationCents??null,
      differenceCents:reference?creation-reference.sicarCreationCents:null,dateDifferenceCents:creation-document,
      referenceDate:state.source?.sicarComparisonDate||null};
  });
}
