import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
const source=readFileSync(new URL('../public/erp/pricing-ui.js',import.meta.url),'utf8');
function harness(){
  const calls=[],listeners={},elements={};
  const products=[{sku:'BLANK',upc:'',name:'Sin UPC'},{sku:'REF',upc:'840080527079',name:'Referencia',category:'Audio',averageCostMxn:1000,costCents:100000,priceCents:199900}];
  const engine={CHANNELS:['T1 Comercios','Coppel'],listCategories:()=>['Todas las categorías'],resolveCategory:()=> 'Todas las categorías',quote:(...args)=>{calls.push(['quote',...args]);return {valid:false,errors:[]};},recommend:(...args)=>{calls.push(['recommend',...args]);return {valid:false,errors:[]};},compareChannels:(...args)=>{calls.push(['compare',...args]);return [];}};
  const context=createContext({structuredClone,state:{products,config:{parameters:{},elektraMsi:[]}},window:{ERP:{engines:{pricing:engine}}},document:{addEventListener:(name,fn)=>{listeners[name]=fn;},getElementById:id=>elements[id]||null},pricingPage:()=>'',renderers:{},nav:[],esc:value=>String(value??''),money:value=>`$${value/100}`,badge:value=>String(value),icon:()=>'<svg></svg>',render(){calls.push(['render']);}});
  runInContext(source,context);
  return {run:code=>runInContext(code,context),calls,listeners,elements,products};
}
test('empty UPC never matches a blank catalogue UPC; rendering and clearing preserve choices',()=>{
  const h=harness();assert.equal(h.run("price28FindProduct('')"),undefined);assert.equal(h.run("price28FindProduct('  ')"),undefined);
  assert.equal(h.run("price28Forms.calculadora.cost"),'');
  h.run("price28Tab='recomendador';price28Forms.recomendador.t1CommissionMode='inferred14';price28Forms.recomendador.t1RetentionBase='gross_ex_vat';price28Forms.recomendador.mode='manual_precios';price28Form()");
  assert.equal(h.run('price28Forms.recomendador.productKey'),'');
  h.run("price28Forms.recomendador.productKey='REF';price28Clear();price28Form()");
  assert.equal(h.run('price28Forms.recomendador.productKey'),'');assert.equal(h.run('price28Forms.recomendador.mode'),'manual_precios');
  assert.equal(h.run('price28Input().t1CommissionMode'),'inferred14');assert.equal(h.run('price28Input().t1RetentionBase'),'gross_ex_vat');
  assert.ok(!source.includes('price28ReferenceUPC')); assert.equal(h.products.length,2);
});
test('manual, UPC and compare routes pass both T1 controls; configured fallback is honored',()=>{
  const h=harness();
  assert.equal(h.run('price28Input().t1CommissionMode'),'configured');assert.equal(h.run('price28Input().t1RetentionBase'),'gross_ex_vat');
  h.run("state.config.parameters.t1RetentionBase='gross_ex_vat'");assert.equal(h.run('price28Input().t1RetentionBase'),'gross_ex_vat');
  for(const tab of ['calculadora','cotizador','recomendador','comparar']){
    h.run(`price28Tab='${tab}';Object.assign(price28Forms[price28Tab],{productKey:'REF',t1CommissionMode:'inferred14',t1RetentionBase:'after_commission_ex_vat'});price28Calculate()`);
    const call=h.calls.at(-1),input=call.at(-1);assert.equal(input.t1CommissionMode,'inferred14');assert.equal(input.t1RetentionBase,'after_commission_ex_vat');
    assert.equal(call[0],tab==='comparar'?'compare':tab==='recomendador'?'recommend':'quote');
  }
});
test('cost and UPC clearing stay editable without restoring an example',()=>{
  const h=harness();assert.equal(h.run('price28Forms.calculadora.cost'),'');
  h.listeners.input({target:{dataset:{price28Field:'cost'},value:''}});assert.equal(h.run('price28Input().cost'),null);
  h.listeners.input({target:{dataset:{price28Field:'cost'},value:'1200'}});assert.equal(h.run('price28Input().cost'),1200);
  h.run("price28Tab='recomendador';price28Forms.recomendador.productKey='840080527079'");assert.equal(h.run('price28Forms.recomendador.productKey'),'840080527079');
  h.elements['price28-product-info']={};h.elements['price28-results']={};h.elements['price28-category-info']={};
  h.listeners.input({target:{dataset:{price28Field:'productKey'},value:''}});
  assert.equal(h.elements['price28-category-info'].textContent,'—');assert.match(h.elements['price28-product-info'].innerHTML,/pendiente de seleccionar/);assert.match(h.elements['price28-results'].innerHTML,/Selecciona un producto/);
});
test('nominal tax rates, monetary base and effective coefficients have distinct labels',()=>{
  const h=harness();h.run(`globalThis.result={valid:true,status:'RENTABLE',channel:'T1 Comercios',withholdingBaseMode:'after_commission_ex_vat',commissionSource:'inferred14',commissionRate:.14,includedVat:.16,nominalVatRate:.08,nominalIsrRate:.025,vatRate:.05931,isrRate:.01853,discount:{price:2000,priceExVat:1724.14,commissionExVat:241.38,withholdingBase:1482.76,vat:118.62,isr:37.07,profit:300,netPayout:1300,margin:.15},regular:{price:2200}}`);
  const html=h.run('price28Result(result)');assert.match(html,/Base = \(P − comisión\) \/ \(1 \+ IVA\)/);assert.match(html,/Comisión vigente Sears \/ Sanborns/);assert.match(html,/Retención IVA \(8% sobre base\)/);assert.match(html,/Retención ISR \(2.5% sobre base\)/);assert.match(html,/Depósito estimado/);assert.match(html,/Base de retención/);
  assert.match(h.run("price28Forms.calculadora.t1CommissionMode='inferred14';price28T1Controls(price28Forms.calculadora)"),/[Cc]omisión vigente/);
  assert.match(h.run("price28Forms.calculadora.channel='Coppel';price28T1Controls(price28Forms.calculadora)"),/^$/);
});
test('settings, saved scenario and publication draft actions remain wired',()=>{
  const h=harness();assert.equal(h.run('price28SettingTabs.length'),10);
  for(const action of ['pricing.scenario.save','pricing.publication.prepare','config.pricing.save','config.commission.save','config.mapping.save'])assert.ok(source.includes(action));
  assert.match(h.run('price28Saved()'),/Escenarios guardados/);
});

