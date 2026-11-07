import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {quote, recommend, compareChannels, resolveCategory, resolveCommission, resolveShipping, shippingSuggestion,
  roundMargin99, roundRegular99, suggestCategory, validateProduct, validateMapping, validateCommission, applyCommissionUpdate} from '../lib/pricing-v28.mjs';

const config = JSON.parse(readFileSync(new URL('../data/pricing-config.json', import.meta.url)));
// These stored reference outputs describe the original V28 gross-price base.
config.parameters.t1IncludedVat=0;config.parameters.t1RetentionBase='gross_ex_vat';
const copy = value => structuredClone(value);
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
const iphone = {sku:'TEST-IPHONE',upc:'195950638011',name:'Apple iPhone 17 Pro Max 256GB 12GB RAM Azul Profundo',brand:'APPLE',category:'CELULARES SMARTPHONE',
  costCents:2794800,priceCents:3099900,good:1,categories:{},categoryOverrides:{},shippingType:'Pequeño',shippingException:'Automático',status:'OK'};

test('CALCULADORA V28 matches stored reference prices and deduction amounts', () => {
  const r = quote(config,{context:'calculadora',cost:8434,marketPrice:12799,channel:'T1 Comercios',category:'Electrónica',shippingType:'Mediano',margin:.1,inflation:.2,mode:'tasas'});
  assert.equal(r.valid,true); assert.equal(r.discount.price,14199); assert.equal(r.regular.price,16999);
  close(r.theoreticalPrice,14152.845528455282); close(r.discount.profit,1448.285); close(r.regular.profit,3450.285);
  close(r.discount.commission,2555.82); close(r.discount.vat,1135.92); close(r.discount.isr,354.975);
  close(r.discount.netPayout,9882.285); close(r.discount.margin,.10199908444256636);
  close(r.discount.costBasedTargetDifference,577.885);
  assert.equal(r.status,'REVISAR: descuento supera mercado');
});

test('Saved automatic V28 reference is preserved; competitive shows market loss without raising price', () => {
  const r = recommend(config,iphone,{channel:'T1 Comercios',mode:'automatico',margin:0});
  assert.equal(r.valid,true); assert.equal(r.discount.price,39299); assert.equal(r.regular.price,39299);
  close(r.discount.profit,20.785); close(r.discount.netPayout,27968.785); close(r.discount.margin,.0005288938649838468);
  const competitive = recommend(config,iphone,{channel:'T1 Comercios',mode:'competitivo'});
  assert.equal(competitive.discount.price,30999);assert.ok(competitive.discount.profit<0);assert.match(competitive.status,/PÉRDIDA/);assert.equal(competitive.competitive.minimumProfitable,39299);
  close(competitive.competitive.maximumAllowed,30999);
});

test('blank shipping uses V28 B tariff; explicit zero stays zero; invalid manual value fails', () => {
  const defaults = resolveShipping(config,{shippingType:'Mediano',manualShipping:''});
  assert.equal(defaults.amount,270);
  assert.equal(resolveShipping(config,{shippingType:'Mediano',manualShipping:0}).amount,0);
  assert.equal(resolveShipping(config,{shippingType:'Mediano',manualShipping:'0'}).amount,0);
  assert.equal(resolveShipping(config,{shippingType:'Mediano',manualShipping:-1}).valid,false);
  assert.equal(resolveShipping(config,{shippingType:'Sin configurar'}).valid,false);
});

test('shipping keyword precedence and individual category overrides survive global mapping changes', () => {
  const c = copy(config), p={...iphone,name:'Apple iPhone control de prueba',categoryOverrides:{Liverpool:'Electrónicos'}};
  assert.equal(shippingSuggestion(c,p),'Pequeño');
  assert.equal(resolveCategory(c,p,'Liverpool'),'Electrónicos');
  c.categoryMappings.find(r=>r.category==='CELULARES SMARTPHONE').channels.Liverpool='Cómputo';
  assert.equal(resolveCategory(c,p,'Liverpool'),'Electrónicos');
  assert.equal(resolveCategory(c,{...p,categoryOverrides:{}},'Liverpool'),'Cómputo');
});

test('calculator Liverpool fixed rate and Elektra selected MSI are not double counted', () => {
  close(resolveCommission(config,{channel:'Liverpool',category:'Telefonía',msi:'6MSI',referencePrice:14999}).rate,.1455);
  const elektra=resolveCommission(config,{channel:'Elektra',category:'TELEFONIA',msi:'12MSI',referencePrice:14999});
  close(elektra.baseRate,.09); close(elektra.msiRate,.06); close(elektra.rate,.15);
  assert.equal(resolveCommission(config,{channel:'Elektra',category:'NO EXISTE',msi:'12MSI',referencePrice:14999}).valid,false);
  assert.equal(resolveCommission(config,{channel:'Elektra',category:'TELEFONIA',msi:'18MSI',referencePrice:14999}).valid,false);
});

test('ML Classic and Premium have independent price calculations using V28 category rates', () => {
  const r = recommend(config,iphone,{channel:'Mercado Libre',mode:'automatico',margin:.1,mlType:'PREMIUM'});
  assert.equal(r.valid,true); close(r.mlComparison.classic.commissionRate,.1); close(r.mlComparison.premium.commissionRate,.125);
  assert.ok(r.mlComparison.premium.discount.price > r.mlComparison.classic.discount.price);
  assert.equal(r.discount.price,r.mlComparison.premium.discount.price);
});

