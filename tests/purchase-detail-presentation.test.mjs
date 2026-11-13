import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const code=fs.readFileSync(new URL('../public/erp/purchase-workspace-ui.js',import.meta.url),'utf8');
function setup(){const state={products:[],purchases:[]},context={state,ERP:{},window:{},document:{addEventListener(){}},renderers:{},op28Detail(){},op28RenderPurchaseForm(){},esc:v=>String(v??''),icon:()=>'<svg></svg>',op28date:v=>String(v).slice(0,10),op28ReceiptHistory:()=>'<section>Physical receipts</section>'};vm.runInNewContext(code+'\nglobalThis.api={buyLineReceipts,buyReceiptsDetail};',context);return {api:context.api,state};}
test('each article shows only its own partial receipt dates without mutating purchase history',()=>{
 const {api}=setup(),r={purchase:{},receipts:[{date:'2026-11-01',items:[{lineId:'A',sku:'SAME',qty:1}]},{date:'2026-11-04',items:[{lineId:'B',sku:'SAME',qty:2}]},{date:'2026-11-07',items:[{lineId:'A',sku:'SAME',qty:3}]}]},before=JSON.stringify(r);
 const html=api.buyLineReceipts(r,{id:'A',sku:'SAME'});assert.match(html,/2026-11-01/);assert.match(html,/2026-11-07/);assert.doesNotMatch(html,/2026-11-04/);assert.equal(JSON.stringify(r),before);
});
test('historical receipt uses SICAR registration date, never fakes a receipt for a cancelled purchase, and keeps provenance accessible',()=>{
 const {api}=setup(),r={purchase:{sicarHistory:{creationDate:'2026-10-21T12:00:00',documentDate:'2026-10-19',cancelled:false}},receipts:[],received:2},line={receivedQty:2};
 assert.match(api.buyLineReceipts(r,line),/2026-10-21/);r.purchase.sicarHistory.cancelled=true;assert.doesNotMatch(api.buyLineReceipts(r,line),/2026-10-21/);
});
