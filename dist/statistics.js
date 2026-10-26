/* An operational view inspired by V25 ESCRITORIO, using the fictional demo only. */
let statsStart='2026-10-01',statsEnd='2026-10-31',statsMarket='';
function statisticsPage(){
  const localDate=o=>new Date(o.date).toLocaleDateString('en-CA',{timeZone:'America/Mexico_City'});
  const selected=state.orders.filter(o=>(!statsMarket||o.market===statsMarket)&&localDate(o)>=statsStart&&localDate(o)<=statsEnd);
  const valid=selected.filter(o=>o.status!=='cancelled');
  const sales=valid.reduce((s,o)=>s+D.orderTotal(o),0);
  const cancelled=selected.filter(o=>o.status==='cancelled');
  const refunded=selected.filter(o=>o.paymentStatus==='refunded');
  const rows=markets.filter(m=>!statsMarket||statsMarket===m).map(m=>{const all=selected.filter(o=>o.market===m),v=all.filter(o=>o.status!=='cancelled');return {market:m,count:v.length,units:v.reduce((s,o)=>s+o.qty,0),sales:v.reduce((s,o)=>s+D.orderTotal(o),0),cancelled:all.filter(o=>o.status==='cancelled').length,refunded:all.filter(o=>o.paymentStatus==='refunded').length};});
  return `${pageHead('RESULTADOS / ESTADÍSTICAS','Entender el periodo completo.','Una vista inspirada en las estadísticas de V25, con pedidos ficticios de este laboratorio.',`<button class="btn" data-view="project">${icon('layers')} Ver alcance de V25</button>`)}<div class="filterbar"><div class="field"><label for="stats-start">Desde</label><input id="stats-start" type="date" value="${esc(statsStart)}"></div><div class="field"><label for="stats-end">Hasta</label><input id="stats-end" type="date" value="${esc(statsEnd)}"></div><div class="field"><label for="stats-market">Marketplace</label><select id="stats-market"><option value="">Todos los canales</option>${markets.map(m=>`<option ${m===statsMarket?'selected':''}>${esc(m)}</option>`).join('')}</select></div><span class="tiny" style="align-self:end;padding-bottom:9px">Fecha del pedido · Zona de Ciudad de México</span></div><div class="metrics">${metric('Venta bruta vigente',whole(sales),'Excluye pedidos cancelados','arrowup','MXN')}${metric('Órdenes vigentes',valid.length,'Pedidos no cancelados del periodo','bag')}${metric('Ticket promedio',valid.length?whole(sales/valid.length):'—','Venta bruta vigente / órdenes vigentes','calculator','MXN')}${metric('Canceladas',cancelled.length,'Operaciones canceladas del periodo','alert')}</div><div class="intro-strip">${icon('info')}<span>Venta vigente y reembolso son dimensiones separadas. ${refunded.length} pedidos del periodo tienen reembolso; la venta bruta mostrada no es ingreso neto ni utilidad.</span></div><section class="panel"><div class="panel-head"><div><h2>Resultados por marketplace</h2><div class="panel-sub">El rango y el canal actualizan todos los indicadores.</div></div><span class="tiny">${selected.length} pedidos en el filtro</span></div><div class="table-wrap"><table><thead><tr><th>Marketplace</th><th>Órdenes vigentes</th><th>Unidades vigentes</th><th>Venta bruta vigente</th><th>Canceladas</th><th>Con reembolso</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${marketTag(r.market)}</td><td>${r.count}</td><td>${r.units}</td><td class="table-price">${money(r.sales)}</td><td>${r.cancelled}</td><td>${r.refunded}</td></tr>`).join('')}</tbody></table></div></section><div class="note-panel"><strong>En el producto comercial:</strong> V25 ya distingue fecha documental y fecha de creación de SICAR. El importador deberá conservar ambas para explicar el cotejo mensual. Esta demostración usa la fecha del pedido ficticio y todavía no importa ese histórico.</div>`;
}
renderers.statistics=statisticsPage;
nav.splice(7,0,['statistics','Estadísticas','arrowup']);
document.addEventListener('change',e=>{
  if(e.target.id==='stats-start')statsStart=e.target.value;
  else if(e.target.id==='stats-end')statsEnd=e.target.value;
  else if(e.target.id==='stats-market')statsMarket=e.target.value;
  else return;
  if(!statsStart||!statsEnd||statsStart>statsEnd){toast('Selecciona un rango de fechas válido.',true);return;}
  render();
});

