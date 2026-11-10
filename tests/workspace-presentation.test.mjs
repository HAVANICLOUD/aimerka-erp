import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {applyCommand} from '../lib/commands.mjs';
import {assertPermission,permissionFor} from '../lib/access-control.mjs';
import {companyName,existingMarkets,MAX_LOGO_BYTES,TIME_ZONE,validateLogoUrl} from '../lib/workspace-presentation.mjs';

const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
const context={now:'2026-11-10T05:59:00Z',actor:'settings@example.test',workspace:'v43'};
const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const fixture=()=>({config:{commissions:{'T1 Comercios':[]},purchaseFiscal:{defaultProfileId:'F1',profiles:[{id:'F1',legalName:'EMPRESA EXISTENTE SA',active:true}]}},orders:[{id:'O1',market:'Sears',amountCents:100}],products:[{sku:'ONE',good:2}],events:[]});
let sequence=0;
const save=(state,payload)=>applyCommand(state,{id:'presentation-'+(++sequence),type:'config.workspacePresentation.save',payload},context);
function browser(state=fixture()){
 const listeners={};
 const scope={state,window:{ERP:{ready:false,access:{active:true,permissions:['settings']}},ERPDate:{datetime:()=> '9 nov 2026, 23:59'}},document:{addEventListener(type,fn){(listeners[type]??=[]).push(fn);}},HTMLImageElement:class{},URL,atob,Uint8Array,console,
  markets:['Liverpool','Sears','Sanborns','Coppel','Elektra','Tienda Nube','Mercado Libre'],marketColors:{},marketTag:()=>'',esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),icon:()=>'',renderers:{configuration:()=>'<p>Reglas anteriores</p>'},navigate(view){scope.navigated=view;},render(){scope.renders=(scope.renders||0)+1;}};
 vm.createContext(scope);vm.runInContext(source('public/erp/market-branding.js'),scope);vm.runInContext(source('public/erp/workspace-presentation-ui.js'),scope);
 return {scope,listeners};
}
test('central settings command persists company, logos, metadata and Mexico timezone without changing operation or fiscal profiles',()=>{
 const state=fixture(),before=structuredClone(state);
 const result=save(state,{company:{commercialName:'  Mi comercio  ',legalName:'Razón para mostrar'},marketplaces:{Sears:{color:'#AAbbCC',logoUrl:PNG}},timeZone:TIME_ZONE});
 assert.equal(result.ok,true);assert.equal(companyName(state),'Mi comercio');
 assert.equal(state.config.workspacePresentation.company.tradeName,'Mi comercio');
 assert.equal(state.config.workspacePresentation.marketplaces.Sears.color,'#aabbcc');assert.equal(state.config.workspacePresentation.marketplaces.Sears.logoUrl,PNG);
 assert.equal(state.config.workspacePresentation.timeZone,TIME_ZONE);assert.equal(state.config.workspacePresentation.updatedAt,context.now);assert.equal(state.config.workspacePresentation.updatedBy,context.actor);
 assert.deepEqual(state.config.purchaseFiscal,before.config.purchaseFiscal);assert.deepEqual(state.orders,before.orders);assert.deepEqual(state.products,before.products);
 assert.equal(state.events[0].type,'config.workspacePresentation.save');
 const reloaded=JSON.parse(JSON.stringify(state));assert.equal(companyName(reloaded),'Mi comercio');assert.equal(reloaded.config.workspacePresentation.marketplaces.Sears.logoUrl,PNG);
});
test('welcome company name prefers trade/commercial name, explicit legal name, then active default fiscal company; never invents one',()=>{
 const state=fixture();assert.equal(companyName(state),'EMPRESA EXISTENTE SA');
 save(state,{company:{legalName:'Razón configurada'}});assert.equal(companyName(state),'Razón configurada');
 save(state,{company:{tradeName:'Comercio'}});assert.equal(companyName(state),'Comercio');
 save(state,{company:{commercialName:'',legalName:''}});assert.equal(companyName(state),'EMPRESA EXISTENTE SA');
 state.config.purchaseFiscal.profiles[0].active=false;assert.equal(companyName(state),'');assert.equal(companyName({}),'');
 state.config.purchaseFiscal.profiles[0].active=true;state.config.purchaseFiscal.defaultProfileId='missing';assert.equal(companyName(state),'');
});
test('invalid requests are atomic and cannot rename, delete, create or reassign marketplaces',()=>{
 const state=fixture();save(state,{marketplaces:{Sears:{color:'#123456',logoUrl:PNG}}});
 for(const payload of [
  {company:{commercialName:'Valid'},marketplaces:{Sears:{color:'#ffffff'},Inventado:{color:'#000000'}}},
  {marketplaces:{Sears:{name:'Otra tienda'}}},{marketplaces:{Sears:null}},
  {marketplaces:[]},{marketplaces:{Sears:{color:'red;display:none'}}},
  {company:{legalName:'x'.repeat(201)}},{company:{tradeName:'Name\nInjected'}},
  {company:{tradeName:'A',commercialName:'B'}},{company:{rfc:'NEW'}},
  {timeZone:'UTC'},{orders:[]},JSON.parse('{"marketplaces":{"__proto__":{"color":"#000000"}}}')
 ]){const before=JSON.stringify(state);assert.throws(()=>save(state,payload));assert.equal(JSON.stringify(state),before);}
});
test('partial updates retain other markets and company fields; empty values restore builtin presentation',()=>{
 const state=fixture();save(state,{company:{commercialName:'Comercio',legalName:'Razón'},marketplaces:{Sears:{color:'#123456',logoUrl:PNG},Coppel:{logoUrl:'https://cdn.example.test/coppel.png'}}});
 save(state,{marketplaces:{Sears:{color:'',logoUrl:''}}});
 assert.equal(companyName(state),'Comercio');assert.equal(state.config.workspacePresentation.company.legalName,'Razón');
 assert.equal(state.config.workspacePresentation.marketplaces.Coppel.logoUrl,'https://cdn.example.test/coppel.png');assert.equal(state.config.workspacePresentation.marketplaces.Sears.logoUrl,'');
});
test('existing market list comes from the operation and configured commissions, never from presentation settings',()=>{
 const state=fixture();state.orders.push({market:'Canal existente'});state.config.workspacePresentation={marketplaces:{Inventado:{}}};
 assert.ok(existingMarkets(state).includes('Canal existente'));assert.ok(existingMarkets(state).includes('T1 Comercios'));assert.ok(!existingMarkets(state).includes('Inventado'));
 save(state,{marketplaces:{'Canal existente':{color:'#123456'}}});
});
const invalidUrls=['javascript:alert(1)','http://example.test/a.png','//evil.test/a.png','https://user:secret@example.test/a.png','data:image/svg+xml;base64,PHN2Zy8+','data:text/html;base64,PHNjcmlwdD4=','data:image/png;base64,SGVsbG8=','data:image/jpeg;base64,'+PNG.split(',')[1],'/erp/../secret','/erp/%2e%2e/secret','/erp/\\evil','/api/private/logo','https://example.test/white space.png','https://example.test/\nlogo.png'];
test('logo validation accepts bounded PNG data, HTTPS and restricted local routes; rejects scripts, credentials and spoofed content',()=>{
 for(const value of [PNG,'https://cdn.example.test/a.png?x=1&y=2','/erp/assets/marketplaces/sears.png','/api/documents/'+'a'.repeat(64)+'?workspace=v43',''])assert.equal(validateLogoUrl(value),value);
 for(const value of invalidUrls)assert.throws(()=>validateLogoUrl(value),value);
 assert.throws(()=>validateLogoUrl('data:image/png;base64,'+Buffer.alloc(MAX_LOGO_BYTES+1).toString('base64')));
});
test('presentation changes use actual settings permission and action route checks it before mutation',()=>{
 const type='config.workspacePresentation.save';assert.equal(permissionFor(type),'settings');
 for(const access of [{active:true,permissions:[]},{active:true,permissions:['sales','inventory','finance','pricing']},{active:false,permissions:['settings']}])assert.throws(()=>assertPermission(access,type));
 assert.doesNotThrow(()=>assertPermission({active:true,permissions:['settings']},type));
 const route=source('app/api/action/route.ts');assert.ok(route.indexOf('assertPermission(access,command.type)')<route.indexOf('applyCommand(next,command'));
});
test('browser helpers match server names, load safely before ready, and expose visible central settings',()=>{
 const state=fixture(),{scope}=browser(state);assert.equal(scope.window.ERP.ready,false);
 assert.equal(scope.window.WorkspacePresentation.companyName(state),companyName(state));
 assert.match(scope.renderers.configuration(),/Abrir identidad y marketplaces/);assert.match(scope.renderers.configuration(),/Reglas anteriores/);
 scope.window.WorkspacePresentation.openSettings();assert.equal(scope.navigated,'configuration');
 const html=scope.renderers.configuration();assert.match(html,/id="workspace-presentation-form"/);assert.match(html,/128 KB/);assert.match(html,/type="file"/);assert.match(html,/EMPRESA EXISTENTE SA/);assert.match(html,/America\/Mexico_City/);assert.match(html,/data-erp-clock/);
 save(state,{company:{commercialName:'Comercio'}});assert.equal(scope.window.WorkspacePresentation.companyName(state),'Comercio');
});
test('readers can inspect presentation but all settings controls render disabled',()=>{
 const {scope}=browser();scope.window.ERP.access={active:true,permissions:[]};scope.window.WorkspacePresentation.open();
 const html=scope.renderers.configuration();assert.match(html,/permiso de configuración/);assert.match(html,/<fieldset disabled>/);assert.match(html,/<button class="btn primary" type="submit" disabled>/);
});
test('central get/logo/tag and legacy color map follow replaced server state; invalid overrides fall back',()=>{
 const {scope}=browser(),ui=scope.window.MarketUI,original=ui.get('Sears');
 const state=fixture();save(state,{marketplaces:{Sears:{color:'#123456',logoUrl:PNG}}});scope.state=JSON.parse(JSON.stringify(state));
 assert.equal(ui.get('Sears').color,'#123456');assert.equal(scope.marketColors.Sears,'#123456');assert.equal(ui.get('Sears').logoUrl,PNG);
 assert.match(ui.logo('Sears'),/data:image\/png;base64/);assert.match(ui.tag('Sears'),/#123456/);assert.match(ui.logo('Sears'),/data-market-fallback="\/erp\/assets\/marketplaces\/sears.png"/);
 scope.state.config.workspacePresentation.marketplaces.Sears={color:'red; bad',logoUrl:'javascript:evil()'};
 assert.equal(ui.get('Sears').color,original.color);assert.equal(ui.get('Sears').logoUrl,'');assert.match(ui.logo('Sears'),/src="\/erp\/assets\/marketplaces\/sears.png"/);
 assert.equal(ui.get('Tiendanube').key,ui.get('Tienda Nube').key);assert.equal(ui.get('Unknown').key,'other');assert.equal(ui.get('__proto__').key,'other');
});
test('browser and server enforce the same logo URL restrictions',()=>{
 const {scope}=browser();for(const url of invalidUrls)assert.equal(scope.window.MarketUI.safeLogoUrl(url),'',url);
 assert.equal(scope.window.MarketUI.safeLogoUrl(PNG),PNG);
 assert.match(scope.window.MarketUI.logo('Sears','invalid'),/market-logo-sm/);
});
test('failed custom images retry the builtin once then expose initials',()=>{
 const {scope,listeners}=browser(),img=new scope.HTMLImageElement();let fallback='/erp/assets/marketplaces/sears.png';
 Object.assign(img,{hasAttribute:key=>key==='data-market-image',getAttribute:()=>fallback,removeAttribute:()=>{fallback='';},nextElementSibling:{hidden:true}});
 listeners.error[0]({target:img});assert.equal(img.src,'/erp/assets/marketplaces/sears.png');assert.equal(img.nextElementSibling.hidden,true);
 listeners.error[0]({target:img});assert.equal(img.hidden,true);assert.equal(img.nextElementSibling.hidden,false);
});
