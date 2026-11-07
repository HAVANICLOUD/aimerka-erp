/**
 * AIMERKA — workbook pricing with separate commercial-margin and cash-flow objectives.
 * Money entering/leaving these calculation functions is MXN (not cents).
 * Product state uses integer cents; recommend() is the explicit adapter.
 * Withholding always reduces cash; its pass-through choice changes the pricing objective only.
 * These functions never publish prices or change inventory.
 */
export const CHANNELS = ['T1 Comercios', 'Coppel', 'Mercado Libre', 'Liverpool', 'Tienda Nube', 'Elektra'];
const text = value => String(value ?? '').trim();
const key = value => text(value).toLocaleLowerCase('es-MX');
const present = value => value !== null && value !== undefined && value !== '';
const numeric = value => present(value) && Number.isFinite(Number(value));
const equal = (a, b) => key(a) === key(b);
const clone = value => JSON.parse(JSON.stringify(value));
const issue = (field, message) => ({field, message});
const invalid = (errors, details = {}) => ({valid: false, errors, warnings: [], discount: null, regular: null, transfer: null, mlComparison: null, ...details});
const roundExcel = (number, places = 0) => {
  const factor = 10 ** places;
  return Math.sign(number) * Math.floor(Math.abs(number) * factor + 0.5 + 1e-10) / factor;
};

export function canonicalChannel(channel) {
  if (['sears', 'sanborns', 't1', 't1 comercios', 't1 comercio'].includes(key(channel))) return 'T1 Comercios';
  return CHANNELS.find(c => equal(c, channel)) ?? text(channel);
}

export function listCategories(config, channel, options = {}) {
  channel = canonicalChannel(channel);
  if (channel === 'Tienda Nube') return [options.mapping ? 'General' : 'Todas las categorías'];
  const rows = config.commissions?.[channel] ?? [];
  return (channel === 'T1 Comercios' && !options.all && !options.mapping ? rows.slice(0, 1) : rows).map(row => row.category);
}

function channelValue(object, channel) {
  if (!object) return '';
  if (Object.hasOwn(object, channel)) return object[channel];
  const aliases = {'T1 Comercios': ['t1', 'sears', 'sanborns'], Coppel: ['coppel'], 'Mercado Libre': ['ml', 'mercadoLibre'], Liverpool: ['liverpool'], 'Tienda Nube': ['tn', 'tiendaNube'], Elektra: ['elektra']};
  for (const a of aliases[channel] ?? []) if (Object.hasOwn(object, a)) return object[a];
  return '';
}

export function resolveCategory(config, product, channel) {
  channel = canonicalChannel(channel);
  if (channel === 'T1 Comercios') return config.commissions?.[channel]?.[0]?.category || 'Todas las categorías';
  if (channel === 'Tienda Nube') return 'Todas las categorías';
  const override = channelValue(product?.categoryOverrides, channel);
  if (present(override) && !equal(override, 'Automático')) return text(override);
  const mapping = config.categoryMappings?.find(row => equal(row.category, product?.category));
  const mapped = channelValue(mapping?.channels, channel);
  if (present(mapped)) return text(mapped);
  const existing = channelValue(product?.categories, channel);
  if (present(existing)) return text(existing);
  return channel === 'Elektra' ? 'HOGAR' : 'General';
}

export function shippingSuggestion(config, product) {
  const title = key(product?.name);
  for (const rule of config.shippingRules ?? []) {
    if (text(rule.keyword) && title.includes(key(rule.keyword))) return rule.type;
  }
  const mapped = config.categoryMappings?.find(row => equal(row.category, product?.category));
  return mapped?.shipping || 'Revisar';
}

export function resolveShipping(config, input = {}, product = null) {
  const manual = present(input.manualShipping) ? input.manualShipping
    : numeric(product?.manualShippingCents) ? Number(product.manualShippingCents) / 100
    : numeric(product?.shippingOverrideCents) ? Number(product.shippingOverrideCents) / 100 : null;
  let type = input.shippingType || 'Automático';
  if (equal(type, 'Automático')) {
    const exception = product?.shippingException;
    type = present(exception) && !equal(exception, 'Automático') ? exception : product ? shippingSuggestion(config, product) : 'Pequeño';
    if (type === 'Revisar' && product?.shippingType && !equal(product.shippingType, 'Automático')) type = product.shippingType;
  }
  const row = (config.shipping ?? []).find(row => equal(row.type, type));
  if (present(manual)) {
    if (!numeric(manual) || Number(manual) < 0) return {valid: false, error: issue('manualShipping', 'La tarifa manual debe ser un importe no negativo.')};
    return {valid: true, type, amount: Number(manual), source: 'Manual', min: row?.min ?? null, max: row?.max ?? null};
  }
  if (!row || !numeric(row.min) || Number(row.min) < 0) return {valid: false, error: issue('shippingType', 'Falta configurar el tipo de envío y su tarifa usada.')};
  return {valid: true, type: row.type, amount: Number(row.min), source: 'CONFIG_ENVIOS · tarifa usada B', min: row.min, max: row.max};
}

