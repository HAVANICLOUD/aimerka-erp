import {assertSupplierCodes,syncSupplierCodes} from './purchase-catalogs.mjs?v=20261105-fiscal';
const clone=v=>structuredClone(v);
const fail=message=>{throw new Error(message);};
const amount=(value,label='Importe')=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<0)fail(label+' debe expresarse en centavos y no puede ser negativo.');return n;};
const quantity=(value,label='Cantidad')=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<=0)fail(label+' debe ser un entero mayor que cero.');return n;};
const text=(v,max=1000)=>String(v??'').trim().slice(0,max);
const normalized=v=>text(v).replace(/^\*+|\*+$/g,'').trim().toLocaleUpperCase('es-MX');
const skuWords=value=>text(value,500).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean);
const skuStopWords=new Set(['DE','DEL','LA','EL','LOS','LAS','CON','PARA','Y','EN','COLOR','CAPACIDAD','UN','UNA']);
const productCodes=product=>[product.sku,product.sellerSku,product.upc,...(Array.isArray(product.skuAliases)?product.skuAliases:[])].filter(Boolean);
/** Compact internal identifiers are independent of supplier barcodes and remain stable after creation. */
export function generateProductSku(input={},products=[]) {
 const brand=skuWords(input.brand).join('').slice(0,3);
 const modelWords=skuWords(input.model),number=modelWords.find(word=>/^\d/.test(word));
 const model=modelWords.find(word=>/[A-Z]/.test(word)&&/\d/.test(word))||(number?(modelWords.find(word=>/[A-Z]/.test(word))||'').slice(0,2)+number:modelWords.join(''));
 const excluded=new Set(skuWords(input.brand));
 const title=skuWords(input.name||input.title).filter(word=>!skuStopWords.has(word)&&!excluded.has(word)).join('');
 const color=skuWords(input.color).filter(word=>!skuStopWords.has(word)).join('').slice(0,1);
 const capacity=skuWords(input.capacity).join('').slice(0,3);
 const descriptive=(model||title||'ARTICULO').slice(0,10-brand.length-color.length-capacity.length);
 const base=brand+descriptive+color+capacity;
 // Old internal identifiers stay reserved after shortening so old labels cannot point at a different product.
 const used=new Set((products||[]).flatMap(productCodes).map(normalized));
 if(!used.has(base))return base;
 // A widening base-36 suffix supports collisions without ever extending the ten-character limit.
 for(let n=2;n<36**10;n++){
   const suffix=n.toString(36).toUpperCase().padStart(2,'0');
   const candidate=base.slice(0,10-suffix.length)+suffix;
   if(!used.has(candidate))return candidate;
 }
 fail('No se pudo generar un SKU único. Revisa los identificadores del catálogo.');
}
/** New barcode assignments require a real GTIN; legacy values remain untouched. */
export function validateProductUpc(value) {
 const code=text(value,80).replace(/[\s-]/g,'');
 if(!/^\d{8}$|^\d{12,14}$/.test(code))fail('El UPC/EAN debe contener 8, 12, 13 o 14 dígitos.');
 let sum=0;for(let i=code.length-2,weight=3;i>=0;i--,weight=weight===3?1:3)sum+=Number(code[i])*weight;
 if((10-sum%10)%10!==Number(code.at(-1)))fail('El dígito de control del UPC/EAN no es válido. Revisa el escaneo.');
 return code;
}
const barcodeKey=value=>{const code=normalized(value);return /^\d{8}$|^\d{12,14}$/.test(code)?code.padStart(14,'0'):code;};
function verifyUpcAssignment(state,product,value,planned=new Map()) {
 const upc=validateProductUpc(value),key=barcodeKey(upc);
 if(product.upc&&barcodeKey(product.upc)!==key)fail('El producto ya tiene otro UPC. Conserva su identificador original.');
 if(state.products.some(p=>p!==product&&p.upc&&barcodeKey(p.upc)===key))fail('Ese UPC ya pertenece a otro producto.');
 if(planned.has(product.sku)&&barcodeKey(planned.get(product.sku))!==key)fail('Se escanearon UPC distintos para el mismo producto.');
 if([...planned].some(([sku,code])=>sku!==product.sku&&barcodeKey(code)===key))fail('El mismo UPC no puede asignarse a productos distintos.');
 planned.set(product.sku,product.upc||upc);return upc;
}
function documentIds(value) {
 if(value==null)return [];
 if(!Array.isArray(value)||value.length>100)fail('Las referencias documentales no son válidas.');
 return [...new Set(value.map(v=>text(v,160)).filter(Boolean))];
}
function queueStock(state,product,ctx,reference) {
 const queue=state.stockSyncQueue??=[],existing=queue.find(row=>row.sku===product.sku);
 const row={id:'stock-'+product.sku,sku:product.sku,upc:product.upc||'',availableQty:available(product),status:'awaiting_connection',updatedAt:ctx.now,reference:text(reference,160)};
 if(existing)Object.assign(existing,row);else queue.push(row);
}
export function available(p){return p.status==='INACTIVO'?0:Math.max(0,Number(p.good||0)-Number(p.reserved||0)-Number(p.safety||0));}
export function orderTotal(o){return Number.isSafeInteger(o.totalCents)?o.totalCents:(o.items?.length?o.items.reduce((s,l)=>s+l.totalCents,0)+(o.shippingChargedCents||0):(o.qty||0)*(o.unitPriceCents||0));}
export function orderItems(o){return o.items?.length?o.items:(o.sku?[{id:o.id+'-1',sku:o.sku,qty:o.qty,unitPriceCents:o.unitPriceCents,totalCents:o.qty*o.unitPriceCents}]:[]);}
export function expectedNet(o){if(o.reconciliation?.estimate?.netCents!=null)return o.reconciliation.estimate.netCents;if(o.stockMode==='historical')return null;const gross=orderTotal(o);return gross-Math.round(gross*(o.commissionBps||0)/10000)-Math.round(gross*(o.msiBps||0)/10000)-(o.shippingCents||0)-(o.withholdingCents||0);}
function findProduct(state,code){const n=normalized(code),found=n?state.products.filter(p=>normalized(p.sku)===n||p.upc&&barcodeKey(p.upc)===barcodeKey(n)||normalized(p.sellerSku)===n||(p.skuAliases||[]).some(alias=>normalized(alias)===n)):[];if(found.length!==1)fail(found.length?'El código coincide con más de un producto.':'No se encontró el producto '+code+'.');return found[0];}
function findOrder(state,id){const o=state.orders.find(o=>o.id===id);if(!o)fail('No se encontró el pedido.');return o;}
function log(state,order,label,ctx,changes){const event={id:ctx.requestId||crypto.randomUUID(),type:ctx.type||'operation',orderId:order?.id||null,message:label,date:ctx.now||new Date().toISOString(),result:'ok',actor:ctx.actor||'Operador',changes};(state.events??=[]).unshift(event);if(order)(order.history??=[]).push({label,date:event.date,actor:event.actor});return {ok:true,message:label,id:order?.id,orderId:order?.id};}
function move(state,product,pool,delta,reference,ctx,trace={}){const before=Number(product[pool]||0);product[pool]=before+delta;(state.movements??=[]).unshift({id:(ctx.requestId||crypto.randomUUID())+'-'+state.movements.length,date:ctx.now,sku:product.sku,upc:product.upc,pool,delta,before,after:product[pool],reference,actor:ctx.actor,type:ctx.type,...trace});queueStock(state,product,ctx,reference);}
function recon(){return {conditions:{publication:'CLASICA',msi:'Sin MSI',shippingCents:null},estimate:null,depositCents:null,depositDate:null,status:'Sin revisar',notes:'',selected:false,draft:null,history:[]};}
function newId(state,prefix,collection){let n=Number(state.nextOrder||1);while(collection.some(x=>x.id===prefix+String(n).padStart(6,'0')))n++;state.nextOrder=n+1;return prefix+String(n).padStart(6,'0');}
export function applyInventory(state,action,context={}){
 const payload=action.payload||{},ctx={now:new Date().toISOString(),...context,type:action.type,requestId:action.id||context.requestId};
 const dateParts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ctx.now));
 const today=['year','month','day'].map(type=>dateParts.find(part=>part.type===type).value).join('-');
 if(action.type==='sale.create'){
   const market=text(payload.market,60),number=text(payload.number,120),sicar=text(payload.sicar,100),account=text(payload.account||'HAVANI Technologies México',120);
   if(!market||!number)fail('Marketplace y número original son obligatorios.');
   const supported=['Liverpool','Sears','Sanborns','Coppel','Elektra','Tienda Nube','Mercado Libre','T1 Comercios'];
   if(!supported.includes(market))fail('Selecciona un marketplace del catálogo.');
   if(state.orders.some(o=>o.market===market&&normalized(o.account||account)===normalized(account)&&normalized(o.number)===normalized(number)))fail('Ya existe ese número de pedido para la cuenta y marketplace.');
   if(sicar&&state.orders.some(o=>o.market===market&&normalized(o.sicar)===normalized(sicar)))fail('El folio SICAR ya está relacionado con una venta de ese marketplace.');
   const date=text(payload.documentDate||today,10),parsedDate=new Date(date+'T12:00:00.000Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsedDate.getTime())||parsedDate.toISOString().slice(0,10)!==date||date>today)fail('La fecha de venta debe ser válida y no futura.');
   const input=payload.items||[],seen=new Set();if(!input.length)fail('Agrega al menos una partida.');
   const items=input.map((line,i)=>{const p=findProduct(state,line.sku||line.upc),qty=quantity(line.qty),price=amount(line.unitPriceCents,'Precio unitario');if(seen.has(p.sku))fail('Agrupa las unidades del mismo producto en una sola partida.');seen.add(p.sku);if(qty>available(p))fail(p.name+': solo hay '+available(p)+' unidades disponibles.');return {id:'',sku:p.sku,upc:p.upc,name:p.name,qty,unitPriceCents:price,totalCents:qty*price,costCents:p.costCents,returnedQty:0,restockedQty:0,rejectedQty:0};});
   const shipping=amount(payload.shippingChargedCents||0,'Envío cobrado'),id=newId(state,'AIM-',state.orders);
   const o={id,number,literalNumber:number,market,account,sicar,ventiId:'',sicarUuid:'',date:date+'T12:00:00',documentDate:date,creationDate:ctx.now,totalCents:items.reduce((s,l)=>s+l.totalCents,shipping),shippingChargedCents:shipping,items:items.map((l,i)=>({...l,id:id+'-'+(i+1)})),sku:items[0].sku,qty:items.reduce((s,l)=>s+l.qty,0),unitPriceCents:items[0].unitPriceCents,status:'reserved',commercialStatus:'Activa',paymentStatus:payload.paymentStatus==='paid'?'paid':'unknown',returnStatus:'none',stockMode:'operational',source:'AIMERKA',comments:text(payload.comments,4000),priority:payload.priority==='Importante'?'Importante':'Normal',followupStatus:payload.followupStatus==='Pendiente'?'Pendiente':'Sin pendiente',history:[],incident:'',commissionBps:0,msiBps:0,shippingCents:0,withholdingCents:0,paidCents:null,reconciliation:recon(),partsStatus:'Capturadas en AIMERKA'};
   for(const item of o.items)move(state,findProduct(state,item.sku),'reserved',item.qty,id,ctx);
   state.orders.unshift(o);return log(state,o,'Venta registrada y existencias reservadas; conserva el pedido original.',ctx);
 }
 if(action.type==='inventory.adjust'){
   const p=findProduct(state,payload.sku),pool=payload.pool||'good',reason=text(payload.reason,2000),newQty=Number(payload.quantity);
   if(!['good','quarantine','damaged','safety'].includes(pool))fail('Tipo de existencia no válido.');
   if(!Number.isSafeInteger(newQty)||newQty<0)fail('La existencia debe ser un entero no negativo.');
   if(!reason)fail('Escribe el motivo del ajuste.');if(pool==='good'&&newQty<p.reserved)fail('El físico vendible no puede quedar por debajo de las reservas activas.');
   const old=p[pool]||0;move(state,p,pool,newQty-old,reason,ctx);p.stockStatus='Verificado en AIMERKA';return log(state,null,'Inventario ajustado: '+p.sku+'. '+reason,ctx,{sku:p.sku,pool,before:old,after:newQty});
 }
 if(action.type==='inventory.receivePurchase'){
   const purchase=state.purchases.find(p=>p.id===payload.purchaseId);if(!purchase)fail('Compra no encontrada.');if(purchase.status==='Cancelada')fail('La compra está cancelada.');
   const receiptId=ctx.requestId||crypto.randomUUID(),priorReceipt=(state.purchaseReceipts||[]).find(r=>r.id===receiptId);
   if(priorReceipt){if(priorReceipt.purchaseId!==purchase.id)fail('Ese identificador de recepción corresponde a otra compra.');return {ok:true,duplicate:true,id:purchase.id,receiptId,message:'Esta recepción ya se registró; no se repitieron existencias.'};}
   const requested=payload.items||[];if(!Array.isArray(requested)||!requested.length)fail('Selecciona mercancía para recibir.');const seen=new Set(),upcs=new Map();
   const resolved=requested.map(input=>{const line=purchase.items.find(l=>l.id===input.lineId);if(!line)fail('Partida de compra no encontrada.');if(seen.has(line.id))fail('Partida de recepción repetida.');seen.add(line.id);const qty=quantity(input.qty),p=findProduct(state,input.sku||line.sku||line.skuOrUpc);if(qty>line.qty-(line.receivedQty||0))fail('La recepción supera las unidades pendientes.');if(line.receivedQty>0&&line.sku!==p.sku)fail('Esta partida ya tiene recepciones para otro SKU. Conserva el producto asignado.');if(input.upc)verifyUpcAssignment(state,p,input.upc,upcs);return {line,p,qty,documents:documentIds(line.documentIds)};});
   // Validate the entire batch before assigning any barcode or stock movement.
   for(const [sku,upc] of upcs){const p=state.products.find(p=>p.sku===sku);p.upc=upc;p.barcodeStatus='Registrado';p.updatedAt=ctx.now;}
   for(const {line,p,qty,documents} of resolved){move(state,p,'good',qty,purchase.id,ctx,{purchaseId:purchase.id,lineId:line.id,receiptId,documentIds:documents});line.receivedQty=(line.receivedQty||0)+qty;line.sku=p.sku;line.upc=p.upc||'';p.stockStatus='Verificado en AIMERKA';p.updatedAt=ctx.now;}
   purchase.receiptMode='physical';purchase.receiptStatus=purchase.items.every(l=>(l.receivedQty||0)>=l.qty)?'Recibida completa':'Recibida parcialmente';purchase.updatedAt=ctx.now;
   const receipts=state.purchaseReceipts??=[],receipt={id:receiptId,purchaseId:purchase.id,number:'REC-'+String(receipts.length+1).padStart(6,'0'),date:ctx.now,actor:ctx.actor||'Operador',reason:text(payload.reason,2000),items:resolved.map(({line,p,qty,documents})=>({lineId:line.id,sku:p.sku,upc:p.upc||'',name:p.name,qty,unitCostCents:line.unitCostCents??null,documentIds:documents})),receiptStatus:purchase.receiptStatus,source:'AIMERKA'};receipts.unshift(receipt);
   return {...log(state,null,'Recepción física registrada para '+(purchase.number||purchase.id)+'. '+purchase.receiptStatus+'.',ctx),id:purchase.id,receiptId,receiptStatus:purchase.receiptStatus,receivedUnits:resolved.reduce((sum,row)=>sum+row.qty,0)};
 }
 if(action.type==='product.assignUpc'){
   const product=findProduct(state,payload.sku),upc=verifyUpcAssignment(state,product,payload.upc);
   if(product.upc)return {ok:true,duplicate:true,sku:product.sku,upc:product.upc,message:'El producto ya conserva ese UPC.'};
   product.upc=upc;product.barcodeStatus='Registrado';product.updatedAt=ctx.now;queueStock(state,product,ctx,product.sku);
   return {...log(state,null,'UPC registrado para '+product.sku+'.',ctx,{sku:product.sku,upc}),sku:product.sku,upc};
 }
 if(action.type==='product.save'){
   const p=payload.product||payload,existing=payload.originalSku?findProduct(state,payload.originalSku):null;
   const name=text(p.name,250),brand=text(p.brand,100),suppliedSku=p.sku==null?'':String(p.sku),generated=!existing&&!suppliedSku;
   if(!existing&&suppliedSku&&!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/.test(suppliedSku))fail('El SKU debe tener hasta 80 letras, números o . _ / -, sin espacios.');
   const sku=existing?text(p.sku||existing.sku,80):(suppliedSku?suppliedSku.toUpperCase():generateProductSku({...p,name,brand},state.products)),rawUpc=text(p.upc??existing?.upc,80),costCents=amount(p.costCents,'Costo'),priceCents=amount(p.priceCents||0,'Precio');
   if(!existing&&!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/.test(sku))fail('El SKU debe tener hasta 80 letras, números o . _ / -, sin espacios.');
   if(!sku||!name||!brand)fail('Descripción y marca son obligatorias; el SKU puede generarse automáticamente.');
   const upc=rawUpc&&(existing?.upc!==rawUpc)?validateProductUpc(rawUpc):rawUpc;
   if(state.products.some(q=>q!==existing&&((existing?normalized(q.sku)===normalized(sku):productCodes(q).some(code=>normalized(code)===normalized(sku)))||upc&&q.upc&&barcodeKey(q.upc)===barcodeKey(upc))))fail('Ese SKU o UPC ya está registrado.');
   if(existing&&sku!==existing.sku)fail('El SKU de un producto registrado es estable; conserva su identificador.');
   if(existing?.upc&&upc!==existing.upc)fail('La actualización conserva el UPC original.');
   if(!['OK','INACTIVO'].includes(p.status||'OK'))fail('El estado del producto debe ser OK o INACTIVO.');
   if(p.costStatus&&!['Por confirmar','Confirmado'].includes(p.costStatus))fail('El estado del costo no es válido.');
   let exactCost=p.averageCostMxn;
   if(existing&&existing.costCents!==costCents&&exactCost===existing.averageCostMxn)exactCost=costCents/100;
   if(exactCost!=null&&(!Number.isFinite(exactCost)||exactCost<0||Math.round(exactCost*100)!==costCents))fail('El costo promedio exacto no coincide con el importe en centavos.');
   const fields=['category','department','generalCategory','commercialDepartment','satCode','shippingType','shippingException','shippingSuggested','sellerSku','review','model','color','capacity','description','manufacturerPart','condition','unitSat','countryOfOrigin','material'];
   let imageUrl=existing?.imageUrl||'';if('imageUrl' in p){imageUrl=text(p.imageUrl,2000);if(imageUrl){let valid=imageUrl.startsWith('/')&&!imageUrl.startsWith('//');try{const u=new URL(imageUrl);valid=u.protocol==='https:'&&!u.username&&!u.password;}catch{}if(!valid)fail('La imagen debe usar una ruta del sitio o una URL HTTPS.');}}
   let supplierCodes=existing?.supplierCodes||[];
   if('supplierCodes' in p){if(!Array.isArray(p.supplierCodes)||p.supplierCodes.length>100)fail('Las equivalencias de proveedor no son válidas.');supplierCodes=p.supplierCodes.map(row=>({supplier:text(row.supplier,250),item:text(row.item,100),name:text(row.name,250)}));if(supplierCodes.some(row=>!row.supplier||!row.item))fail('Cada equivalencia necesita proveedor y número de artículo.');if(supplierCodes.some(row=>state.products.some(q=>q!==existing&&(q.supplierCodes||[]).some(other=>normalized(other.supplier)===normalized(row.supplier)&&normalized(other.item)===normalized(row.item)))))fail('Ese artículo del proveedor ya está asociado a otro producto.');assertSupplierCodes(state,sku,supplierCodes);supplierCodes=supplierCodes.filter((row,i,rows)=>rows.findIndex(other=>normalized(other.supplier)===normalized(row.supplier)&&normalized(other.item)===normalized(row.item))===i);}
   const base=existing?clone(existing):{sku,upc,good:0,reserved:0,quarantine:0,damaged:0,safety:0,minStock:3,icon:'box',source:'AIMERKA',sourceStock:null,categories:{},categoryOverrides:{}};
   Object.assign(base,{sku,upc,name,brand,costCents,priceCents,status:p.status||'OK',imageUrl,supplierCodes,barcodeStatus:upc?'Registrado':'Pendiente',createdAt:existing?.createdAt||ctx.now,updatedAt:ctx.now,skuGenerated:existing?.skuGenerated??generated});for(const f of fields)if(f in p)base[f]=text(p[f],300);
   if(p.categoryOverrides)base.categoryOverrides=Object.fromEntries(Object.entries(p.categoryOverrides).map(([k,v])=>[text(k,60),text(v,150)]));
   if(p.categories)base.categories=Object.fromEntries(Object.entries(p.categories).map(([k,v])=>[text(k,60),text(v,150)]));
   if(p.images){
    if(!Array.isArray(p.images)||p.images.length>100)fail('Galería de imágenes inválida.');
    base.images=p.images.map(image=>{
     const original=existing?.images?.find(i=>i.source==='V43'&&i.id===image.id&&i.url===image.url);
     if(image.source==='V43'){if(!original)fail('Imagen original no encontrada.');return {...original,primary:image.primary===true};}
     const verified=ctx.verifiedImages?.find(i=>i.id===image.id);if(!verified||!['image/jpeg','image/png'].includes(verified.mime))fail('Vuelve a cargar la imagen antes de guardar.');
     return {...verified,url:'/api/documents/'+verified.id+'?workspace='+encodeURIComponent(ctx.workspace),source:'upload',primary:image.primary===true};
    });
    if(new Set(base.images.map(i=>i.id)).size!==base.images.length)fail('No repitas la misma imagen.');
    if(base.images.length){const principal=base.images.find(i=>i.primary)||base.images[0];base.images.forEach(i=>i.primary=i.id===principal.id);base.imageUrl=principal.url;}
    else base.imageUrl='';
   }
   if(p.dimensions){const d={};for(const k of ['weightKg','heightCm','widthCm','lengthCm']){const n=Number(p.dimensions[k]);if(!Number.isFinite(n)||n<0||n>100000)fail('Revisa peso y dimensiones.');d[k]=n;}base.dimensions=d;}
   if(p.channelIdentifiers){const allowed=['Sears','Sanborns','T1 Comercios','Liverpool','Elektra','Coppel','Mercado Libre','Tienda Nube'];base.channelIdentifiers=Object.fromEntries(Object.entries(p.channelIdentifiers).map(([k,v])=>{if(!allowed.includes(k))fail('Canal no reconocido.');return [k,{sellerSku:text(v.sellerSku,100),publicationId:text(v.publicationId,100),variantId:text(v.variantId,100)}];}));}
   for(const f of ['safety','minStock'])if(f in p){base[f]=amount(p[f],f);}
   if(exactCost!=null){base.averageCostMxn=exactCost;base.sourceCost=exactCost;}
   else if(!existing||existing.costCents!==costCents){base.averageCostMxn=costCents/100;base.sourceCost=costCents/100;}
   if(p.costStatus)base.costStatus=p.costStatus;
   else if(base.costStatus==='Por confirmar'&&costCents>0)base.costStatus='Confirmado';
   if('supplierCodes' in p)syncSupplierCodes(state,base);
   const before=existing?{costCents:existing.costCents,averageCostMxn:existing.averageCostMxn,name:existing.name,category:existing.category}:null;
   if(existing)Object.assign(existing,base);else state.products.unshift(base);
   queueStock(state,existing||base,ctx,sku);
   return {...log(state,null,(existing?'Producto actualizado: ':'Producto registrado: ')+name+'.',ctx,{sku,before,after:{costCents,averageCostMxn:base.averageCostMxn,name,category:base.category}}),sku,upc};
 }
 const order=findOrder(state,payload.orderId),items=orderItems(order),managed=order.stockMode!=='historical';
 const resolved=()=>items.map(item=>({item,p:findProduct(state,item.sku||item.upc)}));
 const reason=text(payload.reason||payload.notes,2000);
 switch(action.type){
 case 'sale.ship':{
   if(!managed||order.status!=='reserved')fail('Solo un pedido con reserva activa puede generar una salida física.');if(order.paymentStatus==='refunded')fail('El pedido tiene un reembolso; revisa o cancela su reserva.');
   const rows=resolved();for(const {item,p} of rows)if(p.reserved<item.qty||p.good<item.qty)fail('El inventario requiere revisión antes de enviar.');
   for(const {item,p} of rows){move(state,p,'good',-item.qty,order.id,ctx);move(state,p,'reserved',-item.qty,order.id,ctx);}order.status='shipped';order.shippedAt=ctx.now;return log(state,order,'Envío registrado: salida física y cierre de reservas.',ctx);
 }
 case 'sale.deliver':if(order.status!=='shipped')fail('Primero registra el envío.');order.status='delivered';order.deliveredAt=ctx.now;return log(state,order,'Entrega registrada.',ctx);
 case 'sale.cancel':{
   if(!reason)fail('Escribe el motivo de cancelación.');if(order.commercialStatus==='Cancelada')fail('La venta ya está cancelada.');
   if(managed&&order.status==='reserved'){const rows=resolved();for(const {item,p} of rows)if(p.reserved<item.qty)fail('No coincide la reserva.');for(const {item,p} of rows)move(state,p,'reserved',-item.qty,order.id,ctx);order.status='cancelled';}
   else if(managed&&['shipped','delivered'].includes(order.status)){order.returnStatus='requested';order.incident='Cancelación posterior al envío; pendiente de devolución física.';}
   else if(!managed)order.status='cancelled';
   order.commercialStatus='Cancelada';order.cancelledAt=ctx.now;order.cancellationReason=reason;order.followupStatus='Pendiente';return log(state,order,'Cancelación registrada. '+reason,ctx);
 }
 case 'sale.refund':{
   if(!reason)fail('Escribe el motivo del reembolso.');const refunded=amount(payload.amountCents??orderTotal(order),'Reembolso');if(refunded<=0||refunded>orderTotal(order))fail('El reembolso debe ser positivo y no superar la venta.');
   if(order.refundCents===refunded&&order.paymentStatus==='refunded')fail('Ese reembolso ya está registrado.');
   order.refundCents=refunded;order.paymentStatus=refunded===orderTotal(order)?'refunded':'partially_refunded';order.refundedAt=ctx.now;order.followupStatus='Pendiente';return log(state,order,'Reembolso registrado por '+(refunded/100).toFixed(2)+' MXN, sin entrada al inventario. '+reason,ctx);
 }
 case 'sale.return_request':
   if(order.status==='reserved')fail('Cancela la reserva de un pedido que todavía no fue enviado.');if(['inspection','restocked','rejected'].includes(order.returnStatus))fail('La devolución ya tiene recepción o resolución.');order.returnStatus='requested';order.followupStatus='Pendiente';order.priority='Importante';order.incident=reason||'Devolución en camino.';return log(state,order,'Devolución solicitada. '+reason,ctx);
 case 'sale.return_receive':{
   if(!['requested','inspection'].includes(order.returnStatus))fail('Registra primero la solicitud de devolución.');if(!managed&&!payload.confirmPhysical)fail('Confirma que estás registrando una recepción física actual de esta venta histórica.');
   if(payload.items){const ids=new Set();for(const input of payload.items){if(ids.has(input.id)||!items.some(l=>l.id===input.id))fail('Hay partidas repetidas o desconocidas en la recepción.');ids.add(input.id);quantity(input.qty);}}
   const rows=resolved().map(({item,p})=>{const input=payload.items?.find(l=>l.id===item.id);const qty=input?quantity(input.qty):(payload.items?0:item.qty-(item.returnedQty||0));if(qty<0||qty>item.qty-(item.returnedQty||0))fail('La recepción supera la cantidad vendida pendiente de recibir.');return {item,p,qty};});if(!rows.some(r=>r.qty>0))fail('No quedan unidades pendientes de recibir.');
   for(const {item,p,qty} of rows)if(qty){move(state,p,'quarantine',qty,order.id,ctx);item.returnedQty=(item.returnedQty||0)+qty;}
   order.returnStatus='inspection';order.returnedAt=ctx.now;order.incident='Mercancía recibida y pendiente de inspección.';return log(state,order,'Devolución física recibida en inspección, todavía no disponible para venta.',ctx);
 }
 case 'sale.return_restock':case 'sale.return_reject':{
   if(order.returnStatus!=='inspection')fail('La mercancía debe recibirse en inspección antes de resolver.');const reject=action.type.endsWith('reject');if(reject&&!reason)fail('Indica el motivo por el que no es vendible.');
   const rows=resolved().map(({item,p})=>({item,p,qty:(item.returnedQty||0)-(item.restockedQty||0)-(item.rejectedQty||0)}));for(const {p,qty} of rows)if(qty<0||p.quarantine<qty)fail('Las unidades de inspección requieren revisión.');
   if(!rows.some(r=>r.qty>0))fail('Esta recepción ya fue resuelta.');
   for(const {item,p,qty} of rows)if(qty){move(state,p,'quarantine',-qty,order.id,ctx);move(state,p,reject?'damaged':'good',qty,order.id,ctx);const key=reject?'rejectedQty':'restockedQty';item[key]=(item[key]||0)+qty;}
   const pending=items.some(item=>(item.returnedQty||0)<(item.expectedReturnQty??item.qty));
   order.returnStatus=pending?'requested':reject?'rejected':'restocked';order.incident=pending?'Devolución parcial: quedan unidades por recibir.':reject?'Devolución no vendible: '+reason:'';return log(state,order,reject?'Devolución clasificada como no vendible. '+reason:'Unidades aprobadas y reintegradas al inventario vendible.',ctx);
 }
 case 'sale.note':{
   const previous=order.comments;order.comments=text(payload.comments,6000);if(payload.priority)order.priority=payload.priority==='Importante'?'Importante':'Normal';if(payload.followupStatus&&['Sin pendiente','Pendiente','En seguimiento','Resuelto'].includes(payload.followupStatus))order.followupStatus=payload.followupStatus;return log(state,order,'Seguimiento actualizado.',ctx,{before:previous,after:order.comments});
 }
 case 'sale.resolve':if(!reason)fail('Escribe la resolución.');if(order.returnStatus==='requested')fail('La devolución todavía está en camino.');order.followupStatus='Resuelto';order.resolvedAt=ctx.now;order.incident='';return log(state,order,'Seguimiento resuelto. '+reason,ctx);
 default:fail('Operación de inventario no reconocida.');
 }
}
