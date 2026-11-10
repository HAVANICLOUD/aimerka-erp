import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {listingStatus, channelPrice} from '../lib/product-prices.mjs';

const source = fs.readFileSync(new URL('../public/erp/product-catalog-studio.js', import.meta.url), 'utf8');
function setup(overrides = {}) {
  const listeners = {}, calls = [], inventory = () => 'existing inventory';
  const s = {products: [
    {sku:'A',name:'Cámara <especial>',brand:'Ámbar',category:'Cámaras',department:'Foto',upc:'001234567890',skuAliases:['OLD-A'],averageCostMxn:123.456,costCents:100,priceCents:25000,good:3,channelListings:{Sears:{status:'published'}},images:[{url:'https://example.com/a.png',primary:true}]},
    {sku:'B',name:'Cable',brand:'Beta',department:'Accesorios',priceCents:9999,costCents:5000,good:2,channelIdentifiers:{Sears:{publicationId:'ID-B'}}},
    {sku:'C',name:'Cargador',brand:'Beta',good:0,channelListings:{Sears:{status:'not_published'}}},
    {sku:'D',name:'Pantalla',brand:'Delta',good:-1},
  ],productChannelPrices:[{sku:'D',market:'Sears',regularCents:50000,discountCents:40000}],...overrides};
  const document={addEventListener:(type,fn)=>(listeners[type]??=[]).push(fn),getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[]};
  const context={state:s,renderers:{inventory,products:()=>''},productsPage:()=>'',document,Intl,console,
    ProductTrace28:{show(...args){calls.push(['show',...args]);return 'drawer-result';},form(...args){calls.push(['edit',...args]);}},
    ERP:{engines:{productPrices:{listingStatus,channelPrice}},async command(...args){calls.push(['command',...args]);return {ok:true};}},
    Price28:{openProduct(...args){calls.push(['quote',...args]);}},
    ProductChannels:{strip:p=>`<div class="existing-strip">${p.sku}</div>`},
    MarketUI:{logo:m=>`<svg aria-label="${m}"></svg>`}};
  context.productDetails=context.ProductTrace28.show;
  context.window=context;vm.createContext(context);vm.runInContext(source,context);
  const studio=context.ProductCatalogStudio;
  const emit=async(type,target)=>{for(const fn of listeners[type]||[])await fn({target,preventDefault(){calls.push(['preventDefault']);}});};
  return {studio,context,s,calls,document,emit,inventory};
}
const plain = value => JSON.parse(JSON.stringify(value));
const button = (dataset, attributes=[]) => ({dataset,disabled:false,closest(){return this;},hasAttribute:name=>attributes.includes(name)});

