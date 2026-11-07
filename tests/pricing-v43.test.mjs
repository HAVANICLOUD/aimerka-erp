import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {quote,recommend,compareChannels} from '../lib/pricing-v28.mjs';
const config=JSON.parse(readFileSync(new URL('../data/pricing-config.json',import.meta.url)));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const input={context:'calculadora',marketPrice:2000,channel:'Sears',category:'Todas las categorías',cost:500,shippingType:'Pequeño',manualShipping:130,mode:'precios',manualDiscount:1160,manualRegular:1160};
test('T1 taxes use ex-VAT sale before commission; receipt estimate is independent of stock',()=>{
 const before=JSON.stringify(config);
 for(const [mode,c,base,payout] of [['configured',.18,1000,716.2],['inferred14',.14,1000,762.6]]){
  const r=quote(config,{...input,t1CommissionMode:mode});assert.equal(r.valid,true);close(r.commissionRate,c);close(r.discount.withholdingBase,base);close(r.discount.vat,base*.08);close(r.discount.isr,base*.025);close(r.discount.netPayout,payout);close(r.discount.profit,payout-500);
 }
 assert.equal(JSON.stringify(config),before);
});
test('Historical after-commission base requires explicit input; shipping never reduces tax base',()=>{
 const r=quote(config,{...input,t1RetentionBase:'gross_ex_vat'});close(r.discount.withholdingBase,1000);close(r.discount.vat,80);close(r.discount.isr,25);
 const z=quote(config,{...input,manualShipping:0});close(z.discount.withholdingBase,1000);close(z.discount.netPayout,r.discount.netPayout+130);const old=quote(config,{...input,t1RetentionBase:'after_commission_ex_vat'});close(old.discount.withholdingBase,820);
});
test('automatic, manual UPC and all-channel comparison share T1 scenario math',()=>{
 const p={sku:'TEST',upc:'123',name:'Producto',category:'CELULARES SMARTPHONE',costCents:50000,priceCents:199900,shippingType:'Pequeño',categories:{},categoryOverrides:{}};
 for(const mode of ['configured','inferred14']){
  const r=recommend(config,p,{channel:'Sanborns',mode:'automatico',margin:.1,t1CommissionMode:mode});assert.equal(r.valid,true);assert.equal(r.discount.price%100,99);close(r.discount.withholdingBase,r.discount.price/1.16);assert.ok(Math.abs(r.discount.margin-.1)<.05);
  const manual=recommend(config,p,{...input,channel:'Sanborns',mode:'manual_precios',t1CommissionMode:mode});assert.equal(manual.valid,true);close(manual.discount.withholdingBase,1000);
 }
 const a=compareChannels(config,p,{margin:.1,t1CommissionMode:'inferred14'}),b=compareChannels(config,p,{margin:.1});assert.equal(a.length,6);
 for(let i=1;i<a.length;i++){assert.deepEqual(a[i].discount,b[i].discount);assert.deepEqual(a[i].regular,b[i].regular);assert.equal(a[i].commissionRate,b[i].commissionRate)};
});
test('invalid T1 configuration returns a validation error',()=>{
 for(const override of [{t1CommissionMode:'bad'},{t1RetentionBase:'bad'}])assert.equal(quote(config,{...input,...override}).valid,false);
});
