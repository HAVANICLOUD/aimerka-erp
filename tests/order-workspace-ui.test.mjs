import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as classifier from '../lib/order-workspace.mjs';
import {newestSales,financialState} from '../lib/payment-reconciliation.mjs';
const source=fs.readFileSync(new URL('../public/erp/order-workspace-ui.js',import.meta.url),'utf8');
const commerce=fs.readFileSync(new URL('../public/erp/commerce-v28.js',import.meta.url),'utf8');
const settlement=fs.readFileSync(new URL('../public/erp/settlement-v43.js',import.meta.url),'utf8');
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const order=(id,status='reserved',extra={})=>({id,number:id,market:'Sears',documentDate:'2026-10-29',date:'2026-10-29T12:00:00',status,stockMode:'operational',commercialStatus:'Activa',paymentStatus:'unknown',returnStatus:'none',items:[{name:'Producto',sku:'SKU',upc:'0123',qty:1}],totalCents:1000,...extra});
async function harness(orders=[],calendar=[],existingIssues=[]) {
 const events={};
 const context=vm.createContext({URL,console,esc,window:{},document:{currentScript:{src:new URL('../public/erp/order-workspace-ui.js',import.meta.url).href},addEventListener:(name,fn)=>{events[name]=fn;}},
 state:{orders,products:[],catalogs:{suppliers:['Proveedor real']},config:{}},statusFilter:'',marketFilter:'',orderQuery:'',c28:{orderFrom:'',orderTo:'',orderPage:1},markets:['Sears'],view:'orders',render:()=>{},renderers:{},
 ERP:{ready:true,today:()=> '2026-10-29',engines:{payments:{newestSales,financialState},operations:{buildCalendar:()=>calendar}},field:(id,label,v)=>`<label>${label}<input id="${id}" value="${esc(v)}"></label>`},
 issues:()=>existingIssues,filteredOrders:()=>orders,c28OrdersPage:()=>'',c28Incidents:()=>'',orderDetails:()=> 'existing drawer: roles, pricing, payment and history',
 c28Rows:o=>o.items||[],c28Commercial:o=>o.commercialStatus==='Cancelada'||o.status==='cancelled'?'Cancelada':'Activa',product:()=>null,
 c28Date:v=>v||'—',c28Payment:()=> 'Pago conciliado con banco',money:v=>`$${v/100}`,D:{orderTotal:o=>o.totalCents},
 icon:key=>`<svg data-icon="${key}"></svg>`,badge:(text,tone)=>`<span class="badge ${tone}">${esc(text)}</span>`,marketTag:m=>esc(m),
 MarketUI:{logo:m=>`<img data-market="${esc(m)}">`,chips:()=>''},pageHead:(a,b,c,d)=>`<header>${a} ${b} ${c} ${d}</header>`,primaryNew:()=>'<button data-existing-create>Crear</button>',datasetNote:()=> 'Datos actuales'});
 context.window.PaymentAlerts28={issueTarget:i=>i.payment?`data-op28="detail" data-kind="purchase" data-id="${esc(i.payment.entityId)}"`:i.type==='settlement'?`data-c28-recon="${esc(i.order.id)}"`:i.order?`data-order="${esc(i.order.id)}"`:`data-product="${esc(i.product.sku)}"`};
 // Run the real existing filter and settlement ordering wrapper as integration dependencies.
 vm.runInContext(commerce.split('\n').find(line=>line.startsWith('filteredOrders=function')),context);
 vm.runInContext(settlement.slice(settlement.indexOf('const paymentsPriorFilteredOrders=filteredOrders;')).split('\n').slice(0,2).join('\n'),context);
 const drawer=context.orderDetails;
 new vm.Script(source,{filename:'order-workspace-ui.js'}).runInContext(context);
 context.window.OrderWorkspace.install(classifier);
 await context.window.OrderWorkspace.ready;
 assert.equal(context.orderDetails,drawer);
 return {context,api:context.window.OrderWorkspace,events};
}

test('uses real legacy search/date/market filters and real settlement order; restores filter and does not change data',async()=>{
 const orders=[order('U1','historical',{number:'123',stockMode:'historical',documentDate:'2026-10-01'}),order('U2','reserved',{number:'124',documentDate:'2026-10-30'}),order('U3','delivered',{number:'125',market:'Coppel',documentDate:'2026-10-20'}),order('U4','shipped',{number:'126',documentDate:'2026-10-30'})];
 const before=JSON.stringify(orders),{context:c}=await harness(orders);
 assert.deepEqual(Array.from(c.filteredOrders(),o=>o.id),newestSales(orders).map(o=>o.id));
 c.c28.orderFrom='2026-10-20';c.c28.orderTo='2026-10-30';c.marketFilter='Sears';c.orderQuery='0123';
 assert.deepEqual(Array.from(c.filteredOrders(),o=>o.id),['U4','U2']);
 c.statusFilter='reserved';assert.deepEqual(Array.from(c.filteredOrders(),o=>o.id),['U2']);assert.equal(c.statusFilter,'reserved');
 c.statusFilter='shipped';assert.deepEqual(Array.from(c.filteredOrders(),o=>o.id),['U4']);
 c.statusFilter='';c.orderQuery='missing';assert.equal(c.filteredOrders().length,0);
 assert.equal(JSON.stringify(orders),before);
});

