/**
 * Purchase document interpretation, independent of PDF/OCR transport and state.
 * All extracted money is in integer centavos; absent values remain null.
 * The result is a review draft. Neither PUE nor a supplier's delivery status
 * records a payment, receives merchandise, or changes inventory.
 */

const str = value => value == null ? '' : String(value).trim();
const unique = values => [...new Set(values.filter(Boolean))];
const money = value => Number.isSafeInteger(value) && value >= 0;
const positiveQty = value => Number.isFinite(value) && value > 0;
const AMOUNT = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)\\.\\d{2}';
const NUMBER = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const MONTHS = {enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12};

function normalized(value) {
  return str(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase()
    .replace(/[^A-Z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}

/** Canonical supplier identity for locally confirmed article equivalences. */
export function normalizeSupplier(value) {
  let result = normalized(value)
    .replace(/\b(?:SOCIEDAD ANONIMA(?: DE CAPITAL VARIABLE)?|SOCIEDAD DE RESPONSABILIDAD LIMITADA(?: DE CAPITAL VARIABLE)?)\b/g,' ')
    .replace(/\b(?:S A(?: P I)?|SA(?:PI)?|S DE R L|S DE RL)(?: DE)? (?:C V|CV)\b/g,' ')
    .replace(/\b(?:S A|SA|S DE R L|S DE RL)\b$/,'').trim().replace(/\s+/g,' ');
  if (/^COSTCO(?: (?:DE )?MEXICO)?$/.test(result)) result = 'COSTCO';
  return result;
}

/** Supplier references are strings: retain leading zeros and meaningful punctuation. */
export function normalizeSupplierOrder(value) {
  return str(value).normalize('NFKC').toUpperCase().replace(/\s+/g,'');
}

const MERIDIEM='[AP]\\s*\\.?\\s*M\\.?';
const DATE_REFERENCE='(?:(?:0?[1-9]|[12]\\d|3[01])\\s*[/-]\\s*(?:0?[1-9]|1[0-2])\\s*[/-]\\s*(?:20\\d{2}|\\d{2})|20\\d{2}\\s*-\\s*(?:0?[1-9]|1[0-2])\\s*-\\s*(?:0?[1-9]|[12]\\d|3[01]))';
const CLOCK_REFERENCE=`(?:(?:[01]?\\d|2[0-3])\\s*:\\s*[0-5]\\d(?:\\s*:\\s*[0-5]\\d(?:[.,]\\d+)?)?(?:\\s*${MERIDIEM})?|(?:[01]\\d|2[0-3])[0-5]\\d(?:[0-5]\\d)?\\s*${MERIDIEM}|(?:[01]?\\d|2[0-3])\\s*${MERIDIEM})`;
const COMPACT_CLOCK='(?:[01]\\d|2[0-3])[0-5]\\d[0-5]\\d';
const TIME_ZONE='(?:\\s*(?:Z|UTC|[+-]\\d{2}:?\\d{2}))?';
const TEMPORAL_REFERENCE=`(?:${DATE_REFERENCE}(?:(?:T|\\s)+${CLOCK_REFERENCE}${TIME_ZONE})?|${CLOCK_REFERENCE}${TIME_ZONE})`;

/** Reject clear dates and clocks, never a numeric folio merely resembling HHMMSS. */
export function isTemporalSupplierOrder(value,options={}) {
  if(new RegExp(`^${TEMPORAL_REFERENCE}$`,'i').test(str(value).normalize('NFKC')))return true;
  const reference=normalizeSupplierOrder(value),context=str(options?.context).normalize('NFKC');
  if(!new RegExp(`^${COMPACT_CLOCK}$`).test(reference)||!context)return false;
  // A six-digit folio is valid on its own. It is ambiguous only when the
  // extraction itself places it immediately after a date in a reordered
  // header. An explicit label/value pair is not invalidated by coincidence.
  const orderField='(?:(?:N[UÚ]MERO|N[UÚ]M\\.?|NRO\\.?|NO\\.?|N[º°]\\.?)\\s*(?:DE\\s+)?(?:ORDEN|ORDN|PEDIDO)|ORDEN(?:\\s+DE\\s+COMPRA)?|PEDIDO|PURCHASE\\s+ORDER)';
  if(new RegExp(`\\b${orderField}\\s*[:#=]?\\s*${reference}\\b`,'i').test(context))return false;
  if(!new RegExp(`\\b(?:${orderField}|FECHA\\s+DE\\s+(?:CREACI[OÓ]N|COMPRA))\\b`,'i').test(context))return false;
  return compactDateTimes(context).some(candidate=>candidate.value===reference);
}

function compactDateTimes(source) {
  const expression=new RegExp(`(?<![A-Z0-9_/-])(${DATE_REFERENCE})[ \\t\\r\\n]{1,20}(${COMPACT_CLOCK})(?![A-Z0-9_/-])`,'gi');
  return [...source.matchAll(expression)].map(match=>({value:match[2],index:match.index+match[0].lastIndexOf(match[2]),evidence:match[0]}));
}

function withoutTemporalReferences(source) {
  // Keep offsets/newlines intact for label matching and original evidence. A
  // non-whitespace barrier prevents a label from jumping over an unrelated
  // timestamp. Boundaries protect IDs such as OC-2026-10-19 from partial masks.
  return source.replace(new RegExp(`(?<![A-Z0-9_/-])${TEMPORAL_REFERENCE}(?![A-Z0-9_/-])`,'gi'),
    value=>value.replace(/[^\r\n]/g,'~'));
}

function readSupplierOrder(source) {
  const candidates=[],unresolved=[],rejected=[],scanSource=withoutTemporalReferences(source);
  const originalEvidence=match=>source.slice(match.index,match.index+match[0].length);
  const numberLabel='(?:N[UÚ]MERO|N[UÚ]M\\.?|NRO\\.?|NO\\.?|N[º°]\\.?)';
  const orderLabel='(?:ORDEN(?:\\s+DE\\s+COMPRA)?|ORDN|PEDIDO|PURCHASE\\s+ORDER)';
  const numberedLabel=`${numberLabel}\\s*(?:DE\\s+)?${orderLabel}`;
  const token='(?:\\d{1,3}(?:[ \\t]+\\d{3}){1,5}|[A-Z0-9][A-Z0-9_/-]{2,39})';
  const valid=value=>/^[A-Z0-9][A-Z0-9_/-]{2,39}$/.test(value)&&/\d/.test(value)
    &&!/^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$/.test(value)&&!isTemporalSupplierOrder(value)&&!UUID.test(value);
  const add=(value,evidence,sourceType='label')=>{
    const reference=normalizeSupplierOrder(value);
    if(valid(reference))candidates.push({value:reference,evidence:str(evidence).slice(0,350),source:sourceType});
  };
  // The explicit number label is stronger than the footer URL and works when
  // PDF.js emits its value on the following line or OCR drops the e in orden.
  for(const match of scanSource.matchAll(new RegExp(`\\b${numberedLabel}\\s*[:#=]?\\s*(${token})\\b`,'gi')))add(match[1],originalEvidence(match));
  for(const match of scanSource.matchAll(new RegExp(`\\b${orderLabel}\\s*(?:NUMBER|${numberLabel}|#)?\\s*[:=]\\s*(${token})\\b`,'gi')))add(match[1],originalEvidence(match));
  for(const match of scanSource.matchAll(new RegExp(`(?:^|\\n)\\s*${orderLabel}\\s*(?:NUMBER|${numberLabel}|#)?\\s*(${token})[ \\t]*(?:\\n|$)`,'gi')))add(match[1],originalEvidence(match));
  for(const match of scanSource.matchAll(new RegExp(`(?:^|\\n)[ \\t]*(${token})[ \\t]*\\n[ \\t]*${numberedLabel}\\b`,'gi')))add(match[1],originalEvidence(match));

  // A browser print may place all table headings before the row's values.
  // Only consider this bounded header shape; never search past another folio,
  // item table, payment value or shipping address for a convenient number.
  for(const label of scanSource.matchAll(new RegExp(`\\b${numberedLabel}\\b`,'gi'))){
    const tail=scanSource.slice(label.index+label[0].length,label.index+label[0].length+260);
    if(!/^\s*(?:Forma\s+de\s+pago|Fecha\s+de\s+creaci[oó]n|Direcci[oó]n\s+del\s+estado)/i.test(tail))continue;
    const bounded=tail.split(/\b(?:Folio|Factura|Invoice|Subtotal|Cantidad|Descripci[oó]n|Art[ií]culos?|Item|Resumen|Rastreo|Visa|Mastercard|Amex|Estatus|Direcci[oó]n\s+de\s+env[ií]o)\b/i)[0];
    const tailStart=label.index+label[0].length,original=source.slice(tailStart,tailStart+bounded.length);
    const values=[...bounded.matchAll(/(?<![A-Z0-9_/-])\d{6,20}(?![A-Z0-9_/-])/gi)];
    const clocks=compactDateTimes(original),plausible=[];
    for(const match of values){
      const clock=clocks.find(candidate=>candidate.value===match[0]&&candidate.index===match.index);
      if(clock){
        rejected.push({value:match[0],reason:'date_time_context',evidence:clock.evidence});
        continue;
      }
      plausible.push(match);
    }
    const distinct=unique(plausible.map(match=>match[0]));
    if(distinct.length===1){const match=plausible[0];add(match[0],source.slice(label.index,tailStart+match.index+match[0].length));}
    else if(distinct.length>1){
      unresolved.push(distinct);
      for(const match of plausible)rejected.push({value:match[0],reason:'ambiguous_columns',evidence:source.slice(label.index,tailStart+match.index+match[0].length)});
    }
  }
  for(const match of source.matchAll(/\/my-account\/order\/([A-Z0-9_-]{3,40})(?=[/?#\s]|$)/gi))add(match[1],match[0],'url');
  const values=unique(candidates.map(candidate=>candidate.value));
  // A footer URL or another explicit pair may corroborate an ambiguous row;
  // otherwise leave it for review instead of choosing its first number.
  const ambiguous=unresolved.some(group=>values.length!==1||!group.includes(values[0]));
  const resultValues=ambiguous?unique([...values,...unresolved.flat()]):values;
  return {value:values.length===1&&!ambiguous?values[0]:null,candidates:resultValues,conflict:values.length>1,ambiguous,
    rejected:rejected.filter(candidate=>!values.includes(candidate.value)),
    evidence:candidates.find(candidate=>candidate.value===values[0])?.evidence||null,
    source:candidates.find(candidate=>candidate.value===values[0])?.source||null};
}

function cents(value) {
  const clean = str(value).replace(/^(?:MXN|USD|CAD)\s*/i,'').replace(/^\$\s*/,'').replace(/\s*(?:MXN|USD|CAD)$/i,'');
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(clean)) return null;
  const [whole,decimals=''] = clean.replace(/,/g,'').split('.');
  const result = Number(whole)*100 + Number(decimals.padEnd(2,'0'));
  return money(result) ? result : null;
}

function quantity(value) {
  const clean = str(value);
  if (!/^\d+(?:\.\d+)?$/.test(clean)) return null;
  const result = Number(clean);
  return positiveQty(result) ? result : null;
}

function isoDate(year,month,day) {
  const y=Number(year),m=Number(month),d=Number(day);
  if (y < 2000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y,m-1,d));
  return dt.getUTCFullYear()===y && dt.getUTCMonth()===m-1 && dt.getUTCDate()===d
    ? `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` : null;
}

function dateIn(value) {
  let match = str(value).match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (match) return {value:isoDate(match[1],match[2],match[3]),evidence:match[0]};
  match = str(value).match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  if (match) return {value:isoDate(match[3],match[2],match[1]),evidence:match[0]};
  match = str(value).match(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+de\s+(20\d{2})\b/i);
  return match ? {value:isoDate(match[3],MONTHS[match[2].toLowerCase()],match[1]),evidence:match[0]} : null;
}

function barcode(value) {
  const clean = str(value).replace(/[\s-]/g,'');
  return /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(clean) ? clean.padStart(14,'0') : null;
}

function explicitBarcode(value) {
  const match = str(value).match(/\b(?:UPC|EAN(?:-13)?|GTIN(?:-1[234])?)\s*[:#-]?\s*(\d{8}|\d{12,14})(?!\d)/i);
  return match && barcode(match[1]) ? match[1] : null;
}

function documentMoney(flat,pattern) {
  const match = flat.match(new RegExp(`(?:${pattern})\\s*:?[ \\t]*\\$?\\s*(${AMOUNT})(?!\\d)`,'i'));
  return match ? {value:cents(match[1]),evidence:match[0]} : null;
}

function baseLine(fields) {
  return {supplierItem:null,name:'',qty:null,upc:null,unitCostCents:null,totalCents:null,
    subtotalCents:null,discountCents:null,taxCents:null,...fields};
}

function readCfdiLines(flat,warnings) {
  const pattern = new RegExp(`(?:^|\\s)(\\d{8})\\s+([A-Z0-9][A-Z0-9._/-]{1,39})\\s+([A-Z]\\d{2})\\s+(?:(?:Piezas?|PZAS?|Unidades?|Servicios?)\\s+)?(\\d+(?:\\.\\d+)?)\\s+(.{1,400}?)\\s+(${AMOUNT})\\s+(${AMOUNT})\\s+(${AMOUNT})\\s+(0[123])\\s+(${NUMBER})\\s+(00[123])\\s+Tasa\\s+(0?\\.\\d+|1(?:\\.0+)?)\\s+(${AMOUNT})(?!\\d)`,'gi');
  const lines = [];
  for (const match of flat.matchAll(pattern)) {
    const qty = quantity(match[4]), subtotalCents=cents(match[7]),discountCents=cents(match[8]),taxCents=cents(match[13]);
    const total = money(subtotalCents) && money(discountCents) && money(taxCents) ? subtotalCents-discountCents+taxCents : null;
    const totalCents = money(total) ? total : null;
    if (!qty || totalCents == null) warnings.push('Una partida tiene cantidad o importe inconsistente; revísala contra el documento.');
    lines.push(baseLine({supplierItem:match[2],name:match[5].trim(),qty,upc:explicitBarcode(match[5]),
      unitCostCents:qty && totalCents != null ? Math.round(totalCents/qty) : null,totalCents,subtotalCents,discountCents,taxCents,
      listedUnitPriceCents:cents(match[6]),taxBase:match[10],taxRate:Number(match[12]),satProductCode:match[1],satUnitCode:match[3],
      evidence:{line:match[0].trim().slice(0,600),unitCost:'Importe menos descuento más impuesto de la partida, dividido entre su cantidad.'}}));
  }
  return lines;
}

function precedingDescription(source,markerIndex) {
  const preceding = source.slice(Math.max(0,markerIndex-600),markerIndex).trim();
  const lines = preceding.split('\n').map(v=>v.trim()).filter(Boolean);
  let name = lines.at(-1) || '';
  if (lines.length===1 || name.length>240) {
    const candidates = [...preceding.matchAll(/\b(?:Total|Producto|Descripción|Descripcion)\s*:?\s+/gi)];
    if (!candidates.length) return null;
    const last=candidates.at(-1);
    name=preceding.slice(last.index+last[0].length).trim();
  }
  name = name.replace(/^(?:Producto|Descripción|Descripcion)\s*:\s*/i,'').trim();
  return name.length>=3 && name.length<=240 && !/^(?:Total|Estatus|Cantidad|Resumen de tu orden)$/i.test(name) ? name : null;
}

function readCostcoOrderLines(source,warnings) {
  const markers = [...source.matchAll(/#[ \t]*(\d{3,20})(?!\d)/g)];
  return markers.flatMap((marker,index)=>{
    const name=precedingDescription(source,marker.index);
    if (!name) {warnings.push(`No se pudo separar el nombre del artículo ${marker[1]}; revisa la captura del proveedor.`);return [];}
    const after=source.slice(marker.index+marker[0].length,markers[index+1]?.index ?? source.length);
    const qtyMatch=after.match(/\bCantidad\s*:?\s*(\d+(?:\.\d+)?)(?![\d.])/i);
    const qty=qtyMatch ? quantity(qtyMatch[1]) : null;
    const cost=documentMoney(after,'(?:Precio|Costo)\\s+unitario');
    const lineTotal=documentMoney(after,'Importe\\s+del\\s+art[ií]culo');
    if (!qty) warnings.push(`El artículo ${marker[1]} no tiene una cantidad legible junto a «Cantidad».`);
    return [baseLine({supplierItem:marker[1],name,qty,upc:explicitBarcode(`${name}\n${after}`),
      unitCostCents:cost?.value ?? null,totalCents:lineTotal?.value ?? null,
      evidence:{line:`${name}\n${marker[0]}${qtyMatch ? `\n${qtyMatch[0]}` : ''}`}})];
  });
}

function columnName(value) {
  const s=normalized(value);
  if (/^(?:CANTIDAD|CANT|QTY|QUANTITY|UNIDADES)$/.test(s)) return 'qty';
  if (/^(?:DESCRIPCION|DESCRIPTION|PRODUCTO|PRODUCT|NOMBRE)$/.test(s)) return 'name';
  if (/^(?:ARTICULO|ITEM|NUMERO DE ARTICULO|NO DE ARTICULO|CODIGO|SKU|CLAVE|NO DE IDENTIFICACION)$/.test(s)) return 'supplierItem';
  if (/^(?:UPC|EAN|EAN 13|GTIN|GTIN 13|GTIN 14)$/.test(s)) return 'upc';
  if (/^(?:PRECIO UNITARIO|COSTO UNITARIO|UNIT PRICE|VALOR UNITARIO)$/.test(s)) return 'listedUnitPriceCents';
  if (/^(?:IMPORTE|TOTAL|LINE TOTAL|TOTAL PARTIDA)$/.test(s)) return 'totalCents';
  return null;
}

function readGenericTable(source,warnings) {
  const rows=source.split('\n').map(line=>line.trim()).filter(Boolean);
  for (let i=0;i<rows.length;i++) {
    const delimiter=rows[i].includes('|') ? /\s*\|\s*/ : rows[i].includes('\t') ? /\t+/ : /\s{2,}/;
    const leadingPipe=rows[i].startsWith('|'),trailingPipe=rows[i].endsWith('|');
    const split=row=>{
      const cells=row.split(delimiter).map(str);
      if (leadingPipe && cells[0]==='') cells.shift();
      if (trailingPipe && cells.at(-1)==='') cells.pop();
      return cells;
    };
    const headings=split(rows[i]).map(columnName);
    if (!headings.includes('name') || !headings.includes('qty')) continue;
    const result=[];
    for (let j=i+1;j<rows.length;j++) {
      const cells=split(rows[j]);
      if (/^[-|\s:]+$/.test(rows[j])) continue;
      if (cells.length!==headings.length) {if (result.length) break;continue;}
      const fields={};
      headings.forEach((field,k)=>{if (field) fields[field]=cells[k];});
      const qty=quantity(fields.qty);
      if (!fields.name || !qty) {if (result.length) break;continue;}
      const totalCents=cents(fields.totalCents),listedUnitPriceCents=cents(fields.listedUnitPriceCents);
      // A generic price column may exclude tax. Keep it as quoted price and
      // only treat an explicitly supplied line total as the final cost.
      result.push(baseLine({supplierItem:str(fields.supplierItem)||null,name:fields.name,qty,
        upc:barcode(fields.upc) ? str(fields.upc) : null,totalCents,listedUnitPriceCents,
        unitCostCents:totalCents!=null ? Math.round(totalCents/qty) : null,evidence:{line:rows[j].slice(0,600)}}));
    }
    if (result.length) {
      warnings.push('Tabla genérica detectada: confirma si los importes por partida incluyen impuestos, descuentos y envío.');
      return result;
    }
  }
  return [];
}

/**
 * Interpret extracted PDF text (including OCR text) into an editable draft.
 * Supports the Costco order/CFDI layouts and conservative delimited tables.
 * It does not perform OCR, guarantee recognition, or confirm fiscal validity.
 */
export function parsePurchaseDocument(text,{fileName='',kind}={}) {
  if (typeof text!=='string') throw new TypeError('El texto del documento debe ser una cadena.');
  if (text.length>2_000_000) throw new Error('El documento excede el límite de texto para revisión de compras.');
  const source=text.normalize('NFC').replace(/\r\n?/g,'\n').replace(/[\u00a0\u202f]/g,' ')
    .split('\n').filter(line=>!/^\s*(?:W\s+){5,}W?\s*$/.test(line)).join('\n');
  const flat=source.replace(/\s+/g,' ').trim();
  const warnings=[],evidence={};
  const isCostco=/\bCOSTCO\b/i.test(source) || /\bcostco\b/i.test(fileName);
  const inferred=/\b(?:CFDI|FOLIO FISCAL|TIPO DE COMPROBANTE)\b/i.test(flat) || UUID.test(flat) ? 'invoice'
    : /\b(?:Detalles de Mi Orden|Orden de Compra|Purchase Order|(?:N[uú]mero|N[uú]m\.?|Nro\.?|No\.?|N[º°])\s*(?:de\s+)?(?:orden|ordn|pedido))\b/i.test(flat) || /\/my-account\/order\//i.test(flat) ? 'order' : 'unknown';
  const selected=['order','invoice'].includes(kind) ? kind : inferred;
  if (selected!==inferred && inferred!=='unknown') warnings.push('El tipo seleccionado difiere del contenido detectado; confirma orden o factura.');
  const result={kind:selected,fileName:str(fileName),supplier:null,supplierOrder:null,date:null,orderDate:null,
    invoiceNumber:null,uuid:null,supplierFolio:null,currency:null,subtotalCents:null,discountCents:null,taxCents:null,totalCents:null,
    paymentMethod:null,paymentForm:null,lines:[],parser:'unrecognized',warnings,evidence,requiresReview:true};
  const record=(field,value,excerpt)=>{if(value!=null && value!==''){result[field]=value;evidence[field]=str(excerpt).slice(0,350);}};
  if (isCostco) {
    const supplier=flat.match(/\bCOSTCO\s+DE\s+M[EÉ]XICO\b/i);
    record('supplier',supplier ? supplier[0] : 'Costco',supplier?.[0] || (/costco/i.test(source) ? 'Costco en el documento' : `Nombre del archivo: ${fileName}`));
  } else {
    const supplier=source.match(/(?:^|\n)\s*(?:Proveedor|Supplier|Emisor)\s*:\s*([^\n|]{2,180})/i);
    if (supplier) record('supplier',supplier[1].trim(),supplier[0]);
  }
  const orderReference=readSupplierOrder(source);
  result.supplierOrderCandidates=orderReference.candidates;result.supplierOrderConflict=orderReference.conflict;
  result.supplierOrderNeedsReview=!orderReference.value;
  result.supplierOrderRejectedCandidates=orderReference.rejected;
  if(orderReference.value){record('supplierOrder',orderReference.value,orderReference.evidence);result.supplierOrderSource=orderReference.source;}
  else if(orderReference.conflict)warnings.push('El documento muestra números de orden contradictorios: '+orderReference.candidates.join(', ')+'. Revisa la referencia antes de vincularlo.');
  else if(orderReference.ambiguous)warnings.push('Las columnas del documento contienen varios números posibles de orden: '+orderReference.candidates.join(', ')+'. Confirma la referencia; no se eligió el primer número.');
  else warnings.push('No se reconoció el número de orden del proveedor. Confirma la referencia antes de vincular el documento a una compra.');
  if(orderReference.rejected.some(candidate=>candidate.reason==='date_time_context'))warnings.push('Se descartó un número junto a la fecha de compra porque puede ser la hora sin separadores. Revisa la referencia detectada en el documento.');
  const currency=flat.match(/\b(?:Moneda|Currency)\s*:?\s*(MXN|USD|CAD|EUR)\b/i);
  if (currency) record('currency',currency[1].toUpperCase(),currency[0]);
  const summaries={subtotalCents:'\\bSub\\s*Total',discountCents:'\\bDescuento',
    taxCents:'\\bIVA(?:\\s+al\\s+\\d+(?:\\.\\d+)?\\s*%)?',totalCents:'(?<![A-Za-z])(?<!Sub )(?<!Sub  )Total'};
  for (const [field,label] of Object.entries(summaries)) {
    const amount=documentMoney(flat,label);
    if (amount) record(field,amount.value,amount.evidence);
  }
  if (selected==='invoice') {
    const uuid=flat.match(UUID);
    if (uuid) record('uuid',uuid[0].toLowerCase(),uuid[0]);
    let number=flat.match(/\bFOLIO FISCAL\s*:\s*([A-Z]{1,8}\s+\d{3,20})\b/i)
      || flat.match(/\b(?:Factura|Invoice)(?:\s+(?:No\.?|N[uú]mero|#))?\s*:\s*([A-Z0-9][A-Z0-9_/-]{2,39})\b/i);
    // PDF.js can emit this Costco header column-by-column: all labels first,
    // then their values. The printed series/folio still directly precedes its
    // UUID. Require that bounded fiscal header and an actual textual pair;
    // filenames and the order reference are never invoice-number evidence.
    if (!number && isCostco && uuid) {
      const fiscalHeader=flat.search(/\bFOLIO FISCAL\s*:/i);
      if (fiscalHeader>=0 && uuid.index>fiscalHeader && uuid.index-fiscalHeader<=1200) {
        const header=flat.slice(fiscalHeader,uuid.index).trim();
        number=header.match(/\b([A-Z]{2,6}\s+\d{5,12})$/);
      }
    }
    if (number) record('invoiceNumber',number[1].replace(/\s+/g,' '),number[0]);
    const folio=flat.match(/\bFolio\s*:\s*(\d{6,30}(?:_\d+)?)\b/i);
    if (folio) record('supplierFolio',folio[1],folio[0]);
    const spanish=flat.match(/\b\d{1,2}\s+de\s+[a-záéíóú]+\s+de\s+20\d{2}\b/i);
    const dated=spanish ? dateIn(spanish[0]) : dateIn(flat.match(/Fecha(?:\s+(?:de\s+)?(?:emisi[oó]n|factura))\s*:?\s*.{0,100}/i)?.[0]);
    if (dated?.value) record('date',dated.value,dated.evidence);
    const orderDate=flat.match(/\bOrden\s*:.{0,150}?\bFecha\s*:\s*(\d{1,2}\/\d{1,2}\/20\d{2})/i);
    if (orderDate) record('orderDate',dateIn(orderDate[1])?.value,orderDate[0]);
    const method=flat.match(/M[eé]todo de Pago\s*:\s*(PUE|PPD)\b/i);
    if (method) {
      record('paymentMethod',method[1].toUpperCase(),method[0]);
      warnings.push('El método de pago del documento es informativo; no registra abonos ni confirma una liquidación en AIMERKA.');
    }
    const form=flat.match(/Forma de Pago\s*:\s*(\d{2})\b/i);
    if (form) record('paymentForm',form[1],form[0]);
    result.lines=readCfdiLines(flat,warnings);
    if (result.lines.length) result.parser=isCostco ? 'costco_invoice' : 'cfdi_table';
  }
  if (selected==='order') {
    const heading=flat.match(/Fecha de creaci[oó]n.{0,450}/i)
      || flat.match(/Fecha(?:\s+(?:de\s+)?(?:orden|pedido|compra))?\s*:\s*.{0,100}/i);
    const dated=heading ? dateIn(heading[0]) : null;
    if (dated?.value) record('date',dated.value,dated.evidence);
    const itemLayout=/\bDetalles de tu orden\b/i.test(flat)&&/#[ \t]*\d{3,20}(?!\d)/.test(source)&&/\bCantidad\s*:?\s*\d/i.test(source);
    if (isCostco||itemLayout) {result.lines=readCostcoOrderLines(source,warnings);if (result.lines.length) result.parser=isCostco?'costco_order':'order_item_layout';}
    if (/\b(?:Entregado|Enviada|Enviado)\b/i.test(flat)) warnings.push('El estado del proveedor no confirma recepción en almacén. Recibe las unidades físicamente para aumentar existencias.');
  }
  if (!result.lines.length) {
    result.lines=readGenericTable(source,warnings);
    if (result.lines.length) result.parser='generic_table';
  }
  if (!result.lines.length) warnings.push('No se reconocieron partidas con suficiente certeza. Captura o corrige los artículos antes de registrar la compra.');
  if (result.lines.some(line=>!Number.isInteger(line.qty) && line.qty!=null)) warnings.push('Hay cantidades fraccionarias; confirma la unidad de medida antes de importar.');
  if (result.lines.some(line=>line.unitCostCents==null)) warnings.push('Faltan costos legibles de una o más partidas; se conservarán pendientes, sin inventar precios.');
  if (result.totalCents==null) warnings.push('El total no es legible. Confírmalo con las facturas o introdúcelo manualmente; no se toma de publicidad o precios actuales.');
  if (!result.lines.some(line=>line.upc)) warnings.push('No se detectó un UPC/EAN explícito en las partidas; puede agregarse al recibir la mercancía.');
  if (money(result.subtotalCents) && money(result.discountCents) && money(result.taxCents) && money(result.totalCents)
      && Math.abs(result.subtotalCents-result.discountCents+result.taxCents-result.totalCents)>1) warnings.push('Subtotal, descuento, IVA y total no coinciden; verifica los importes extraídos.');
  if (result.lines.length && result.lines.every(line=>money(line.totalCents)) && money(result.totalCents)
      && Math.abs(result.lines.reduce((sum,line)=>sum+line.totalCents,0)-result.totalCents)>1) warnings.push('El total de las partidas difiere del total del documento; revisa envío, descuentos o cargos adicionales.');
  result.warnings=unique(warnings);
  return result;
}

function productName(product) {return str(product.name || product.title || product.description);}
function productBarcodes(product) {return unique([product.upc,product.ean,product.gtin,...(Array.isArray(product.barcodes) ? product.barcodes : [])].map(barcode));}
function supplierItem(value) {return str(value).toUpperCase().replace(/\s+/g,'');}
function candidate(product,score,reason) {return {sku:str(product.sku),name:productName(product),upc:str(product.upc)||null,score,reason};}

/** Exact matches may populate an SKU. Ambiguous/fuzzy matches never do. */
export function matchPurchaseLine(line,products=[],equivalences=[],supplier='') {
  const catalog=(Array.isArray(products) ? products : []).filter(product=>str(product?.sku));
  const rawUpc=str(line?.upc || line?.ean || line?.gtin),upc=barcode(rawUpc);
  const supplierKey=normalizeSupplier(supplier),item=supplierItem(line?.supplierItem || line?.item),name=normalized(line?.name || line?.title);
  const finish=(matched,confidence,reason)=>{
    const distinct=[...new Map(matched.map(product=>[str(product.sku),product])).values()];
    if (!distinct.length) return null;
    const conflict=rawUpc && (!upc || distinct.some(product=>productBarcodes(product).length && !productBarcodes(product).includes(upc)));
    const exact=distinct.length===1 && !conflict;
    return {sku:exact ? str(distinct[0].sku) : null,confidence:exact ? confidence : 'suggestion',
      candidates:distinct.map(product=>candidate(product,1,conflict ? 'El código de barras no coincide; requiere revisión.' : distinct.length>1 ? `Coincidencia ambigua: ${reason}` : reason))};
  };
  if (upc) {
    const found=finish(catalog.filter(product=>productBarcodes(product).includes(upc)),'exact_upc','UPC/EAN coincidente');
    if (found) return found;
  }
  if (supplierKey && (item || name)) {
    const aliases=[];
    for (const product of catalog) for (const alias of product.supplierCodes || []) aliases.push({...alias,sku:product.sku});
    for (const alias of Array.isArray(equivalences) ? equivalences : []) aliases.push(alias);
    const eligible=aliases.filter(alias=>normalizeSupplier(alias.supplier)===supplierKey);
    if (item) {
      const skus=new Set(eligible.filter(alias=>supplierItem(alias.item || alias.supplierItem)===item).map(alias=>str(alias.sku)));
      const found=finish(catalog.filter(product=>skus.has(str(product.sku))),'supplier_item','Artículo del proveedor en una equivalencia guardada');
      if (found) return found;
    }
    if (name) {
      const skus=new Set(eligible.filter(alias=>normalized(alias.name)===name).map(alias=>str(alias.sku)));
      const found=finish(catalog.filter(product=>skus.has(str(product.sku))),'name','Nombre exacto en una equivalencia del proveedor');
      if (found) return found;
    }
  }
  if (name) {
    const found=finish(catalog.filter(product=>normalized(productName(product))===name),'name','Nombre normalizado exacto');
    if (found) return found;
  }
  const stop=new Set(['DE','DEL','LA','EL','LOS','LAS','Y','CON','PARA','EN']);
  const tokens=value=>new Set(normalized(value).split(' ').filter(token=>token && !stop.has(token)));
  const target=tokens(name);
  const candidates=catalog.map(product=>{
    const other=tokens(productName(product));
    let shared=0;
    for (const token of target) if (other.has(token)) shared++;
    const score=target.size+other.size ? 2*shared/(target.size+other.size) : 0;
    return candidate(product,Math.round(score*1000)/1000,'Similitud de nombre; confirma manualmente el producto.');
  }).filter(value=>value.score>=0.45).sort((a,b)=>b.score-a.score || a.sku.localeCompare(b.sku)).slice(0,5);
  return {sku:null,confidence:candidates.length ? 'suggestion' : 'unmatched',candidates};
}

function sumKnown(values) {
  if (!values.length || values.some(value=>!money(value))) return null;
  const result=values.reduce((sum,value)=>sum+value,0);
  return money(result) ? result : null;
}

function invoiceLineMatches(line,lines) {
  const upc=barcode(line.upc),item=supplierItem(line.supplierItem),name=normalized(line.name);
  if (upc) {
    const matches=lines.filter(other=>barcode(other.upc)===upc);
    if (matches.length) return matches;
  }
  if (item) {
    const matches=lines.filter(other=>supplierItem(other.supplierItem)===item);
    if (matches.length) return matches;
    // A similar printed name cannot override an explicitly different item ID.
    // Name matching remains available when the order has no supplier item yet.
    const missingItems=lines.filter(other=>!supplierItem(other.supplierItem));
    return name ? missingItems.filter(other=>normalized(other.name)===name) : [];
  }
  return name ? lines.filter(other=>normalized(other.name)===name) : [];
}

/**
 * Combine wrappers {id,sha256,parsed} or parser results. An order defines the
 * ordered quantity; invoices cover it rather than creating duplicate units.
 * Complete invoice coverage may fill prices absent from the order. Partial
 * invoices leave the unknown remainder and purchase total pending.
 */
export function combinePurchaseDocuments(documents=[]) {
  const warnings=[],blockingWarnings=[],duplicates=[],seen=new Map(),docs=[];
  for (const [index,container] of documents.entries()) {
    if (!container || typeof container!=='object') continue;
    const parsed=container.parsed || container;
    const id=str(container.id || parsed.id) || `document-${index+1}`;
    const hash=str(container.sha256 || container.hash || parsed.sha256 || parsed.hash).toLowerCase();
    const uuid=str(parsed.uuid).toLowerCase();
    const supplier=normalizeSupplier(parsed.supplier),invoiceNumber=normalizeSupplierOrder(parsed.invoiceNumber);
    const folioKey=parsed.kind==='invoice'&&supplier&&invoiceNumber?`invoice_folio:${supplier}:${invoiceNumber}`:null;
    const keys=[uuid && `uuid:${uuid}`,hash && `sha256:${hash}`,folioKey].filter(Boolean);
    const duplicateKey=keys.find(key=>seen.has(key)&&(key!==folioKey||!uuid||!str(seen.get(key).parsed.uuid)));
    if (duplicateKey) {
      const previous=seen.get(duplicateKey);
      duplicates.push({documentId:id,duplicateOf:previous.id,reason:duplicateKey.split(':')[0],uuid:uuid||null});
      warnings.push(`El documento ${id} ya estaba incluido por ${duplicateKey.startsWith('uuid:') ? 'UUID' : duplicateKey.startsWith('invoice_folio:') ? 'proveedor y folio de factura' : 'huella del archivo'}; no se sumó dos veces.`);
      if (money(parsed.totalCents) && money(previous.parsed.totalCents) && parsed.totalCents!==previous.parsed.totalCents) blockingWarnings.push('Dos copias del mismo documento tienen importes distintos; revisa la extracción.');
      for(const [field,normalize] of [['supplierOrder',normalizeSupplierOrder],['supplier',normalizeSupplier],['currency',normalizeSupplierOrder]]){
        const first=normalize(previous.parsed[field]),next=normalize(parsed[field]);
        if(first&&next&&first!==next)blockingWarnings.push('Dos copias del mismo documento tienen referencias distintas de orden, proveedor o moneda; revisa la extracción.');
      }
      const signature=lines=>JSON.stringify((lines||[]).map(line=>[supplierItem(line.supplierItem)||barcode(line.upc)||normalized(line.name),line.qty]).sort());
      if(parsed.lines?.length&&previous.parsed.lines?.length&&signature(parsed.lines)!==signature(previous.parsed.lines))blockingWarnings.push('Dos copias del mismo documento tienen partidas o cantidades distintas; revisa la extracción.');
      // Register all identities even when the matching key was only the hash.
      for (const key of keys) if (!seen.has(key)) seen.set(key,previous);
      continue;
    }
    if(folioKey&&seen.has(folioKey)&&uuid&&str(seen.get(folioKey).parsed.uuid)&&uuid!==str(seen.get(folioKey).parsed.uuid).toLowerCase())blockingWarnings.push('El mismo proveedor y folio de factura aparece con UUID distintos; revisa si existe una refacturación antes de adjuntarla.');
    const doc={id,hash,parsed};
    docs.push(doc);
    for (const key of keys) seen.set(key,doc);
  }
  const orders=docs.filter(doc=>doc.parsed.kind==='order'),invoices=docs.filter(doc=>doc.parsed.kind==='invoice');
  const reference=orders[0] || invoices[0] || docs[0];
  const order=orders[0];
  const refs=unique(docs.map(doc=>normalizeSupplierOrder(doc.parsed.supplierOrder)));
  const suppliers=unique(docs.map(doc=>normalizeSupplier(doc.parsed.supplier)));
  const currencies=unique(docs.map(doc=>str(doc.parsed.currency).toUpperCase()));
  if (refs.length>1) blockingWarnings.push('Los documentos pertenecen a números de orden distintos; sepáralos antes de importar.');
  if (suppliers.length>1) blockingWarnings.push('Los documentos pertenecen a proveedores distintos; no se combinaron como una compra confirmada.');
  if (currencies.length>1) blockingWarnings.push('Los documentos usan monedas distintas; no se convierten ni suman automáticamente.');
  if (orders.length>1) {
    warnings.push('Se conserva la cantidad de la primera orden; las demás copias no agregan unidades.');
    const signature=doc=>JSON.stringify((doc.parsed.lines||[]).map(line=>[supplierItem(line.supplierItem),normalized(line.name),line.qty]).sort());
    if (orders.some(doc=>signature(doc)!==signature(order))) blockingWarnings.push('Hay órdenes con partidas diferentes; selecciona una sola versión.');
  }
  for (const doc of docs) {
    if(doc.parsed.supplierOrderConflict)blockingWarnings.push(`El documento ${doc.id} contiene referencias de orden contradictorias; confirma el número correcto.`);
    else if(doc.parsed.supplierOrderNeedsReview)blockingWarnings.push(`El documento ${doc.id} no tiene un número de orden reconocido con certeza; confirma la referencia antes de combinarlo.`);
    if (!['order','invoice'].includes(doc.parsed.kind)) blockingWarnings.push(`El documento ${doc.id} no tiene un tipo de compra reconocido.`);
    if (!doc.parsed.lines?.length) blockingWarnings.push(`El documento ${doc.id} no tiene partidas reconocidas; completa la revisión.`);
    for (const warning of doc.parsed.warnings || []) warnings.push(warning);
  }
  const invoiceTotals=Object.fromEntries(['subtotalCents','discountCents','taxCents','totalCents'].map(field=>[field,sumKnown(invoices.map(doc=>doc.parsed[field]))]));
  const lines=(order?.parsed.lines || []).map((line,index)=>({...line,id:line.id || `line-${index+1}`,qty:line.qty,orderedQty:line.qty,
    invoicedQty:0,invoicedTotalCents:0,invoicedSubtotalCents:0,invoicedDiscountCents:0,invoicedTaxCents:0,
    documentIds:orders.map(doc=>doc.id),invoiceDocumentIds:[]}));
  const unmatchedInvoiceLines=[];
  const addInvoice=(target,line,doc)=>{
    target.invoicedQty+=line.qty;
    for (const [targetField,sourceField] of [['invoicedTotalCents','totalCents'],['invoicedSubtotalCents','subtotalCents'],['invoicedDiscountCents','discountCents'],['invoicedTaxCents','taxCents']]) {
      target[targetField]=money(target[targetField]) && money(line[sourceField]) ? target[targetField]+line[sourceField] : null;
    }
    target.documentIds=unique([...target.documentIds,doc.id]);
    target.invoiceDocumentIds=unique([...target.invoiceDocumentIds,doc.id]);
  };
  for (const doc of invoices) for (const line of doc.parsed.lines || []) {
    if (!positiveQty(line.qty)) {blockingWarnings.push(`La factura ${doc.id} tiene una cantidad inválida.`);continue;}
    const matches=invoiceLineMatches(line,lines);
    if (matches.length===1) {
      const target=matches[0];
      if (barcode(target.upc) && barcode(line.upc) && barcode(target.upc)!==barcode(line.upc)) {
        blockingWarnings.push(`El artículo ${line.supplierItem || line.name} tiene códigos de barras distintos entre documentos.`);
        unmatchedInvoiceLines.push({...line,documentId:doc.id});continue;
      }
      addInvoice(target,line,doc);
      if (!order) {target.qty+=line.qty;target.orderedQty=target.qty;}
    } else if (matches.length>1 || order) {
      unmatchedInvoiceLines.push({...line,documentId:doc.id});
      blockingWarnings.push(`La partida ${line.supplierItem || line.name} de ${doc.id} no corresponde de forma única a una partida de la orden.`);
    } else {
      const target={...line,id:line.id || `line-${lines.length+1}`,qty:line.qty,orderedQty:line.qty,
        invoicedQty:0,invoicedTotalCents:0,invoicedSubtotalCents:0,invoicedDiscountCents:0,invoicedTaxCents:0,documentIds:[],invoiceDocumentIds:[]};
      addInvoice(target,line,doc);lines.push(target);
    }
  }
  for (const line of lines) {
    if (!positiveQty(line.qty)) blockingWarnings.push('La orden contiene una cantidad inválida.');
    if (order && line.invoicedQty>line.qty+1e-8) blockingWarnings.push(`El artículo ${line.supplierItem || line.name} está facturado por más unidades que las ordenadas.`);
    line.invoiceCoverage=Math.abs(line.invoicedQty-line.qty)<1e-8 && line.invoicedQty>0 ? 'complete' : line.invoicedQty>0 ? 'partial' : 'none';
    if (!order || line.invoiceCoverage==='complete') {
      // Do not infer the cost of unbilled units from the price of a partial invoice.
      for (const field of ['totalCents','subtotalCents','discountCents','taxCents']) {
        const invoiceField=`invoiced${field[0].toUpperCase()}${field.slice(1)}`;
        if (!order || line[field]==null) line[field]=line[invoiceField];
      }
      if ((!order || line.unitCostCents==null) && money(line.totalCents) && positiveQty(line.qty)) line.unitCostCents=Math.round(line.totalCents/line.qty);
    }
  }
  const complete=Boolean(invoices.length && lines.length && !unmatchedInvoiceLines.length && lines.every(line=>line.invoiceCoverage==='complete'));
  if (order && invoices.length && !complete) warnings.push('Las facturas no cubren exactamente todas las unidades de la orden. El importe faltante permanece pendiente.');
  if (order && complete && money(order.parsed.totalCents) && money(invoiceTotals.totalCents) && order.parsed.totalCents!==invoiceTotals.totalCents) warnings.push('El total de la orden difiere del total facturado; se conserva el importe de la orden para revisión.');
  const totals=Object.fromEntries(['subtotalCents','discountCents','taxCents','totalCents'].map(field=>[field,
    money(order?.parsed[field]) ? order.parsed[field] : complete && !blockingWarnings.length ? invoiceTotals[field] : null]));
  return {supplier:reference?.parsed.supplier || docs.find(doc=>doc.parsed.supplier)?.parsed.supplier || null,
    supplierOrder:normalizeSupplierOrder(reference?.parsed.supplierOrder) || (refs.length===1 ? refs[0] : null),date:order?.parsed.date || invoices.find(doc=>doc.parsed.orderDate)?.parsed.orderDate || reference?.parsed.date || null,
    currency:currencies.length===1 ? currencies[0] : null,lines,...totals,invoiceTotals,
    invoiceNumbers:unique(invoices.map(doc=>doc.parsed.invoiceNumber)),documentIds:docs.map(doc=>doc.id),
    invoiceDocumentIds:invoices.map(doc=>doc.id),orderDocumentIds:orders.map(doc=>doc.id),duplicates,unmatchedInvoiceLines,
    invoiceCoverage:complete ? 'complete' : invoices.length ? 'partial' : 'none',
    warnings:unique([...warnings,...blockingWarnings]),blockingWarnings:unique(blockingWarnings),
    canImport:Boolean(lines.length && !blockingWarnings.length),requiresReview:true};
}
