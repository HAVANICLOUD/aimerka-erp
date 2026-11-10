/** Presentation settings never change channel identities, fiscal profiles or sales. */
export const TIME_ZONE='America/Mexico_City';
export const MAX_LOGO_BYTES=128*1024;
export const DEFAULT_MARKETS=['Liverpool','Sears','Sanborns','Coppel','Elektra','Tienda Nube','Mercado Libre'];
const clean=value=>typeof value==='string'?value.trim():'';
const own=(object,key)=>Object.hasOwn(object||{},key);
export function existingMarkets(state={}){
 return [...new Set([...DEFAULT_MARKETS,...Object.keys(state.config?.commissions||{}),...(state.orders||[]).map(row=>row.market)])].filter(name=>typeof name==='string'&&name.trim()&&name.length<=120&&!['__proto__','prototype','constructor'].includes(name));
}
export function companyName(state={}){
 const company=state.config?.workspacePresentation?.company||{},fiscal=state.config?.purchaseFiscal;
 const profile=fiscal?.profiles?.find(row=>row.id===fiscal.defaultProfileId&&row.active!==false);
 return clean(company.tradeName)||clean(company.commercialName)||clean(company.legalName)||clean(profile?.legalName)||'';
}
export function validateLogoUrl(value){
 if(typeof value!=='string')throw new Error('El logo debe ser una URL o imagen PNG/JPG.');
 const url=value.trim();if(!url)return '';
 if(url.startsWith('data:')){
  const match=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if(!match||match[2].length%4||match[2].length>4*Math.ceil(MAX_LOGO_BYTES/3))throw new Error('Usa una imagen PNG/JPG de hasta 128 KB.');
  let binary;try{binary=atob(match[2]);}catch{throw new Error('Imagen codificada inválida.');}
  if(binary.length>MAX_LOGO_BYTES)throw new Error('El logo supera 128 KB.');
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  const png=bytes.length>=33&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b)&&String.fromCharCode(...bytes.slice(12,16))==='IHDR';
  const jpeg=bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217;
  if(match[1]==='png'?!png:!jpeg)throw new Error('El contenido del logo no coincide con una imagen PNG/JPG.');
  return url;
 }
 if(url.length>2048||/[\s\\\u0000-\u001f\u007f]/.test(url))throw new Error('URL del logo inválida.');
 if(/^\/erp\/[A-Za-z0-9_./-]+$/.test(url)&&!url.includes('..'))return url;
 if(/^\/api\/documents\/[a-f0-9]{64}\?workspace=v43$/.test(url))return url;
 let parsed;try{parsed=new URL(url);}catch{throw new Error('Usa una URL HTTPS o una ruta local de imagen del ERP.');}
 if(parsed.protocol!=='https:'||!url.startsWith('https://')||!parsed.hostname||parsed.username||parsed.password)throw new Error('Usa una URL HTTPS sin credenciales o una ruta local del ERP.');
 return url;
}
function record(value,label){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(label+' inválida.');return value;}
export function saveWorkspacePresentation(state,command,context={}){
 const payload=record(command.payload,'Configuración'),previous=state.config?.workspacePresentation||{},next=structuredClone(previous);
 for(const key of Object.keys(payload))if(!['company','marketplaces','timeZone'].includes(key))throw new Error('Campo de identidad no reconocido: '+key);
 if(own(payload,'timeZone')&&payload.timeZone!==TIME_ZONE)throw new Error('La zona horaria de la operación es America/Mexico_City.');
 if(own(payload,'company')){
  const input=record(payload.company,'Empresa');for(const key of Object.keys(input))if(!['commercialName','tradeName','legalName'].includes(key))throw new Error('Campo de empresa no reconocido.');
  const company={...(previous.company||{})};
  for(const key of ['commercialName','tradeName','legalName'])if(own(input,key)){
   if(typeof input[key]!=='string'||input[key].length>200||/[\u0000-\u001f\u007f]/.test(input[key]))throw new Error('El nombre debe tener hasta 200 caracteres, sin caracteres de control.');
   company[key]=input[key].trim().replace(/\s+/g,' ');
  }
  if(own(input,'commercialName')||own(input,'tradeName')){
   if(own(input,'commercialName')&&own(input,'tradeName')&&company.commercialName!==company.tradeName)throw new Error('Usa un solo nombre comercial.');
   company.tradeName=company.commercialName=own(input,'tradeName')?company.tradeName:company.commercialName;
  }
  next.company=company;
 }
 if(own(payload,'marketplaces')){
  const rows=record(payload.marketplaces,'Identidad de marketplaces'),allowed=existingMarkets(state),marketplaces={...(previous.marketplaces||{})};
  if(Object.keys(rows).length>allowed.length)throw new Error('Selecciona marketplaces existentes.');
  for(const [name,value] of Object.entries(rows)){
   if(!allowed.includes(name))throw new Error('Marketplace no existente: '+name);
   const input=record(value,'Identidad del marketplace');
   for(const key of Object.keys(input))if(!['color','logoUrl'].includes(key))throw new Error('Solo puedes cambiar el color y el logo del marketplace.');
   const row={...(own(marketplaces,name)?marketplaces[name]:{})};
   if(own(input,'color')){if(typeof input.color!=='string'||input.color!==''&&!/^#[a-f0-9]{6}$/i.test(input.color))throw new Error('Usa un color hexadecimal de seis dígitos.');row.color=input.color.toLowerCase();}
   if(own(input,'logoUrl'))row.logoUrl=validateLogoUrl(input.logoUrl);
   marketplaces[name]=row;
  }
  next.marketplaces=marketplaces;
 }
 next.timeZone=TIME_ZONE;next.updatedAt=context.now||new Date().toISOString();next.updatedBy=context.actor||'';
 state.config??={};state.config.workspacePresentation=next;
 const message='Identidad y marketplaces guardados.';
 (state.events??=[]).unshift({id:command.id,type:command.type,date:next.updatedAt,actor:context.actor,result:'ok',message});
 return {ok:true,message};
}
