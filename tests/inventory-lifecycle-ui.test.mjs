import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/erp/inventory-workspace-ui.js',import.meta.url),'utf8');
function setup(){
 const listeners={},calls=[],nodes={main:{innerHTML:''},'iw-query':{value:''},modal:{close(){calls.push(['close-modal']);}}};
 const state={products:[{sku:'A',upc:'0012',name:'Activo',good:0},{sku:'A-1',name:'Prefijo',good:0},{sku:'B',name:'Retirado',good:0,lifecycle:{discontinued:true}},{sku:'C',upc:'0099',name:'Oculto',good:0,lifecycle:{discontinued:true,hidden:true}}],movements:[{sku:'C',delta:2}],orders:[{sku:'C'}],events:[{type:'sale'}]};
 const lifecycle={isHidden:p=>!!p.lifecycle?.hidden,isDiscontinued:p=>!!p.lifecycle?.discontinued,discontinuationEligibility:()=>({eligible:true,issues:[]})};
 const row={dataset:{iwRow:'C'},scrollIntoView(){calls.push(['scroll']);},focus(){calls.push(['focus']);}};
 const document={addEventListener:(type,fn)=>(listeners[type]??=[]).push(fn),getElementById:id=>nodes[id],querySelectorAll:()=>[row]};
 const context={state,document,renderers:{},view:'inventory',ERP:{engines:{productLifecycle:lifecycle},command:async(...args)=>{calls.push(['command',...args]);return {ok:true};}},D:{available:p=>Math.max(0,(p.good||0)-(p.reserved||0)-(p.safety||0))},esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),icon:()=>'<svg></svg>',ProductTrace28:{thumb:()=>'',show:sku=>calls.push(['show',sku])},closeDrawer:()=>calls.push(['close-drawer']),navigate:view=>{calls.push(['navigate',view]);nodes.main.innerHTML=context.renderers[view]();},showModal:html=>{nodes.modal.innerHTML=html;}};
 context.window=context;vm.createContext(context);vm.runInContext(source,context);
 return {context,state,calls,nodes,lifecycle,ui:context.InventoryWorkspace,emit:async(type,target)=>{for(const fn of listeners[type]||[])await fn({target,preventDefault(){}});}};
}
const skus=rows=>Array.from(rows,p=>p.sku);
function form(action='discontinue'){
 const feedback={textContent:''},submit={disabled:false},reason={value:'Conservar motivo',disabled:false},hide={checked:true,disabled:false},cancel={disabled:false},controls=[submit,reason,hide,cancel];
 return {feedback,submit,reason,hide,cancel,dataset:{sku:'A',action},setAttribute(){},hasAttribute:name=>name==='data-iw-lifecycle-form',elements:{namedItem:name=>({reason,hide})[name]},querySelector:s=>s==='[type="submit"]'?submit:feedback,querySelectorAll:()=>controls};
}
test('default excludes hidden but badges visible discontinued; archive includes both without mutating history',()=>{
 const {ui,state}=setup(),before=structuredClone(state);
 assert.deepEqual(skus(ui.filterProducts()),['A','A-1','B']);assert.match(ui.render(),/Descontinuado/);assert.doesNotMatch(ui.render(),/data-iw-row="C"/);
 ui.model.filter='archived';assert.deepEqual(skus(ui.filterProducts()),['B','C']);assert.match(ui.render(),/Oculto/);assert.deepEqual(state,before);
});
test('openProduct routes SKU and UPC, resets page and filter, focuses archived row and never adjusts inventory',()=>{
 const {ui,state,calls,nodes}=setup(),before=structuredClone(state);ui.model.page=9;ui.model.filter='negative';
 ui.openProduct('0099');assert.equal(ui.model.query,'0099');assert.equal(nodes['iw-query'].value,'0099');assert.equal(ui.model.filter,'archived');assert.equal(ui.model.page,1);assert.equal(ui.model.highlight,'C');assert.deepEqual(skus(ui.filterProducts()),['C']);
 assert.deepEqual(calls,[['close-drawer'],['navigate','inventory'],['scroll'],['focus']]);
 ui.openProduct('A');assert.deepEqual(skus(ui.filterProducts()),['A']);assert.equal(ui.model.filter,'all');assert.deepEqual(state,before);
 ui.openProduct('not found');assert.equal(nodes['iw-query'].value,'not found');assert.deepEqual(skus(ui.filterProducts()),[]);
});
test('retirement form displays server eligibility issues and prevents hide actions on active products',()=>{
 const {ui,lifecycle,nodes,state,calls}=setup(),before=structuredClone(state);lifecycle.discontinuationEligibility=()=>({eligible:false,issues:['Reserva en Poniente','Saldo en inspección']});
 ui.lifecycleForm('A','discontinue');assert.match(nodes.modal.innerHTML,/Reserva en Poniente/);assert.match(nodes.modal.innerHTML,/Saldo en inspección/);assert.match(nodes.modal.innerHTML,/type="submit"[^>]*disabled/);assert.match(nodes.modal.innerHTML,/todos los almacenes/);assert.match(nodes.modal.innerHTML,/todo el historial/);
 nodes.modal.innerHTML='unchanged';ui.lifecycleForm('A','hide');assert.equal(nodes.modal.innerHTML,'unchanged');assert.deepEqual(state,before);assert.equal(calls.length,0);
});
test('commands have exact lifecycle payloads; failures retain draft and release busy controls',async()=>{
 const {emit,context,calls,state}=setup(),before=structuredClone(state);
 for(const [action,type,extra] of [['discontinue','discontinue',{hide:true}],['hide','visibility',{hidden:true}],['show','visibility',{hidden:false}],['reactivate','reactivate',{}]]){
  const f=form(action);await emit('submit',f);const command=calls.filter(c=>c[0]==='command').at(-1);
  assert.equal(command[1],'inventory.product.'+type);assert.deepEqual(JSON.parse(JSON.stringify(command[2])),{sku:'A',reason:'Conservar motivo',...extra});assert.equal(f.submit.disabled,false);
 }
 context.ERP.command=async()=>({ok:false,error:'No elegible',issues:['Reserva pendiente']});const f=form();await emit('submit',f);
 assert.match(f.feedback.textContent,/No elegible.*Reserva pendiente/);assert.equal(f.reason.value,'Conservar motivo');assert.equal(f.hide.checked,true);assert.equal(f.submit.disabled,false);assert.equal(f.dataset.busy,undefined);
 context.ERP.command=async()=>{throw Error('Sin conexión');};await emit('submit',f);assert.equal(f.feedback.textContent,'Sin conexión');assert.equal(f.cancel.disabled,false);assert.deepEqual(state,before);
});
test('busy guard prevents duplicate submission and keeps controls disabled until command completes',async()=>{
 const {emit,context}=setup();let resolve,count=0;context.ERP.command=()=>{count++;return new Promise(r=>resolve=r);};const f=form();
 const pending=emit('submit',f);assert.equal(f.submit.disabled,true);assert.equal(f.reason.disabled,true);await emit('submit',f);assert.equal(count,1);resolve({ok:false,error:'Reintentar'});await pending;assert.equal(f.reason.disabled,false);assert.equal(f.reason.value,'Conservar motivo');
});
