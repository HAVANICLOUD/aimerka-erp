import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {accessView,assertPermission} from '../lib/access-control.mjs';
import {applyInventory} from '../lib/inventory-v28.mjs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const products=JSON.parse(read('../data/sat-products.json')),units=JSON.parse(read('../data/sat-units.json'));
function load(path,context={},transform=s=>s){
 const source=transform(read(path).replace(/^import .*;\n/gm,''));
 const exports={};vm.runInNewContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}),{exports,products,units,Response,URL,...context});return exports;
}
function route({email='operator@example.com',suspended=false,failPolicy=false}={}){
 let policyReads=0,workspaceReads=0;
 const {requestAccess}=load('../lib/access.ts',{
  accessView,assertPermission,projectState:()=>{},
  readState(){workspaceReads++;throw new Error('Catalogue must not read workspace state');},
  async readTeamPolicy(){policyReads++;if(failPolicy)throw new Error('private DB error');return {revision:4,state:{security:{users:[{email:'operator@example.com',roleId:'operations',active:!suspended}]}}};}
 },s=>s.replace('import.meta.env.DEV','false'));
 const {GET}=load('../app/api/sat-catalog/route.ts',{
  requestAccess,
  readState(){workspaceReads++;throw new Error('Catalogue must not read workspace state');},
  workspaceId(){throw new Error('Catalogue must not initialize workspaces');}
 },s=>s.replace('new Date().toISOString().slice(0,10)',"'2026-11-10'"));
 return {async query(params){const response=await GET(new Request('https://erp.test/api/sat-catalog?workspace=v43&'+params,{headers:email?{'oai-authenticated-user-email':email}:{}}));return {response,data:await response.json()};},counts:()=>({policyReads,workspaceReads})};
}

test('production identity authorization queries team policy without reading workspace state',async()=>{
 const h=route();
 for(const query of ['kind=units&q=unidad%20pieza','kind=products&code=52161514']){
  const {response,data}=await h.query(query);assert.equal(response.status,200);assert.ok(data.results.length>0);assert.equal(data.bundled,true);assert.equal(data.version,products.version);
 }
 assert.deepEqual(h.counts(),{policyReads:2,workspaceReads:0});
 for(const options of [{email:''},{suspended:true}]){
  const denied=route(options),{response,data}=await denied.query('kind=units&q=H87');assert.equal(response.status,403);assert.equal(data.errorCode,'SAT_ACCESS_DENIED');assert.equal(denied.counts().workspaceReads,0);
 }
 const {response,data}=await route({failPolicy:true}).query('kind=units&q=H87');assert.equal(response.status,503);assert.equal(data.errorCode,'SAT_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(data),/private DB/);assert.equal(response.headers.get('cache-control'),'no-store');
});

test('browse exposes common units and products without changing exact/search query semantics',async()=>{
 const h=route();
 const {data}=await h.query('kind=units&browse=1');assert.equal(data.results[0].code,'H87');assert.equal(data.results[0].description,'Pieza');assert.equal(data.results[1].code,'E48');assert.equal(data.results.length,40);
 assert.equal((await h.query('kind=products&browse=1')).data.results.length,40);
 for(const query of ['kind=units','kind=units&q=h','kind=units&browse=1&q=h'])assert.equal((await h.query(query)).data.results.length,0);
 assert.deepEqual((await h.query('kind=units&browse=1&code=notreal')).data.results,[]);
 assert.equal((await h.query('kind=bad&browse=1')).response.status,400);
});

test('accent, case, numeric prefixes and description tokens return canonical ranked results',async()=>{
 const h=route();
 for(const [kind,q,code] of [['units','  h87  ','H87'],['units','PIEZA','H87'],['units','unidad pieza','H87'],['units','unidad servicio','E48'],['units','kilometro','KMT'],['products','52161514','52161514'],['products','AUDÍFONOS','52161514'],['products','audi\u0301fonos','52161514']]){
  const {response,data}=await h.query('kind='+kind+'&q='+encodeURIComponent(q));assert.equal(response.status,200);if(q==='unidad pieza'||q==='unidad servicio')assert.ok(data.results.some(r=>r.code===code),q);else assert.equal(data.results[0].code,code,q);assert.ok(data.sourceUrl);assert.ok(data.officialUrl);
 }
 const prefix=(await h.query('kind=products&q=521615')).data.results;assert.ok(prefix.length>1);assert.ok(prefix.every(r=>r.code.startsWith('521615')));
 assert.deepEqual((await h.query('kind=units&code=H87')).data.results,[{code:'H87',description:'Pieza'}]);
});

test('route selections validate against actual bundled engine maps and never create default units',async()=>{
 const {satCatalogues}=load('../lib/sat-catalogues.ts');
 const context={now:'2026-11-10T12:00:00Z',actor:'QA',requireFiscalValidation:true,satCatalogues};
 const state={products:[],orders:[],purchases:[],events:[],movements:[],config:{}};
 const save=product=>applyInventory(state,{id:'sat-test',type:'product.save',payload:{product:{name:'Producto',brand:'Marca',costCents:100,priceCents:200,...product}}},context);
 save({sku:'EMPTY'});assert.equal('unitSat' in state.products[0],false);
 const h=route(),unit=(await h.query('kind=units&code=h87')).data.results[0],product=(await h.query('kind=products&code=52161514')).data.results[0];
 save({sku:'SELECTED',unitSat:unit.code,unitSatDescription:'untrusted',satCode:product.code,satDescription:'untrusted'});
 const selected=state.products.find(p=>p.sku==='SELECTED');assert.equal(selected.unitSatDescription,unit.description);assert.equal(selected.satDescription,product.description);
 const before=structuredClone(state);assert.throws(()=>save({sku:'BAD',unitSat:'ZZZ'}),/SAT vigente/);assert.deepEqual(state,before);
});