export function parseMsi(value) {
  if (!present(value) || equal(value, 'Sin MSI')) return 0;
  const match = text(value).match(/^(\d+)\s*(?:MSI)?$/i);
  return match ? Number(match[1]) : null;
}

/** Pricing-only assumptions. Historical settlements and saved scenarios keep their own snapshots. */
export function withholdingProfiles(config = {}) {
  return CHANNELS.map(channel=>{
    const saved=(config.pricingWithholding||[]).find(r=>r.channel===channel);
    return {...{channel,baseMode:channel==='Tienda Nube'?'none':'gross_ex_vat',includedVat:channel==='T1 Comercios'?Number(config.parameters?.t1IncludedVat??.16):.16,vatRate:Number(config.parameters?.vatWithholding??.08),isrRate:Number(config.parameters?.incomeWithholding??.025)},...saved};
  });
}
export function validateWithholdingProfiles(rows){
  if(!Array.isArray(rows)||rows.length!==CHANNELS.length)throw Error('Configura una regla de retenciones por canal.');
  const seen=new Set();for(const r of rows){if(!CHANNELS.includes(r.channel)||seen.has(r.channel))throw Error('Canal fiscal inválido o repetido.');seen.add(r.channel);
    if(!['gross_ex_vat','sale_gross','none'].includes(r.baseMode))throw Error('Base fiscal de precios inválida.');
    for(const k of ['includedVat','vatRate','isrRate'])if(typeof r[k]!=='number'||!Number.isFinite(r[k])||r[k]<0||r[k]>=1)throw Error('IVA y retenciones deben estar entre 0% y menos de 100%.');
  }return clone(rows);
}
export function resolveCommission(config, input = {}) {
  const channel = canonicalChannel(input.channel);
  const errors = [];
  let category = text(input.category), baseRate = 0, msiRate = 0, path = '', rate = 0;
  if (!CHANNELS.includes(channel)) return {valid: false, errors: [issue('channel', 'Selecciona un marketplace configurado.')], channel};
  if (channel === 'Tienda Nube') {
    const price = Number(input.referencePrice);
    if (!numeric(input.referencePrice) || price < 0) errors.push(issue('marketPrice', 'Falta un precio válido para elegir el tramo de Tienda Nube.'));
    const rows = (config.tnBands ?? []).filter(row => price >= Number(row.min));
    const row = rows.at(-1);
    if (!row || !numeric(row.usedRate)) errors.push(issue('commission', 'Falta la tasa usada del tramo de Tienda Nube.'));
    else {baseRate = Number(row.usedRate); path = `Tienda Nube · ${row.label}`;}
    category = 'Todas las categorías';
  } else {
    const rows = config.commissions?.[channel] ?? [];
    const row = channel === 'T1 Comercios' ? rows[0] : rows.find(row => equal(row.category, category));
    if (!row) errors.push(issue('category', `Categoría sin comisión configurada: ${category || '(sin categoría)'} / ${channel}.`));
    else {
      category = row.category;
      const type = text(input.mlType || 'CLASICA').toUpperCase();
      if (channel === 'Mercado Libre' && !['CLASICA', 'CLÁSICA', 'PREMIUM'].includes(type)) errors.push(issue('mlType', 'Selecciona Clásica o Premium.'));
      const raw = channel === 'Mercado Libre' && type === 'PREMIUM' ? row.premiumRate : row.rate;
      if (!numeric(raw)) errors.push(issue('commission', `Falta la tasa de comisión de ${category}.`));
      else baseRate = Number(raw);
      path = row.path || '';
    }
    if (channel === 'Elektra') {
      const months = parseMsi(input.msi);
      const msiRow = (config.elektraMsi ?? []).find(row => parseMsi(row.label) === months);
      if (months === null || !msiRow || !numeric(msiRow.rate)) errors.push(issue('msi', 'El plazo MSI Elektra no está configurado.'));
      else msiRate = Number(msiRow.rate);
    }
  }
  const configuredCommissionRate=baseRate;
  const t1CommissionMode=input.t1CommissionMode||'configured';
  if(channel==='T1 Comercios'){
    if(!['configured','inferred14'].includes(t1CommissionMode))errors.push(issue('t1CommissionMode','Selecciona comisión configurada o escenario inferido de 14%.'));
    if(t1CommissionMode==='inferred14')baseRate=.14;
  }
  rate = baseRate + msiRate;
  if (channel !== 'Tienda Nube'&&!(config.pricingWithholding||[]).some(r=>r.channel===channel)) {
    if (!numeric(config.parameters?.vatWithholding)) errors.push(issue('vatRate', 'Falta configurar la retención IVA.'));
    if (!numeric(config.parameters?.incomeWithholding)) errors.push(issue('isrRate', 'Falta configurar la retención ISR.'));
  }
  const isT1=channel==='T1 Comercios',profile=withholdingProfiles(config).find(r=>r.channel===channel);
  const withholdingBaseMode=isT1&&present(input.t1RetentionBase)?input.t1RetentionBase:profile.baseMode;
  const includedVat=withholdingBaseMode==='sale_gross'?0:Number(profile.includedVat);
  if(!['after_commission_ex_vat','gross_ex_vat','sale_gross','none'].includes(withholdingBaseMode))errors.push(issue('withholdingBase','Selecciona una base de retenciones válida.'));
  if(!Number.isFinite(includedVat)||includedVat<0||includedVat>=1)errors.push(issue('vatRate','Revisa el IVA incluido en el precio.'));
  const retentionTreatment=input.retentionTreatment||'pass_through';
  if(!['pass_through','no_pass_through'].includes(retentionTreatment))errors.push(issue('retentionTreatment','Selecciona cómo trasladar las retenciones al precio.'));
  const nominalVatRate=withholdingBaseMode==='none'?0:Number(profile.vatRate);
  const nominalIsrRate=withholdingBaseMode==='none'?0:Number(profile.isrRate);
  const taxMultiplier=(withholdingBaseMode==='after_commission_ex_vat'?1-rate:1)/(1+includedVat);
  const vatRate=nominalVatRate*taxMultiplier,isrRate=nominalIsrRate*taxMultiplier;
  for (const [name, value] of [['commission', baseRate], ['msi', msiRate], ['commission', rate], ['vatRate', vatRate], ['isrRate', isrRate],['vatRate',nominalVatRate],['isrRate',nominalIsrRate]]) {
    if (!Number.isFinite(value) || value < 0 || value >= 1) errors.push(issue(name, 'Las tasas configuradas deben estar entre 0% y menos de 100%.'));
  }
  return {valid: !errors.length, errors, channel, category, baseRate, msiRate, rate, vatRate, isrRate, path, configuredCommissionRate,withholdingBaseMode,includedVat,nominalVatRate,nominalIsrRate,retentionTreatment,t1CommissionMode,commissionSource:isT1&&t1CommissionMode==='inferred14'?'Escenario 14% · referencia inferida en conciliación':'Comisión configurada',context:'Calculadora V43'};
}

