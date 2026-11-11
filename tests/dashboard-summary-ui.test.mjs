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
 pageHead:(e,t,s,a)=>`<header>${t}${a}</header>`,primaryNew:()=>'',icon:name=>`<svg data-icon="${name}"></svg>`,badge:n=>`<b>${n}</b>`,money:n=>(n/100).toFixed(2),metric:(l,v,n)=>`<article>${l} ${v} ${n}</article>`,totals:()=>({reserved:0,available:0}),datasetNote:()=>'',orderTable:()=>'<table>recent</table>',markets:['Sears'],D:{available:()=>0},MarketUI:{logo:m=>`<img alt="${m}">`,overview:(orders,stats)=>{sandbox.overviewStats=stats;return '<aside>overview</aside>'}},PaymentAlerts28:{panel:()=>'<section>TESORERIA</section>',issueTarget:i=>i.order?'data-order="o"':i.payment?'data-op28="detail"':'data-product="p"'}};
 vm.createContext(sandbox);vm.runInContext(dashboard,sandbox);
 return {sandbox,listeners,html:()=>sandbox.c28Dashboard()};
}
test('priority order, actionable links, marketplace logos and vector payment/stock icons',()=>{
 const {html}=setup(),h=html();
 assert.ok(h.indexOf('Necesitan tu atención')<h.indexOf('TESORERIA'));assert.ok(h.indexOf('TESORERIA')<h.indexOf('VENTAS Y RESULTADOS'));
 assert.match(h,/data-order="o"/);assert.match(h,/data-op28="detail"/);assert.match(h,/data-product="p"/);
 assert.match(h,/<img alt="Sears">/);assert.match(h,/data-icon="supplierPayment"/);assert.match(h,/data-icon="box"/);
 assert.doesNotMatch(h,/Oculto|Descontinuado/);assert.match(h,/3 pendientes accionables/);
});
test('escaped welcome, shared date formatter, clock, current month and Spanish month selector',()=>{
 const {html}=setup(),h=html();assert.match(h,/Bienvenido a &lt;Empresa&gt;/);assert.match(h,/data-erp-clock/);assert.match(h,/01\/11\/2026 al 30\/11\/2026/);
 assert.match(h,/<select data-c28-dashboard-field="month"/);assert.match(h,/<option value="11" selected>Noviembre/);assert.doesNotMatch(h,/type="month"/);assert.match(h,/value="document" selected/);assert.match(h,/Sin ventas ni eventos/);
 assert.ok(h.includes('Pedidos recientes')&&h.includes('overview')&&h.includes('Compras y mercancía'));
});
test('mode, year, basis, anchor and current-month reset handlers update dashboard only',()=>{
 const {sandbox,listeners,html}=setup();html();
 const click=(mode,now=false)=>listeners.click({target:{closest:selector=>selector==='[data-c28-dashboard-mode]'&&!now?{dataset:{c28DashboardMode:mode}}:selector==='[data-c28-dashboard-now]'&&now?{}:null}});
 click('week');assert.equal(sandbox.c28.dashboard.mode,'week');assert.match(html(),/Semana de lunes a domingo/);
 listeners.change({target:{dataset:{c28DashboardField:'anchor'},value:'2026-10-04'}});assert.match(html(),/28\/09\/2026 al 04\/10\/2026/);
 listeners.change({target:{dataset:{c28DashboardField:'year'},value:'2025'}});assert.equal(sandbox.c28.dashboard.anchor,'2025-10-04');
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

test('marketplaces lead results immediately before controls and dashboard queues are removed',()=>{
 const {html,sandbox}=setup(),h=html();
 assert.ok(h.indexOf('VENTAS Y RESULTADOS')<h.indexOf('<aside>overview</aside>'));
 assert.match(h,/<aside>overview<\/aside>\s*<div class="dashboard-period-controls"[^>]*>/);
 assert.doesNotMatch(h,/dashboard-operation-metrics|quick-queues|Pedidos por preparar|Disponible para vender|Ticket promedio activo|Seguimientos pendientes|Devoluciones en proceso|Productos sin disponible/);
 assert.equal(sandbox.overviewStats.period.from,'2026-11-01');
});
test('week options cover the selected year with complete Monday–Sunday ranges',()=>{
 const {html,sandbox,listeners}=setup();
 sandbox.c28.dashboard={mode:'week',anchor:'2027-01-03',basis:'document'};
 let h=html();
 assert.match(h,/<option value="2027-01-01" selected>28\/12\/2026 al 03\/01\/2027/);
 assert.match(h,/<option value="2027-12-27" >27\/12\/2027 al 02\/01\/2028/);
 const options=[...h.matchAll(/<option value="(\d{4}-\d{2}-\d{2})"[^>]*>([^<]+)/g)];
 assert.equal(options.length,53);
 for(let i=0;i<options.length;i++){
   const period=dashboardSummary.dashboardPeriod('week',options[i][1]);
   assert.equal(new Date(period.from+'T12:00:00Z').getUTCDay(),1);
   assert.equal(new Date(period.to+'T12:00:00Z').getUTCDay(),0);
   assert.ok(options[i][1].startsWith('2027-'));
   if(i)assert.equal(options[i][1],dashboardSummary.dashboardPeriod('week',options[i-1][1]).endExclusive);
 }
 listeners.change({target:{dataset:{c28DashboardField:'week'},value:'2027-12-27'}});
 assert.match(html(),/<option value="2027" selected>/);
 sandbox.c28.dashboard.anchor='2028-02-29';
 assert.match(html(),/28\/02\/2028 al 05\/03\/2028/);
 listeners.change({target:{dataset:{c28DashboardField:'year'},value:'2027'}});
 assert.equal(sandbox.c28.dashboard.anchor,'2027-02-28');
});
test('all modes retain year; month changes use that year and day remains a Latin native date',()=>{
 const {html,sandbox,listeners}=setup();html();
 for(const mode of ['year','month','week','day']){
   sandbox.c28.dashboard.mode=mode;assert.match(html(),/<select data-c28-dashboard-field="year"/);
 }
 assert.match(html(),/type="date" lang="es-MX"/);
 sandbox.c28.dashboard={mode:'month',anchor:'2028-01-31',basis:'document'};
 listeners.change({target:{dataset:{c28DashboardField:'month'},value:'02'}});
 assert.equal(sandbox.c28.dashboard.anchor,'2028-02-01');
 assert.match(html(),/01\/02\/2028 al 29\/02\/2028/);
 const monthSelect=html().match(/<select data-c28-dashboard-field="month"[^>]*>(.*?)<\/select>/)[1];
 assert.equal([...monthSelect.matchAll(/<option/g)].length,12);
});
test('overview supports selected statistics while preserving the historical caller',()=>{
 const branding=readFileSync(new URL('../public/erp/market-branding.js',import.meta.url),'utf8');
 const overview=branding.slice(branding.indexOf('  function overview('),branding.indexOf('\n  return {get,logo'));
 const sandbox={markets:['Sears','Liverpool'],esc:String,icon:()=>'',get:()=>({color:'#000000',tint:'#ffffff'}),logo:()=>'',money:n=>(n/100).toFixed(2)};
 vm.createContext(sandbox);vm.runInContext(overview,sandbox);
 const orders=[{market:'Sears'},{market:'Sears'}],stats={markets:[{market:'Sears',activeGrossCents:12345,activeCount:1}]};
 const old=sandbox.overview(orders),selected=sandbox.overview(orders,stats);
 assert.match(old,/2<small>pedidos/);assert.doesNotMatch(old,/venta activa|pedidos activos/);
 assert.match(selected,/123.45<small>MXN · venta activa/);assert.match(selected,/1 pedido activo/);
 assert.match(selected,/0.00<small>MXN · venta activa/);assert.match(selected,/0 pedidos activos/);
});
