import test from 'node:test';import assert from 'node:assert/strict';
import {rotationSettings,rotationPolicy,rotationReport,saveRotationPolicy} from '../lib/stock-rotation.mjs';
const base=()=>({products:[{sku:'A',name:'Producto',good:3,reserved:1,safety:0,costCents:10000,priceCents:20000}],purchases:[{documentDate:'2026-01-01',items:[{sku:'A',qty:3}]}],orders:[{documentDate:'2026-10-24',status:'delivered',items:[{sku:'A',qty:1}]}],config:{},commercialEventRuns:[{id:'preserved',targets:[{sku:'A',regularCents:20000}]}]});
const report=s=>rotationReport(s,{asOf:'2026-11-14'})[0];
function save(s,policy,id='save',expectedRevision=rotationSettings(s).revision){return saveRotationPolicy(s,{id,type:'config.rotation.save',payload:{policy,expectedRevision}},{actor:'QA',now:'2026-11-14T12:00:00Z'});}
test('initial catalogue exactly preserves six monthly thresholds names colors and existing flags',()=>{
 const s=base(),before=structuredClone(s),p=rotationSettings(s);assert.equal(p.unit,'months');assert.deepEqual(p.levels.map(r=>r.threshold),[1,2,3,4,5,6]);assert.deepEqual(p.levels.map(r=>r.color),['#2563eb','#087f8c','#a46b00','#c25b12','#c24162','#b42318']);assert.equal(p.showFlagsInEvents,true);assert.equal(p.showFlagsInLiquidations,true);assert.equal(p.purchaseReference,'first');assert.equal(p.unknownHistory,'use_last_sale');assert.deepEqual(s,before);
 s.config.stockRotation={months:[2,4,6,8,10,12]};assert.deepEqual(rotationPolicy(s).map(r=>r.threshold),[2,4,6,8,10,12]);
});
test('daily and weekly time units actually change classification at complete boundaries',()=>{
 const s=base(),p=rotationSettings(s);assert.equal(report(s).level,0);p.unit='weeks';p.levels.forEach((r,i)=>r.threshold=i+1);save(s,p);assert.equal(report(s).elapsed,3);assert.equal(report(s).level,3);assert.equal(report(s).unitLabel,'semanas');
 const d=rotationSettings(s);d.unit='days';d.levels.forEach((r,i)=>r.threshold=(i+1)*5);save(s,d,'days');assert.equal(report(s).elapsed,21);assert.equal(report(s).level,4);assert.equal(report(s).unitLabel,'días');
});
test('labels colors active levels and critical review propagate without changing recorded inventory or price snapshots',()=>{
 const s=base();s.orders=[];const p=rotationSettings(s),products=structuredClone(s.products),runs=structuredClone(s.commercialEventRuns);p.levels[5].color='#aabbcc';p.levels[5].label='Revisar urgencia';p.levels[5].critical=false;save(s,p);assert.equal(report(s).color,'#aabbcc');assert.equal(report(s).label,'Revisar urgencia');assert.equal(report(s).critical,false);p.levels[5].active=false;save(s,p,'disable');assert.equal(report(s).level,5);assert.deepEqual(s.products,products);assert.deepEqual(s.commercialEventRuns,runs);assert.equal(s.events.length,2);assert.equal(s.events[0].before.levels[5].active,true);
});
test('purchase reference incomplete history sale states returns and stock basis obey the catalogue',()=>{
 const s=base();s.purchases.push({documentDate:'2026-11-12',items:[{sku:'A',qty:1}]});s.orders=[];assert.equal(report(s).level,6);let p=rotationSettings(s);p.purchaseReference='latest';save(s,p);assert.equal(report(s).level,0);assert.equal(report(s).anchorDate,'2026-11-12');
 s.purchases=[];s.orders=[{documentDate:'2026-05-01',status:'delivered',items:[{sku:'A',qty:1}]}];assert.equal(report(s).level,6);p=rotationSettings(s);p.unknownHistory='require_purchase';save(s,p,'strict');assert.equal(report(s).status,'unknown');p.unknownHistory='use_last_sale';p.saleStatuses=['shipped'];save(s,p,'states');assert.equal(report(s).lastSale,null);
 s.orders[0].status='shipped';s.orders[0].paymentStatus='refunded';assert.equal(report(s).lastSale,null);p.excludeRefunded=false;save(s,p,'refund');assert.equal(report(s).lastSale,'2026-05-01');s.products[0].reserved=3;p.stockBasis='available';save(s,p,'stock');assert.equal(report(s).status,'no_stock');assert.equal(report(s).level,0);
});
test('pausing classification preserves evidence history and config while suppressing flags',()=>{
 const s=base();s.orders=[];const p=rotationSettings(s);p.enabled=false;p.levels.forEach(r=>r.active=false);save(s,p);assert.equal(report(s).level,0);assert.equal(report(s).firstPurchase,'2026-01-01');assert.equal(rotationSettings(s).levels.length,6);
});
test('malformed or stale changes never mutate the catalogue; legacy month edits preserve colors and visibility',()=>{
 const s=base(),p=rotationSettings(s);p.showFlagsInEvents=false;p.levels[0].color='#abcdef';save(s,p);let before=structuredClone(s);assert.throws(()=>save(s,p,'stale',0),/otra sesión/);assert.deepEqual(s,before);
 for(const change of [p=>p.levels[0].color='red; background:url(x)',p=>p.levels[0].threshold=0,p=>p.levels[3].threshold=1,p=>p.unit='years',p=>p.levels[0].label='',p=>p.showFlagsInEvents='false',p=>p.saleStatuses=['reserved'],p=>p.levels.forEach(r=>r.active=false)]){const bad=rotationSettings(s);change(bad);before=structuredClone(s);assert.throws(()=>save(s,bad));assert.deepEqual(s,before);}
 saveRotationPolicy(s,{id:'legacy',type:'config.rotation.save',payload:{months:[2,4,6,8,10,12]}});assert.equal(rotationSettings(s).showFlagsInEvents,false);assert.equal(rotationSettings(s).levels[0].color,'#abcdef');assert.deepEqual(rotationPolicy(s).map(r=>r.threshold),[2,4,6,8,10,12]);
});