export function pricePolicy(config = {}) {
  const p=config.parameters||{},policy={step:p.priceStep??100,ending:p.priceEnding??99,transferDiscount:p.transferDiscount??.1,transferCommission:p.transferCommission??.006};
  if(!Number.isSafeInteger(policy.step)||policy.step<1||policy.step>10000||!Number.isSafeInteger(policy.ending)||policy.ending<0||policy.ending>=policy.step)throw new Error('La terminación debe ser un entero menor que el intervalo de redondeo.');
  for(const k of ['transferDiscount','transferCommission'])if(typeof policy[k]!=='number'||!Number.isFinite(policy[k])||policy[k]<0||policy[k]>=1)throw new Error('Las tasas de transferencia deben estar entre 0% y menos de 100%.');
  return policy;
}
const floorPrice=(value,p)=>Math.floor((value-p.ending)/p.step)*p.step+p.ending;
const ceilPrice=(value,p)=>Math.ceil((value-p.ending)/p.step)*p.step+p.ending;
const firstPrice=p=>p.ending||p.step;
export function roundMargin99(costTotal, factor, targetMargin, p={step:100,ending:99}) {
  if (!Number.isFinite(costTotal + factor + targetMargin) || factor - targetMargin <= 0) return null;
  const theoretical = costTotal / (factor - targetMargin);
  const lower = Math.max(firstPrice(p), floorPrice(theoretical,p));
  const upper = Math.max(firstPrice(p), ceilPrice(theoretical,p));
  const lowerSafe = lower * factor - costTotal >= -1e-7;
  return lowerSafe && Math.abs(factor - costTotal / lower - targetMargin) <= Math.abs(factor - costTotal / upper - targetMargin) ? lower : upper;
}

export function roundRegular99(discount, inflation, p={step:100,ending:99}) {
  if (!Number.isFinite(discount + inflation) || discount <= 0) return null;
  const raw = discount * (1 + inflation);
  const minimum = Math.max(firstPrice(p),inflation>0?floorPrice(discount,p)+p.step:ceilPrice(discount,p));
  const lower = Math.max(minimum, floorPrice(raw,p));
  const upper = Math.max(minimum, ceilPrice(raw,p));
  return Math.abs(lower - raw) <= Math.abs(upper - raw) ? lower : upper;
}

