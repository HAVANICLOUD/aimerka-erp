import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {applyInventory} from '../lib/inventory-v28.mjs';
const units=JSON.parse(readFileSync(new URL('../data/sat-units.json',import.meta.url)));
const products=JSON.parse(readFileSync(new URL('../data/sat-products.json',import.meta.url)));
const ctx={now:'2026-11-07T12:00:00Z',actor:'QA',workspace:'v43'};
const state=()=>({products:[],orders:[],purchases:[],events:[],movements:[],config:{}});
const save=(s,p,originalSku,extra={})=>applyInventory(s,{id:'test',type:'product.save',payload:{originalSku,product:{name:'Producto',brand:'Marca',costCents:100,priceCents:200,...p}}},{...ctx,...extra});

test('shared browser engine initializes without resolving or loading JSON imports',async()=>{
 const source=readFileSync(new URL('../lib/inventory-v28.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');let imports=0;
 const engine=await vm.runInNewContext('(async()=>{'+source+';return {generateProductSku};})()', {window:{},structuredClone}, {importModuleDynamically(){imports++;throw new Error('Browser must not load server catalogues');}});
 assert.match(engine.generateProductSku({name:'Test',brand:'Marca'}),/^[A-Z0-9]{1,10}$/);assert.equal(imports,0);
});

test('full pinned SAT unit distribution includes canonical examples and provenance',()=>{
 assert.equal(units.rows.length,2418);assert.equal(new Set(units.rows.map(r=>r[0])).size,2418);
 assert.equal(units.version,products.version);assert.match(units.sourceUrl,/v10\.21\.20261029/);
 assert.match(units.downloadSha256,/^[a-f0-9]{64}$/);
 assert.equal(units.rows.find(r=>r[0]==='H87')[1],'Pieza');assert.equal(units.rows.find(r=>r[0]==='E48')[1],'Unidad de servicio');
});

test('server canonicalizes descriptions, rejects unknown selections, and saves no automatic unit',()=>{
 const s=state();save(s,{sku:'EMPTY'});assert.equal('unitSat' in s.products[0],false);
 save(s,{sku:'GOOD',unitSat:'H87',unitSatDescription:'Forged',satCode:'01010101',satDescription:'Forged'});
 assert.equal(s.products[0].unitSatDescription,'Pieza');assert.equal(s.products[0].satDescription,'No existe en el catálogo');
 for(const product of [{unitSat:'ZZZ'},{unitSat:'H87 · Pieza'},{satCode:'99999999'},{satCode:'0101010'}]){
  const before=structuredClone(s);assert.throws(()=>save(s,{sku:'BAD',...product}),/SAT vigente/);assert.deepEqual(s,before);
 }
 const before=structuredClone(s);assert.throws(()=>save(s,{sku:'FUTURE',unitSat:'H87'},undefined,{now:'2021-01-01'}),/SAT vigente/);assert.deepEqual(s,before);
});

test('every currently valid SAT unit saves with canonical casing, including Xyv',()=>{
 const s=state();save(s,{sku:'ALLUNITS'});
 for(const row of units.rows.filter(r=>(!r[3]||r[3]<='2026-11-07')&&(!r[4]||r[4]>='2026-11-07'))){
  save(s,{...s.products[0],unitSat:row[0]},'ALLUNITS');assert.equal(s.products[0].unitSat,row[0]);assert.equal(s.products[0].unitSatDescription,row[1]);
 }
 save(s,{...s.products[0],unitSat:'xyv'},'ALLUNITS');assert.equal(s.products[0].unitSat,'Xyv');
 save(s,{...s.products[0],unitSat:'h87'},'ALLUNITS');assert.equal(s.products[0].unitSat,'H87');
});

test('legacy selections and extra fields remain intact across all 327 product edits',()=>{
 const s=state();s.orders=[{id:'sale-history',sku:'LEGACY0'}];s.movements=[{sku:'LEGACY0',delta:7}];
 s.products=Array.from({length:327},(_,i)=>({sku:'LEGACY'+i,name:'Legacy',brand:'Marca',costCents:100,priceCents:200,good:7,reserved:2,safety:1,quarantine:3,damaged:4,satCode:'old-'+i,...(i%2?{unitSat:'legacy piece',unitSatDescription:'Histórico'}:{}),skuAliases:['ALIAS'+i],custom:{immutable:i},dimensions:{weightKg:1,heightCm:2,widthCm:3,lengthCm:4,customPacking:true},channelIdentifiers:{'T1 Comercios':{sellerSku:'T1',custom:true}}}));
 const before=structuredClone(s),stockKeys=['sku','skuAliases','good','reserved','safety','quarantine','damaged','custom','dimensions','channelIdentifiers'];
 for(const p of [...s.products])save(s,{...p,name:'Updated'},p.sku);
 assert.equal(s.products.length,327);assert.deepEqual(s.movements,before.movements);assert.deepEqual(s.orders,before.orders);
 for(let i=0;i<327;i++){
  const p=s.products[i],old=before.products[i];for(const k of stockKeys)assert.deepEqual(p[k],old[k]);
  assert.equal(p.satCode,old.satCode);assert.equal(p.unitSat,old.unitSat);assert.equal('unitSat' in p,'unitSat' in old);
 }
 save(s,{...s.products[0],unitSat:'E48'},'LEGACY0');assert.equal(s.products[0].unitSatDescription,'Unidad de servicio');
 s.config.productCatalog={requireSatUnit:true};assert.throws(()=>save(s,{sku:'REQUIRED'}),/unidad de venta SAT/);
 save(s,{...s.products[2]},'LEGACY2');assert.equal('unitSat' in s.products[2],false);
});

test('uploaded images are server-verified, persist a principal, and keep stock/history unchanged',()=>{
 const s=state();save(s,{sku:'MEDIA',good:999});const p=s.products[0];p.good=8;
 const docs=[{id:'one',mime:'image/png',name:'one.png'},{id:'two',mime:'image/jpeg',name:'two.jpg'}];
 const payload={...p,images:docs.map((d,i)=>({...d,source:'upload',url:'blob:not-persisted',primary:i===1})),dimensions:{weightKg:1,heightCm:2,widthCm:3,lengthCm:4},channelIdentifiers:{'T1 Comercios':{sellerSku:'old',publicationId:'p',variantId:'v',custom:'keep'}}};
 assert.throws(()=>save(s,payload,'MEDIA'),/Vuelve a cargar/);assert.equal(p.images,undefined);
 save(s,payload,'MEDIA',{verifiedImages:docs});assert.equal(p.imageUrl,'/api/documents/two?workspace=v43');assert.equal(p.good,8);assert.equal(p.images.filter(i=>i.primary).length,1);
 save(s,{...p,images:p.images.map(i=>({...i,primary:i.id==='one'}))},'MEDIA',{verifiedImages:docs});assert.equal(p.imageUrl,'/api/documents/one?workspace=v43');
 save(s,{...p,images:[],imageUrl:'https://example.com/photo.png'},'MEDIA');assert.equal(p.imageUrl,'https://example.com/photo.png');assert.equal(p.good,8);assert.deepEqual(s.movements,[]);
});

async function route({active=true,date='2026-11-07',extraUnits=[]}={}){
 const source=readFileSync(new URL('../app/api/sat-catalog/route.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace("new Date().toISOString().slice(0,10)",JSON.stringify(date));
 const js=ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS});
 const exports={};vm.runInNewContext(js,{exports,products,units:{...units,rows:[...units.rows,...extraUnits]},readState:async()=>({}),workspaceId:v=>v,requestAccess:async()=>({active}),Response,URL});return exports.GET;
}
test('authenticated endpoint searches whole bundled catalogues, accent-insensitively with validity filters',async()=>{
 const get=await route({extraUnits:[['ZZ1','Futura','', '2099-01-01',''],['ZZ2','Expirada','','2022-01-01','2024-01-01']]});
 const query=async params=>{const res=await get(new Request('https://erp.test/api/sat-catalog?workspace=v43&'+params));return [res,await res.json()];};
 for(const [q,code] of [['pieza','H87'],['unidad servicio','E48'],['h87','H87'],['kilómetro','KMT']]){const [r,d]=await query('kind=units&q='+encodeURIComponent(q));assert.equal(r.status,200);assert.ok(d.results.some(r=>r.code===code),q);assert.equal(d.bundled,true);}
 assert.deepEqual((await query('kind=units&code=H87'))[1].results,[{code:'H87',description:'Pieza'}]);
 assert.equal((await query('kind=units&code=xyv'))[1].results[0].code,'Xyv');
 assert.ok(!(await query('kind=units&q=ZZ'))[1].results.some(r=>['ZZ1','ZZ2'].includes(r.code)));
 assert.equal((await query('q=01010101'))[1].results[0].code,'01010101');
 assert.equal((await query('kind=units&q=x'))[1].results.length,0);
 assert.equal((await query('kind=unknown&q=test'))[0].status,400);
 const unauthorized=await route({active:false});assert.equal((await unauthorized(new Request('https://erp.test/api/sat-catalog?kind=units&q=H87'))).status,403);
});
