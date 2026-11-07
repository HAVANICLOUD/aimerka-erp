import {allocateCents} from './settlement-documents.mjs';
const RET='http://www.sat.gob.mx/esquemas/retencionpago/2',TFD='http://www.sat.gob.mx/TimbreFiscalDigital',PLAT='http://www.sat.gob.mx/esquemas/retencionpago/1/PlataformasTecnologicas10';
const fail=m=>{throw new Error(m);};
const uuidPattern=/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
const money=v=>{if(!/^\d+(?:\.\d{1,6})?$/.test(String(v??'')))fail('Importe fiscal ilegible.');const n=Math.round(Number(v)*100);if(!Number.isSafeInteger(n))fail('Importe fiscal fuera de rango.');return n;};
const decode=s=>s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,e)=>e[0]==='#'?String.fromCodePoint(e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):Number(e.slice(1))):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[e]);
/** Restricted XML reader: no DTD, entities, network resolution, or executable markup. */
function xmlTree(source){
 if(typeof source!=='string'||source.length>2000000||/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source))fail('XML fiscal no válido o demasiado extenso.');
 const stack=[],roots=[];let cursor=0;
 const re=/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(?:[^<>"']|"[^"]*"|'[^']*')+>/g;
 for(const match of source.matchAll(re)){
  if(source.slice(cursor,match.index).trim().replace(/^\uFEFF/,''))fail('Texto fuera de estructura XML.');cursor=match.index+match[0].length;
  const token=match[0];if(token.startsWith('<?')||token.startsWith('<!--'))continue;
  if(token.startsWith('</')){if(stack.pop()?.qname!==token.slice(2,-1).trim())fail('Etiquetas XML desbalanceadas.');continue;}
  const start=token.match(/^<([\w:.-]+)/);if(!start)fail('Elemento XML no válido.');
  const attrs={},rest=token.slice(start[0].length).replace(/\/?\s*>$/,'');let end=0;
  for(const a of rest.matchAll(/([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/g)){if(rest.slice(end,a.index).trim()||Object.hasOwn(attrs,a[1]))fail('Atributos XML no válidos.');attrs[a[1]]=decode(a[3]);end=a.index+a[0].length;}
  if(rest.slice(end).trim())fail('Atributos XML incompletos.');
  const ns={...(stack.at(-1)?.ns||{})};for(const [k,v]of Object.entries(attrs))if(k==='xmlns')ns['']=v;else if(k.startsWith('xmlns:'))ns[k.slice(6)]=v;
  const bits=start[1].split(':'),node={qname:start[1],name:bits.at(-1),uri:ns[bits.length===2?bits[0]:'']||'',attrs,ns,children:[]};
  if(stack.length)stack.at(-1).children.push(node);else roots.push(node);if(!/\/\s*>$/.test(token))stack.push(node);
 }
 if(stack.length||roots.length!==1||source.slice(cursor).trim())fail('Estructura XML incompleta.');return roots[0];
}
const children=(n,name,uri=RET)=>(n?.children||[]).filter(c=>c.name===name&&c.uri===uri);
const one=(n,name,uri=RET)=>{const rows=children(n,name,uri);if(rows.length!==1)fail('Falta un elemento fiscal único: '+name);return rows[0];};
export function parseRetentionXML(source){
 const root=xmlTree(source);if(root.name!=='Retenciones'||root.uri!==RET||root.attrs.Version!=='2.0')fail('Adjunta un CFDI de Retenciones 2.0.');
 const issuer=one(root,'Emisor').attrs,receiver=one(one(root,'Receptor'),'Nacional').attrs,period=one(root,'Periodo').attrs,totals=one(root,'Totales'),complement=one(root,'Complemento'),stamp=one(complement,'TimbreFiscalDigital',TFD).attrs;
 const uuid=String(stamp.UUID||'').toUpperCase();if(!uuidPattern.test(uuid))fail('UUID de timbrado no válido.');
 const market=issuer.RfcE==='SOM101125UEA'?'Sears':issuer.RfcE==='SHE190630V37'?'Sanborns':null;if(!market)fail('El emisor no corresponde a Sears o Sanborns configurados.');
 const year=Number(period.Ejercicio),fromMonth=Number(period.MesIni),toMonth=Number(period.MesFin);if(!Number.isInteger(year)||year<2000||year>2100||!Number.isInteger(fromMonth)||!Number.isInteger(toMonth)||fromMonth<1||toMonth<fromMonth||toMonth>12)fail('Periodo fiscal no válido.');
 const taxes=children(totals,'ImpRetenidos').map(n=>({code:n.attrs.ImpuestoRet,baseCents:n.attrs.BaseRet==null?null:money(n.attrs.BaseRet),amountCents:money(n.attrs.MontoRet),paymentType:n.attrs.TipoPagoRet}));
 const operationCents=money(totals.attrs.MontoTotOperacion),taxableCents=money(totals.attrs.MontoTotGrav),exemptCents=money(totals.attrs.MontoTotExent),retentionCents=money(totals.attrs.MontoTotRet);
 if(operationCents!==taxableCents+exemptCents||retentionCents!==taxes.reduce((s,t)=>s+t.amountCents,0))fail('Los totales fiscales del XML no cuadran.');
 const platformRows=children(complement,'ServiciosPlataformasTecnologicas',PLAT),platform=platformRows[0];if(platformRows.length!==1)fail('Falta el complemento de plataformas tecnológicas.');
 const a=platform.attrs,vatCents=taxes.filter(t=>t.code==='002').reduce((s,t)=>s+t.amountCents,0),isrCents=taxes.filter(t=>t.code==='001').reduce((s,t)=>s+t.amountCents,0),commissionCents=money(a.MonTotalporUsoPlataforma),transferredVatCents=money(a.TotalIVATrasladado);
 if(vatCents!==money(a.TotalIVARetenido)||isrCents!==money(a.TotalISRRetenido)||operationCents!==money(a.MonTotServSIVA))fail('El complemento fiscal no coincide con los totales.');
 const services=one(platform,'Servicios',PLAT).children.filter(n=>n.name==='DetallesDelServicio'&&n.uri===PLAT).map(n=>({date:n.attrs.FechaServ,baseCents:money(n.attrs.PrecioServSinIVA),commissions:children(n,'ComisionDelServicio',PLAT).map(c=>({baseCents:c.attrs.Base==null?null:money(c.attrs.Base),rate:c.attrs.Porcentaje==null?null:Number(c.attrs.Porcentaje),amountCents:money(c.attrs.Importe)}))}));
 return {uuid,folio:root.attrs.FolioInt||'',issuedAt:root.attrs.FechaExp,stampedAt:stamp.FechaTimbrado,issuerRfc:issuer.RfcE,issuerName:issuer.NomDenRazSocE,recipientRfc:receiver.RfcR,recipientName:receiver.NomDenRazSocR,market,year,fromMonth,toMonth,operationCents,taxableCents,exemptCents,retentionCents,vatCents,isrCents,commissionCents,transferredVatCents,grossCents:operationCents+transferredVatCents,netCents:operationCents+transferredVatCents-commissionCents-retentionCents,taxes,services,related:children(root,'CfdiRetenRelacionados').map(n=>({type:n.attrs.TipoRelacion,uuid:n.attrs.UUID})),source:'SAT · XML timbrado',signatureValidation:'No verificada criptográficamente'};
}
export function certificateCandidates(cert,state){
 return (state.settlementLedger?.cheques||[]).filter(c=>c.market===cert.market).map(c=>{
  const taxLines=c.lines.filter(l=>['CR','DR'].includes(l.code)),taxCents=taxLines.length?-taxLines.reduce((s,l)=>s+l.amountCents,0):null,taxDifferenceCents=taxCents==null?null:taxCents-cert.retentionCents;
  const adjustmentCents=c.lines.filter(l=>['SI','SV'].includes(l.code)).reduce((s,l)=>s+l.amountCents,0),netDifferenceCents=c.totalCents-adjustmentCents-cert.netCents;
  const seen=new Set();let orderGrossCents=0,missing=false;for(const l of c.lines.filter(l=>['LP','NP','NT','LD','ND'].includes(l.code))){const sign=['LD','ND'].includes(l.code)?-1:1,key=l.orderId+'|'+sign;if(seen.has(key))continue;seen.add(key);const order=state.orders.find(o=>o.id===l.orderId);if(!order)missing=true;else orderGrossCents+=sign*order.totalCents;}
  const grossDifferenceCents=missing?null:orderGrossCents-cert.grossCents;
  const netRoundingToleranceCents=Math.min(50,Math.max(2,c.lines.filter(l=>['LP','NP','NT','LD','ND'].includes(l.code)).length*2));
  const days=Math.abs(new Date(c.date)-new Date(cert.issuedAt?.slice(0,10)))/86400000;
  return {chequeId:c.id,number:c.number,date:c.date,taxCents,taxDifferenceCents,netDifferenceCents,adjustmentCents,orderGrossCents,grossDifferenceCents,grossWithinRounding:grossDifferenceCents!=null&&Math.abs(grossDifferenceCents)<=2,exactTax:taxDifferenceCents===0,netRoundingToleranceCents,netWithinRounding:Math.abs(netDifferenceCents)<=netRoundingToleranceCents,days};
 }).filter(c=>c.exactTax||c.netWithinRounding).sort((a,b)=>Number(b.exactTax)-Number(a.exactTax)||Math.abs(a.netDifferenceCents)-Math.abs(b.netDifferenceCents)||a.days-b.days);
}
export function autoCertificateLink(cert,state){
 const candidates=certificateCandidates(cert,state),exact=candidates.filter(c=>c.netWithinRounding&&(c.exactTax||c.grossWithinRounding));
 // Emission date is secondary evidence only. Never choose arbitrarily between equal monetary candidates.
 if(exact.length===1)return {status:'matched',chequeIds:[exact[0].chequeId],basis:exact[0].exactTax?'Retención y neto fiscal cotejados; ajustes SI/SV separados':'Neto fiscal y bruto de pedidos cotejados; retención incluida en el pago NP',candidates};
 const taxOnly=candidates.filter(c=>c.exactTax);if(taxOnly.length===1)return {status:'review',chequeIds:[],basis:'Retención coincidente; revisar neto y ajustes del cheque',candidates};
 return {status:candidates.length?'review':'unmatched',chequeIds:[],basis:candidates.length?'Más de una coincidencia o neto por revisar':'Sin cheque coincidente en la operación',candidates};
}
function allocateTax(cert,cheque,state){
 const groups=new Map();for(const l of cheque.lines.filter(l=>l.orderId&&['LP','NP','NT','LD','ND'].includes(l.code))){const sign=['LD','ND'].includes(l.code)?-1:1,key=l.orderId+'|'+sign;const group=groups.get(key)||{id:l.orderId,sign,lines:[]};group.lines.push(l);groups.set(key,group);}
 const weights=new Map();for(const group of groups.values()){const o=state.orders.find(o=>o.id===group.id),explicit=group.lines.every(l=>Number.isSafeInteger(l.allocationBaseGrossCents)),weight=explicit?group.lines.reduce((s,l)=>s+l.allocationBaseGrossCents,0):group.sign*(o?.totalCents||0);weights.set(group.id,(weights.get(group.id)||0)+weight);}
 const entries=[...weights].map(([id,weight])=>({id,weight}));if(!entries.length||entries.reduce((s,e)=>s+e.weight,0)<=0)return {};
 const vat=allocateCents(cert.vatCents,entries),isr=allocateCents(cert.isrCents,entries),base=allocateCents(cert.operationCents,entries);
 return Object.fromEntries(entries.map(({id})=>[id,{vatCents:vat[id],isrCents:isr[id],retentionCents:vat[id]+isr[id],baseCents:base[id],quality:'allocated',method:'Distribución fiscal por bases del cheque; un bruto por pedido y sentido, sin multiplicarlo por documentos partidos. No es un CFDI individual.'}]));
}
export function applyRetentionImport(state,command,context={}){
 const ledger=state.settlementLedger;if(!ledger)fail('No existe conciliación documental en este espacio.');
 const rows=context.verifiedRetentions;if(!Array.isArray(rows)||!rows.length)fail('Primero carga los XML originales.');
 const imported=[],duplicates=[];ledger.retentionCertificates??=[];
 for(const row of rows){
  const cert=parseRetentionXML(row.xml),expected=state.config.bankReconciliation?.companyRfc;if(!expected||cert.recipientRfc!==expected)fail('El certificado no está emitido al RFC de la empresa configurada.');
  if(row.pdfDocument&&!String(row.pdfDocument.name||'').toUpperCase().includes(cert.uuid))fail('El nombre del PDF original no identifica el UUID de este certificado.');
  const status=row.satStatus;if(!['Activo','Cancelado','No verificado'].includes(status))fail('Registra el estado consultado en SAT.');
  const existing=ledger.retentionCertificates.find(c=>c.uuid===cert.uuid);
  if(existing){
   if(existing.xmlId!==row.xmlDocument.id)fail('El UUID ya existe con un XML diferente. Requiere revisión.');
   if(existing.pdfId&&row.pdfDocument&&existing.pdfId!==row.pdfDocument.id)fail('El certificado ya tiene un PDF distinto; se conserva el original.');
   if(existing.satStatus===status&&(!row.pdfDocument||existing.pdfId===row.pdfDocument.id)&&existing.allocationVersion===3){duplicates.push(cert.uuid);continue;}
  }
  Object.assign(cert,{xmlId:row.xmlDocument.id,pdfId:row.pdfDocument?.id||existing?.pdfId||null,satStatus:status,satCheckedAt:context.now,importedAt:existing?.importedAt||context.now,actor:context.actor,allocationVersion:3,statusHistory:[...(existing?.statusHistory||[]),...(existing?[{status:existing.satStatus,checkedAt:existing.satCheckedAt,actor:existing.actor,chequeIds:existing.chequeIds}]:[])]});
  const match=status==='Activo'?autoCertificateLink(cert,state):{status:status==='Cancelado'?'cancelled':'unverified',chequeIds:[],basis:'No se aplica a impuestos efectivos sin vigencia confirmada',candidates:[]};
  Object.assign(cert,match);cert.allocations={};for(const id of cert.chequeIds){const cheque=ledger.cheques.find(c=>c.id===id);if(ledger.retentionCertificates.some(c=>c.uuid!==cert.uuid&&c.satStatus==='Activo'&&c.chequeIds?.includes(id)))fail('El cheque ya tiene un certificado activo; revisa sustituciones antes de asociar otro.');cert.allocations[id]=allocateTax(cert,cheque,state);}
  for(const doc of [row.xmlDocument,row.pdfDocument].filter(Boolean))if(!ledger.documents.some(d=>d.id===doc.id))ledger.documents.push({...doc,kind:'retention',certificateUuid:cert.uuid});
  if(existing)Object.assign(existing,cert);else ledger.retentionCertificates.push(cert);imported.push({uuid:cert.uuid,status:cert.status,chequeIds:cert.chequeIds,updated:!!existing});
 }
 const message=`${imported.length} certificados fiscales guardados; ${imported.filter(r=>r.status==='matched').length} cotejados con cheque. Depósitos e inventario conservados.`;
 (state.events??=[]).unshift({id:command.id,type:command.type,date:context.now,actor:context.actor,message,result:'ok'});return {ok:true,message,imported,duplicates};
}
export function orderCertificateEvidence(order,state){
 const ledger=state.settlementLedger,chequeIds=new Set((ledger?.cheques||[]).filter(c=>c.lines.some(l=>l.orderId===order.id)).map(c=>c.id));
 return (ledger?.retentionCertificates||[]).filter(c=>c.satStatus==='Activo'&&c.status==='matched'&&c.chequeIds?.some(id=>chequeIds.has(id))).map(c=>({certificate:c,parts:c.chequeIds.filter(id=>chequeIds.has(id)).map(id=>({chequeId:id,...c.allocations?.[id]?.[order.id]}))}));
}
