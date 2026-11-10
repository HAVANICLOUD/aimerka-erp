import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/erp/product-trace-ui.js',import.meta.url),'utf8');
function setup(){
  const listeners={},events=[],commands=[];
  let form,html;
  const product={sku:'REGISTERED-1',name:'Camera',brand:'Brand',costCents:12345,averageCostMxn:123.456789,priceCents:20000};
  const context={state:{products:[product],config:{}},renderers:{},c28ProductForm:null,productDetails:null,
    esc:value=>String(value??''),icon:()=>'<svg></svg>',money:String,
    ERP:{engines:{inventory:{generateProductSku:()=> 'GENERATED-1'},pricing:{CHANNELS:[]}},command:async(...args)=>{commands.push(args);return {ok:false,error:'Review'};}},
    document:{addEventListener:(type,fn)=>(listeners[type]??=[]).push(fn),getElementById:id=>id==='pt29-product-form'?form:null},
    Catalog43:{attachForm(){events.push('gallery');},readForm(){}},
    showModal(markup){
      html=markup;
      const fields=new Map();
      for(const match of markup.matchAll(/<input\b([^>]*)>/g)){
        const attrs=match[1],name=attrs.match(/\bname="([^"]+)"/)?.[1];if(!name)continue;
        fields.set(name,{value:attrs.match(/\bvalue="([^"]*)"/)?.[1]||'',readOnly:/\breadonly\b/.test(attrs),
          focus(options){events.push(['focus',name,options]);},scrollIntoView(options){events.push(['scroll',name,options]);},select(){assert.fail('Must not select SKU text');}});
      }
      const help={textContent:''},error={hidden:true,scrollIntoView(){}},submit={disabled:false};
      form={dataset:{original:markup.match(/data-original="([^"]*)"/)[1]},elements:{namedItem:name=>fields.get(name)||null},querySelectorAll:()=>[],
        querySelector:selector=>selector==='#pt29-sku-help'?help:selector==='.pt29-form-error'?error:selector==='[type="submit"]'?submit:null,
        closest:()=>({addEventListener(){}})};
    }};
  context.window=context;vm.createContext(context);vm.runInContext(source,context);
  const emit=async(type,target)=>{for(const fn of listeners[type]||[])await fn({target,preventDefault(){}});};
  const toggle=()=>{const attrs={'data-pt29-sku-lock':'','aria-pressed':'false'};const button={dataset:{},innerHTML:'',closest:()=>form,hasAttribute:name=>Object.hasOwn(attrs,name),setAttribute:(name,value)=>attrs[name]=value};return {button,attrs,click:()=>emit('click',{closest:selector=>selector==='button'?button:null})};};
  return {context,events,commands,emit,toggle,get form(){return form;},get html(){return html;}};
}

test('existing SKU opens readOnly, focuses after gallery without selection, and unlocks only by explicit toggle',async()=>{
  const s=setup();s.context.ProductTrace28.form('REGISTERED-1');
  const input=s.form.elements.namedItem('sku');
  assert.equal(input.value,'REGISTERED-1');assert.equal(input.readOnly,true);
  assert.match(s.html,/data-pt29-sku-lock[^>]*aria-controls="pt29-sku"[^>]*aria-pressed="false"/);
  assert.match(s.html,/Desbloquéalo solo si necesitas corregirlo/);
  assert.match(s.html,/data-pt29-sku-lock[^>]*>[\s\S]*?<svg[^>]*aria-hidden="true"/);
  assert.equal(s.events[0],'gallery');assert.equal(s.events[1][0],'focus');assert.equal(s.events[1][1],'sku');assert.equal(s.events[1][2].preventScroll,true);
  assert.equal(s.events[2][0],'scroll');assert.equal(s.events[2][2].block,'center');
  const toggle=s.toggle();await toggle.click();assert.equal(input.readOnly,false);assert.equal(toggle.attrs['aria-pressed'],'true');assert.equal(toggle.attrs['aria-label'],'Bloquear SKU');
  assert.match(s.form.querySelector('#pt29-sku-help').textContent,/SKU editable/);
  input.value='CORRECTED-1';await toggle.click();assert.equal(input.readOnly,true);assert.equal(input.value,'CORRECTED-1');assert.equal(toggle.attrs['aria-pressed'],'false');
  assert.match(s.form.querySelector('#pt29-sku-help').textContent,/solo si necesitas corregirlo/);
  s.context.ProductTrace28.form('REGISTERED-1');assert.equal(s.form.elements.namedItem('sku').readOnly,true);assert.equal(s.form.elements.namedItem('sku').value,'REGISTERED-1');
});

test('new SKU remains editable with generator and manual override',async()=>{
  const s=setup();s.context.ProductTrace28.form();const input=s.form.elements.namedItem('sku');
  assert.equal(input.readOnly,false);assert.doesNotMatch(s.html,/data-pt29-sku-lock/);assert.match(s.html,/data-pt29-generate/);
  s.form.elements.namedItem('name').value='New camera';
  const button={dataset:{},hasAttribute:name=>name==='data-pt29-generate',closest:()=>s.form};
  await s.emit('click',{closest:selector=>selector==='button'?button:null});assert.equal(input.value,'GENERATED-1');
  input.id='pt29-sku';input.closest=()=>s.form;input.value='MANUAL-1';await s.emit('input',input);
  assert.equal(s.form.dataset.skuManual,'1');
  await s.emit('input',{name:'name',closest:()=>s.form});assert.equal(input.value,'MANUAL-1');
});

test('unlocked correction preserves originalSku migration and decimal cost save contract',async()=>{
  const s=setup();s.context.ProductTrace28.form('REGISTERED-1');await s.toggle().click();s.form.elements.namedItem('sku').value='CORRECTED-1';
  s.form.id='pt29-product-form';await s.emit('submit',s.form);
  assert.equal(s.commands.length,1);const [command,payload]=s.commands[0];
  assert.equal(command,'product.save');assert.equal(payload.originalSku,'REGISTERED-1');assert.equal(payload.product.sku,'CORRECTED-1');
  assert.equal(payload.product.averageCostMxn,123.456789);assert.equal(payload.product.costCents,12346);
});