function breakdown(price, cost, shipping, rate, targetMargin) {
  if (price === null) return null;
  const commission=price*rate.rate,priceExVat=price/(1+rate.includedVat),commissionExVat=commission/(1+rate.includedVat);
  const withholdingBase=rate.withholdingBaseMode==='none'?0:rate.withholdingBaseMode==='after_commission_ex_vat'?priceExVat-commissionExVat:priceExVat;
  const vat=withholdingBase*rate.nominalVatRate,isr=withholdingBase*rate.nominalIsrRate;
  const deductions = commission + vat + isr + shipping;
  const netPayout = price - deductions, profit = netPayout - cost;
  const commercialProfit=price-commission-shipping-cost,objectiveProfit=rate.retentionTreatment==='no_pass_through'?commercialProfit:profit;
  const withholdingTotal=vat+isr,marketplacePayout=price-commission-withholdingTotal;
  return {price, cost, shipping, commission, vat, isr, deductions, netPayout, profit, cashProfit:profit,commercialProfit,objectiveProfit,objectiveMargin:price?objectiveProfit/price:0,withholdingTotal,marketplacePayout, withholdingBase,priceExVat,commissionExVat, margin: price ? profit / price : 0,
    targetProfit: price * targetMargin, targetDifference: objectiveProfit - price * targetMargin,
    costBasedTargetDifference: objectiveProfit - (cost + shipping) * targetMargin};
}

function decision(result, marketPrice, context, zeroCommission, priceType = 'descuento') {
  if (!result) return 'REVISAR MARGEN Y COMISIONES';
  if (zeroCommission) return 'FALTA CONFIGURAR COMISIÓN';
  if ((result.objectiveProfit??result.profit) < 0) return 'PÉRDIDA';
  if ((marketPrice > 0 || context === 'recomendador') && result.price > marketPrice) return context === 'calculadora' ? `REVISAR: ${priceType} supera mercado` : 'SUPERA MERCADO';
  if ((result.objectiveProfit??result.profit) + 0.005 < result.targetProfit) return context === 'calculadora' ? 'REVISAR: utilidad baja' : 'REVISAR UTILIDAD';
  if (marketPrice <= 0) return 'PUBLICAR: revisar mercado';
  return context === 'calculadora' ? 'PUBLICAR: cumple utilidad' : 'PUBLICAR';
}

function transferResult(discount, cost, shipping, targetMargin, context, policy) {
  if (!discount) return null;
  const price = discount.price * (1-policy.transferDiscount), commission = price * policy.transferCommission, profit = price - cost - shipping - commission;
  const comparisonTarget = context === 'recomendador' ? (cost + shipping) * targetMargin : discount.price * targetMargin;
  return {price, discountRate: policy.transferDiscount, commissionRate: policy.transferCommission, commission, cost, shipping, profit, netPayout: price - shipping - commission,
    margin: profit / price, differenceVsNormal: profit - discount.profit, comparisonTarget,
    targetBasis: context === 'recomendador' ? 'Costo + envío' : 'Precio con descuento antes de transferencia',
    decision: profit < 0 ? 'PÉRDIDA' : profit < comparisonTarget ? 'REVISAR UTILIDAD' : 'PUBLICAR'};
}

function modeOf(mode) {
  const value = key(mode).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (['precios', 'manual_precios', 'precios manuales', 'manual'].includes(value)) return 'precios';
  if (value === 'competitivo') return 'competitivo';
  if (value === 'automatico') return 'automatico';
  return 'tasas';
}

