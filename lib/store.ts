import { env } from 'cloudflare:workers';
import { splitState, joinState, diffFragments } from './state-codec.mjs';
import seed from '../data/seed-v28.json';
import pricingConfig from '../data/pricing-config.json';
import legacy from './legacy-domain.mjs';

export function database(){if(!env.DB)throw new Error('El almacenamiento del ERP no está disponible.');return env.DB;}
export function workspaceId(value:string|null|undefined){if(value==='practice')return 'practice';if(!value||value==='v28')return 'v28';throw new Error('Espacio de trabajo inválido.');}
export function createSeed(id:string){
  if(id==='v28'){const state:any=structuredClone(seed);state.config=structuredClone(pricingConfig);return state;}
  const state:any=legacy.createState();
  const defaults:any=seed;
  Object.assign(state,{version:28,purchases:[],expenses:[],purchasePayments:[],expensePayments:[],creditRules:structuredClone(defaults.creditRules),catalogs:structuredClone(defaults.catalogs),movements:[],sicarMovements:[],sicarMonthlyReference:[],sourceAudit:[],config:structuredClone(pricingConfig),source:{file:'Escenario de práctica',notes:'Productos y pedidos ficticios para ensayar sin modificar V28.'}});
  state.products.forEach((p:any)=>{const terms=p.name.toLowerCase().split(' '),sample=defaults.products.find((x:any)=>x.brand===p.brand&&terms.some((t:string)=>t.length>3&&x.name.toLowerCase().includes(t)))||defaults.products.find((x:any)=>x.brand===p.brand);p.upc=p.sku;p.sellerSku=p.sku;p.source='Práctica';p.status='OK';p.shippingType=sample?.shippingType||'Pequeño';p.shippingException='Automático';p.categories=structuredClone(sample?.categories||{});p.categoryOverrides={};p.category=sample?.category||p.category;p.averageCostMxn=p.costCents/100;p.sourceStock=p.good;});
  state.orders.forEach((o:any)=>{o.totalCents=o.qty*o.unitPriceCents;o.items=[{id:o.id+'-1',sku:o.sku,upc:o.sku,name:state.products.find((p:any)=>p.sku===o.sku)?.name,qty:o.qty,unitPriceCents:o.unitPriceCents,totalCents:o.totalCents,costCents:state.products.find((p:any)=>p.sku===o.sku)?.costCents||0}];o.stockMode='operational';o.commercialStatus=o.status==='cancelled'?'Cancelada':'Activa';o.source='Práctica';o.documentDate=o.date;o.creationDate=o.date;o.followupStatus=o.incident?'Pendiente':'Sin pendiente';o.priority='Normal';o.comments='';o.reconciliation={conditions:{publication:'CLASICA',msi:'Sin MSI',shippingCents:null},estimate:null,depositCents:o.paidCents,depositDate:o.paidCents?o.date.slice(0,10):null,status:'Sin revisar',notes:'',selected:false,draft:null,history:[]};});
  return state;
}

async function init(id:string){
  const db=database(),now=new Date().toISOString(),action='init-v28';
  await db.prepare('INSERT OR IGNORE INTO erp_workspaces (id,revision,initialized,last_action,updated_at) VALUES (?,0,0,?,?)').bind(id,'',now).run();
  const row:any=await db.prepare('SELECT initialized FROM erp_workspaces WHERE id=?').bind(id).first();
  if(row?.initialized)return;
  const fragments=splitState(createSeed(id));
  const statements=[db.prepare('UPDATE erp_workspaces SET initialized=1, last_action=?, updated_at=? WHERE id=? AND initialized=0').bind(action,now,id)];
  for(const r of fragments)statements.push(db.prepare('INSERT OR IGNORE INTO erp_fragments(workspace,name,part,body) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM erp_workspaces WHERE id=? AND initialized=1 AND last_action=?)').bind(id,r.name,r.part,r.body,id,action));
  await db.batch(statements);
}

export async function readState(id:string){
  const db=database();
  let batch=await db.batch([db.prepare('SELECT revision, initialized, updated_at FROM erp_workspaces WHERE id=?').bind(id),db.prepare('SELECT name,part,body FROM erp_fragments WHERE workspace=? ORDER BY name,part').bind(id)]);
  if(!(batch[0].results[0] as any)?.initialized){await init(id);batch=await db.batch([db.prepare('SELECT revision, initialized, updated_at FROM erp_workspaces WHERE id=?').bind(id),db.prepare('SELECT name,part,body FROM erp_fragments WHERE workspace=? ORDER BY name,part').bind(id)]);}
  const row:any=batch[0].results[0];
  return {workspace:id,revision:row.revision,updatedAt:row.updated_at,state:joinState(batch[1].results)};
}
export async function priorAction(id:string,actionId:string){return database().prepare('SELECT input_hash,result,revision FROM erp_actions WHERE workspace=? AND id=?').bind(id,actionId).first<any>();}
export async function hashInput(value:unknown){const bytes=new TextEncoder().encode(JSON.stringify(value));const hash=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(hash)).map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function commitState(id:string,revision:number,before:any,after:any,command:any,result:any,actor:string,inputHash:string){
  const db=database(),next=revision+1,now=new Date().toISOString(),diff=diffFragments(before,after);
  const guard='EXISTS(SELECT 1 FROM erp_workspaces WHERE id=? AND revision=? AND last_action=?)';
  const statements=[db.prepare('UPDATE erp_workspaces SET revision=?,last_action=?,updated_at=? WHERE id=? AND revision=?').bind(next,command.id,now,id,revision)];
  for(const row of diff.upserts)statements.push(db.prepare(`INSERT INTO erp_fragments(workspace,name,part,body) SELECT ?,?,?,? WHERE ${guard} ON CONFLICT(workspace,name,part) DO UPDATE SET body=excluded.body`).bind(id,row.name,row.part,row.body,id,next,command.id));
  for(const row of diff.deletes)statements.push(db.prepare(`DELETE FROM erp_fragments WHERE workspace=? AND name=? AND part=? AND ${guard}`).bind(id,row.name,row.part,id,next,command.id));
  statements.push(db.prepare(`INSERT INTO erp_actions(workspace,id,type,input_hash,result,revision,actor,created_at) SELECT ?,?,?,?,?,?,?,? WHERE ${guard}`).bind(id,command.id,command.type,inputHash,JSON.stringify(result),next,actor,now,id,next,command.id));
  const response=await db.batch(statements);
  if(response[0].meta.changes!==1)return null;
  return {workspace:id,revision:next,updatedAt:now,state:after,result};
}
