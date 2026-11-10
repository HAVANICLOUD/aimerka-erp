import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as dashboardSummary from '../lib/dashboard-summary.mjs';
import * as operations from '../lib/operations-v28.mjs';
const source=readFileSync(new URL('../public/erp/commerce-v28.js',import.meta.url),'utf8');
const dashboard=source.slice(source.indexOf('function c28Dashboard(){'),source.indexOf('\norderRows='));
function setup(){
 const listeners={},esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 const issues=[{title:'Pedido',detail:'Revisar',order:{id:'o',market:'Sears'}},{type:'stock',title:'Inventario',product:{sku:'p'}},{type:'stock',title:'Oculto',product:{sku:'h',lifecycle:{hidden:true}}},{type:'stock',title:'Descontinuado',product:{sku:'d',lifecycle:{discontinued:true}}},{type:'supplier-payment',title:'Pago',payment:{entityId:'c'}}];
 const sandbox={c28:{},ERP:{today:()=> '2026-11-10',engines:{dashboardSummary,operations:{...operations,buildCalendar:()=>[]}}},state:{orders:[],products:[]},window:{WorkspacePresentation:{companyName:()=>'<Empresa>'},ERPDate:{date:d=>d.split('-').reverse().join('/')}},document:{addEventListener:(type,fn)=>listeners[type]=fn},render:()=>sandbox.renderCount++,renderCount:0,issues:()=>issues,esc,
 pageHead:(e,t,s,a)=>`<header>${t}${a}</header>`,primaryNew:()=>'',icon:name=>`<svg data-icon="${name}"></svg>`,badge:n=>`<b>${n}</b>`,money:n=>(n/100).toFixed(2),metric:(l,v,n)=>`<article>${l} ${v} ${n}</article>`,totals:()=>({reserved:0,available:0}),datasetNote:()=>'',orderTable:()=>'<table>recent</table>',markets:['Sears'],D:{available:()=>0},MarketUI:{logo:m=>`<img alt="${m}">`,overview:()=>'<aside>overview</aside>'},PaymentAlerts28:{panel:()=>'<section>TESORERIA</section>',issueTarget:i=>i.order?'data-order="o"':i.payment?'data-op28="detail"':'data-product="p"'}};
 vm.createContext(sandbox);vm.runInContext(dashboard,sandbox);
 return {sandbox,listeners,html:()=>sandbox.c28Dashboard()};
}
test('priority order, actionable links, marketplace logos and vector payment/stock icons',()=>{
 const {html}=setup(),h=html();
 assert.ok(h.indexOf('Necesitan tu atención')<h.indexOf('TESORERIA'));assert.ok(h.indexOf('TESORERIA')<h.indexOf('VENTAS Y RESULTADOS'));
 assert.match(h,/data-order="o"/);assert.match(h,/data-op28="detail"/);assert.match(h,/data-product="p"/);
 assert.match(h,/<img alt="Sears">/);assert.match(h,/data-icon="wallet"/);assert.match(h,/data-icon="box"/);
 assert.doesNotMatch(h,/Oculto|Descontinuado/);assert.match(h,/3 pendientes accionables/);
});
test('escaped welcome, shared date formatter, clock, current month and native selector',()=>{
 const {html}=setup(),h=html();assert.match(h,/Bienvenido a &lt;Empresa&gt;/);assert.match(h,/data-erp-clock/);assert.match(h,/01\/11\/2026 al 30\/11\/2026/);
 assert.match(h,/type="month"[^>]*value="2026-11"/);assert.match(h,/value="document" selected/);assert.match(h,/Sin ventas ni eventos/);
 assert.ok(h.includes('Pedidos recientes')&&h.includes('overview')&&h.includes('Compras y mercancía'));
});
test('mode, year, basis, anchor and current-month reset handlers update dashboard only',()=>{
 const {sandbox,listeners,html}=setup();html();
 const click=(mode,now=false)=>listeners.click({target:{closest:selector=>selector==='[data-c28-dashboard-mode]'&&!now?{dataset:{c28DashboardMode:mode}}:selector==='[data-c28-dashboard-now]'&&now?{}:null}});
 click('week');assert.equal(sandbox.c28.dashboard.mode,'week');assert.match(html(),/Semana de lunes a domingo/);
 listeners.change({target:{dataset:{c28DashboardField:'anchor'},value:'2026-10-04'}});assert.match(html(),/28\/09\/2026 al 04\/10\/2026/);
 listeners.change({target:{dataset:{c28DashboardField:'year'},value:'2025'}});assert.equal(sandbox.c28.dashboard.anchor,'2025-10-01');
 listeners.change({target:{dataset:{c28DashboardField:'basis'},value:'creation'}});assert.equal(sandbox.c28.dashboard.basis,'creation');
 click(null,true);assert.equal(sandbox.c28.dashboard.anchor,'2026-11-10');assert.equal(sandbox.c28.dashboard.mode,'month');
});
test('three comparable marketplace series and explicit commercial net explanation',()=>{
 const h=setup().html();assert.match(h,/Venta bruta activa/);assert.match(h,/Cancelaciones registradas/);assert.match(h,/Reembolsos registrados/);assert.match(h,/misma escala/);assert.match(h,/no representa depósitos bancarios ni utilidad/);assert.match(h,/cancelaciones ya están excluidas/i);
});
test('attention footer can wrap without a narrow fixed count column',()=>{
 const css=readFileSync(new URL('../public/erp/dashboard-summary.css',import.meta.url),'utf8');
 assert.match(css,/connected-footer>span\{flex:1 1 180px;min-width:0;width:auto/);assert.match(css,/height:auto;min-height:0;overflow:visible;flex-wrap:wrap/);
});