function run(config, input, product = null, includeComparisons = true) {
  let policy;try{policy=pricePolicy(config);}catch(error){return invalid([issue('parameters',error.message)]);}
  const context = input.context || (product ? 'recomendador' : 'cotizador');
  const mode = modeOf(input.mode), errors = [], warnings = [];
  const cost = Number(input.cost), marketPrice = Number(input.marketPrice ?? 0);
  let margin = Number(input.margin ?? 0.1), inflation = Number(input.inflation ?? 0.1);
  if (!numeric(input.cost) || cost < 0) errors.push(issue('cost', 'Captura un costo numérico no negativo.'));
  if (!Number.isFinite(marketPrice) || marketPrice < 0 || (context === 'cotizador' && marketPrice <= 0)) errors.push(issue('marketPrice', 'Captura un precio de mercado mayor a cero.'));
  const range = context === 'cotizador' ? [0, 0.3] : [-0.5, 0.5];
  if (!Number.isFinite(margin) || margin < range[0] || margin > range[1]) errors.push(issue('margin', `El margen debe estar entre ${range[0] * 100}% y ${range[1] * 100}%.`));
  if (!Number.isFinite(inflation) || inflation < 0 || inflation > (context === 'cotizador' ? 0.3 : 0.5)) errors.push(issue('inflation', 'El inflado debe estar dentro del rango permitido.'));
  const shipping = resolveShipping(config, input, product);
  if (!shipping.valid) errors.push(shipping.error);
  let manualDiscount = numeric(input.manualDiscount) ? Number(input.manualDiscount) : null;
  let manualRegular = numeric(input.manualRegular) ? Number(input.manualRegular) : null;
  if (mode === 'precios') {
    if (manualDiscount === null || manualDiscount <= 0) errors.push(issue('manualDiscount', 'Captura un precio con descuento mayor a cero.'));
    if (present(input.manualRegular) && (manualRegular === null || manualRegular <= 0)) errors.push(issue('manualRegular', 'El precio regular debe ser mayor a cero.'));
    if (manualRegular === null && manualDiscount > 0) manualRegular = roundRegular99(manualDiscount, inflation,policy);
  }
  const referencePrice = mode === 'precios' && context !== 'recomendador' ? manualRegular : marketPrice;
  const category = input.category || (product ? resolveCategory(config, product, input.channel) : '');
  let rates = resolveCommission(config, {...input, category, referencePrice});
  errors.push(...rates.errors);
  if (errors.length) return invalid(errors, {channel: rates.channel, category, context, mode, inputs: clone(input)});
  if (rates.rate === 0 && rates.channel !== 'Tienda Nube') warnings.push('V28 muestra FALTA CONFIGURAR COMISIÓN cuando la tasa total es cero.');
  const shippingAmount = shipping.amount, costTotal = cost + shippingAmount;
  let factor = 1 - rates.rate - (rates.retentionTreatment==='pass_through'?rates.vatRate+rates.isrRate:0);
  let discountPrice, regularPrice, competitive = null;
  if (mode === 'competitivo') {
    if (marketPrice <= 0 || factor <= 0 || (rates.rate === 0 && rates.channel !== 'Tienda Nube')) return invalid([issue('marketPrice', 'No se puede calcular un precio competitivo con mercado y tasas incompletas.')], {channel: rates.channel, category, context, mode});
    const belowMarket = Math.max(0, floorPrice(marketPrice,policy));
    const minimumProfitable = Math.max(firstPrice(policy), Math.ceil(roundExcel(((costTotal+.01)/factor-policy.ending)/policy.step,10))*policy.step+policy.ending);
    if (context === 'recomendador') {
      const tolerance = Number(config.parameters?.competitiveTolerance ?? 0.03);
      discountPrice = belowMarket >= minimumProfitable ? belowMarket : minimumProfitable <= marketPrice * (1 + tolerance) ? minimumProfitable : null;
      const competitiveInflation = Number(input.competitiveInflation ?? input.inflation ?? 0.1);
      if (!Number.isFinite(competitiveInflation) || competitiveInflation < 0 || competitiveInflation > 0.5) return invalid([issue('competitiveInflation', 'El inflado competitivo debe estar entre 0% y 50%.')]);
      regularPrice = discountPrice === null ? null : Math.max(discountPrice + policy.step, roundExcel((discountPrice * (1 + competitiveInflation) - policy.ending) / policy.step) * policy.step + policy.ending);
      competitive = {minimumProfitable, belowMarket, tolerance, maximumAllowed: marketPrice * (1 + tolerance)};
    } else {
      discountPrice = belowMarket >= firstPrice(policy) && belowMarket * factor - costTotal > 0 ? belowMarket : null;
      regularPrice = discountPrice === null ? null : roundRegular99(discountPrice, inflation,policy);
      competitive = {minimumProfitable, belowMarket, tolerance: 0, maximumAllowed: marketPrice};
      if (discountPrice !== null) {
        // CotizadorERP.Competitivo calls Calcular again in manual-price mode.
        // TN therefore reselects its band from the regular manual price (CALCULADORA C11).
        rates = resolveCommission(config, {...input, category, referencePrice: regularPrice});
        if (!rates.valid) return invalid(rates.errors, {channel: rates.channel, category, context, mode});
        factor = 1 - rates.rate - (rates.retentionTreatment==='pass_through'?rates.vatRate+rates.isrRate:0);
      }
    }
    margin = discountPrice === null ? 0 : factor - costTotal / discountPrice;
    inflation = discountPrice === null ? inflation : regularPrice / discountPrice - 1;
  } else if (mode === 'precios') {
    discountPrice = manualDiscount;
    regularPrice = manualRegular;
    margin = factor - costTotal / discountPrice;
    inflation = regularPrice / discountPrice - 1;
  } else {
    discountPrice = roundMargin99(costTotal, factor, margin,policy);
    regularPrice = discountPrice === null ? null : roundRegular99(discountPrice, inflation,policy);
  }
  if (numeric(input.comparisonTargetMargin)) margin = Number(input.comparisonTargetMargin);
  const discount = breakdown(discountPrice, cost, shippingAmount, rates, margin);
  const regular = breakdown(regularPrice, cost, shippingAmount, rates, margin);
  const zeroCommission = rates.rate === 0 && rates.channel !== 'Tienda Nube';
  if (discount) discount.decision = decision(discount, marketPrice, context, zeroCommission);
  if (regular) regular.decision = decision(regular, marketPrice, context, zeroCommission, 'regular');
  let status = discount?.decision || 'REVISAR MARGEN Y COMISIONES';
  if (mode === 'competitivo') {
    status = discount === null ? 'NO SE PUEDE COMPETIR CON UTILIDAD. Usa Automático y prueba las tasas.'
      : discount.price <= marketPrice ? 'PRECIO COMPETITIVO CON UTILIDAD' : 'COMPETITIVO: SUPERA MERCADO DENTRO DE LA TOLERANCIA';
    if (discount) discount.decision = status;
    if (regular && context === 'recomendador') regular.decision = regular.price > marketPrice ? 'SUPERA MERCADO' : 'PRECIO COMPETITIVO CON UTILIDAD';
  }
  if (context === 'cotizador' && discount) {
    status = discount.objectiveProfit < 0 ? 'PÉRDIDA: revisa costo, comisión y precio.' : discount.price > marketPrice ? 'NO COMPITE: el precio sugerido supera el mercado.' : 'VIABLE: precio dentro del mercado y utilidad positiva.';
    if (Math.abs(discount.objectiveProfit) < 0.005) status = 'PUNTO DE EQUILIBRIO: no hay utilidad positiva.';
  }
  if(rates.retentionTreatment==='no_pass_through')warnings.push('Las retenciones siguen reduciendo el depósito. El margen objetivo se mide antes de retenciones; acreditarlas depende de tu situación fiscal y no implica devolución inmediata.');
  if(discount?.cashProfit<0&&discount?.objectiveProfit>=0)warnings.push('Disponible de caja negativo después de costo y envío. Este precio depende de financiar o acreditar las retenciones.');
  const result = {valid: true, errors: [], warnings, channel: rates.channel, category: rates.category, context, mode, cost, costTotal,
    shipping: shippingAmount, shippingDetails: shipping, commissionRate: rates.rate, baseCommissionRate: rates.baseRate,
    retentionTreatment:rates.retentionTreatment,objectiveBasis:rates.retentionTreatment==='pass_through'?'cash_after_withholding':'commercial_before_withholding',cashFactor:1-rates.rate-rates.vatRate-rates.isrRate,withholdingBaseMode:rates.withholdingBaseMode,includedVat:rates.includedVat,nominalVatRate:rates.nominalVatRate,nominalIsrRate:rates.nominalIsrRate,commissionSource:rates.commissionSource,configuredCommissionRate:rates.configuredCommissionRate,t1CommissionMode:rates.t1CommissionMode,msiRate: rates.msiRate, vatRate: rates.vatRate, isrRate: rates.isrRate, margin, inflation, factor, marketPrice,
    theoreticalPrice: factor - margin > 0 ? costTotal / (factor - margin) : null,
    discount, regular, status, competitive, pricePolicy:policy, transfer: rates.channel === 'Tienda Nube' ? transferResult(discount, cost, shippingAmount, margin, context,policy) : null,
    mlComparison: null, inputs: clone(input), ratePath: rates.path, source: `V43 · ${context === 'recomendador' ? 'RECOMENDADOR_UPC' : 'CALCULADORA / COTIZADOR'}`};
  if(includeComparisons&&discount){const otherTreatment=rates.retentionTreatment==='pass_through'?'no_pass_through':'pass_through',other=run(config,{...input,retentionTreatment:otherTreatment},product,false);result.retentionComparison={pass_through:rates.retentionTreatment==='pass_through'?discount:other.discount,no_pass_through:rates.retentionTreatment==='no_pass_through'?discount:other.discount};}
  if (includeComparisons && rates.channel === 'Mercado Libre') result.mlComparison = {
    classic: run(config, {...input, mlType: 'CLASICA', comparisonTargetMargin: margin}, product, false),
    premium: run(config, {...input, mlType: 'PREMIUM', comparisonTargetMargin: margin}, product, false)
  };
  return result;
}

