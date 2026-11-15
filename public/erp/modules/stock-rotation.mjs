/** Rotation is measured per product across all channels, independently of price viability. */
import {commerciallySelectable} from './product-lifecycle.mjs?v=20261115-product-routing';
export const ROTATION_LEVELS=Object.freeze([
 {level:1,minMonths:1,color:'#2563eb',label:'Vigilar',tone:'blue'},
 {level:2,minMonths:2,color:'#087f8c',label:'Impulsar',tone:'teal'},
 {level:3,minMonths:3,color:'#a46b00',label:'Planear liquidación',tone:'yellow'},
 {level:4,minMonths:4,color:'#c25b12',label:'Liquidación prioritaria',tone:'orange'},
 {level:5,minMonths:5,color:'#c24162',label:'Liquidación alta',tone:'rose'},
 {level:6,minMonths:6,color:'#b42318',label:'Liquidación urgente',tone:'red'}
].map(Object.freeze));
export const ROTATION_DEFAULTS=Object.freeze({enabled:true,unit:'months',purchaseReference:'first',unknownHistory:'use_last_sale',stockBasis:'physical',excludeRefunded:true,saleStatuses:['shipped','delivered','historical'],showFlagsInEvents:true,showFlagsInLiquidations:true,showLevelNumber:true,showLevelLabel:true});
export function rotationSettings(state){
 const saved=state.config?.stockRotation||{};
 return {...structuredClone(ROTATION_DEFAULTS),...Object.fromEntries(Object.keys(ROTATION_DEFAULTS).filter(k=>saved[k]!==undefined).map(k=>[k,structuredClone(saved[k])])),revision:saved.revision||0,
 levels:ROTATION_LEVELS.map((row,i)=>({level:row.level,threshold:saved.months?.length===6?saved.months[i]:row.minMonths,label:row.label,color:row.color,active:true,critical:row.level===6,...structuredClone(saved.levels?.find(r=>r.level===row.level)||{})}))};
}
export function rotationPolicy(state){return rotationSettings(state).levels.map(r=>({...r,minMonths:r.threshold,tone:ROTATION_LEVELS.find(d=>d.level===r.level)?.tone}));}
export function rotationUnitLabel(unit,count=2){return ({months:count===1?'mes':'meses',weeks:count===1?'semana':'semanas',days:count===1?'día':'días'})[unit]||'meses';}
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
 const settings=rotationSettings(state);
 const products=(state.products||[]).filter(commerciallySelectable),owners=new Map(),dates=new Map(products.map(p=>[p.sku,{purchases:[],sales:[],future:0}]));
 for(const p of products)for(const c of [p.sku,p.upc,p.sellerSku,p.sicarCode,...(p.skuAliases||[])].filter(Boolean)){const k=code(c);owners.set(k,owners.has(k)&&owners.get(k)!==p.sku?null:p.sku);}
 const match=line=>{const found=new Set([line.sku,line.productSku,line.skuOrUpc,line.upc,line.sellerSku].map(c=>owners.get(code(c))).filter(Boolean));return found.size===1?[...found][0]:null;};
 const push=(sku,kind,date,ref)=>{if(!sku)return;const d=civilDate(date);if(!d)return;const target=dates.get(sku);if(d>today){target.future++;return;}target[kind].push({date:d,reference:ref});};
 for(const p of state.purchases||[]){if(cancelled(p))continue;for(const line of p.items||p.lines||[]){if(line.kind==='charge'||Number(line.qty??line.quantity??0)<=0)continue;push(match(line),'purchases',p.documentDate||p.sicarHistory?.documentDate||p.date,p.number||p.sicar||p.id);}}
 for(const o of state.orders||[]){
  if(cancelled(o)||settings.excludeRefunded&&(['refunded','Reembolsada'].includes(o.paymentStatus)||['restocked','rejected'].includes(o.returnStatus)))continue;
  if(!settings.saleStatuses.includes(o.status)&&!(settings.saleStatuses.includes('historical')&&o.stockMode==='historical'))continue;
  const lines=o.items?.length?o.items:[{sku:o.sku,qty:o.qty||1}];
  for(const line of lines){if(Number(line.qty??line.quantity??0)-(settings.excludeRefunded?Number(line.reintegratedQty||0):0)<=0)continue;push(match(line),'sales',o.documentDate||o.date,o.number||o.id);}
 }
 const policy=rotationPolicy(state);
 return products.map(product=>{
  const evidence=dates.get(product.sku),purchases=evidence.purchases.sort((a,b)=>a.date.localeCompare(b.date)),sales=evidence.sales.sort((a,b)=>a.date.localeCompare(b.date));
  const firstPurchase=purchases[0]?.date||null,lastPurchase=purchases.at(-1)?.date||null,lastSale=sales.at(-1)?.date||null;
  // New replenishments must not hide old stagnant stock. This is product inactivity, not FIFO lot age.
  const purchaseAnchor=settings.purchaseReference==='latest'?lastPurchase:firstPurchase;
  const anchorDate=!firstPurchase&&settings.unknownHistory==='require_purchase'?null:[purchaseAnchor,lastSale].filter(Boolean).sort().at(-1)||null,anchorKind=anchorDate===lastSale&&lastSale?'sale':purchaseAnchor?'purchase':'unknown';
  const months=anchorDate?completeMonths(anchorDate,today):null,days=anchorDate?Math.floor((Date.parse(today+'T12:00Z')-Date.parse(anchorDate+'T12:00Z'))/86400000):null;
  const physical=Number(product.good||0),available=Math.max(0,physical-Number(product.reserved||0)-Number(product.safety||0));
  const elapsed=settings.unit==='days'?days:settings.unit==='weeks'&&days!==null?Math.floor(days/7):months;
  const stocked=settings.stockBasis==='available'?available>0:physical>0;
  const band=settings.enabled&&anchorDate&&stocked?policy.filter(r=>r.active&&elapsed>=r.threshold).at(-1):null;
  const average=product.costStatus==='Por confirmar'?null:Number.isFinite(product.averageCostMxn)?product.averageCostMxn*100:product.costCents;
  return {sku:product.sku,product,asOf:today,firstPurchase,lastPurchase,lastSale,anchorDate,anchorKind,months,days,elapsed,unit:settings.unit,unitLabel:rotationUnitLabel(settings.unit,elapsed),critical:!!band?.critical,level:band?.level||0,tone:band?.tone||'slate',color:band?.color||'#64748b',label:band?.label||(!stocked?(physical<=0?'Sin stock':'Sin disponible'):!settings.enabled?'Clasificación pausada':anchorDate?'Rotación reciente':'Por verificar'),status:!stocked?'no_stock':!anchorDate?'unknown':band?'flagged':'recent',historyPartial:!firstPurchase,physical,available,averageCostCents:Number.isFinite(average)?Math.round(average):null,capitalCents:Number.isFinite(average)?Math.round(average*available):null,salesCount:sales.length,purchaseCount:purchases.length,futureRecords:evidence.future};
 }).sort((a,b)=>b.level-a.level||(b.months??-1)-(a.months??-1)||String(a.product.name).localeCompare(String(b.product.name)));
}
export function saveRotationPolicy(state,command,ctx={}){
 const current=rotationSettings(state),p=command.payload||{};
 if(p.expectedRevision!==undefined&&p.expectedRevision!==current.revision)throw Error('El catálogo cambió desde otra sesión. Recarga la configuración antes de guardar.');
 const policy=p.policy?structuredClone(p.policy):{...current,unit:'months',levels:current.levels.map((r,i)=>({...r,threshold:p.months?.[i]}))};
 const booleanKeys=['enabled','excludeRefunded','showFlagsInEvents','showFlagsInLiquidations','showLevelNumber','showLevelLabel'];
 if(booleanKeys.some(k=>typeof policy[k]!=='boolean')||!['days','weeks','months'].includes(policy.unit)||!['first','latest'].includes(policy.purchaseReference)||!['use_last_sale','require_purchase'].includes(policy.unknownHistory)||!['physical','available'].includes(policy.stockBasis))throw Error('Revisa las opciones generales del catálogo de liquidaciones.');
 if(!Array.isArray(policy.saleStatuses)||!policy.saleStatuses.length||policy.saleStatuses.some(v=>!['shipped','delivered','historical'].includes(v)))throw Error('Selecciona al menos un estado de venta válido para medir rotación.');
 const max={months:60,weeks:260,days:1825}[policy.unit];
 if(!Array.isArray(policy.levels)||policy.levels.length!==6)throw Error('Configura los seis niveles de liquidación.');
 const levels=policy.levels.map((r,i)=>{
  if(r.level!==i+1||!Number.isInteger(r.threshold)||r.threshold<1||r.threshold>max||i>0&&r.threshold<=policy.levels[i-1].threshold)throw Error('Usa seis umbrales crecientes: de 1 a '+max+' '+rotationUnitLabel(policy.unit)+'.');
  if(typeof r.label!=='string'||!r.label.trim()||r.label.trim().length>80||/[\u0000-\u001f]/.test(r.label)||!/^#[a-fA-F0-9]{6}$/.test(r.color||'')||typeof r.active!=='boolean'||typeof r.critical!=='boolean')throw Error('Revisa el nombre, color y activación del nivel '+(i+1)+'.');
  return {level:i+1,threshold:r.threshold,label:r.label.trim(),color:r.color.toLowerCase(),active:r.active,critical:r.critical};
 });
 if(policy.enabled&&!levels.some(r=>r.active))throw Error('Activa al menos un nivel o pausa la clasificación general.');
 const saved={version:2,revision:current.revision+1,...Object.fromEntries(Object.keys(ROTATION_DEFAULTS).map(k=>[k,structuredClone(policy[k])])),levels,saleStatuses:[...new Set(policy.saleStatuses)]};
 (state.config??={}).stockRotation=saved;
 (state.events??=[]).unshift({id:command.id,type:command.type,date:ctx.now,actor:ctx.actor,result:'ok',message:'Catálogo de rotación y liquidaciones actualizado.',before:structuredClone(current),after:structuredClone(saved)});
 return {ok:true,message:'Catálogo guardado. Los niveles, colores y banderines se actualizarán en el ERP.',revision:saved.revision};
}
