import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {applyCommand} from '../lib/commands.mjs';
import {splitState,joinState,diffFragments} from '../lib/state-codec.mjs';
import {quote,recommend,resolveCommission,resolveShipping,shippingSuggestion,resolveCategory,listCategories} from '../lib/pricing-v28.mjs';

// Real UI command names/payloads, real source data and the server's state codec.
// Tests work on detached copies and never open the live store or change the seed.
const seed=JSON.parse(readFileSync(new URL('../data/seed-v28.json',import.meta.url)));
const config=JSON.parse(readFileSync(new URL('../data/pricing-config.json',import.meta.url)));
// Archival V28 contract: preserve its original gross-price withholding reference.
config.parameters.t1IncludedVat=0;config.parameters.t1RetentionBase='gross_ex_vat';
const clone=value=>structuredClone(value);
const fresh=()=>({...clone(seed),config:clone(config)});
const clock={now:'2026-10-28T06:00:00.000Z',actor:'Contrato de precios V28',workspace:'v28'};
let sequence=0;
function command(state,type,payload){return applyCommand(state,{id:`pricing-contract-${++sequence}`,type,payload},clock);}
function reload(state){return joinState(splitState(state));}
function saveConfig(state,section,value){
  const before=clone(state),result=command(state,'config.pricing.save',{section,value});
  assert.equal(result.ok,true);assert.notDeepEqual(diffFragments(before,state).upserts,[]);
  const loaded=reload(state);assert.deepEqual(loaded.config[section],value);
  assert.deepEqual(loaded.products,before.products);assert.deepEqual(loaded.orders,before.orders);
  return loaded;
}
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} differs from ${expected}`);

test('Saved-scenario UI shows UTC instants in Mexico City and preserves civil dates and source values',()=>{
  const source={pricingScenarios:[{name:'UTC',date:'2026-10-28T05:23:00.000Z'},{name:'Civil',date:'2026-10-28'}]},before=clone(source);
  const context=createContext({state:source,window:{},document:{addEventListener(){}},pricingPage(){return '';},renderers:{},nav:[],esc:value=>String(value??''),badge:value=>String(value)});
  runInContext(readFileSync(new URL('../public/erp/pricing-ui.js',import.meta.url),'utf8'),context);
  const html=runInContext('price28Saved()',context);
  assert.match(html,/27\/10\/2026,? 23:23/);assert.match(html,/>2026-10-28<\/span>/);assert.deepEqual(source,before);
  assert.equal(runInContext("price28Timestamp('2026-10-27T23:23:00-06:00')",context),runInContext("price28Timestamp('2026-10-28T05:23:00Z')",context));
  assert.equal(runInContext("price28Timestamp('2026-10-28T05:23')",context),'2026-10-28T05:23');
});

test('UI configuration: retention parameters persist and affect only subsequent calculations',()=>{
  let state=fresh();const value=clone(state.config.parameters);value.vatWithholding=.075;
  const prior=quote(state.config,{cost:1000,marketPrice:1999,channel:'T1 Comercios',shippingType:'Pequeño',margin:.1,inflation:.1});
  state=saveConfig(state,'parameters',value);
  const next=quote(state.config,{cost:1000,marketPrice:1999,channel:'T1 Comercios',shippingType:'Pequeño',margin:.1,inflation:.1});
  assert.equal(prior.vatRate,.08);assert.equal(next.vatRate,.075);assert.ok(next.discount.profit!==prior.discount.profit);
});

test('UI configuration: active shipping tariff survives persistence with manual-zero meaning intact',()=>{
  let state=fresh();const value=clone(state.config.shipping);value[0].min=131;
  state=saveConfig(state,'shipping',value);
  assert.equal(resolveShipping(state.config,{shippingType:'Pequeño',manualShipping:null}).amount,131);
  assert.equal(resolveShipping(state.config,{shippingType:'Pequeño',manualShipping:0}).amount,0);
  assert.equal(state.config.shipping[0].base,130);
});

test('UI configuration: first matching shipping rule persists and changes automatic suggestion',()=>{
  let state=fresh();const value=clone(state.config.shippingRules);
  value.unshift({priority:1,keyword:'ALEXA',type:'Grande',note:'Regla de prueba'});
  value.forEach((row,i)=>row.priority=i+1);
  state=saveConfig(state,'shippingRules',value);
  assert.equal(shippingSuggestion(state.config,state.products.find(p=>p.name.includes('ALEXA'))),'Grande');
});

test('UI configuration: Elektra MSI term persists and is added once to category base',()=>{
  let state=fresh();const value=clone(state.config.elektraMsi);value.find(r=>r.label==='12MSI').rate=.065;
  state=saveConfig(state,'elektraMsi',value);
  const result=resolveCommission(state.config,{channel:'Elektra',category:'TELEFONIA',msi:'12MSI',referencePrice:14999});
  assert.equal(result.valid,true);close(result.baseRate,.09);close(result.msiRate,.065);close(result.rate,.155);
});

test('UI configuration: gateway weight persists without inventing automatic TN band recalculation',()=>{
  let state=fresh();const bands=clone(state.config.tnBands),value=clone(state.config.tnGateways);value[0].weight=.2;
  state=saveConfig(state,'tnGateways',value);
  assert.equal(state.config.tnGateways[0].weight,.2);assert.deepEqual(state.config.tnBands,bands);
  close(resolveCommission(state.config,{channel:'Tienda Nube',referencePrice:1000}).rate,bands[0].usedRate);
});

test('UI configuration: explicit TN used rate persists and drives the selected price band',()=>{
  let state=fresh();const value=clone(state.config.tnBands);value[0].usedRate=.07;
  state=saveConfig(state,'tnBands',value);
  assert.equal(resolveCommission(state.config,{channel:'Tienda Nube',referencePrice:2498}).rate,.07);
  assert.equal(resolveCommission(state.config,{channel:'Tienda Nube',referencePrice:2499}).rate,value[1].usedRate);
});

test('UI configuration: settlement table command persists shipping treatment and audit history',()=>{
  let state=fresh();const value=clone(state.config.settlement);value.shippingTreatment.Liverpool='Descontado';
  state=saveConfig(state,'settlement',value);
  assert.equal(state.config.settlement.shippingTreatment.Liverpool,'Descontado');
  assert.equal(state.configHistory.at(-1).action,'Actualizar reglas de conciliación');
  assert.equal(state.configHistory.at(-1).actor,clock.actor);
  assert.equal(state.configHistory.at(-1).before.shippingTreatment.Liverpool,'Por confirmar');
});

test('UI commission editor commands persist T1, Coppel, ML, Liverpool and Elektra rates',()=>{
  for(const channel of ['T1 Comercios','Coppel','Mercado Libre','Liverpool','Elektra']){
    let state=fresh();const row=state.config.commissions[channel][0],includedMsi=channel==='Liverpool'?state.config.settlement.liverpoolIncludedMsi:0;
    const payload={channel,category:row.category,baseRate:row.rate-includedMsi+.005,premiumRate:channel==='Mercado Libre'?row.premiumRate+.005:null,includedMsi,path:row.path||'',note:'Edición desde contrato UI'};
    const previous=clone(state.products);assert.equal(command(state,'config.commission.save',payload).ok,true);state=reload(state);
    const saved=state.config.commissions[channel].find(r=>r.category===payload.category);
    close(saved.rate,row.rate+.005);assert.equal(saved.note,payload.note);assert.deepEqual(state.products,previous);
    if(channel==='Mercado Libre')close(saved.premiumRate,payload.premiumRate);
    if(channel==='T1 Comercios')assert.ok(state.config.commissions[channel].every(r=>r.rate===saved.rate));
    if(channel==='Liverpool')close(saved.rate,payload.baseRate+includedMsi);
  }
});

test('UI new commission and mapping commands create usable catalogue categories',()=>{
  let state=fresh();
  const commission={channel:'Coppel',category:'Categoría de contrato',baseRate:.15,premiumRate:null,path:'Prueba / Categoría',note:'Sólo esta copia'};
  assert.equal(command(state,'config.commission.save',commission).ok,true);
  const mapping=clone(state.config.categoryMappings[0]);mapping.category='INVENTARIO DE CONTRATO';mapping.channels.Coppel=commission.category;
  assert.equal(command(state,'config.mapping.save',mapping).ok,true);state=reload(state);
  assert.ok(listCategories(state.config,'Coppel').includes(commission.category));
  assert.equal(state.config.categoryMappings.find(r=>r.category===mapping.category).channels.Coppel,commission.category);
  assert.equal(resolveCategory(state.config,{category:mapping.category,categoryOverrides:{},categories:{}},'Coppel'),commission.category);
});

test('UI mapping edits preserve existing product exceptions after state serialization',()=>{
  let state=fresh();const product=state.products.find(p=>p.upc==='195950638011');product.categoryOverrides.Liverpool='Telefonía';
  const mapping=clone(state.config.categoryMappings.find(r=>r.category===product.category));mapping.channels.Liverpool='Cómputo';
  const previous=clone(state.products);assert.equal(command(state,'config.mapping.save',mapping).ok,true);state=reload(state);
  const loaded=state.products.find(p=>p.sku===product.sku);assert.deepEqual(state.products,previous);
  assert.equal(resolveCategory(state.config,loaded,'Liverpool'),'Telefonía');
  assert.equal(resolveCategory(state.config,{...loaded,categoryOverrides:{}},'Liverpool'),'Cómputo');
});

test('UI scenario commands save all three contexts, exact outputs and immutable rule snapshots',()=>{
  let state=fresh();const product=state.products.find(p=>p.upc==='195950638011'),products=clone(state.products),orders=clone(state.orders);
  const scenarios=[
    {name:'Calculadora V28',context:'calculadora',productSku:null,input:{cost:8434,marketPrice:12799,channel:'T1 Comercios',category:'Todas las categorías',shippingType:'Mediano',manualShipping:null,margin:.1,inflation:.2,mode:'tasas'}},
    {name:'Cotizador TN manual',context:'cotizador',productSku:null,input:{cost:1000,marketPrice:5999,channel:'Tienda Nube',shippingType:'Pequeño',manualShipping:0,mode:'precios',manualDiscount:12999,manualRegular:14999}},
    {name:'UPC importado',context:'recomendador',productSku:product.sku,input:{channel:'T1 Comercios',mode:'automatico',margin:0,shippingType:'Automático',manualShipping:null}}
  ];
  for(const payload of scenarios){assert.equal(command(state,'pricing.scenario.save',payload).ok,true);state=reload(state);}
  assert.deepEqual(state.pricingScenarios.map(s=>s.context),['recomendador','cotizador','calculadora']);
  const calc=state.pricingScenarios.find(s=>s.context==='calculadora'),cotizador=state.pricingScenarios.find(s=>s.context==='cotizador'),upc=state.pricingScenarios[0];
  assert.equal(calc.result.discount.price,14199);close(calc.result.discount.profit,1448.285);
  assert.equal(cotizador.result.shipping,0);close(cotizador.result.commissionRate,.158725845477871);
  assert.equal(upc.result.discount.price,39299);close(upc.result.discount.profit,20.785);assert.equal(upc.productSku,product.sku);
  for(const scenario of state.pricingScenarios){assert.equal(scenario.date,clock.now);assert.equal(scenario.result.valid,true);assert.deepEqual(scenario.configSnapshot,config);}
  const savedScenarios=clone(state.pricingScenarios),parameters={...state.config.parameters,vatWithholding:.07};
  state=saveConfig(state,'parameters',parameters);
  assert.deepEqual(state.pricingScenarios,savedScenarios);assert.deepEqual(state.products,products);assert.deepEqual(state.orders,orders);
  assert.equal(recommend(state.config,state.products.find(p=>p.sku===product.sku),scenarios[2].input).vatRate,.07);
});

test('Original free-scenario command remains separate from V28 rates and saved calculations',()=>{
  let state=fresh();const previous=clone(state.config);
  const calc={market:'Liverpool',category:'Escenario libre',price:10000,cost:6000,shipping:200,commission:12,msi:3,vat:16,target:10,withholding:100,base:'gross',feesVat:true};
  assert.equal(command(state,'pricing.legacyScenario.save',{calc}).ok,true);state=reload(state);
  assert.deepEqual(state.rules.at(-1),{...calc,date:clock.now});assert.deepEqual(state.config,previous);
  assert.equal(state.pricingScenarios?.length||0,0);
});

test('Invalid known rate, mapping and scenario inputs reject before changing cloned state',()=>{
  const cases=[
    ['config.pricing.save',{section:'parameters',value:{...config.parameters,vatWithholding:null}}],
    ['config.commission.save',{channel:'Liverpool',category:'Telefonía',baseRate:.11,includedMsi:'abc'}],
    ['config.mapping.save',{category:'INCOMPLETA',channels:{Coppel:'Celulares'},shipping:'Pequeño'}],
    ['pricing.scenario.save',{context:'calculadora',input:{cost:-1,marketPrice:1000,channel:'T1 Comercios',shippingType:'Pequeño'}}],
    ['pricing.scenario.save',{context:'recomendador',productSku:'MISSING',input:{margin:.1}}]
  ];
  for(const [type,payload] of cases){const state=fresh(),before=clone(state);assert.throws(()=>command(state,type,payload));assert.deepEqual(state,before);}
});