export function quote(config, input = {}) {
  return run(config, {...input, context: input.context || 'cotizador'});
}

export function recommend(config, product, input = {}) {
  if (!product?.upc && !product?.sku) return invalid([issue('upc', 'Busca un UPC o SKU válido.')]);
  const mode = modeOf(input.mode || 'automatico');
  const margin = Number(input.margin ?? 0.1);
  const marketPrice = numeric(input.alternateMarketPrice) && Number(input.alternateMarketPrice) > 0 ? Number(input.alternateMarketPrice) : Number(product.priceCents) / 100;
  const inflation = mode === 'automatico' ? margin === 0 ? Number(input.zeroMarginInflation ?? 0) : margin
    : mode === 'tasas' && margin === 0 ? Number(input.zeroMarginInflation ?? input.inflation ?? 0) : Number(input.inflation ?? 0.1);
  const exactCost = numeric(product.averageCostMxn) && Math.round(Number(product.averageCostMxn) * 100) === product.costCents ? Number(product.averageCostMxn) : Number(product.costCents) / 100;
  const result = run(config, {...input, mode, context: 'recomendador', cost: exactCost, marketPrice, margin, inflation,
    channel: input.channel || 'T1 Comercios', category: resolveCategory(config, product, input.channel || 'T1 Comercios')}, product);
  result.product = {sku: product.sku, upc: product.upc, name: product.name, category: product.category};
  return result;
}

