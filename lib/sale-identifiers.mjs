const str=v=>String(v??'').trim();
const orderKey=v=>str(v).replace(/[\s-]/g,'');
const technicalLine=line=>/^\s*(?:Cotejo directo|Fecha de documento|Fecha del documento|La pantalla no muestra|Ventiapp:|Portal .*verificado|SICAR verificado)/i.test(line);
/** Extract only marked identifiers. Never normalise case, strip S, infer a unit or rewrite source notes. */
export function saleNoteEvidence(order={}){
 const identifiers=[],seen=new Set(),items=order.items||[],single=items.length===1||!items.length;
 const excluded=new Set([order.number,order.literalNumber,...items.flatMap(l=>[l.upc,l.sku])].filter(Boolean).map(str));
 const add=(kind,raw)=>{const id=str(raw);if(!id||excluded.has(id)||seen.has(kind+'|'+id))return false;
 if(kind==='IMEI'?!/^\d{15}$/.test(id):!(/^[A-Za-z0-9][A-Za-z0-9'’-]{5,39}$/.test(id)&&/\d/.test(id)))return false;
 seen.add(kind+'|'+id);identifiers.push({kind,value:id,lineIndex:single?0:null});return true;};
 let comments=String(order.comments||'');
 // The first token is the order reference. At most the first two identifier tokens
 // are consumed; promotional prose is retained verbatim as a normal observation.
 comments=comments.replace(/\*{3}\s*([^\s*]+)([^*]*)\*{3}/g,(match,number,tail)=>{
 if(![order.number,order.literalNumber].some(n=>n&&orderKey(n)===orderKey(number)))return match;
 let rest=tail.trim(),count=0;
 while(count<2&&rest){const m=rest.match(/^([^\s,;]+)(?:[\s,;]+|$)/);if(!m)break;const id=m[1],kind=/^\d{15}$/.test(id)?'IMEI':'Serie';
 // A second token must be the other identifier type, never an unlabelled second serial.
 if(count&&identifiers.some(i=>i.kind===kind))break;
 if(!add(kind,id)&&!seen.has(kind+'|'+id))break;rest=rest.slice(m[0].length).trim();count++;}
 return rest;
 });
 comments=comments.replace(/\b(IMEI(?:\s*[12])?|SERIE|SERIAL(?:\s*NUMBER)?|S\/N|SN)\s*[:#=\-]?\s*([A-Za-z0-9][A-Za-z0-9'’-]{5,39})\b/gi,(match,label,id)=>{const kind=/^IMEI/i.test(label)?'IMEI':'Serie';return add(kind,id)||seen.has(kind+'|'+id)?'':match;});
 comments=comments.split('\n').filter(line=>!technicalLine(line)).join('\n').replace(/^[\s:;,|.\-]+/gm,'').replace(/\n{3,}/g,'\n\n').trim();
 const hasFollowupTerms=/\b(?:reembols\w*|cancel\w*|reintegr\w*|devoluci[oó]n|retorno|retornar)\b/i.test(comments);
 return {identifiers,comments,hasFollowupTerms};
}
export function saleLineIdentifiers(order,line={},index=0){
 const list=[],seen=new Set(),add=(kind,id)=>{if(typeof id!=='string'&&typeof id!=='number')return;const value=str(id);if(value&&!seen.has(kind+'|'+value)){list.push({kind,value});seen.add(kind+'|'+value);}};
 if(!line.identifierOverride){for(const key of ['serial','serialNumber','serie'])add('Serie',line[key]);for(const key of ['imei','imei1','imei2'])add('IMEI',line[key]);
 for(const id of line.serials||[])add('Serie',id);for(const id of line.imeis||[])add('IMEI',id);
 }
 for(const unit of order.marketplace34?.units||[]){if(unit.lineId===line.id&&line.id||!unit.lineId&&unit.sku===line.sku&&(order.items||[]).filter(l=>l.sku===line.sku).length===1){add('Serie',unit.serial);add('IMEI',unit.imei);}}
 if(line.identifierOverride)return list;
 const grouped=saleNoteEvidence(order).identifiers.filter(i=>i.lineIndex===index);
 for(const kind of ['Serie','IMEI']){const stored=list.filter(i=>i.kind===kind);if(!stored.length)for(const id of grouped.filter(i=>i.kind===kind))add(kind,id.value);}
 return list;
}
/** Populate missing single-unit fields only. Explicit unit records take precedence over notes. */
export function assignSaleIdentifiers(order){let added=0,conflicts=0;const notes=saleNoteEvidence(order);
 for(const [index,line] of (order.items||[]).entries()){if(line.qty!==1)continue;
 const ids=saleLineIdentifiers(order,line,index);
 for(const [kind,key,aliases] of [['Serie','serial',['serial','serialNumber','serie']],['IMEI','imei',['imei','imei1','imei2']]]){
 if(aliases.some(k=>str(line[k]))||(kind==='Serie'?line.serials:line.imeis)?.length)continue;
 const candidates=[...new Set(ids.filter(i=>i.kind===kind).map(i=>i.value))];if(candidates.length!==1){if(candidates.length>1)conflicts++;continue;}
 // If a typed unit and a comment disagree, retain the typed unit and original comment.
 const id=candidates[0];line[key]=id;added++;
 }}return {added,conflicts,unassigned:notes.identifiers.filter(i=>i.lineIndex===null).length};
}
export function maintainSaleIdentifiers(state,ctx={}){const markers=(state.config??={}).saleIdentifierMaintenance??={},id='sale-identifiers-20261124';if(markers[id])return null;
 let fields=0,orders=0,conflicts=0;for(const o of state.orders||[]){const r=assignSaleIdentifiers(o);fields+=r.added;conflicts+=r.conflicts;if(r.added)orders++;}const result={fields,orders,conflicts};markers[id]={at:ctx.now,...result};return result;
}
export function operationalSaleHistory(order){return (order.history||[]).filter(h=>!/^\s*(?:Promoción de Liverpool cotejada|Cotejo\b|Consulta\b|Registro importado\b|Estado .*cotejad|Importaci[oó]n\b)/i.test(h.label||''));}