test('page contains six vector categories, visible provisional note, historical badges and existing actions',async()=>{
 const {context:c,events}=await harness([order('U1','historical',{number:'123',stockMode:'historical'}),order('U2','reserved',{number:''})]);
 const html=c.renderers.orders();assert.match(html,/data-ow-category="shipped"/);assert.match(html,/Devoluciones y reembolsos/);
 assert.doesNotMatch(html,/Histórico V28/);assert.match(html,/Histórico · sin consulta en vivo/);assert.match(html,/estados actuales de VentiApp no se han podido verificar/);
 assert.match(html,/Pedido 123/);assert.match(html,/Pedido sin número registrado/);assert.match(html,/Pago conciliado con banco/);assert.match(html,/data-existing-create/);assert.match(html,/data-v28="orders-export"/);
 c.c28.orderPage=2;events.click({target:{closest:()=>({dataset:{owCategory:'reserved'}})}});assert.equal(c.statusFilter,'reserved');assert.equal(c.c28.orderPage,1);
 assert.equal(c.filteredOrders().length,1);
});

test('incident identities use distinct exact vector keys, real marketplace logo and honest references',async()=>{
 const {api,context:c}=await harness();
 for(const [issue,key] of [[{type:'expense-payment',payment:{kind:'expense'}},'expense'],[{type:'supplier-payment',payment:{kind:'purchase'}},'supplierPayment'],[{type:'settlement',order:order('U123')},'salesSettlement']]) assert.match(api.issueIdentity(issue),new RegExp(`data-icon="${key}"`));
 assert.match(api.issueIdentity({type:'order',order:order('U123')}),/data-market="Sears"/);
 assert.equal(api.issueReference({order:order('U123','historical',{number:'123'})}),'Pedido 123');
 assert.equal(api.issueReference({order:order('U123','historical',{number:''})}),'Pedido sin número registrado');
 assert.equal(api.describeIssue({type:'supplier-payment',payment:{description:'Proveedor real'}}).label,'Proveedor');
 assert.equal(api.issueReference({type:'supplier-payment',payment:{entityId:'C1',description:'Proveedor real'}}),'Compra C1 · Proveedor real');
 assert.equal(api.issueReference({type:'expense-payment',payment:{kind:'expense',entityId:'G1',description:'Renta'}}),'Gasto G1 · Renta');
 assert.equal(api.issueReference({type:'stock',product:{sku:'SKU',name:'Producto'}}),'SKU · Producto');
 c.state.catalogs.suppliers=[{name:'Proveedor real',logoUrl:'https://example.com/logo.png'}];
 assert.match(api.issueIdentity({type:'supplier-payment',payment:{description:'Proveedor real'}}),/src="https:\/\/example.com\/logo.png"/);
 c.state.catalogs.suppliers=[{name:'Proveedor real',logoUrl:'javascript:alert(1)'}];
 assert.match(api.issueIdentity({type:'supplier-payment',payment:{description:'Proveedor real'}}),/data-icon="supplierPayment"/);
});

test('incidents retain actionable purchase, settlement, order, stock targets and include only real expense debt',async()=>{
 const o=order('U-internal','cancelled',{number:'123',paymentStatus:'refunded',returnStatus:'requested',incident:'Caja dañada',followupStatus:'En seguimiento'});
 const list=[{type:'supplier-payment',payment:{kind:'purchase',entityId:'C1',description:'Proveedor',number:1,term:1,balanceCents:100,dueDate:'2026-10-29'},title:'Pago',detail:'Compra C1'},
 {type:'settlement',order:o,title:'Diferencia',detail:'123 · $50'}, {type:'order',order:o,title:'Seguimiento',detail:'123 · Sears'}, {type:'stock',product:{sku:'SKU',name:'Producto'},title:'Stock'}];
 const calendar=[{kind:'expense',entityId:'G1',number:1,term:1,balanceCents:200,dueDate:'2026-10-30',description:'Renta'}, {kind:'purchase',entityId:'C2',number:1,balanceCents:300,dueDate:'2026-10-30'}, {kind:'expense',entityId:'G-paid',balanceCents:0,dueDate:'2026-10-30'}];
 const {context:c}=await harness([o],calendar,list);const before=JSON.stringify(c.state);const html=c.renderers.incidents();
 assert.match(html,/<th scope="col">Origen<\/th><th scope="col">Asunto/);
 for(const target of ['data-kind="purchase"','data-kind="expense"','data-c28-recon="U-internal"','data-order="U-internal"','data-product="SKU"']) assert.ok(html.includes(target),target);
 assert.match(html,/Pedido 123/);assert.doesNotMatch(html,/>U-internal</);assert.match(html,/Reembolsada/);assert.match(html,/Pendiente de recibir/);assert.match(html,/En seguimiento/);assert.match(html,/Caja dañada/);assert.match(html,/\$50/);
 assert.equal(c.issues().length,5);assert.equal(JSON.stringify(c.state),before);
});

test('install is idempotent, safe before ERP readiness and retains category on dependency failure',async()=>{
 const {context:c,api}=await harness([order('1')]);const filter=c.filteredOrders;api.install({});assert.equal(c.filteredOrders,filter);
 c.ERP.ready=false;assert.deepEqual(Array.from(c.issues()),[]);
 c.statusFilter='reserved';c.orderQuery=null;assert.throws(()=>c.filteredOrders());assert.equal(c.statusFilter,'reserved');
});