test('installs only product renderers, preserves inventory and does not mutate state on render/open',()=>{
  const {studio,context,s,calls,inventory}=setup(), before=structuredClone(s);
  assert.equal(context.renderers.inventory,inventory);
  assert.equal(context.renderers.products,studio.render);assert.equal(context.productsPage,studio.render);
  assert.match(studio.render(),/Precio general/);assert.match(studio.render(),/Costo promedio/);
  assert.equal(context.ProductTrace28.show('A','prices'),'drawer-result');
  assert.deepEqual(calls,[['show','A','prices']]);assert.deepEqual(s,before);
  assert.equal(context.productDetails,context.ProductTrace28.show);
});
test('channel defaults to declared published; a saved price never makes a product published',()=>{
  const {studio,s}=setup();studio.setFilters({market:'Sears'});
  assert.equal(studio.filters.status,'published');assert.deepEqual(plain(studio.filterProducts(s)).map(p=>p.sku),['A']);
  for(const [status,expected] of [['registered',['B']],['unknown',['D']],['not_published',['C']],['all',['A','B','C','D']]]){
    studio.setFilters({status});assert.deepEqual(plain(studio.filterProducts(s)).map(p=>p.sku),expected);
  }
  studio.setFilters({status:'unknown'});assert.match(studio.render(),/\$500\.00 \/ \$400\.00/);
  assert.match(studio.render(),/Publicación por verificar/);
  studio.setFilters({market:''});assert.equal(studio.filterProducts(s).length,4);
});
test('search supports accents, SKU, exact UPC strings and aliases; brand and department combine and reset pages',()=>{
  const {studio,s}=setup();
  for(const q of ['camara','001234567890','old-a','ámbar']){studio.setFilters({query:q});assert.deepEqual(plain(studio.filterProducts(s)).map(p=>p.sku),['A']);}
  studio.setFilters({query:'',brand:'Beta',department:'Accesorios'});assert.deepEqual(plain(studio.filterProducts(s)).map(p=>p.sku),['B']);
  for(const change of [{query:'a'},{brand:'Beta'},{department:'Foto'},{warehouse:'principal'},{status:'all'},{market:'Coppel'},{pageSize:60}]){
    studio.setFilters({page:8});studio.setFilters(change);assert.equal(studio.filters.page,1);
  }
});
test('warehouse scopes use any nonzero recorded pool, deduplicate rows and never fallback for an empty ledger',()=>{
  const {studio,s}=setup({warehouseStock:[{sku:'A',warehouseId:'west',reserved:1},{sku:'A',warehouseId:'west',good:2},{sku:'B',warehouseId:'east',good:3},{sku:'C',warehouseId:'west',damaged:2},{sku:'D',warehouseId:'west',good:-5}]});
  studio.setFilters({warehouse:'west'});assert.deepEqual(plain(studio.filterProducts(s)).map(p=>p.sku),['A','C','D']);
  assert.match(studio.render(),/Productos con existencias en almacén/);
  s.warehouseStock=[];assert.equal(studio.filterProducts(s).length,0);
  delete s.warehouseStock;studio.setFilters({warehouse:'principal'});assert.deepEqual(plain(studio.filterProducts(s)).map(p=>p.sku),['A','B','D']);
  assert.match(studio.render(),/asociación no verificada/);
  studio.setFilters({warehouse:'west'});assert.equal(studio.filterProducts(s).length,0);
});
test('paginates every one of 327 products without truncation and clamps invalid pages',()=>{
  const products=Array.from({length:327},(_,i)=>({sku:`SKU-${i}`,name:`Producto ${i}`}));
  const {studio}=setup({products}), seen=[];
  for(let page=1;page<=11;page++){const result=studio.paginate(products,{page,pageSize:30});seen.push(...result.rows.map(p=>p.sku));assert.equal(result.pages,11);}
  assert.equal(new Set(seen).size,327);assert.equal(seen.length,327);
  assert.equal(studio.paginate(products,{page:999,pageSize:30}).page,11);
  assert.equal(studio.paginate([],{page:-1,pageSize:30}).page,1);
});
test('renders escaped identity, safe thumbnails, central price and average MXN cost, without stock columns',()=>{
  const {studio,s,context}=setup();context.ProductChannels.strip=p=>`<div class="existing-strip">${studio.escape(p.sku)}</div>`;s.products[0].sku='A"<script>';s.products[0].imageUrl='javascript:alert(1)';s.products[0].images=[];
  let html=studio.render();assert.match(html,/Cámara &lt;especial&gt;/);assert.match(html,/A&quot;&lt;script&gt;/);
  assert.match(html,/\$123\.46/);assert.match(html,/\$250\.00/);assert.match(html,/001234567890/);
  assert.doesNotMatch(html,/<script>|src="javascript:|<th>Físico|<th>Reserva|<th>Disponible/);
  for(const bad of ['javascript:x','//bad.test/a','/\\bad','data:image/svg+xml,x','https://x/" onerror="x'])assert.equal(studio.safeImage(bad),'');
  assert.equal(studio.safeImage('/erp/assets/photo.png'),'/erp/assets/photo.png');
  studio.setFilters({layout:'grid'});html=studio.render();assert.match(html,/pcs-grid/);
});
test('row actions call current ficha, edit and quote APIs with the same SKU and market',async()=>{
  const {studio,calls,emit}=setup();studio.setFilters({market:'Liverpool'});
  await emit('click',button({pcsOpen:'A'}));await emit('click',button({pcsEdit:'A'}));await emit('click',button({pcsQuote:'A'}));
  assert.deepEqual(calls,[['show','A'],['edit','A'],['quote','A','Liverpool']]);
});
test('profile uses exact save contract, preserves unknown attributes and never creates a central SKU',async()=>{
  const {studio,s,calls,emit}=setup();
  s.products[0].channelProfiles={Sears:{title:'Título guardado',attributes:[{name:'material',value:'Acero'},{name:'brand',value:'Anterior'}]}};
  const before=structuredClone(s), html=studio.profileContent(s.products[0],'Sears');
  assert.match(html,/Título guardado/);assert.match(html,/readonly/);assert.match(html,/Ficha del canal/);assert.deepEqual(s,before);assert.equal(calls.length,0);
  const values={title:'Nuevo título',description:'Descripción',categoryId:'EXT-1',categoryName:'Externa',sellerSku:'SELL-A',publicationId:'PUB-A',condition:'Nuevo',warranty:'12 meses','attr-brand':'Ámbar','attr-weightKg':'2.5'};
  const feedback={textContent:''}, submit={disabled:false};
  const form={dataset:{sku:'A',market:'Sears'},querySelectorAll:()=>[{querySelector:selector=>({value:selector==='[data-pcs-attribute-name]'?'material':'Acero'})}],elements:{namedItem:name=>({value:values[name]||''})},hasAttribute:name=>name==='data-pcs-profile-form',querySelector:selector=>selector==='[type="submit"]'?submit:feedback};
  await emit('submit',form);
  const saved=calls.find(c=>c[0]==='command');assert.equal(saved[1],'pricing.productChannel.save');
  assert.deepEqual(plain(saved[2]),{sku:'A',market:'Sears',profile:{title:'Nuevo título',description:'Descripción',categoryId:'EXT-1',categoryName:'Externa',condition:'Nuevo',warranty:'12 meses',sellerSku:'SELL-A',publicationId:'PUB-A',attributes:[{name:'material',value:'Acero'},{name:'brand',value:'Ámbar'},{name:'weightKg',value:'2.5'}]}});
  assert.deepEqual(s,before);assert.equal(submit.disabled,false);assert.match(feedback.textContent,/guardada/);
});
test('failed profile save keeps form values and releases busy state for retry',async()=>{
  const {context,emit}=setup();context.ERP.command=async()=>{throw Error('Sin conexión');};
  const feedback={}, submit={}, values={value:'Conservar'};
  const form={dataset:{sku:'A',market:'Sears'},querySelectorAll:()=>[],elements:{namedItem:()=>values},hasAttribute:()=>true,querySelector:selector=>selector==='[type="submit"]'?submit:feedback};
  await emit('submit',form);assert.equal(feedback.textContent,'Sin conexión');assert.equal(values.value,'Conservar');assert.equal(submit.disabled,false);assert.equal(form.dataset.busy,undefined);
});
test('appends channel tab idempotently to current drawer and selects it without saving or changing prices tab',()=>{
  const {studio,context,document,calls}=setup();let appended=0,exists=false;
  const tabs={insertAdjacentHTML(position,html){appended++;exists=true;assert.match(html,/Ficha del canal/);}};
  const panel={innerHTML:'Existing prices',setAttribute(name,value){this[name]=value;}};
  const active={};const tabNodes=['pcp-prices-tab','pcs-profile-tab'].map(id=>({id,classList:{toggle(key,value){active[id]=value;}},setAttribute(){}}));
  document.querySelector=selector=>selector==='#drawer .pt29-tabs'?tabs:null;
  document.getElementById=id=>id==='pcs-profile-tab'?(exists?{}:null):id==='pt29-history-panel'?panel:null;
  document.querySelectorAll=()=>tabNodes;
  context.productDetails('A','prices');studio.decorate('A');assert.equal(appended,1);assert.equal(panel.innerHTML,'Existing prices');
  studio.showProfile('A','Coppel');assert.match(panel.innerHTML,/data-market="Coppel"/);assert.equal(panel['aria-labelledby'],'pcs-profile-tab');
  assert.equal(active['pcp-prices-tab'],false);assert.equal(active['pcs-profile-tab'],true);
  assert.deepEqual(calls,[['show','A','prices']]);
});
test('paused and pending approval remain distinct, selectable declared states, unrelated to prices or IDs',()=>{
  const {studio,s,calls}=setup();
  for(const status of ['paused','pending_approval']){
    s.products[0].channelListings.Sears.status=status;
    studio.setFilters({market:'Sears'});assert.equal(studio.filterProducts(s).length,0);
    studio.setFilters({status});assert.deepEqual(plain(studio.filterProducts(s)).map(p=>p.sku),['A']);
    const html=studio.profileContent(s.products[0],'Sears');
    assert.match(html,new RegExp(`value="${status}" selected`));assert.match(html,/declaración manual/);
    assert.match(studio.render(),new RegExp(`value="${status}" selected`));
  }
  const form={dataset:{sku:'A',market:'Sears'},querySelectorAll:()=>[],elements:{namedItem:name=>({value:name==='publicationStatus'?'paused':''})}};
  assert.equal(studio.profilePayload(form).profile.publicationStatus,'paused');
  assert.equal(calls.length,0);
  const registeredHtml=studio.profileContent(s.products[1],'Sears');assert.match(registeredHtml,/value="unknown" selected/);
});
test('central dimensions are separate read-only references and profile text limits match the command',()=>{
  const {studio,s}=setup();s.products[0].productDimensions={weightKg:1.2,lengthCm:10};s.products[0].dimensions={weightKg:2.5,lengthCm:25};
  const before=structuredClone(s),html=studio.profileContent(s.products[0],'Sears');
  assert.match(html,/Producto · consulta central/);assert.match(html,/Empaque · consulta central/);
  assert.match(html,/<dd>1.2<\/dd>/);assert.match(html,/<dd>2.5<\/dd>/);
  assert.match(html,/name="title"[^>]+maxlength="250"/);assert.match(html,/name="description"[^>]+maxlength="10000"/);
  assert.deepEqual(s,before);
});
test('commercial drawer context replaces only adjust action, leaves Inventory context untouched',()=>{
  const {studio,context,document}=setup();const classes={},adjust={outerHTML:'Original adjust'};
  const detail={classList:{toggle(key,value){classes[key]=value;}},querySelector:()=>adjust};
  document.querySelector=selector=>selector==='#drawer .pt29-tabs'?{insertAdjacentHTML(){}}:selector==='#drawer .pt29-product-detail'?detail:null;
  context.view='products';studio.decorate('A');assert.equal(classes['pcs-commercial-detail'],true);assert.match(adjust.outerHTML,/data-view="inventory">Consultar inventario/);
  context.view='inventory';adjust.outerHTML='Original adjust';studio.decorate('A');assert.equal(classes['pcs-commercial-detail'],false);assert.equal(adjust.outerHTML,'Original adjust');
});
test('generic channel attributes render escaped editable rows and reject duplicate, partial or excessive values',()=>{
  const {studio,s}=setup();s.products[0].channelProfiles={Sears:{attributes:[{name:'Material',value:'Acero <pulido>'}]}};
  const html=studio.profileContent(s.products[0],'Sears');assert.match(html,/Atributos específicos del canal/);assert.match(html,/data-pcs-attribute-value[^>]+value="Acero &lt;pulido&gt;"/);
  const make=attrs=>({dataset:{sku:'A',market:'Sears'},elements:{namedItem:()=>null},querySelectorAll:()=>attrs.map(a=>({querySelector:selector=>({value:selector==='[data-pcs-attribute-name]'?a.name:a.value})}))});
  assert.deepEqual(plain(studio.profilePayload(make([{name:'Material',value:'Nuevo'}])).profile.attributes),[{name:'Material',value:'Nuevo'}]);
  assert.equal(studio.profilePayload(make([])).profile.attributes.length,0);
  assert.throws(()=>studio.profilePayload(make([{name:'Material',value:'A'},{name:'material',value:'B'}])),/No repitas/);
  assert.throws(()=>studio.profilePayload(make([{name:'Material',value:''}])),/Completa/);
  assert.throws(()=>studio.profilePayload(make(Array.from({length:51},(_,i)=>({name:String(i),value:'x'})))),/50 atributos/);
});
test('successful profile save refreshes current channel strip only, retaining form feedback and draft',async()=>{
  const {context,document,s,emit}=setup();const strip={outerHTML:'old strip'},feedback={},submit={},draft={value:'Draft title'};
  context.ERP.command=async()=>{s.products[0].channelListings.Sears.status='paused';return {ok:true};};
  context.ProductChannels.strip=p=>`strip:${p.channelListings.Sears.status}`;
  document.querySelector=selector=>selector==='#drawer .pcp-detail-channels .pcp-market-strip'?strip:null;
  const form={dataset:{sku:'A',market:'Sears'},elements:{namedItem:name=>name==='title'?draft:null},querySelectorAll:()=>[],hasAttribute:()=>true,querySelector:selector=>selector==='[type="submit"]'?submit:feedback};
  await emit('submit',form);assert.equal(strip.outerHTML,'strip:paused');assert.equal(draft.value,'Draft title');assert.match(feedback.textContent,/guardada/);
});
test('unknown publication empty state offers all statuses; pending zero cost is explicit, known average remains visible',async()=>{
  const {studio,s,emit}=setup();studio.setFilters({market:'Elektra'});
  assert.match(studio.render(),/Sin publicaciones declaradas para este canal/);assert.match(studio.render(),/data-pcs-statusall/);
  await emit('click',button({},['data-pcs-statusall']));assert.equal(studio.filters.status,'all');assert.equal(studio.filterProducts(s).length,4);
  studio.setFilters({market:''});s.products[0].costStatus='Por confirmar';assert.match(studio.render(),/\$123\.46/);
  s.products[0].averageCostMxn=0;assert.match(studio.render(),/<strong>Por confirmar<\/strong>/);
});
test('packaging attributes round-trip through rendered inputs without fallback, loss or duplicate generic rows',()=>{
  const {studio,s}=setup();
  const packaging=[{name:'weightKg',value:'2.75'},{name:'lengthCm',value:'31'},{name:'widthCm',value:'22.5'},{name:'heightCm',value:'0'}];
  s.products[0].brand='';s.products[0].dimensions={weightKg:99,lengthCm:99,widthCm:99,heightCm:99};
  for(const upper of [false,true]){
    s.products[0].channelProfiles={Sears:{attributes:packaging.map(a=>({...a,name:upper?a.name.toUpperCase():a.name}))}};
    const before=structuredClone(s),html=studio.profileContent(s.products[0],'Sears');
    assert.doesNotMatch(html,/data-pcs-attribute-row>/);
    const inputs=Object.fromEntries([...html.matchAll(/<input name="([^"]+)" value="([^"]*)"/g)].map(match=>[match[1],match[2]]));
    for(const a of packaging)assert.equal(inputs['attr-'+a.name],a.value);
    const form={dataset:{sku:'A',market:'Sears'},querySelectorAll:()=>[],elements:{namedItem:name=>Object.hasOwn(inputs,name)?{value:inputs[name]}:null}};
    assert.deepEqual(plain(studio.profilePayload(form).profile.attributes),packaging);
    assert.deepEqual(s,before);
  }
});
