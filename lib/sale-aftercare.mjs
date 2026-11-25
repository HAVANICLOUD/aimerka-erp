import {verifiedOrderStatus,verifiedOrderRefunds} from './marketplace-order-status.mjs?v=20261124-order-reference';
import {operationalSaleHistory} from './sale-identifiers.mjs?v=20261124-sale-editor';
const str=v=>String(v??'').trim(),num=v=>Number.isFinite(Number(v))?Number(v):0;
const matches=(m,o)=>m.orderId===o.id||m.reference===o.id;
export function saleMovementFacts(order,state={}){
 const native=verifiedOrderStatus(order),refund=verifiedOrderRefunds(order),items=order.items||[],qty=items.reduce((n,l)=>n+num(l.qty),0),moves=(state.movements||[]).filter(m=>matches(m,order)),restocks=moves.filter(m=>m.type==='sale.return_restock'&&m.pool==='good'&&m.delta>0),restockedQty=Math.max(items.reduce((n,l)=>n+num(l.restockedQty),0),restocks.reduce((n,m)=>n+m.delta,0));
 return {cancelled:order.status==='cancelled'||order.commercialStatus==='Cancelada'||native?.mappedStatus==='cancelled',refunded:order.paymentStatus==='refunded'||native?.mappedStatus==='refunded'||!!refund?.refunds?.some(r=>num(r.amountCents)===order.totalCents&&r.refundDate),received:['inspection','restocked','rejected'].includes(order.returnStatus)&&(!!order.returnedAt||items.some(l=>l.returnedQty>0)||moves.some(m=>m.type==='sale.return_receive'&&m.delta>0)),restocked:qty>0&&restockedQty>=qty&&order.returnStatus==='restocked',restockedQty,moves,restocks,refund,qty};
}
function savedIdentifiers(order){const ids=new Set(),add=v=>{if(typeof v==='string'||typeof v==='number'){const id=str(v);if(id)ids.add(id);}};
 for(const l of order.items||[]){if(!l.identifierOverride){for(const k of ['serial','serialNumber','serie','imei','imei1','imei2'])add(l[k]);for(const v of [...(l.serials||[]),...(l.imeis||[])])add(v);}}
 for(const u of order.marketplace34?.units||[]){if((order.items||[]).some(l=>u.lineId===l.id||!u.lineId&&u.sku===l.sku&&(order.items||[]).filter(x=>x.sku===u.sku).length===1)){add(u.serial);add(u.imei);}}
 return ids;
}
const key=v=>str(v).replace(/[\s-]/g,'');
export function previewSaleCommentCleanup(order,state={}){
 const before=String(order.comments||''),saved=savedIdentifiers(order),removed=[],facts=saleMovementFacts(order,state);let text=before;
 text=text.replace(/\*{3}\s*([^\s*]+)([^*]*)\*{3}/g,(match,number,tail)=>{if(![order.number,order.literalNumber].some(n=>n&&key(n)===key(number)))return match;let rest=tail.trim(),changed=false,unmatched=false;const tokens=rest.split(/\s+/),kept=[];
  for(let i=0;i<Math.min(2,tokens.length);i++){const token=tokens[i];if(saved.has(token)){removed.push({kind:'identifier',text:token});changed=true;tokens[i]='';}else{if(!/^[A-Za-z0-9][A-Za-z0-9'’-]{5,39}$/.test(token)||!/\d/.test(token))break;unmatched=true;}}
  if(!changed)return match;rest=tokens.filter(Boolean).join(' ');return unmatched?'***'+number+' '+rest+'***':rest;
 });
 text=text.replace(/\b(IMEI(?:\s*[12])?|SERIE|SERIAL(?:\s*NUMBER)?|S\/N|SN)\s*[:#=\-]?\s*([A-Za-z0-9][A-Za-z0-9'’-]{5,39})\b/gi,(match,label,id)=>{if(!saved.has(id))return match;removed.push({kind:'identifier',text:match});return '';});
 // Whole clauses only: mixed or ambiguous pending work is retained without shortening it.
 const pending=/\b(?:pendiente\w*|esperando|falta\w*|reclama\w*|incidencia\w*|por\s+(?:confirmar|revisar|recibir|reintegrar|pagar|resolver)|no\s+(?:se|ha|hay|fue|reintegr\w*)|sin\s+(?:recibir|reintegrar|reembolso|confirmar))\b/i;
 const noteKinds=clause=>{const kinds=[];if(/\bcancel\w*\b/i.test(clause))kinds.push('cancelled');if(/\breembols\w*\b/i.test(clause))kinds.push('refunded');if(/\breintegr\w*\b/i.test(clause))kinds.push('restocked');if(/\b(?:devoluci[oó]n|retorn\w*|regres[oó]\w*)\b/i.test(clause)&&!kinds.includes('restocked'))kinds.push('received');return kinds;};
 const reasons=(facts.refund?.refunds||[]).map(r=>str(r.reason).replace(/[.\s]+$/,'').toLowerCase());
 const lines=text.split('\n').map(line=>line.split(/\s+\|\s+/).filter(clause=>{const kinds=noteKinds(clause);if(!kinds.length&&/^\s*(?:Liverpool\s*[·:]\s*)?Motivo\s*:/i.test(clause)&&reasons.includes(clause.replace(/^\s*(?:Liverpool\s*[·:]\s*)?Motivo\s*:/i,'').trim().replace(/[.\s]+$/,'').toLowerCase()))kinds.push('refunded');const simplePending=/^\s*(?:pendiente(?:\s+de)?|falta(?:\s+el)?)\s+(?:el\s+)?(?:reembolso|reintegr(?:o|ar)(?:\s+(?:a\s+)?inventario)?|cancelaci[oó]n)[.!\s]*$/i.test(clause);if(!kinds.length||pending.test(clause)&&!simplePending||/^\s*(?:Cotejo directo|Fecha del? documento)/i.test(clause)||!kinds.every(k=>facts[k]))return true;removed.push({kind:'movement',kinds,text:clause.trim()});return false;}).join(' | '));
 const after=lines.join('\n').replace(/^[\s:;,|.\-]+$/gm,'').replace(/^[\t ]*[|;]+[\t ]*/gm,'').replace(/\n{3,}/g,'\n\n').trim();return {before,after,removed,changed:after!==before};
}
export function archiveSaleComments(order,before,after,ctx={},reason='Edición manual',removed=[]){if(before===after)return null;const entries=order.commentHistory??=[],entry={id:(ctx.requestId||ctx.now||'comment')+'-'+order.id+'-'+entries.length,at:ctx.now,actor:ctx.actor||'Operador',reason,before,after,removed:structuredClone(removed)};entries.push(entry);return entry;}
export function cleanSaleComments(order,state,ctx={}){const plan=previewSaleCommentCleanup(order,state);if(!plan.changed||!plan.removed.length)return null;archiveSaleComments(order,plan.before,plan.after,ctx,'Limpieza de notas confirmadas',plan.removed);order.comments=plan.after;
 const notes=order.postSaleNotes??=[];for(const r of plan.removed.filter(r=>r.kind==='movement'))if(!notes.some(n=>n.text===r.text))notes.push({text:r.text,kinds:r.kinds,registeredAt:ctx.now});return {identifiers:plan.removed.filter(r=>r.kind==='identifier').length,movements:plan.removed.filter(r=>r.kind==='movement').length};}
export function maintainSaleComments(state,ctx={}){const id='sale-comment-cleanup-20261124',markers=(state.config??={}).saleCommentMaintenance??={};if(markers[id])return null;const result={orders:0,identifiers:0,movements:0};for(const o of state.orders||[]){const r=cleanSaleComments(o,state,ctx);if(r){result.orders++;result.identifiers+=r.identifiers;result.movements+=r.movements;}}markers[id]={at:ctx.now,...result};return result;}
export function saleAftercare(order,state={}){
 const facts=saleMovementFacts(order,state),trace=order.marketplace34?.trace||{},records=[],historyDate=pattern=>[...(order.history||[])].reverse().find(h=>pattern.test(h.label||''))?.date||null;
 if(facts.cancelled)records.push({kind:'cancelled',title:'Cancelación',date:order.cancelledAt||trace.cancelMarketplace||trace.cancelSeller||historyDate(/^Cancelación registrada/i),reason:order.cancellationReason||'',status:'Registrada'});
 const refunds=facts.refund?.refunds||[];for(const r of refunds)records.push({kind:'refunded',title:'Reembolso',id:r.id,requestDate:r.requestDate,date:r.refundDate,reason:r.reason,amountCents:r.amountCents,status:r.refundDate?'Registrado':'Solicitado',reverseGuide:r.reverseGuide});
 if(!refunds.length&&(facts.refunded||order.paymentStatus==='partially_refunded'||order.refundCents>0))records.push({kind:'refunded',title:order.paymentStatus==='partially_refunded'?'Reembolso parcial':'Reembolso',date:order.refundedAt||trace.refundMarketplace||trace.refundSeller||null,reason:order.refundReason||'',amountCents:order.refundCents??null,status:'Registrado'});
 if(order.returnStatus==='requested')records.push({kind:'requested',title:'Devolución',date:historyDate(/^Devolución solicitada/i),status:'Pendiente de recepción',reason:order.incident||''});
 if(facts.received)records.push({kind:'received',title:'Recepción de devolución',date:order.returnedAt||facts.moves.find(m=>m.type==='sale.return_receive')?.date||null,status:order.returnStatus==='inspection'?'En inspección':'Recibida',qty:(order.items||[]).reduce((n,l)=>n+num(l.returnedQty),0)||null});
 if(facts.restocked||order.returnStatus==='restocked')records.push({kind:'restocked',title:'Reintegro a inventario',date:facts.restocks[0]?.date||trace.restock||historyDate(/reintegradas al inventario/i),status:'Registrado',qty:facts.restockedQty||null});
 if(order.returnStatus==='rejected')records.push({kind:'rejected',title:'Clasificación no vendible',date:order.resolvedAt||facts.moves.find(m=>m.type==='sale.return_reject'&&m.pool==='damaged')?.date||null,status:'No vendible',reason:order.incident||''});
 return records;
}
export function saleTimeline(order,state={}){
 const history=operationalSaleHistory(order),entries=[],add=(label,date,kind='operation',extra={})=>{if(entries.some(e=>e.label===label&&e.date===date))return;entries.push({label,date:date||null,kind,...extra});},trace=order.marketplace34?.trace||{};
 add('Venta registrada',order.creationDate||order.registeredAt||null,'registered');
 if((order.shippedAt||trace.shipment)&&!history.some(h=>/^Envío registrado/i.test(h.label)))add('Envío registrado',order.shippedAt||trace.shipment,'shipped');if((order.deliveredAt||trace.delivery)&&!history.some(h=>/^Entrega registrada/i.test(h.label)))add('Entrega registrada',order.deliveredAt||trace.delivery,'delivered');
 for(const h of history)if(!/^Venta registrada/i.test(h.label||'')||String(h.date).slice(0,19)!==String(order.creationDate||order.registeredAt).slice(0,19))add(h.label,h.date,'operation',{actor:h.actor});
 for(const r of saleAftercare(order,state)){if(r.requestDate)add('Solicitud de reembolso',r.requestDate,'requested',{reference:r.id});const label={cancelled:'Cancelación registrada',refunded:r.title+' registrado',requested:'Devolución pendiente de recepción',received:'Devolución recibida',restocked:'Reintegro a inventario registrado',rejected:'Clasificación no vendible registrada'}[r.kind];if(!history.some(h=>r.kind==='refunded'&&!r.id&&/^Reembolso registrado/i.test(h.label)||r.kind==='requested'&&/^Devolución solicitada/i.test(h.label)||r.kind==='restocked'&&/reintegradas al inventario/i.test(h.label)||r.kind==='received'&&/devolución física recibida/i.test(h.label)||r.kind==='cancelled'&&/^Cancelación registrada/i.test(h.label)))add(label,r.date,r.kind,{reference:r.id,amountCents:r.amountCents});}
 return entries.map((e,index)=>({...e,index})).sort((a,b)=>a.date&&b.date?String(a.date).localeCompare(String(b.date))||a.index-b.index:a.date?-1:b.date?1:a.index-b.index);
}

export function visibleSaleComments(order){return String(order.comments||'').split('\n').filter(line=>!/^\s*(?:Cotejo directo|Fecha del? documento|Fecha de documento|La pantalla no muestra|Portal .*verificado)/i.test(line)).join('\n').trim();}