export function compareChannels(config, product, input = {}) {
  return CHANNELS.map(channel => recommend(config, product, {...input, channel}));
}

function normalizedTitle(value) {
  return ` ${key(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[-/.,()]/g, ' ').trim()} `;
}
export function productFamily(title) {
  title = normalizedTitle(title);
  const families = [
    ['accesorios','cable|adaptador|correa|funda|cargador|accesorio'], ['controles','control|dualsense|joystick|mando'],
    ['telefonia','iphone|celular|smartphone|telefonia|telefono'], ['tabletas','ipad|tableta|tablet|galaxy tab'],
    ['audifonos','airpods|audifono|headphone|earbud|buds| beats solo| beats studio'], ['bocinas','bocina|homepod|altavoz|echo|beats pill'],
    ['relojes','apple watch|smartwatch|reloj|galaxy watch'], ['laptops','macbook|laptop|notebook|portatil'],
    ['computo','imac|mac mini|mac studio|computadora|computo'], ['consolas','consola|playstation|xbox|nintendo'],
    ['perfumes','perfume|fragancia'], ['cabello','supersonic|airwrap|airstrait|secadora|alisador'],
    ['ventilacion','ventilador|purificador'], ['aspiradoras','aspiradora|vacuum']
  ];
  return families.find(([, terms]) => terms.split('|').some(term => title.includes(term)))?.[0] || '';
}

export function suggestCategory(config, title, channel, products = []) {
  if (text(title).length < 3) return '';
  channel = canonicalChannel(channel);
  const categories = listCategories(config, channel);
  if (['T1 Comercios', 'Tienda Nube'].includes(channel)) return categories[0] || '';
  const family = productFamily(title), words = normalizedTitle(title).trim().split(' ');
  let best = 0, suggestion = '';
  for (const product of products) {
    const candidate = resolveCategory(config, product, channel);
    if (!categories.some(category => equal(category, candidate))) continue;
    const normalized = normalizedTitle(product.name);
    if (family && productFamily(normalized) !== family) continue;
    let score = family ? 3 : 0;
    for (const word of words) if (word.length >= 3 && !['apple','samsung','dyson'].includes(word) && normalized.includes(` ${word} `)) score += 2;
    if (score >= 4 && score > best) {best = score; suggestion = candidate;}
  }
  return suggestion || (family ? categories.find(category => productFamily(category) === family) || '' : '');
}