test('cash policy buttons update all calculator inputs and survive clearing a product',async()=>{const h=harness();for(const tab of ['calculadora','cotizador','recomendador','comparar']){h.run(`price28Tab='${tab}'`);await h.listeners.click({target:{closest:selector=>selector==='[data-price28-retention]'?{dataset:{price28Retention:'no_pass_through'}}:null}});assert.equal(h.run('price28Input().retentionTreatment'),'no_pass_through');assert.match(h.run('price28RetentionControls(price28Forms[price28Tab])'),/aria-pressed="true"/);h.run('price28Clear()');assert.equal(h.run('price28Input().retentionTreatment'),'no_pass_through');}assert.match(h.run('price28RetentionControls(price28Forms.calculadora)'),/Las retenciones se calculan y reducen el depósito en ambos modos/);});
test('manual price capture follows the mode selector before fee and withholding controls',()=>{const h=harness();for(const tab of ['calculadora','cotizador','recomendador','comparar']){h.run(`price28Tab='${tab}';price28Forms[price28Tab].mode='manual_precios'`);const html=h.run('price28Form()');const mode=html.indexOf('price28-mode-field'),manual=html.indexOf('price28-manual-fields'),tax=html.indexOf('price28-retention-policy');assert.ok(mode>=0&&manual>mode&&tax>manual);assert.ok(html.indexOf('id="price28-manualDiscount"')<tax);assert.match(html,/Captura tus precios/);}});
test('primary metric always reports cash after withholding, never commercial profit as available money',()=>{const h=harness();h.run(`globalThis.r={mode:'competitivo',retentionTreatment:'no_pass_through',discount:{price:7499,cashProfit:-200,profit:-200,commercialProfit:500,withholdingTotal:700,marketplacePayout:5800,margin:-.026},regular:{price:8299}}`);const html=h.run('price28Metrics(r)');assert.match(html,/Disponible de caja estimado/);assert.match(html,/price28-negative/);assert.match(html,/Dinero retenido · no disponible en caja/);assert.match(html,/Resultado antes de retenciones/);assert.match(html,/no se supone una devolución del SAT/);});

