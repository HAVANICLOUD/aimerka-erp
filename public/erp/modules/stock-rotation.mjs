/** Rotation is measured per product across all channels, independently of price viability. */
import {commerciallySelectable} from './product-lifecycle.mjs';
export const ROTATION_LEVELS=Object.freeze([
 {level:1,minMonths:1,color:'#2563eb',label:'Vigilar',tone:'blue'},
 {level:2,minMonths:2,color:'#087f8c',label:'Impulsar',tone:'teal'},
 {level:3,minMonths:3,color:'#a46b00',label:'Planear liquidación',tone:'yellow'},
 {level:4,minMonths:4,color:'#c25b12',label:'Liquidación prioritaria',tone:'orange'},
 {level:5,minMonths:5,color:'#c24162',label:'Liquidación alta',tone:'rose'},
 {level:6,minMonths:6,color:'#b42318',label:'Liquidación urgente',tone:'red'}
].map(Object.freeze));
export function rotationPolicy(state){const saved=state.config?.stockRotation?.months;return ROTATION_LEVELS.map((row,i)=>({...row,minMonths:Array.isArray(saved)&&saved.length===6?saved[i]:row.minMonths}));}
export function civilDate(input){
 if(typeof input!=='string')return null;
 let day=input.slice(0,10);
 if(/T.*(?:Z|[+-]\d\d:\d\d)$/.test(input)){const parsed=new Date(input);if(!Number.isFinite(+parsed))return null;const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(parsed);day=['year','month','day'].map(k=>p.find(p=>p.type===k).value).join('-');}
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return null;const date=new Date(day+'T12:00:00Z');return Number.isFinite(+date)&&date.toISOString().slice(0,10)===day?day:null;
}
export function mexicoDate(now=new Date()){return civilDate(new Date(now).toISOString());}
export function completeMonths(from,to){const a=from.split('-').map(Number),b=to.split('-').map(Number);let n=(b[0]-a[0])*12+b[1]-a[1];const anniversary=Math.min(a[2],new Date(Date.UTC(b[0],b[1],0)).getUTCDate());if(b[2]<anniversary)n--;return Math.max(0,n);}
const code=v=>String(v??'').trim().toUpperCase();
const cancelled=row=>['cancelled','cancelada','cancelado'].includes(code(row.status).toLowerCase())||['cancelada','cancelado'].includes(code(row.commercialStatus).toLowerCase())||!!row.sicarHistory?.cancelled;
export function rotationReport(state,{asOf=mexicoDate()}={}){
 const today=civilDate(asOf);if(!today)throw Error('Fecha de evaluación inválida.');
 const products=(state.products||[]).filter(commerciallySelectable),owners=new Map(),dates=new Map(products.map(p=>[p.sku,{purchases:[],sales:[],future:0}]));
 for(const p of products)for(const c of [p.sku,p.upc,p.sellerSku,p.sicarCode,...(p.skuAliases||[])].filter(Boolean)){const k=code(c);owners.set(k,owners.has(k)&&owners.get(k)!==p.sku?null:p.sku);}
 const match=line=>{const found=new Set([line.sku,line.productSku,line.skuOrUpc,line.upc,line.sellerSku].map(c=>owners.get(code(c))).filter(Boolean));return found.size===1?[...found][0]:null;};
 const push=(sku,kind,date,ref)=>{if(!sku)return;const d=civilDate(date);if(!d)return;const target=dates.get(sku);if(d>today){target.future++;return;}target[kind].push({date:d,reference:ref});};
 for(const p of state.purchases||[]){if(cancelled(p))continue;for(const line of p.items||p.lines||[]){if(line.kind==='charge'||Number(line.qty??line.quantity??0)<=0)continue;push(match(line),'purchases',p.documentDate||p.sicarHistory?.documentDate||p.date,p.number||p.sicar||p.id);}}
 for(const o of state.orders||[]){
  if(cancelled(o)||['refunded','Reembolsada'].includes(o.paymentStatus)||['restocked','rejected'].includes(o.returnStatus))continue;
  if(!['shipped','delivered','historical'].includes(o.status)&&o.stockMode!=='historical')continue;
  const lines=o.items?.length?o.items:[{sku:o.sku,qty:o.qty||1}];
  for(const line of lines){if(Number(line.qty??line.quantity??0)-Number(line.reintegratedQty||0)<=0)continue;push(match(line),'sales',o.documentDate||o.date,o.number||o.id);}
 }
 const policy=rotationPolicy(state);
 return products.map(product=>{
  const evidence=dates.get(product.sku),purchases=evidence.purchases.sort((a,b)=>a.date.localeCompare(b.date)),sales=evidence.sales.sort((a,b)=>a.date.localeCompare(b.date));
  const firstPurchase=purchases[0]?.date||null,lastPurchase=purchases.at(-1)?.date||null,lastSale=sales.at(-1)?.date||null;
  // New replenishments must not hide old stagnant stock. This is product inactivity, not FIFO lot age.
  const anchorDate=[firstPurchase,lastSale].filter(Boolean).sort().at(-1)||null,anchorKind=anchorDate===lastSale&&lastSale?'sale':firstPurchase?'purchase':'unknown';
  const months=anchorDate?completeMonths(anchorDate,today):null,days=anchorDate?Math.floor((Date.parse(today+'T12:00Z')-Date.parse(anchorDate+'T12:00Z'))/86400000):null;
  const physical=Number(product.good||0),available=Math.max(0,physical-Number(product.reserved||0)-Number(product.safety||0));
  const band=anchorDate&&physical>0?policy.filter(r=>months>=r.minMonths).at(-1):null;
  const average=product.costStatus==='Por confirmar'?null:Number.isFinite(product.averageCostMxn)?product.averageCostMxn*100:product.costCents;
  return {sku:product.sku,product,asOf:today,firstPurchase,lastPurchase,lastSale,anchorDate,anchorKind,months,days,level:band?.level||0,tone:band?.tone||'slate',color:band?.color||'#64748b',label:band?.label||(physical<=0?'Sin stock':anchorDate?'Rotación reciente':'Por verificar'),status:physical<=0?'no_stock':!anchorDate?'unknown':band?'flagged':'recent',historyPartial:!firstPurchase,physical,available,averageCostCents:Number.isFinite(average)?Math.round(average):null,capitalCents:Number.isFinite(average)?Math.round(average*available):null,salesCount:sales.length,purchaseCount:purchases.length,futureRecords:evidence.future};
 }).sort((a,b)=>b.level-a.level||(b.months??-1)-(a.months??-1)||String(a.product.name).localeCompare(String(b.product.name)));
}
export function saveRotationPolicy(state,command,ctx={}){
 const months=command.payload?.months;
 if(!Array.isArray(months)||months.length!==6||months.some((n,i)=>!Number.isInteger(n)||n<1||n>60||i>0&&n<=months[i-1]))throw Error('Configura seis umbrales crecientes, de 1 a 60 meses completos.');
 (state.config??={}).stockRotation={months:[...months]};
 (state.events??=[]).unshift({id:command.id,type:command.type,date:ctx.now,actor:ctx.actor,result:'ok',message:'Umbrales de rotación actualizados.',months:[...months]});
 return {ok:true,message:'Niveles guardados. La clasificación se recalcula con compras y ventas actuales.'};
}