test('TN exact band thresholds and zero withholdings are retained', () => {
  close(resolveCommission(config,{channel:'Tienda Nube',referencePrice:2498}).rate,.0669458240878417);
  close(resolveCommission(config,{channel:'Tienda Nube',referencePrice:2499}).rate,.0788652105548102);
  close(resolveCommission(config,{channel:'Tienda Nube',referencePrice:26000}).rate,.158725845477871);
  close(resolveCommission(config,{channel:'Tienda Nube',referencePrice:26001}).rate,.159731836931129);
  const r=quote(config,{cost:1000,marketPrice:1999,channel:'Tienda Nube',shippingType:'Pequeño',margin:.1,inflation:.1});
  assert.equal(r.vatRate,0); assert.equal(r.isrRate,0); assert.equal(r.discount.price,1399);
  close(r.transfer.price,1259.1); close(r.transfer.commission,7.5546); close(r.transfer.profit,121.5454);
  assert.equal(r.transfer.decision,'REVISAR UTILIDAD');
});

test('manual-price TN cotizador uses regular price band; UPC uses market price band', () => {
  const r=quote(config,{cost:1000,marketPrice:5999,channel:'Tienda Nube',shippingType:'Pequeño',mode:'precios',manualDiscount:12999,manualRegular:14999});
  close(r.commissionRate,.158725845477871);
  const u=recommend(config,{...iphone,costCents:100000,priceCents:599900},{channel:'Tienda Nube',mode:'manual_precios',manualDiscount:12999,manualRegular:14999});
  close(u.commissionRate,.111059062132845);
  assert.equal(u.discount.price,12999); assert.equal(u.regular.price,14999);
});

test('UPC and Cotizador keep competitive market price even below cash break-even', () => {
  const product={...iphone,costCents:100000,priceCents:156900};
  const u=recommend(config,product,{channel:'T1 Comercios',mode:'competitivo'});
  assert.equal(u.discount.price,1499);assert.ok(u.discount.profit<0);assert.match(u.status,/CAJA NEGATIVA/);assert.equal(u.competitive.minimumCash,1599);
  const q=quote(config,{cost:1000,marketPrice:1569,channel:'T1 Comercios',shippingType:'Pequeño',mode:'competitivo'});
  assert.equal(q.discount.price,1499);assert.ok(q.discount.profit<0);assert.match(q.status,/CAJA NEGATIVA/);
});

test('99 rounding uses margin proximity and enforces a higher regular step when inflated', () => {
  assert.equal(roundMargin99(8704,.895,.1),10899);
  assert.equal(roundRegular99(1499,0),1499);
  assert.equal(roundRegular99(1499,.0001),1599);
  assert.equal(roundMargin99(1000,.3,.3),null);
});

test('automatic UPC links inflation to selected margin; zero-margin inflation is separate', () => {
  const r=recommend(config,iphone,{channel:'Coppel',mode:'automatico',margin:.15,inflation:.05});
  close(r.inflation,.15);
  const z=recommend(config,iphone,{channel:'Coppel',mode:'automatico',margin:0,zeroMarginInflation:.2});
  close(z.inflation,.2); assert.ok(z.regular.price>z.discount.price);
});

test('average acquisition cost precision is preserved until cost changes', () => {
  const p={...iphone,costCents:87581,averageCostMxn:875.808674};
  close(recommend(config,p,{margin:.1}).cost,875.808674);
  close(recommend(config,{...p,costCents:90000},{margin:.1}).cost,900);
});

test('catalogue validators preserve UPC identity, mapping completeness and premium ordering', () => {
  assert.equal(validateProduct(config,iphone,[]).valid,true);
  assert.equal(validateProduct(config,iphone,[iphone]).valid,false);
  assert.equal(validateProduct(config,{...iphone,good:1.5},[]).valid,false);
  assert.equal(validateProduct(config,{...iphone,upc:'changed'},[iphone],iphone).valid,false);
  assert.equal(validateMapping(config,config.categoryMappings.find(r=>r.category==='CELULARES SMARTPHONE')).valid,true);
  assert.equal(validateCommission(config,{channel:'Mercado Libre',category:'Celulares',baseRate:.2,premiumRate:.1}).valid,false);
  const c=applyCommissionUpdate(config,{channel:'T1 Comercios',category:'Todas las categorías',baseRate:19});
  assert.ok(c.config.commissions['T1 Comercios'].every(r=>r.rate===.19));
  close(config.commissions['T1 Comercios'][0].rate,.18);
});

test('category suggestion follows known product family and six-channel comparison has no API side effects', () => {
  assert.equal(suggestCategory(config,'iPhone 17 Pro Max','Coppel',[iphone]),'Celulares');
  assert.equal(suggestCategory(config,'Apple cargador','Tienda Nube',[iphone]),'Todas las categorías');
  assert.equal(suggestCategory(config,'???','Coppel',[]),'');
  const before=JSON.stringify(config), rows=compareChannels(config,iphone,{mode:'automatico',margin:.1,msi:'Sin MSI'});
  assert.equal(rows.length,6); assert.ok(rows.every(row=>row.valid)); assert.equal(JSON.stringify(config),before);
});

test('blank configured withholdings are not treated as a valid zero', () => {
  const c=copy(config);c.parameters.vatWithholding=null;
  assert.equal(resolveCommission(c,{channel:'Coppel',category:'Celulares',referencePrice:1000}).valid,false);
  c.parameters.vatWithholding=0;
  assert.equal(resolveCommission(c,{channel:'Coppel',category:'Celulares',referencePrice:1000}).valid,true);
});

test('Liverpool included-MSI setting rejects malformed and negative amounts', () => {
  for(const includedMsi of ['abc',-.5,1,NaN])assert.equal(validateCommission(config,{channel:'Liverpool',category:'Telefonía',baseRate:.11,includedMsi}).valid,false);
  const valid=validateCommission(config,{channel:'Liverpool',category:'Telefonía',baseRate:.11,includedMsi:.0355});
  assert.equal(valid.valid,true);close(valid.value.totalRate,.1455);
});
