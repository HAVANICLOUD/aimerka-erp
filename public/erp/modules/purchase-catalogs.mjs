import {normalizeSupplier} from './purchase-document-parser.mjs?v=20261105-fiscal';
const text=v=>String(v??'').trim();
const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9Ñ&]+/g,' ').trim().replace(/\s+/g,' ');
const item=v=>text(v).toUpperCase().replace(/\s+/g,'');
const fail=m=>{throw new Error(m);};
export function supplierEquivalences(state){
 const map=new Map();for(const row of [...(state.supplierEquivalences||[]),...(state.products||[]).flatMap(p=>(p.supplierCodes||[]).map(c=>({...c,sku:p.sku})))]){
  const key=normalizeSupplier(row.supplier)+'|'+item(row.item||row.supplierItem),product=state.products?.find(p=>p.sku===row.sku);if(!row.supplier||!item(row.item||row.supplierItem)||!product)continue;
  map.set(key,{supplier:row.supplier,item:row.item||row.supplierItem,name:row.name||product.name,sku:product.sku,productName:product.name,upc:product.upc||''});
 }return [...map.values()].sort((a,b)=>a.supplier.localeCompare(b.supplier,'es')||a.item.localeCompare(b.item));
}
export function assertSupplierCodes(state,sku,codes){
 for(const c of codes)if(supplierEquivalences(state).some(a=>a.sku!==sku&&normalizeSupplier(a.supplier)===normalizeSupplier(c.supplier)&&item(a.item)===item(c.item)))fail('Ese código del proveedor ya pertenece a otro producto. Revisa el catálogo de equivalencias.');
}
export function syncSupplierCodes(state,product){
 assertSupplierCodes(state,product.sku,product.supplierCodes||[]);
 state.supplierEquivalences=(state.supplierEquivalences||[]).filter(c=>c.sku!==product.sku);
 for(const c of product.supplierCodes||[])state.supplierEquivalences.push({supplier:c.supplier,item:c.item,name:c.name||product.name,sku:product.sku});
}
export function saveSupplierEquivalence(state,command,ctx={}){
 const p=command.payload||{},product=state.products?.find(q=>q.sku===p.sku),row={supplier:text(p.supplier).slice(0,250),item:text(p.item).slice(0,100),name:text(p.name).slice(0,250)};
 if(!product||!row.supplier||!row.item)fail('Selecciona el producto, proveedor y código del proveedor.');
 const codes=structuredClone(product.supplierCodes||[]),prior=codes.find(c=>normalizeSupplier(c.supplier)===normalizeSupplier(row.supplier)&&item(c.item)===item(row.item));if(prior)Object.assign(prior,row);else codes.push(row);
 assertSupplierCodes(state,product.sku,codes);product.supplierCodes=codes;syncSupplierCodes(state,product);
 (state.events??=[]).unshift({id:command.id,type:command.type,date:ctx.now,actor:ctx.actor,result:'ok',message:'Equivalencia de proveedor guardada: '+row.supplier+' · '+row.item+' → '+product.sku});
 return {ok:true,message:'Equivalencia guardada. Se usará en las siguientes órdenes y facturas.'};
}
export function saveFiscalProfile(state,command,ctx={}){
 const p=command.payload||{},rfc=text(p.rfc).toUpperCase(),legalName=text(p.legalName).replace(/\s+/g,' '),postalCode=text(p.postalCode),taxRegime=text(p.taxRegime);
 if(!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)||['XAXX010101000','XEXX010101000'].includes(rfc))fail('Registra el RFC específico de la empresa compradora.');
 if(legalName.length<3||legalName.length>200||!/^\d{5}$/.test(postalCode)||!/^\d{3}$/.test(taxRegime))fail('Completa razón social, código postal de cinco dígitos y clave de régimen fiscal.');
 const config=structuredClone(state.config?.purchaseFiscal||{profiles:[],defaultProfileId:null}),prior=config.profiles.find(x=>x.id===p.id),id=prior?.id||'FISCAL-'+command.id;
 if(p.id&&!prior)fail('Empresa fiscal no encontrada.');if(config.profiles.some(x=>x.id!==id&&x.rfc===rfc))fail('Ese RFC ya está registrado en el catálogo.');
 const profile={id,label:text(p.label||legalName).slice(0,150),rfc,legalName,postalCode,taxRegime,purchaseUsage:'G01',active:p.active!==false,revision:(prior?.revision||0)+1,updatedAt:ctx.now,actor:ctx.actor};
 if(prior)Object.assign(prior,profile);else config.profiles.push(profile);
 if(p.makeDefault||!config.defaultProfileId)config.defaultProfileId=id;
 state.config??={};state.config.purchaseFiscal=config;
 (state.events??=[]).unshift({id:command.id,type:command.type,date:ctx.now,actor:ctx.actor,result:'ok',message:'Datos fiscales de empresa compradora guardados: '+profile.label});
 return {ok:true,id,message:'Datos fiscales guardados. Las facturas de mercancía se cotejarán con esta empresa y uso G01.'};
}
export function validateInvoiceFiscal(documents,config,{profileId,required=true,allowStoredSnapshots=false}={}){
 const invoices=(documents||[]).filter(d=>(d.parsed||d).kind==='invoice'),profile=config?.profiles?.find(p=>p.id===(profileId||config.defaultProfileId)&&p.active!==false),issues=[],checks=[];
 if(invoices.length&&!profile&&required&&!(allowStoredSnapshots&&invoices.every(d=>d.fiscalValidation?.valid&&d.fiscalValidation.profile)))issues.push({code:'BUYER_FISCAL_PROFILE_REQUIRED',severity:'error',message:'Configura y selecciona la empresa compradora en Datos fiscales antes de guardar la facturación.',documentIds:invoices.map(d=>d.id)});
 for(const doc of invoices){const expectedProfile=allowStoredSnapshots&&doc.fiscalValidation?.valid&&doc.fiscalValidation.profile?doc.fiscalValidation.profile:profile,p=doc.parsed||doc,fields=[['recipientRfc','RFC',expectedProfile?.rfc,v=>text(v).toUpperCase()],['recipientName','Razón social',expectedProfile?.legalName,norm],['recipientPostalCode','Código postal',expectedProfile?.postalCode,text],['recipientTaxRegime','Régimen fiscal',expectedProfile?.taxRegime,text],['cfdiUse','Uso CFDI',expectedProfile?.purchaseUsage||'G01',v=>text(v).toUpperCase()],['cfdiType','Tipo de comprobante','I',v=>text(v).toUpperCase()]],rows=fields.map(([key,label,expected,normalize])=>({key,label,expected:expected||null,actual:p[key]||null,status:!p[key]?'missing':expected&&normalize(p[key])!==normalize(expected)?'mismatch':expected?'matched':'unconfigured'}));
  for(const row of rows.filter(r=>r.status==='missing'||r.status==='mismatch'))issues.push({code:row.status==='missing'?'INVOICE_FISCAL_FIELD_MISSING':'INVOICE_FISCAL_MISMATCH',severity:'error',message:(p.invoiceNumber||doc.name||'Factura')+': '+row.label+(row.status==='missing'?' no reconocido. Revisa el documento original.':' no coincide: '+row.actual+'; se esperaba '+row.expected+'.'),documentIds:[doc.id],field:row.key,actual:row.actual,expected:row.expected});
  checks.push({id:doc.id,valid:!!expectedProfile&&rows.every(r=>r.status==='matched'),fields:rows,profileId:expectedProfile?.id||null,profileRevision:expectedProfile?.revision||null});
 }return {valid:!issues.length,issues,checks,profile:profile?structuredClone(profile):null};
}
