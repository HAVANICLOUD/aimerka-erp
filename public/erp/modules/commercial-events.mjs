/** Bounded, internal campaign proposals. Dates describe a calendar, never trigger activation. */
import {recommend} from './pricing-v28.mjs';
import {classifyPricing,canSavePrice} from './pricing-signals.mjs';
import {MARKETS,channelPrice,listingStatus,saveCalculatedPrices} from './product-prices.mjs';
import {warehouses,warehouseBalances,POOLS} from './warehouses.mjs';

export const eventTemplates=Object.freeze(['Buen Fin','Hot Sale','Decembrino','Pre-navideño','Navidad','Día de la Madre','Día del Padre','Black Friday','Cyber Monday'].map(name=>Object.freeze({name})));
const LIMIT=2000,MAX_ROWS=LIMIT*7;
const copy=value=>structuredClone(value);
const fail=message=>{throw new Error(message);};
const key=(sku,market)=>JSON.stringify([sku,market]);
const money=n=>Number.isSafeInteger(n)&&n>0&&n<=100000000000;
function list(value=[],max=LIMIT){
 if(!Array.isArray(value)||value.length>max||value.some(v=>typeof v!=='string'||!v.trim()||v.length>160)||new Set(value).size!==value.length)fail('Selección inválida o repetida.');
 return [...value].sort();
}
function civil(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.slice(0,4)==='0000')return false;
 const date=new Date(value+'T00:00:00Z');return Number.isFinite(+date)&&date.toISOString().slice(0,10)===value;
}
function references(rows=[]){
 if(!Array.isArray(rows)||rows.length>MAX_ROWS)fail('Referencias de mercado inválidas.');
 const seen=new Set();
 return rows.map(r=>{
  if(!r||typeof r.sku!=='string'||!r.sku||r.sku.length>160||!MARKETS.includes(r.market)||typeof r.price!=='number'||!Number.isFinite(r.price)||r.price<=0||r.price>1000000000||typeof r.store!=='string'||!r.store.trim()||r.store.length>160||typeof r.url!=='string'||r.url.length>2000)fail('Referencia real incompleta: SKU, marketplace, precio, tienda y URL requeridos.');
  let url;try{url=new URL(r.url);}catch{fail('URL de referencia inválida.');}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)fail('URL de referencia inválida.');
  const id=key(r.sku,r.market);if(seen.has(id))fail('Referencia de mercado repetida.');seen.add(id);
  return {sku:r.sku,market:r.market,price:r.price,store:r.store.trim(),url:r.url};
 }).sort((a,b)=>key(a.sku,a.market).localeCompare(key(b.sku,b.market)));
}
function normalize(event){
 if(!event||typeof event!=='object')fail('Campaña no encontrada.');
 const name=typeof event.name==='string'?event.name.trim():'';
 if(!name||name.length>160||!civil(event.startDate)||!civil(event.endDate)||event.startDate>event.endDate)fail('Nombre o fechas de campaña inválidos; usa fechas civiles reales YYYY-MM-DD en orden.');
 const markets=list(event.markets,7);if(!markets.length||markets.some(m=>!MARKETS.includes(m)))fail('Selecciona marketplaces válidos.');
 const s=event.selection||{},r=event.rules||{};
 if(s.onlyPublished!==undefined&&typeof s.onlyPublished!=='boolean'||s.warehouseId!==undefined&&typeof s.warehouseId!=='string')fail('Filtros de selección inválidos.');
 if(!['margin','discount','competitive'].includes(r.mode))fail('Modo de campaña inválido.');
 const margin=r.margin??.1,discount=r.discount??0;
 if(typeof margin!=='number'||!Number.isFinite(margin)||margin<0||margin>=1||typeof discount!=='number'||!Number.isFinite(discount)||discount<0||discount>=1)fail('Margen o descuento fuera de rango.');
 if(!['pass_through','no_pass_through'].includes(r.retentionTreatment??'pass_through')||!['configured','inferred14'].includes(r.t1CommissionMode??'configured')||!['CLASICA','CLÁSICA','PREMIUM'].includes(r.mlType??'CLASICA'))fail('Reglas de retención o comisión inválidas.');
 if(r.msi!==undefined&&(typeof r.msi!=='string'||r.msi.length>30))fail('Plazo MSI inválido.');
 if(event.id!==undefined&&(typeof event.id!=='string'||!event.id||event.id.length>160))fail('Identificador de campaña inválido.');
 return {id:event.id,name,startDate:event.startDate,endDate:event.endDate,markets,selection:{brands:list(s.brands),departments:list(s.departments),skus:list(s.skus),warehouseId:s.warehouseId||'',onlyPublished:s.onlyPublished??false},rules:{mode:r.mode,margin,discount,retentionTreatment:r.retentionTreatment??'pass_through',t1CommissionMode:r.t1CommissionMode??'configured',mlType:r.mlType??'CLASICA',msi:r.msi??'Sin MSI',marketReferences:references(r.marketReferences)}};
}
// Two independent synchronous 32-bit streams; canonical input order does not affect the token.
function stable(value){
 if(value===undefined)return 'null';
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
 return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
}
function hash(value){let a=2166136261,b=5381;for(const c of stable(value)){a=Math.imul(a^c.codePointAt(0),16777619);b=Math.imul(b,33)^c.codePointAt(0);}return 'ce1-'+(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');}
export function previewCommercialEvent(state,payload={}){
 if(Boolean(payload.eventId)===Boolean(payload.event))fail('Indica una campaña guardada o un evento, exclusivamente.');
 const event=normalize(payload.eventId?(state.commercialEvents||[]).find(e=>e.id===payload.eventId):payload.event);
 const s=event.selection;
 if(s.warehouseId&&!warehouses(state).some(w=>w.id===s.warehouseId&&w.active))fail('Selecciona un almacén activo.');
 const balances=s.warehouseId?warehouseBalances(state).filter(b=>b.warehouseId===s.warehouseId):[];
 const products=(state.products||[]).filter(p=>p.status!=='INACTIVO'&&(!s.brands.length||s.brands.includes(p.brand))&&(!s.departments.length||s.departments.includes(p.department))&&(!s.skus.length||s.skus.includes(p.sku))&&(!s.warehouseId||balances.some(b=>b.sku===p.sku&&POOLS.some(pool=>Number.isFinite(Number(b[pool]))&&Number(b[pool])!==0)))).sort((a,b)=>String(a.sku).localeCompare(String(b.sku)));
 if(products.length>LIMIT||new Set(products.map(p=>p.sku)).size!==products.length)fail('La campaña admite hasta 2000 productos con SKU único; divide catálogos mayores por marca o departamento.');
 const refs=event.rules.mode==='competitive'?references(event.rules.marketReferences.length?event.rules.marketReferences:state.competitorReferences):[];
 const rows=[],baselines=[];
 for(const product of products){
  const candidates=[];
  for(const market of event.markets){
   if(s.onlyPublished&&listingStatus(product,market).status!=='published')continue;
   const saved=channelPrice(state,product.sku,market),baseline=saved?.regularCents??product.priceCents;
   const ref=refs.find(r=>r.sku===product.sku&&r.market===market),r=event.rules;
   baselines.push({sku:product.sku,market,saved,baseline});
   const input={channel:['Sears','Sanborns'].includes(market)?'T1 Comercios':market,margin:r.margin,retentionTreatment:r.retentionTreatment,t1CommissionMode:r.t1CommissionMode,mlType:r.mlType,msi:r.msi,alternateMarketPrice:baseline/100,mode:r.mode==='margin'?'automatico':r.mode==='discount'?'manual_precios':'competitivo'};
   if(r.mode==='discount')Object.assign(input,{manualRegular:baseline/100,manualDiscount:Math.round(baseline*(1-r.discount))/100});
   if(r.mode==='competitive'&&ref)input.alternateMarketPrice=ref.price;
   let result;
   if(!money(baseline)||r.mode==='competitive'&&!ref)result={valid:false,errors:[{message:!money(baseline)?'Precio regular de referencia inválido.':'Falta referencia de competencia real para este destino.'}],regular:null,discount:null};
   else result=recommend(state.config,product,input);
   candidates.push({sku:product.sku,name:product.name,brand:product.brand,department:product.department,market,sourceId:'commercial-event:'+key(event.id||'preview',key(product.sku,market)),baselineCents:baseline,reference:ref||null,input,result});
  }
  const signals=classifyPricing(candidates.map(c=>c.result),state.config);
  candidates.forEach((row,i)=>{
   row.traffic=signals[i];row.result={...row.result,targetMarket:row.market,traffic:row.traffic};
   row.regularCents=Math.round(row.result.regular?.price*100)||0;row.discountCents=Math.round(row.result.discount?.price*100)||0;
   row.valid=canSavePrice(row.result)&&money(row.regularCents)&&money(row.discountCents)&&row.regularCents>=row.discountCents;
   row.targetMargin=event.rules.margin;
   row.actualMargin=row.result.discount?.objectiveProfit/row.result.discount?.price;
   row.belowTargetMargin=event.rules.mode!=='margin'&&row.valid&&row.actualMargin+1e-10<row.targetMargin;
   row.warnings=[...(row.result.warnings||[])];
   if(row.belowTargetMargin){
    const warning='Por debajo del margen objetivo configurado.';row.warnings.push(warning);
    row.traffic={...row.traffic,color:row.traffic.color==='green'?'yellow':row.traffic.color,reason:row.traffic.reason+' '+warning};
    row.result={...row.result,traffic:row.traffic,warnings:row.warnings};
   }
   row.defaultSelected=row.valid&&row.traffic.color==='green'&&!row.belowTargetMargin;
   row.reason=row.valid?row.traffic.reason:(row.result.errors||[]).map(e=>e.message).join(' ')||'Precios inválidos.';rows.push(row);
  });
 }
 const summary={products:products.length,total:rows.length,valid:rows.filter(r=>r.valid).length,invalid:rows.filter(r=>!r.valid).length,green:0,yellow:0,red:0};
 for(const row of rows)summary[row.traffic.color]++;
 return {event,rows,summary,fingerprint:hash({event,config:state.config,products,balances,baselines,references:refs}),activation:'manual',externalPublication:false};
}
function targets(value,allowEmpty=false){
 if(!Array.isArray(value)||value.length>MAX_ROWS||!allowEmpty&&!value.length)fail('Selecciona destinos válidos.');
 const ids=value.map(t=>{if(!t||typeof t.sku!=='string'||!MARKETS.includes(t.market))fail('Destino inválido.');return key(t.sku,t.market);});
 if(new Set(ids).size!==ids.length)fail('Destinos repetidos.');return new Set(ids);
}
function audit(state,command,ctx,type,message,extra={}){
 state.events=[{id:command.id,type,date:ctx.now,actor:ctx.actor,result:'ok',message,...extra},...(state.events||[])];
}
export function commercialEventCommand(state,command,ctx={}){
 const p=command.payload||{};
 if(typeof command.id!=='string'||!command.id||command.id.length>120)fail('Identificador de operación requerido.');
 if(command.type==='pricing.event.save'){
  const event=normalize(p.event),existing=(state.commercialEvents||[]).find(e=>e.id===event.id);
  if(event.id&&!existing)fail('Campaña no encontrada.');
  event.id=event.id||'campaign-'+command.id;
  if(!existing&&(state.commercialEvents||[]).length>=100)fail('Límite de 100 campañas alcanzado.');
  if(!existing&&(state.commercialEvents||[]).some(e=>e.id===event.id))fail('Identificador de campaña repetido.');
  // Validate warehouse and bounds before saving, without requiring all rows to be viable.
  previewCommercialEvent(state,{event});
  const saved={...event,createdAt:existing?.createdAt??ctx.now,updatedAt:ctx.now,actor:ctx.actor,revision:(existing?.revision||0)+1,history:existing?[{...normalize(existing),revision:existing.revision,updatedAt:existing.updatedAt},...(existing.history||[])].slice(0,20):[]};
  state.commercialEvents=[...(state.commercialEvents||[]).filter(e=>e.id!==event.id),saved];
  audit(state,command,ctx,command.type,'Campaña guardada; activación manual.',{eventId:event.id});
  return {ok:true,id:event.id,eventId:event.id,event:copy(saved)};
 }
 if(command.type!=='pricing.event.apply')fail('Operación de campaña no reconocida.');
 const preview=previewCommercialEvent(state,{eventId:p.eventId});
 if(!p.previewFingerprint||p.previewFingerprint!==preview.fingerprint)fail('La vista previa cambió; recalcula antes de aplicar.');
 const selected=targets(p.targets),ack=targets(p.riskAcknowledgedTargets??[],true),byId=new Map(preview.rows.map(r=>[key(r.sku,r.market),r]));
 if([...ack].some(id=>!selected.has(id)))fail('El reconocimiento de riesgo debe corresponder a destinos seleccionados.');
 const rows=[...selected].map(id=>{const row=byId.get(id);if(!row||!row.valid)fail('Destino desconocido o precio inválido.');if(row.traffic.color==='red'&&!ack.has(id))fail('Reconoce explícitamente cada destino rojo antes de aplicar.');return row;});
 if((state.commercialEventRuns||[]).some(r=>r.id===command.id))fail('Esta aplicación ya fue registrada.');
 // Stage every fallible calculation/write on isolated price collections, then commit together.
 const draft={productChannelPrices:copy(state.productChannelPrices||[]),productChannelPriceHistory:copy(state.productChannelPriceHistory||[]),pricePublicationQueue:copy(state.pricePublicationQueue||[])};
 for(const row of rows){
  const product=state.products.find(p=>p.sku===row.sku);
  saveCalculatedPrices(draft,product,[row.result],ctx,command.id);
  for(const old of draft.pricePublicationQueue)if(old.sku===row.sku&&(old.targetMarket||old.channel)===row.market&&['awaiting_connection','review_required'].includes(old.status)){old.status='superseded';old.supersededAt=ctx.now;}
  draft.pricePublicationQueue.unshift({id:command.id+'-'+key(row.sku,row.market),source:'commercial-event',sourceId:row.sourceId,eventId:p.eventId,runId:command.id,sku:row.sku,upc:product.upc,name:row.name,channel:row.result.channel,targetMarket:row.market,currency:'MXN',regularCents:row.regularCents,discountCents:row.discountCents,status:row.traffic.color==='red'?'review_required':'awaiting_connection',riskAcknowledged:ack.has(key(row.sku,row.market)),traffic:copy(row.traffic),createdAt:ctx.now,actor:ctx.actor,input:copy(row.input),result:copy(row.result)});
 }
 const snapshot={id:command.id,eventId:p.eventId,date:ctx.now,actor:ctx.actor,fingerprint:preview.fingerprint,event:copy(preview.event),configSnapshot:copy(state.config),targets:rows.map(row=>({sku:row.sku,market:row.market,sourceId:row.sourceId,baselineCents:row.baselineCents,regularCents:row.regularCents,discountCents:row.discountCents,reference:copy(row.reference),traffic:copy(row.traffic),riskAcknowledged:ack.has(key(row.sku,row.market)),regular:copy(row.result.regular),discount:copy(row.result.discount)}))};
 Object.assign(state,draft,{commercialEventRuns:[snapshot,...(state.commercialEventRuns||[])]});
 audit(state,command,ctx,'campaign.applied','Propuestas internas guardadas; pendientes de conexión.',{eventId:p.eventId,runId:command.id,targets:rows.map(r=>({sku:r.sku,market:r.market}))});
 return {ok:true,id:command.id,eventId:p.eventId,applied:rows.length,fingerprint:preview.fingerprint,message:'Propuestas guardadas; no enviadas a tiendas.'};
}
