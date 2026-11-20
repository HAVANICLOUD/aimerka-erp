import {estimateOrder} from './reconciliation-v28.mjs?v=20261120-t1-current14';
import {compareV43} from './settlement-documents.mjs?v=20261120-t1-current14';

/** Explicit user-attested alternative. It never creates bank proof or changes stock. */
export function saveManualPayment(state,command,context={}){
 const p=command.payload||{},o=state.orders.find(o=>o.id===p.orderId);if(!o)throw new Error('Pedido no encontrado.');
 const r=o.reconciliation||{};if(r.closure)throw new Error('Reabre la conciliación cerrada con motivo antes de modificarla.');
 const related=(state.settlementLedger?.cheques||[]).filter(c=>c.lines.some(l=>l.orderId===o.id));
 if(related.length&&related.every(c=>c.status==='reconciled'))throw new Error('Esta venta ya está cotejada con banco. El registro manual no reemplaza su evidencia.');
 if(!Number.isSafeInteger(p.amountCents)||p.amountCents<0||p.amountCents>100000000000)throw new Error('Escribe un depósito no negativo con hasta dos decimales.');
 if(typeof p.complete!=='boolean')throw new Error('Indica si el pago es completo o parcial.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(p.date||'')||!Number.isFinite(Date.parse(p.date+'T12:00:00Z'))||new Date(p.date+'T12:00:00Z').toISOString().slice(0,10)!==p.date||p.date<'2000-01-01'||p.date>'2100-12-31')throw new Error('Escribe una fecha de depósito válida.');
 const notes=String(p.notes||'').trim();if(notes.length<5||notes.length>2000)throw new Error('Describe el motivo o referencia del registro manual (5 a 2000 caracteres).');
 for(const k of ['withholdingCents','shippingCents'])if(p[k]!=null&&(!Number.isSafeInteger(p[k])||p[k]<0||p[k]>100000000000))throw new Error('Retenciones y envío deben ser importes no negativos con hasta dos decimales.');
 let snapshot=null;try{if(['Sears','Sanborns'].includes(o.market)){const c=compareV43(o,state.products,state.config);snapshot={retentionCents:Math.round((c.vat+c.isr)*100),commissionRate:c.commissionRate};}else{const e=r.estimate||estimateOrder(o,state.products,state.config);snapshot={retentionCents:e.vatCents+e.incomeCents,commissionRate:e.grossCents?e.commissionCents/e.grossCents:null};}}catch{}
 const before=r.manual?structuredClone(r.manual):null,manual={id:command.id,amountCents:p.amountCents,date:p.date,complete:p.complete,withholdingCents:p.withholdingCents??null,shippingCents:p.shippingCents??null,notes,estimateSnapshot:snapshot,at:context.now,actor:context.actor,source:'manual'};
 o.reconciliation=r;r.manual=manual;(r.history??=[]).unshift({type:'payment.manual.save',at:context.now,actor:context.actor,before,after:structuredClone(manual)});
 r.depositCents=manual.amountCents;r.depositDate=manual.date;r.confirmationSource='manual';r.status=manual.complete?'Conciliada manualmente':'Depósito manual parcial';o.paidCents=r.depositCents;
 (state.events??=[]).unshift({id:command.id,type:command.type,date:context.now,actor:context.actor,result:'ok',message:'Depósito declarado manualmente · '+o.number,changes:{orderId:o.id,before,after:structuredClone(manual)}});
 return {ok:true,message:'Conciliación manual guardada con historial. No constituye un cotejo bancario.',id:o.id};
}