export function validateProduct(config, product, existingProducts = [], previousProduct = null) {
  const errors = [], value = {...product, upc: text(product.upc), name: text(product.name), brand: text(product.brand), category: text(product.category)};
  for (const [field,label] of [['upc','UPC / EAN'],['name','Nombre'],['brand','Marca / departamento'],['category','Categoría inventario']]) if (!value[field]) errors.push(issue(field, `Falta ${label}.`));
  if (existingProducts.some(p => equal(p.upc, value.upc) && (!previousProduct || p.sku !== previousProduct.sku))) errors.push(issue('upc','Esa clave UPC ya existe.'));
  if (!(config.categoryMappings ?? []).some(row => equal(row.category, value.category))) errors.push(issue('category','Crea primero la categoría de inventario y su mapeo.'));
  for (const field of ['costCents','priceCents','good']) if (!Number.isSafeInteger(value[field]) || value[field] < 0) errors.push(issue(field,'Costo, precio e inventario deben ser cantidades no negativas; dinero en centavos e inventario entero.'));
  for (const field of ['shippingOverrideCents','manualShippingCents']) if (present(value[field]) && (!Number.isSafeInteger(value[field]) || value[field] < 0)) errors.push(issue(field, 'La tarifa manual debe ser un importe no negativo en centavos.'));
  if (value.priceCents <= 0) errors.push(issue('priceCents','El precio de mercado debe ser mayor a cero.'));
  value.status = text(product.status || 'OK').toUpperCase();
  if (!['OK','INACTIVO'].includes(value.status)) errors.push(issue('status','El estado debe ser OK o INACTIVO.'));
  if (previousProduct && value.upc !== text(previousProduct.upc)) errors.push(issue('upc','La actualización conserva el UPC original.'));
  const shipping = product.shippingException || product.shippingType || 'Automático';
  if (!['Automático','Pequeño','Mediano','Grande'].includes(shipping)) errors.push(issue('shippingType','Selecciona un tipo de envío válido.'));
  if (shipping === 'Automático' && shippingSuggestion(config, value) === 'Revisar') errors.push(issue('shippingType','No se pudo estimar el envío. Elige Pequeño, Mediano o Grande.'));
  for (const channel of CHANNELS) {
    const override = channelValue(value.categoryOverrides, channel);
    if (present(override) && !equal(override, 'Automático') && !listCategories(config, channel, {mapping:true}).some(c => equal(c, override))) errors.push(issue('categoryOverrides', `Categoría no válida para ${channel}.`));
  }
  return {valid: !errors.length, errors, value};
}

export function validateMapping(config, mapping) {
  const errors = [];
  if (!text(mapping.category)) errors.push(issue('category','Falta el nombre de la categoría inventario.'));
  if (!['Pequeño','Mediano','Grande'].includes(mapping.shipping)) errors.push(issue('shipping','Selecciona un tipo de envío válido.'));
  for (const channel of CHANNELS) {
    const value = channelValue(mapping.channels, channel);
    if (!listCategories(config, channel, {mapping: true}).some(c => equal(c, value))) errors.push(issue('channels', `Selecciona una categoría válida para ${channel}.`));
  }
  return {valid: !errors.length, errors};
}

export function validateCommission(config, input) {
  const channel = canonicalChannel(input.channel), category = text(input.category), errors = [];
  const convert = value => numeric(value) ? Number(value) > 1 ? Number(value) / 100 : Number(value) : NaN;
  const baseRate = convert(input.baseRate), premiumRate = convert(input.premiumRate);
  const includedMsi = channel === 'Liverpool' ? Number(input.includedMsi ?? config.settlement?.liverpoolIncludedMsi ?? 0.0355) : 0;
  const totalRate = baseRate + includedMsi;
  if (!CHANNELS.includes(channel) || channel === 'Tienda Nube') errors.push(issue('channel','Tienda Nube se configura por tramos y pasarelas; selecciona otro canal para una comisión por categoría.'));
  if (!category) errors.push(issue('category','Falta el nombre de la categoría.'));
  if (!Number.isFinite(includedMsi) || includedMsi < 0 || includedMsi >= 1) errors.push(issue('includedMsi','El recargo incluido debe estar entre 0% y menos de 100%.'));
  if (!Number.isFinite(baseRate) || baseRate < 0 || !Number.isFinite(totalRate) || totalRate < 0 || totalRate >= 1) errors.push(issue('baseRate','La comisión total debe estar entre 0% y menos de 100%.'));
  if (channel === 'Mercado Libre' && (!Number.isFinite(premiumRate) || premiumRate < baseRate || premiumRate >= 1)) errors.push(issue('premiumRate','Premium debe ser mayor o igual a Clásica y menor que 100%.'));
  return {valid: !errors.length, errors, value: {channel, category, baseRate, premiumRate: channel === 'Mercado Libre' ? premiumRate : null, includedMsi, totalRate, path:text(input.path), note:text(input.note)}};
}

export function applyCommissionUpdate(config, input) {
  const validation = validateCommission(config, input);
  if (!validation.valid) return validation;
  const next = clone(config), v = validation.value;
  const rows = next.commissions[v.channel] ||= [];
  const existing = rows.find(row => equal(row.category, v.category));
  const row = {...(existing || {}), category:v.category, rate:v.totalRate, path:v.path, note:v.note};
  if (v.channel === 'Mercado Libre') row.premiumRate = v.premiumRate;
  if (existing) Object.assign(existing, row); else rows.push(row);
  if (v.channel === 'T1 Comercios') for (const item of rows) item.rate = v.baseRate;
  return {valid:true, errors:[], config:next, value:row};
}
