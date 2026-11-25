import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const traceSource=readFileSync(new URL('../public/erp/product-trace-ui.js',import.meta.url),'utf8');
const mediaSource=readFileSync(new URL('../public/erp/catalog-v43.js',import.meta.url),'utf8');
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function satHarness(code=''){
 const handlers={},requests=[],timers=new Map(),values={unitSat:{value:code},unitSatDescription:{value:''}},out={hidden:true,innerHTML:'',querySelectorAll(){return [];}},status={textContent:''},retry={hidden:true};
 const box={querySelector(s){return s==='[role="listbox"]'?out:s==='[data-sat-status]'?status:s==='[data-sat-retry]'?retry:input;}};
 const input={value:code,dataset:{satInput:'unitSat',satKind:'units'},attrs:{},setAttribute(k,v){this.attrs[k]=v;},setCustomValidity(v){this.validity=v;},focus(){this.focused=true;},closest(s){return s==='form'?form:box;}};
 const form={dataset:{original:code?'LEGACY':''},isConnected:true,elements:{namedItem(k){return values[k];}},querySelectorAll(){return [input];},closest(){return {addEventListener(type,fn){form.close=fn;}};}};
 const context={esc,URL,AbortController,clearTimeout(id){timers.delete(id);},setTimeout(fn){const id=timers.size+1;timers.set(id,fn);return id;},state:{config:{},products:[]},ERP:{workspace:'v43',engines:{}},renderers:{},window:{},c28ProductForm:null,productDetails:null,document:{addEventListener(type,handler){(handlers[type]??=[]).push(handler);}},fetch(url,options){const d=deferred();requests.push({url,options,...d});return d.promise;}};
 vm.runInNewContext(traceSource.replace('  c28ProductForm=showProductForm;','  window.hooks={satField,initSatFields,lookupSat,selectSat,validateSatFields};\n  c28ProductForm=showProductForm;'),context);
 const hooks=context.window.hooks;
 return {hooks,input,form,values,out,status,retry,requests,context,
  focus(){for(const handler of handlers.focusin||[])handler({target:input});},
  retryClick(){const button={closest:()=>box};for(const handler of handlers.click||[])handler({target:{closest:s=>s==='[data-sat-retry]'?button:null}});},
  init(){hooks.initSatFields(form);},
  type(value){input.value=value;for(const handler of handlers.input||[])handler({target:input});},
  debounce(){const callbacks=[...timers.values()];timers.clear();callbacks.forEach(fn=>fn());},
  async reply(n,results,ok=true){requests[n].resolve({ok,status:ok?200:503,json:async()=>({results,error:ok?undefined:'Sin conexión'})});await flush();}
 };
}

