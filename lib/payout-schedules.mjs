import {dateOnly} from './operations-v28.mjs';
export const PAYOUT_CHANNELS=['Sears','Sanborns','Liverpool','Coppel','Elektra','Tienda Nube','Mercado Libre'];
export const SCHEDULE_TYPES=['Calendario','Semanal','Mensual','Días tras entrega'];
const date=v=>dateOnly(v)&&String(v).length===10?String(v):null;
const instant=v=>new Date(v+'T12:00:00Z');
const civil=d=>d.toISOString().slice(0,10);
const add=(s,n)=>{const d=instant(s);d.setUTCDate(d.getUTCDate()+n);return civil(d);};
function dayOfMonth(year,month,day){const first=new Date(Date.UTC(year,month,1,12)),last=new Date(Date.UTC(year,month+1,0,12)).getUTCDate();first.setUTCDate(Math.min(day,last));return civil(first);}
export function validateSchedule(value){
 const r={channel:value.channel,type:value.type,confirmed:value.confirmed===true,cutoffReference:value.cutoffReference||null,paymentReference:value.paymentReference||null,days:Number(value.days??0),reference:String(value.reference||'').trim().slice(0,2000),calendar:structuredClone(value.calendar||[])};
 if(!PAYOUT_CHANNELS.includes(r.channel)||!SCHEDULE_TYPES.includes(r.type)||!Number.isInteger(r.days)||r.days<0||r.days>365)throw new Error('Selecciona un canal, tipo de regla y días enteros entre 0 y 365.');
 if(['Semanal','Mensual'].includes(r.type)&&(!date(r.cutoffReference)||!date(r.paymentReference)))throw new Error('Selecciona fechas reales de referencia para corte y pago.');
 if(r.confirmed&&!r.reference)throw new Error('Documenta la referencia del acuerdo antes de confirmarlo.');
 if(!Array.isArray(r.calendar)||r.calendar.length>2000)throw new Error('Calendario no válido.');const cuts=new Set();
 for(const row of r.calendar){if(!date(row.cutoff)||!date(row.payment)||row.payment<row.cutoff||cuts.has(row.cutoff))throw new Error('Revisa fechas del calendario: el pago no puede preceder al corte y no se repiten cortes.');cuts.add(row.cutoff);}
 r.calendar.sort((a,b)=>a.cutoff.localeCompare(b.cutoff));return r;
}
export function calculatePayout(rule,eventDate){
 const event=dateOnly(eventDate),empty=message=>({cutoff:null,payment:null,message});
 if(!event)return empty('Falta fecha real de entrega o del evento documentado.');
 if(!rule?.confirmed)return empty('Cortes y pagos por configurar / confirmar.');
 const r=validateSchedule(rule),eligible=add(event,r.days);let cutoff,payment;
 if(r.type==='Calendario'){const row=r.calendar.find(x=>x.cutoff>=eligible);if(!row)return empty('Falta un próximo corte en el calendario.');({cutoff,payment}=row);}
 if(r.type==='Días tras entrega')cutoff=payment=eligible;
 if(r.type==='Semanal'){cutoff=add(eligible,(instant(r.cutoffReference).getUTCDay()-instant(eligible).getUTCDay()+7)%7);payment=add(cutoff,(instant(r.paymentReference).getUTCDay()-instant(cutoff).getUTCDay()+7)%7);}
 if(r.type==='Mensual'){const d=instant(eligible),cutDay=instant(r.cutoffReference).getUTCDate(),payDay=instant(r.paymentReference).getUTCDate();cutoff=dayOfMonth(d.getUTCFullYear(),d.getUTCMonth(),cutDay);if(cutoff<eligible)cutoff=dayOfMonth(d.getUTCFullYear(),d.getUTCMonth()+1,cutDay);const cut=instant(cutoff);payment=dayOfMonth(cut.getUTCFullYear(),cut.getUTCMonth(),payDay);if(payment<cutoff)payment=dayOfMonth(cut.getUTCFullYear(),cut.getUTCMonth()+1,payDay);}
 return {cutoff,payment,eligible,message:'Pago previsto según regla confirmada. No confirma un depósito bancario.'};
}
export function orderPayout(order,config){
 const t=order.marketplace34?.trace||{},candidates=order.market==='Liverpool'?[['refundMarketplace','Reembolso marketplace'],['refundSeller','Reembolso seller'],['cancelMarketplace','Cancelación marketplace'],['cancelSeller','Cancelación seller'],['delivery','Entrega real']]:[['delivery','Entrega real']];
 let selected=candidates.find(([key])=>t[key]);const event=selected?t[selected[0]]:order.market==='Liverpool'?(order.refundedAt||order.cancelledAt||order.deliveredAt):order.deliveredAt;
 return {...calculatePayout(config.payoutSchedules?.find(r=>r.channel===order.market),event),eventDate:dateOnly(event),eventLabel:selected?.[1]||'Evento registrado en la operación'};
}
