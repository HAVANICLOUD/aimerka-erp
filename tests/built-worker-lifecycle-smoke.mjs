/** Opt-in writes only to an isolated local D1 fixture. Never hosted data. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {catalogVisible,commerciallySelectable} from '../lib/product-lifecycle.mjs';
const base=new URL(process.argv[2]||'http://127.0.0.1:4173');
assert.ok(['127.0.0.1','localhost'].includes(base.hostname));assert.equal(process.env.AIMERKA_ISOLATED_FIXTURE,'yes');
const owner='geovanyjk@msn.com',headers={'Content-Type':'application/json','oai-authenticated-user-email':owner};
async function get(){const r=await fetch(new URL('/api/state',base),{headers});assert.equal(r.status,200);return r.json();}
async function post(command,email=owner){const r=await fetch(new URL('/api/action',base),{method:'POST',headers:{...headers,'oai-authenticated-user-email':email},body:JSON.stringify(command)});assert.match(r.headers.get('content-type')||'',/json/);return {status:r.status,body:await r.json()};}
const command=(type,payload,revision)=>({id:crypto.randomUUID(),workspace:'v43',type,payload,revision});
const sku='APLHMPODMBL',before=await get(),product=before.state.products.find(p=>p.sku===sku);
assert.equal(product.good,0);assert.equal(catalogVisible(product),true);
const reject=await post(command('inventory.product.discontinue',{sku:'APAIRPODSMAXMN',hide:true,reason:'No debe retirar stock positivo'},before.revision));assert.equal(reject.status,422);assert.equal((await get()).revision,before.revision);
const retireCommand=command('inventory.product.discontinue',{sku,hide:true,reason:'Prueba local: conservación de historial'},before.revision),retired=await post(retireCommand);assert.equal(retired.status,200,retired.body.error);
const after=await get(),hidden=after.state.products.find(p=>p.sku===sku);assert.equal(hidden.lifecycle.discontinued,true);assert.equal(hidden.lifecycle.hidden,true);assert.equal(catalogVisible(hidden),false);assert.equal(commerciallySelectable(hidden),false);assert.equal(after.state.products.length,before.state.products.length);
for(const k of Object.keys(before.state))if(!['products','events'].includes(k))assert.deepEqual(after.state[k],before.state[k],k+' preserved');
for(const p of after.state.products){const old=before.state.products.find(o=>o.sku===p.sku);if(p.sku!==sku)assert.deepEqual(p,old);else for(const k of Object.keys(old))if(k!=='status')assert.deepEqual(p[k],old[k]);}
const duplicate=await post(retireCommand);assert.equal(duplicate.status,200);assert.equal(duplicate.body.result.duplicate,true);assert.equal((await get()).revision,after.revision);
const quote=await post(command('pricing.publication.prepare',{productSku:sku,targets:['Sears'],input:{mode:'automatico',margin:.1}},after.revision));assert.equal(quote.status,422);assert.equal((await get()).revision,after.revision);
const denied=await post(command('inventory.product.reactivate',{sku},after.revision),'hantoni_@hotmail.com');assert.equal(denied.status,403);assert.equal((await get()).revision,after.revision);
const shown=await post(command('inventory.product.visibility',{sku,hidden:false},after.revision));assert.equal(shown.status,200,shown.body.error);assert.equal(shown.body.state.products.find(p=>p.sku===sku).lifecycle.discontinued,true);
const restored=await post(command('inventory.product.reactivate',{sku},shown.body.revision));assert.equal(restored.status,200,restored.body.error);assert.equal(commerciallySelectable(restored.body.state.products.find(p=>p.sku===sku)),true);
const final=await get();for(const k of ['orders','purchases','documents','movements','settlementLedger','pricePublicationQueue','productChannelPrices'])assert.deepEqual(final.state[k],before.state[k],k+' preserved after restore');
const evidence={passed:true,runtime:'built Cloudflare Worker / isolated D1',zeroStockValidated:true,positiveStockRejected:true,archiveHidden:true,recordCountPreserved:final.state.products.length,historyAndFinancialDataUnchanged:true,duplicateProtected:true,pricingArchivedRejected:true,roleGuardVerified:true,visibilityRestored:true,reactivationVerified:true};
fs.writeFileSync(new URL('../outputs/vistas-campanas-archivo-2026/worker-smoke.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