test('SAT fields expose one searchable input and hidden selected code/description',()=>{
 const h=satHarness();const html=h.hooks.satField('unitSat','Unidad SAT',{unitSat:'H87',unitSatDescription:'Pieza'},'units');
 assert.equal((html.match(/role="combobox"/g)||[]).length,1);assert.equal((html.match(/type="hidden"/g)||[]).length,2);
 assert.match(html,/value="H87 · Pieza"/);assert.doesNotMatch(traceSource,/pt29-sat-query|data-sat-search/);assert.doesNotMatch(mediaSource,/field\('unitSat'/);
});

test('debouncing and typing abort stale exact lookups and stale search results',async()=>{
 const h=satHarness('H87');h.init();assert.match(h.requests[0].url,/kind=units&code=H87/);
 h.type('serv');h.type('servicio');assert.equal(h.values.unitSat.value,'');assert.equal(h.requests[0].options.signal.aborted,true);
 h.debounce();assert.equal(h.requests.length,2);assert.match(h.requests[1].url,/q=servicio/);
 await h.reply(0,[{code:'H87',description:'Pieza'}]);assert.equal(h.input.value,'servicio');
 h.type('metro');h.debounce();assert.equal(h.requests[1].options.signal.aborted,true);
 await h.reply(1,[{code:'E48',description:'Unidad de servicio'}]);assert.equal(h.out.hidden,true);
 await h.reply(2,[{code:'MTR',description:'Metro'}]);assert.match(h.out.innerHTML,/Metro/);assert.equal(h.out.hidden,false);
 h.hooks.selectSat(h.input,0);assert.equal(h.input.value,'MTR · Metro');assert.equal(h.values.unitSat.value,'MTR');assert.equal(h.input.validity,'');assert.equal(h.hooks.validateSatFields(h.form),true);
 h.type('incompleto');assert.equal(h.hooks.validateSatFields(h.form),false);h.type('');assert.equal(h.hooks.validateSatFields(h.form),true);
});

test('closing, opening another form, and switching workspace suppress late replies',async()=>{
 for(const action of ['close','replace','workspace']){
  const h=satHarness();h.init();h.type('pieza');h.debounce();
  if(action==='close')h.form.close();
  if(action==='replace')h.hooks.initSatFields({dataset:{},querySelectorAll(){return [];},closest(){return null;}});
  if(action==='workspace')h.context.ERP.workspace='another';
  await h.reply(0,[{code:'H87',description:'Pieza'}]);assert.equal(h.out.hidden,true,action);assert.equal(h.values.unitSat.value,'');
 }
 const h=satHarness('legacy piece');h.init();await h.reply(0,[]);assert.equal(h.values.unitSat.value,'legacy piece');assert.equal(h.input.value,'legacy piece');assert.match(h.status.textContent,/anterior conservado/);
});


test('empty focus opens suggestions without assigning any unit, including after clearing',async()=>{
 const h=satHarness();h.init();h.focus();assert.match(h.requests[0].url,/browse=1/);
 h.focus();assert.equal(h.requests.length,1);
 await h.reply(0,[{code:'H87',description:'Pieza'},{code:'E48',description:'Unidad de servicio'}]);
 assert.equal(h.out.hidden,false);assert.equal(h.values.unitSat.value,'');assert.equal(h.input.value,'');
 h.hooks.selectSat(h.input,0);assert.equal(h.values.unitSat.value,'H87');
 h.type('');h.debounce();await h.reply(1,[{code:'H87',description:'Pieza'}]);assert.equal(h.values.unitSat.value,'');
});

test('lookup failure offers retry, preserves original selection, and malformed data cannot select',async()=>{
 const h=satHarness('H87');h.init();await h.reply(0,[],false);
 assert.equal(h.values.unitSat.value,'H87');assert.equal(h.input.value,'H87');assert.equal(h.retry.hidden,false);assert.match(h.status.textContent,/conservado/);
 h.retryClick();assert.match(h.requests[1].url,/code=H87/);await h.reply(1,[{code:'H87',description:'Pieza'}]);assert.equal(h.retry.hidden,true);
 h.type('pieza');h.debounce();await h.reply(2,[{code:'H87'}]);assert.equal(h.retry.hidden,false);assert.equal(h.out.hidden,true);
 h.hooks.selectSat(h.input,0);assert.equal(h.values.unitSat.value,'');assert.equal(h.input.value,'pieza');
 h.retryClick();await h.reply(3,[{code:'H87',description:'Pieza'}]);h.hooks.selectSat(h.input,99);assert.equal(h.values.unitSat.value,'');
 h.context.ERP.workspace='other';h.hooks.selectSat(h.input,0);assert.equal(h.values.unitSat.value,'');
});

test('HTTP access errors, invalid JSON and timeout expose recoverable failures',async()=>{
 for(const scenario of ['access','json','timeout']){
  const h=satHarness();h.init();h.type('pieza');h.debounce();
  if(scenario==='timeout')h.debounce(); // A transport may ignore abort and never settle.
  else h.requests[0].resolve({ok:false,status:403,json:async()=>{if(scenario==='json')throw new Error('Unexpected token <');return {error:'denied'};}});
  await flush();assert.equal(h.retry.hidden,false,scenario);assert.equal(h.input.attrs['aria-busy'],'false');assert.equal(h.values.unitSat.value,'');
  assert.match(h.status.textContent,scenario==='access'?/sesión/:scenario==='json'?/respuesta válida/:/tardó demasiado/);
 }
});


test('timeout releases a hung JSON body and ignores its late result after retry',async()=>{
 const h=satHarness();h.init();h.type('pieza');h.debounce();
 const body=deferred();h.requests[0].resolve({ok:true,json:()=>body.promise});await flush();
 h.debounce();await flush();assert.equal(h.retry.hidden,false);assert.match(h.status.textContent,/tardó demasiado/);assert.equal(h.requests[0].options.signal.aborted,true);
 h.retryClick();await h.reply(1,[{code:'H87',description:'Pieza'}]);
 body.resolve({results:[{code:'E48',description:'Unidad de servicio'}]});await flush();
 assert.match(h.out.innerHTML,/H87/);assert.doesNotMatch(h.out.innerHTML,/E48/);assert.equal(h.values.unitSat.value,'');
});

test('optional and required unit settings stay scoped to new products',()=>{
 const h=satHarness();h.context.state.config.productCatalog={requireSatUnit:true};h.init();assert.equal(h.input.required,true);
 h.form.dataset.original='EXISTING';h.init();assert.equal(h.input.required,false);
 h.context.state.config.productCatalog.requireSatUnit=false;h.form.dataset.original='';h.init();assert.equal(h.input.required,false);
});

function mediaHarness(){
 const handlers={},requests=[],revoked=[],insertions=[],closeCallbacks=[];let nextBlob=0;
 const values={imageUrl:{value:''},name:{value:'Producto'}};
 const gallery={innerHTML:''},preview={innerHTML:''},submit={disabled:false},progress={textContent:''};
 const form={isConnected:true,elements:{namedItem:k=>values[k]},querySelector(s){return {'#catalog43-gallery':gallery,'#pt29-preview-photo':preview,'[type="submit"]':submit,'#catalog43-progress':progress,'.pt29-form-preview':{insertAdjacentHTML(where,html){insertions.push({where,html});}},'.modal-actions':{insertAdjacentHTML(){}},'[name="imageUrl"]':{closest(){return {legacy:true};}},'.catalog43-url':{append(node){insertions.push(node);}}}[s];},closest(){return {addEventListener(type,fn){closeCallbacks.push(fn);}};}};
 const context={esc,structuredClone,AbortController,FormData:class{entries=[];append(...args){this.entries.push(args)}},URL:{createObjectURL(){return 'blob:test-'+(++nextBlob);},revokeObjectURL(url){revoked.push(url);}},state:{products:[]},ERP:{workspace:'v43'},ProductMedia:{html:p=>'<img src="'+esc(p.images?.[0]?.url||p.imageUrl||'')+'">',uploadForm:async file=>({entries:[['file',file],['thumbnail'],['preview']]})},ProductTrace28:{safeImage:v=>v.startsWith('https://')||v.startsWith('/')?v:'',thumb:()=>'<fallback>'},productDetails(){},toast(){},document:{addEventListener(type,handler){(handlers[type]??=[]).push(handler);}},fetch(url,options){const d=deferred();requests.push({url,options,...d});return d.promise;}};
 context.window=context;vm.runInNewContext(mediaSource,context);const catalog=context.Catalog43;
 const change=files=>{const target={id:'catalog43-files',files,value:'selected',closest:()=>form};return handlers.change[0]({target});};
 const click=(attribute,index)=>{const b={dataset:{catalog43Primary:String(index),catalog43Remove:String(index)},closest:()=>form,hasAttribute:k=>k===attribute};handlers.click[0]({target:{closest:()=>b}});};
 return {catalog,form,values,gallery,preview,submit,progress,requests,revoked,insertions,closeCallbacks,context,change,click,
  async reply(index,id,ok=true){await flush();requests[index].resolve({ok,json:async()=>ok?{document:{id,mime:'image/png',name:id+'.png'}}:{error:'Falló carga'}});await flush();}
 };
}
const file=(name='test.png',size=100)=>({name,size,type:'image/png'});

test('shared product editor attaches media on every open and places uploader before identity',()=>{
 assert.match(traceSource,/window\.Catalog43\?\.attachForm\(form,p\)/);
 const h=mediaHarness();h.catalog.attachForm(h.form,{});
 assert.equal(h.insertions[0].where,'beforebegin');assert.match(h.insertions[0].html,/type="file"[^>]*multiple/);assert.match(h.insertions[0].html,/URL existente · opcional/);
 assert.ok(h.insertions.some(i=>i.legacy));
 h.catalog.attachForm(h.form,{images:[{id:'existing',source:'V43',url:'/erp/photo.jpg',primary:true}]});assert.match(h.gallery.innerHTML,/\/erp\/photo.jpg/);
});

test('local multiple thumbnails appear before upload resolves; principals/removals and blob cleanup work',async()=>{
 const h=mediaHarness();h.catalog.attachForm(h.form,{});const uploading=h.change([file('one.png'),file('two.png')]);
 assert.equal(h.catalog.images.length,2);assert.match(h.gallery.innerHTML,/blob:test-1/);assert.match(h.gallery.innerHTML,/blob:test-2/);assert.equal(h.submit.disabled,true);
 assert.throws(()=>h.catalog.readForm(h.form,{}),/Espera/);
 h.click('data-catalog43-primary',1);assert.match(h.preview.innerHTML,/blob:test-2/);
 await h.reply(0,'one');assert.deepEqual(h.requests[0].options.body.entries.map(e=>e[0]),['file','thumbnail','preview']);assert.equal(h.requests.length,2);await h.reply(1,'two');await uploading;
 assert.equal(h.submit.disabled,false);const saved={unitSat:'H87',channelIdentifiers:{'T1 Comercios':{custom:'keep'}}};h.catalog.readForm(h.form,saved);
 assert.equal(saved.images[1].primary,true);assert.ok(saved.images.every(i=>!('preview' in i)&&!i.url.startsWith('blob:')));assert.equal(saved.unitSat,'H87');assert.equal(saved.channelIdentifiers['T1 Comercios'].custom,'keep');
 h.click('data-catalog43-remove',1);assert.equal(h.catalog.images[0].primary,true);assert.ok(h.revoked.includes('blob:test-2'));
 h.closeCallbacks.at(-1)();assert.ok(h.revoked.includes('blob:test-1'));assert.equal(h.catalog.images.length,0);
});

test('removing pending images and closing during upload never attaches stale images to another form',async()=>{
 const h=mediaHarness();h.catalog.attachForm(h.form,{});const uploading=h.change([file()]);await flush();h.click('data-catalog43-remove',0);
 await h.reply(0,'removed');await uploading;assert.equal(h.catalog.images.length,0);assert.equal(h.values.imageUrl.value,'');
 const pending=h.change([file()]);await flush();h.catalog.attachForm(h.form,{images:[{id:'keep',source:'V43',url:'/erp/keep.jpg',primary:true}]});
 await h.reply(1,'stale');await pending;assert.equal(h.catalog.images[0].id,'keep');assert.equal(h.catalog.uploading,false);
});

test('failed/oversized images cannot save and partial uploads remain reviewable',async()=>{
 const h=mediaHarness();h.catalog.attachForm(h.form,{});await h.change([file('large.png',16*1024*1024)]);assert.equal(h.requests.length,0);
 const pending=h.change([file()]);await h.reply(0,'bad',false);await pending;
 assert.match(h.gallery.innerHTML,/No se cargó: Falló carga/);assert.throws(()=>h.catalog.readForm(h.form,{}),/no se cargaron/);
 h.click('data-catalog43-remove',0);const saved={};h.catalog.readForm(h.form,saved);assert.equal(saved.images,undefined);
});
