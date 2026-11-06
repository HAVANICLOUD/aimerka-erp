/** Identity comes exclusively from Sites authentication headers, never the payload. */
export const PERMISSIONS={sales:'Registrar y gestionar ventas',inventory:'Mover y ajustar inventario',purchases:'Compras, facturas y recepciones',finance:'Registrar gastos, pagos y conciliación',finance_read:'Consultar finanzas y documentos de pago',pricing:'Guardar escenarios de precios',settings:'Modificar reglas y catálogos',warehouses:'Administrar almacenes y traspasos',access:'Administrar usuarios y roles'};
export const DEFAULT_ROLES=[
 {id:'reader',name:'Consulta',permissions:[]},
 {id:'operations',name:'Operación',permissions:['sales','inventory','purchases']},
 {id:'finance',name:'Finanzas',permissions:['finance']},
 {id:'commercial',name:'Comercial',permissions:['pricing']},
 {id:'administrator',name:'Administrador',permissions:Object.keys(PERMISSIONS)}
];
const cleanEmail=value=>String(value||'').trim().toLowerCase();
export function accessView(state,identity,ownerEmail){
 const email=cleanEmail(identity?.email),owner=!!email&&email===cleanEmail(ownerEmail),roles=state.security?.roles||DEFAULT_ROLES,users=state.security?.users||[];
 const member=users.find(u=>cleanEmail(u.email)===email),role=roles.find(r=>r.id===(member?.roleId||'reader'));
 const active=owner||!!email&&member?.active!==false,permissions=active?(owner?Object.keys(PERMISSIONS):role?.permissions||[]):[];
 return {email,owner,active,role:owner?'Propietario':role?.name||'Consulta',permissions,permissionLabels:PERMISSIONS,
  ...(permissions.includes('access')?{roles,users,ownerEmail:cleanEmail(ownerEmail)}:{})};
}
export function permissionFor(type){
 if(type.startsWith('settlement.')||type==='payment.manual.save')return 'finance';
 if(type==='marketplace.promotion.save')return 'sales';
 if(type==='marketplace.trace.save')return 'sales';
 if(type==='marketplace.identifiers.save')return 'inventory';
 if(type.startsWith('marketplace.'))return 'finance';
 if(type.startsWith('access.'))return 'access';
 if(type.startsWith('warehouse.'))return 'warehouses';
 if(type==='inventory.receivePurchase')return 'purchases';
 if(type.startsWith('inventory.')||type.startsWith('product.'))return 'inventory';
 if(type.startsWith('sale.'))return 'sales';
 if(type.startsWith('purchase.'))return 'purchases';
 if(/^(expense|credit|reconciliation)\./.test(type))return 'finance';
 if(/^(config|catalog)\./.test(type))return 'settings';
 if(type.startsWith('pricing.'))return 'pricing';
 return null;
}
export function assertPermission(access,type){
 if(!access.active)throw new Error('Tu acceso está suspendido o falta iniciar sesión.');
 const permission=permissionFor(type);
 if(type==='practice.reset'? !access.owner:!permission||!access.permissions.includes(permission))throw new Error('Tu rol no permite esta operación. Solicita el permiso al administrador.');
}
export function applyAccessCommand(state,command,context={}){
 const p=command.payload||{},security=structuredClone(state.security||{roles:DEFAULT_ROLES,users:[]});
 if(command.type==='access.role.save'){
  const id=p.id||'role-'+command.id,name=String(p.name||'').trim(),permissions=p.permissions;
  if(!name||name.length>80||!Array.isArray(permissions)||permissions.some(k=>!Object.hasOwn(PERMISSIONS,k)))throw new Error('Escribe un nombre y selecciona permisos válidos.');
  if(security.roles.some(r=>r.id!==id&&r.name.toLowerCase()===name.toLowerCase()))throw new Error('Ya existe un rol con ese nombre.');
  const role={id,name,permissions:[...new Set(permissions)]},old=security.roles.find(r=>r.id===id);if(p.id&&!old)throw new Error('Rol no encontrado.');if(old)Object.assign(old,role);else security.roles.push(role);
 }else if(command.type==='access.user.save'){
  const email=cleanEmail(p.email),role=security.roles.find(r=>r.id===p.roleId);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||!role)throw new Error('Escribe un correo válido y selecciona un rol.');
  if(email===cleanEmail(context.ownerEmail))throw new Error('El propietario conserva todos los permisos y no se puede suspender.');
  const row={email,name:String(p.name||'').trim().slice(0,120),roleId:role.id,active:p.active!==false,updatedAt:context.now},old=security.users.find(u=>u.email===email);if(old)Object.assign(old,row);else security.users.push(row);
 }else throw new Error('Operación de acceso no reconocida.');
 state.security=security;
 const message='Permisos guardados. El usuario debe tener acceso al enlace privado e iniciar sesión con ese correo.';
 (state.events??=[]).unshift({id:command.id,type:command.type,date:context.now,actor:context.actor,message,result:'ok'});
 return {ok:true,message};
}

export function canReadFinance(access){return Boolean(access?.active&&access.permissions?.some(p=>p==='finance'||p==='finance_read'));}
