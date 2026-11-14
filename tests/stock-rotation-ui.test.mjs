import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createContext,runInContext} from 'node:vm';
import * as stockRotation from '../lib/stock-rotation.mjs';
const source=readFileSync(new URL('../public/erp/stock-rotation-ui.js',import.meta.url),'utf8');
function harness(){
 const calls=[],handlers={};const state={products:[{sku:'A',upc:'123',name:'Auriculares <test>',brand:'Marca',good:3,reserved:1,safety:0,costCents:10000,priceCents:20000,imageUrl:'javascript:alert(1)'},{sku:'B',name:'Producto sin fecha',good:1,priceCents:10000,costCents:5000}],purchases:[{date:'2025-01-01',items:[{sku:'A',qty:3}]}]};
 const engine={...stockRotation,mexicoDate:()=> '2026-11-14'};
 const context=createContext({state,window:{ERP:{revision:1,engines:{stockRotation:engine},access:{owner:true},downloadCSV:(name,rows)=>calls.push({export:rows})},CommercialEventsUI:{renderLiquidation:()=>'<p>Editor</p>',startSelection:(...args)=>calls.push({selection:args})}},renderers:{},document:{addEventListener:(name,fn)=>handlers[name]=fn,getElementById:()=>({scrollIntoView(){},close(){}}),querySelector:()=>null},render(){},navigate:route=>calls.push({navigate:route}),showModal:html=>calls.push({modal:html}),setInterval(){},Intl,Date,Number,Set,Map,console});runInContext(source,context);
 const api=context.window.StockRotationUI;const click=(action,extra={})=>handlers.click({target:{closest:selector=>selector==='[data-sr-action]'?{dataset:{srAction:action,...extra}}:null}});
 const change=(dataset,value='',checked=false)=>handlers.change({target:{dataset,value,checked}});
 return {api,click,change,calls,state,context,handlers};
}
test('rotation view has six independent numeric flags, full identities costs quantities and safe images',()=>{
 const h=harness(),html=h.api.render();assert.match(html,/Rotación y liquidaciones/);assert.match(html,/SKU <b>A/);assert.match(html,/UPC 123/);assert.match(html,/Costo promedio/);assert.match(html,/Precio general/);assert.match(html,/Físico vendible/);assert.match(html,/sr-level-6/);assert.equal((html.match(/data-sr-level=/g)||[]).length,6);assert.match(html,/Auriculares &lt;test&gt;/);assert.doesNotMatch(html,/src="javascript:/);
});
test('filters and selection prepare own plan or ordinary campaign without stock writes',async()=>{
 const h=harness(),before=structuredClone(h.state);h.api.render();await h.click('select');await h.click('prepare');assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1).selection)),[['A'],'liquidation',[6],'']);assert.deepEqual(h.state,before);
 await h.click('campaign');assert.equal(h.calls.at(-2).navigate,'commercialEvents');assert.equal(h.calls.at(-1).selection[1],'campaign');
 h.change({srFilter:''},'unknown');assert.match(h.api.render(),/Producto sin fecha/);assert.doesNotMatch(h.api.render(),/SKU <b>A/);
 await h.click('export');assert.equal(h.calls.at(-1).export.length,1);assert.equal(h.calls.at(-1).export[0].sku,'B');
});
test('new sales refresh flags automatically and clear ineligible selection before a new plan',async()=>{
 const h=harness();h.api.render();await h.click('select');h.state.orders=[{documentDate:'2026-11-14',status:'delivered',items:[{sku:'A',qty:1}]}];h.context.window.ERP.revision++;assert.doesNotMatch(h.api.render(),/SKU <b>A/);assert.equal(h.api.flag('A'),'');const count=h.calls.length;await h.click('prepare');assert.equal(h.calls.length,count);
});
