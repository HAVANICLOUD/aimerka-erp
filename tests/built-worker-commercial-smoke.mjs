/** Opt-in writes only to a disposable, isolated local D1 clone. Never hosted data. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {previewCommercialEvent} from '../lib/commercial-events.mjs';
const base=new URL(process.argv[2]||'http://127.0.0.1:4173');
assert.ok(['127.0.0.1','localhost'].includes(base.hostname));
assert.equal(process.env.AIMERKA_ISOLATED_FIXTURE,'yes');
const owner='geovanyjk@msn.com',headers={'Content-Type':'application/json','oai-authenticated-user-email':owner};
async function get(){const r=await fetch(new URL('/api/state',base),{headers});assert.equal(r.status,200);return r.json();}
async function post(c,email=owner){const r=await fetch(new URL('/api/action',base),{method:'POST',headers:{...headers,'oai-authenticated-user-email':email},body:JSON.stringify(c)});assert.match(r.headers.get('content-type')||'',/json/);return {status:r.status,body:await r.json()};}
const command=(type,payload,revision)=>({id:crypto.randomUUID(),workspace:'v43',type,payload,revision});
assert.equal((await post({})).status,400);
const before=await get(),sku='APAIRPODSMAXMN';
const profile=await post(command('pricing.productChannel.save',{sku,market:'Sears',profile:{title:'Ficha local de prueba',description:'Descripción propia del canal',publicationStatus:'paused',publicationId:'LOCAL-123',attributes:[{name:'Color',value:'Medianoche'}]}},before.revision));
assert.equal(profile.status,200,profile.body.error);
const now=await get();
for(const p of now.state.products){const old=before.state.products.find(o=>o.sku===p.sku);if(p.sku!==sku)assert.deepEqual(p,old);else for(const k of Object.keys(old))if(!['channelProfiles','channelIdentifiers','channelListings'].includes(k))assert.deepEqual(p[k],old[k],k);}
const event={name:'QA aislada · catálogo completo',startDate:'2026-11-10',endDate:'2026-11-20',markets:['Sears','Sanborns','Coppel','Mercado Libre','Liverpool','Tienda Nube','Elektra'],selection:{brands:[],departments:[],skus:[],warehouseId:'',onlyPublished:false},rules:{mode:'margin',margin:.15,discount:0,retentionTreatment:'no_pass_through',t1CommissionMode:'inferred14',mlType:'PREMIUM',msi:'12MSI'}};
const saved=await post(command('pricing.event.save',{event},now.revision));assert.equal(saved.status,200,saved.body.error);
const current=await get(),eventId=saved.body.result.eventId,preview=previewCommercialEvent(current.state,{eventId});
assert.equal(preview.rows.length,current.state.products.filter(p=>p.status!=='INACTIVO').length*7);
const selected=preview.rows.filter(r=>r.defaultSelected).slice(0,4),targets=selected.map(({sku,market})=>({sku,market}));assert.equal(targets.length,4);
const applyCommand=command('pricing.event.apply',{eventId,previewFingerprint:preview.fingerprint,targets},current.revision);
const applied=await post(applyCommand);assert.equal(applied.status,200,applied.body.error);
const after=await get();assert.equal(after.revision,current.revision+1);
for(const key of Object.keys(current.state))if(!['productChannelPrices','productChannelPriceHistory','pricePublicationQueue','commercialEventRuns','events'].includes(key))assert.deepEqual(after.state[key],current.state[key],key+' preserved');
for(const row of selected){const record=after.state.productChannelPrices.find(r=>r.sku===row.sku&&r.market===row.market);assert.equal(record.regularCents,row.regularCents);assert.equal(record.discountCents,row.discountCents);}
for(const row of current.state.productChannelPrices||[])if(!targets.some(t=>t.sku===row.sku&&t.market===row.market))assert.deepEqual(after.state.productChannelPrices.find(r=>r.sku===row.sku&&r.market===row.market),row,'unselected price unchanged');
const duplicate=await post(applyCommand);assert.equal(duplicate.status,200);assert.equal(duplicate.body.result.duplicate,true);assert.equal((await get()).revision,after.revision);
const stale=await post(command('pricing.event.apply',{eventId,previewFingerprint:preview.fingerprint,targets},after.revision));assert.equal(stale.status,422);assert.match(stale.body.error,/vista previa/);assert.equal((await get()).revision,after.revision);
const denied=await post(command('pricing.event.save',{event},after.revision),'hantoni_@hotmail.com');assert.equal(denied.status,403);assert.equal((await get()).revision,after.revision);
const bulkPreview=previewCommercialEvent(after.state,{eventId}),bulkRows=bulkPreview.rows.filter(r=>r.defaultSelected);
assert.ok(bulkRows.length>1000,'Full inventory campaign must exercise a genuinely massive write');
const bulk=await post(command('pricing.event.apply',{eventId,previewFingerprint:bulkPreview.fingerprint,targets:bulkRows.map(({sku,market})=>({sku,market}))},after.revision));
assert.equal(bulk.status,200,bulk.body.error);assert.equal(bulk.body.result.applied,bulkRows.length);
const full=await get();for(const k of ['products','orders','purchases','movements','documents','settlementLedger'])assert.deepEqual(full.state[k],after.state[k],k+' unchanged during massive save');
for(const row of bulkRows){const record=full.state.productChannelPrices.find(r=>r.sku===row.sku&&r.market===row.market);assert.equal(record.regularCents,row.regularCents);assert.equal(record.discountCents,row.discountCents);}
const evidence={passed:true,runtime:'built Cloudflare Worker, isolated local D1',catalogueProducts:current.state.products.length,previewTargets:preview.rows.length,pricesApplied:4,bulkGreenPricesSaved:bulkRows.length,unselectedPricesUnchanged:true,identityAndStockUnchanged:true,financialDataUnchanged:true,channelProfileSaved:true,duplicateProtected:true,stalePreviewRejected:true,readOnlyRoleRejected:true};
fs.writeFileSync(new URL('../outputs/productos-eventos-2026/worker-smoke.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
