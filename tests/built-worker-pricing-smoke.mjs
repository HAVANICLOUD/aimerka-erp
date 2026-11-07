/** Opt-in: run against a built Worker with a disposable, isolated D1 fixture. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base=new URL(process.argv[2]||'http://127.0.0.1:4173');
assert.ok(['127.0.0.1','localhost'].includes(base.hostname),'Local isolated Worker only');
assert.equal(process.env.AIMERKA_ISOLATED_FIXTURE,'yes','Requires an explicitly disposable local D1 fixture');
const headers={'Content-Type':'application/json','oai-authenticated-user-email':'geovanyjk@msn.com'};
async function post(command){
 const response=await fetch(new URL('/api/action',base),{method:'POST',headers,body:JSON.stringify(command)});
 assert.match(response.headers.get('content-type')||'',/application\/json/,'Worker module must initialize and return JSON');
 return {status:response.status,body:await response.json()};
}
async function get(){const r=await fetch(new URL('/api/state?workspace=v43',base),{headers});assert.equal(r.status,200);return r.json();}
assert.equal((await post({})).status,400);
const before=await get(),sku='APAIRPODSMAXMN';
assert.ok(before.state.products.some(p=>p.sku===sku));
const targets=['Sears','Sanborns','Coppel','Mercado Libre','Liverpool','Tienda Nube','Elektra'];
const expected=[[1409900,1229900],[1409900,1229900],[1329900,1159900],[1429900,1239900],[1449900,1259900],[1409900,1229900],[1449900,1259900]];
const command={id:'built-worker-'+crypto.randomUUID(),workspace:'v43',revision:before.revision,type:'pricing.publication.prepare',payload:{productSku:sku,targets,input:{mode:'automatico',margin:.15,inflation:.15,alternateMarketPrice:12499,t1CommissionMode:'inferred14',retentionTreatment:'no_pass_through',mlType:'Premium',msi:'12MSI',shippingType:'Automático'}}};
const saved=await post(command);assert.equal(saved.status,200,saved.body.error);assert.equal(saved.body.revision,before.revision+1);
const after=await get();
for(let i=0;i<targets.length;i++){
 const row=after.state.productChannelPrices.find(r=>r.sku===sku&&r.market===targets[i]);
 assert.deepEqual([row.regularCents,row.discountCents],expected[i],targets[i]);
}
for(const key of new Set([...Object.keys(before.state),...Object.keys(after.state)])){
 if(!['productChannelPrices','productChannelPriceHistory','pricePublicationQueue','events'].includes(key))assert.deepEqual(after.state[key],before.state[key],key+' unchanged');
}
const duplicate=await post(command);assert.equal(duplicate.status,200);assert.equal(duplicate.body.result.duplicate,true);assert.equal((await get()).revision,after.revision);
const product=after.state.products.find(p=>p.sku===sku);
const productCommand={id:'built-sat-'+crypto.randomUUID(),workspace:'v43',revision:after.revision,type:'product.save',payload:{originalSku:sku,product:{...product,unitSat:'ZZZ'}}};
const rejected=await post(productCommand);assert.equal(rejected.status,422);assert.match(rejected.body.error,/SAT vigente/);assert.equal((await get()).revision,after.revision);
productCommand.id='built-sat-'+crypto.randomUUID();productCommand.payload.product.unitSat='h87';
const canonical=await post(productCommand);assert.equal(canonical.status,200,canonical.body.error);assert.equal(canonical.body.state.products.find(p=>p.sku===sku).unitSat,'H87');
const evidence={passed:true,runtime:'built Cloudflare Worker / local isolated D1',moduleInitialization:true,pricesSaved:7,idempotent:true,unrelatedStateUnchanged:true,satInvalidRejected:true,satCanonicalSaved:true};
fs.writeFileSync(new URL('../outputs/correccion-guardado-precios-2026/worker-smoke.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence));