test('latest purchase cost travels with inventory comparison and clears when changing products',()=>{
  const h=harness();h.run("price28Tab='recomendador';price28Forms.recomendador.productKey='REF';price28Forms.recomendador.lastPurchaseCost='1250';");
  assert.match(h.run('price28Form()'),/Último costo de compra con IVA/);assert.equal(h.run('price28Input().lastPurchaseCost'),1250);
  h.run('price28Calculate()');assert.equal(h.calls.at(-1).at(-1).lastPurchaseCost,1250);
  h.run('price28StartComparison()');assert.equal(h.run('price28Input().lastPurchaseCost'),1250);h.run('price28Calculate()');assert.equal(h.calls.at(-1).at(-1).lastPurchaseCost,1250);
  h.listeners.input({target:{dataset:{price28Field:'productKey'},value:'BLANK'}});assert.equal(h.run('price28Input().lastPurchaseCost'),null);
  h.run("price28Forms.comparar.lastPurchaseCost='999';price28Clear()");assert.equal(h.run('price28Forms.comparar.lastPurchaseCost'),'');
});

test('retention and discount choices update the scenario without rebuilding the page or resetting product inputs',async()=>{
 const h=harness();h.run("price28Tab='recomendador';Object.assign(price28Forms.recomendador,{productKey:'REF',lastPurchaseCost:'1250',minimumDiscount:'15'})");
 const initial=h.calls.filter(c=>c[0]==='render').length;
 for(const [selector,dataset] of [['[data-price28-retention]',{price28Retention:'no_pass_through'}],['[data-price28-discount-mode]',{price28DiscountMode:'minimum'}],['[data-price28-discount-mode]',{price28DiscountMode:'automatic'}]])await h.listeners.click({target:{closest:s=>s===selector?{dataset}:null}});
 assert.equal(h.calls.filter(c=>c[0]==='render').length,initial);assert.equal(h.run('price28Input().retentionTreatment'),'no_pass_through');
 assert.equal(h.run('price28Forms.recomendador.minimumDiscount'),'15');assert.equal(h.run('price28Input().lastPurchaseCost'),1250);assert.equal(h.run('price28Forms.recomendador.productKey'),'REF');
});


test('percentage buttons and in-form mode changes never rebuild the page in any calculator',async()=>{
 const h=harness();
 for(const tab of ['calculadora','cotizador','recomendador','comparar']){
  h.run(`price28Tab='${tab}';price28Forms[price28Tab].productKey='REF';price28Forms[price28Tab].lastPurchaseCost='1250'`);
  for(const [selector,dataset] of [
   ['[data-price28-rate]',{price28Rate:'margin',price28Value:'35'}],
   ['[data-price28-rate]',{price28Rate:'inflation',price28Value:'45'}],
   ['[data-price28-mode]',{price28Mode:'competitivo'}],
   ['[data-price28-transfer-toggle]',{}]
  ])await h.listeners.click({target:{closest:s=>s===selector?{dataset}:null}});
  assert.equal(h.run('price28Forms[price28Tab].margin'),'35');
  assert.equal(h.run('price28Forms[price28Tab].inflation'),'45');
  assert.equal(h.run('price28Forms[price28Tab].lastPurchaseCost'),'1250');
  h.listeners.change({target:{dataset:{price28Field:'margin'},value:'40'}});
  assert.equal(h.run('price28Forms[price28Tab].margin'),'40');
 }
 assert.equal(h.calls.filter(c=>c[0]==='render').length,0);
});
