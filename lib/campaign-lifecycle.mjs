/** Campaign families share progress; scheduled closure restores only prices they still own. */
const clone=v=>structuredClone(v);
const normalized=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function campaignFamilyId(state,eventId){const event=(state.commercialEvents||[]).find(e=>e.id===eventId);return event?.parentId||eventId;}
export function campaignFamilyIds(state,eventId){const root=campaignFamilyId(state,eventId);return new Set([root,...(state.commercialEvents||[]).filter(e=>e.parentId===root).map(e=>e.id)]);}
export function ensureCampaignParent(state,event,ctx){
 if(event.isParent&&event.parentId)throw Error('Una campaña principal no puede pertenecer a otra.');
 let parent=event.parentId?(state.commercialEvents||[]).find(e=>e.id===event.parentId&&e.isParent&&!e.deletedAt):null;
 if(parent&&(parent.kind||'campaign')!==(event.kind||'campaign'))throw Error('La campaña principal debe pertenecer al mismo módulo.');
 if(event.parentId&&!parent)throw Error('Selecciona una campaña principal disponible.');
 if(event.parentName?.trim()){
  const name=event.parentName.trim();parent=(state.commercialEvents||[]).find(e=>e.isParent&&!e.deletedAt&&(e.kind||'campaign')===(event.kind||'campaign')&&normalized(e.name)===normalized(name));
  if(!parent){parent={...clone(event),id:'parent-'+ctx.requestId,name,isParent:true,parentId:undefined,parentName:'',selection:{brands:[],departments:[],skus:[],warehouseId:'',onlyPublished:false,onlyAvailable:true},createdAt:ctx.now,updatedAt:ctx.now,revision:1,history:[]};(state.commercialEvents??=[]).push(parent);}
 }
 if(parent){event.parentId=parent.id;event.parentName='';parent.markets=[...new Set([...(parent.markets||[]),...event.markets])];parent.startDate=[parent.startDate,event.startDate].sort()[0];parent.endDate=[parent.endDate,event.endDate].sort().at(-1);}
 return event;
}
export function migrateBuenFinFamily(state,ctx){
 if(state.campaignFamilyMigration2026)return false;
 const children=(state.commercialEvents||[]).filter(e=>!e.deletedAt&&['buenfintiendanubeconsolasyvideojuegos','buenfintiendanubedingdongapple'].includes(normalized(e.name)));
 if(!children.length)return false;
 const parent=(state.commercialEvents||[]).find(e=>e.isParent&&normalized(e.name)==='buenfin2026');
 for(const child of children){if(child.parentId)continue;ensureCampaignParent(state,{...child,parentName:'Buen Fin 2026'},ctx);const root=(state.commercialEvents||[]).find(e=>e.isParent&&normalized(e.name)==='buenfin2026');child.parentId=root.id;}
 state.campaignFamilyMigration2026={date:ctx.now,children:children.map(e=>e.id)};return true;
}
export function restoreExpiredCampaignPrices(state,now){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
 const today=['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');
 const events=state.commercialEvents||[],entries=state.campaignPriceRestorations||[];
 const expired=entry=>{const event=events.find(e=>e.id===campaignFamilyId(state,entry.eventId));return !!event?.endDate&&event.endDate<today;};
 let changed=false;
 function original(entry,seen=new Set()){
  if(seen.has(entry.id))return {assignment:null,effective:null};seen.add(entry.id);
  const previous=entry.previous,prior=entries.find(e=>e.sku===entry.sku&&e.market===entry.market&&e.appliedRunId===previous?.commandId&&(expired(e)||e.status==='released'));
  return prior?original(prior,seen):{assignment:previous,effective:entry.previousEffective};
 }
 for(const entry of entries){
  if(entry.status!=='pending'||!expired(entry))continue;
  const index=(state.productChannelPrices||[]).findIndex(p=>p.sku===entry.sku&&p.market===entry.market),current=state.productChannelPrices?.[index];
  if(current?.commandId!==entry.appliedRunId){entry.status='superseded';entry.closedAt=now;changed=true;continue;}
  const resolved=original(entry),previous=resolved.assignment;
  (state.productChannelPriceHistory??=[]).unshift(clone(current));
  if(previous)state.productChannelPrices[index]={...clone(previous),revision:(current.revision||0)+1,updatedAt:now,restoredFromCampaign:entry.eventId};
  else state.productChannelPrices.splice(index,1);
  for(const q of state.pricePublicationQueue||[])if(q.runId===entry.appliedRunId&&q.sku===entry.sku&&(q.targetMarket||q.channel)===entry.market&&['awaiting_connection','review_required'].includes(q.status)){q.status='expired';q.expiredAt=now;}
  const fallback=(state.products||[]).find(p=>p.sku===entry.sku)?.priceCents;
  const price=previous||resolved.effective||{regularCents:fallback,discountCents:fallback};
  if(price.regularCents>0&&price.discountCents>0)(state.pricePublicationQueue??=[]).unshift({id:'restore-'+entry.id,source:'campaign-closure',eventId:entry.eventId,sku:entry.sku,targetMarket:entry.market,regularCents:price.regularCents,discountCents:price.discountCents,currency:'MXN',status:'awaiting_connection',createdAt:now});
  entry.status='restored';entry.closedAt=now;changed=true;
 }
 if(changed)(state.events??=[]).unshift({id:'campaign-close-'+now,type:'campaign.prices.restored',date:now,actor:'Sistema',result:'ok',message:'Cierre de campañas: precios internos anteriores restaurados; envío a tiendas pendiente de integración.'});
 return changed;
}

/** Existing runs retain their original audited data; add closure backups separately. */
export function backfillCampaignRestorations(state,now){
 let changed=false;
 for(const current of state.productChannelPrices||[]){
  const run=(state.commercialEventRuns||[]).find(r=>r.id===current.commandId&&r.targets?.some(t=>t.sku===current.sku&&t.market===current.market));
  if(!run||(state.campaignPriceRestorations||[]).some(e=>e.appliedRunId===run.id&&e.sku===current.sku&&e.market===current.market))continue;
  const family=campaignFamilyIds(state,run.eventId),familyRuns=new Set((state.commercialEventRuns||[]).filter(r=>family.has(r.eventId)).map(r=>r.id));
  const previous=(state.productChannelPriceHistory||[]).find(p=>p.sku===current.sku&&p.market===current.market&&!familyRuns.has(p.commandId)&&(p.revision||0)<(current.revision||Infinity))||null;
  (state.campaignPriceRestorations??=[]).push({id:'legacy-'+run.id+'-'+current.sku+'-'+current.market,eventId:run.eventId,appliedRunId:run.id,sku:current.sku,market:current.market,previous:clone(previous),previousEffective:null,status:'pending',createdAt:now});changed=true;
 }
 return changed;
}
