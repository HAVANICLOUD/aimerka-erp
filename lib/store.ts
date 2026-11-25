import {maintainSaleComments} from './sale-aftercare.mjs';
import {maintainSaleIdentifiers} from './sale-identifiers.mjs';
import {maintainSalePromotions} from './sale-promotion-maintenance.mjs';
import liverpoolPromotions from '../data/liverpool-promotions-20261124.json';
import {maintainOrderReference} from './order-reference-maintenance.mjs';
import marketplaceOrderReference from '../data/marketplace-order-reference-20261124.json';
import {maintainOrderGross} from './order-gross-maintenance.mjs';
import marketplaceGrossEvidence from '../data/marketplace-gross-evidence-20261124.json';
import {applyMarketplaceOrderEvidence} from './marketplace-order-status.mjs';
import marketplaceOrderEvidence from '../data/marketplace-order-evidence-20261124.json';
import {migrateT1Commission14} from './t1-commission-policy.mjs';
import {correctLiverpoolSmartwatches} from './marketplace-mapping-maintenance.mjs';
import {migrateBuenFinFamily,backfillCampaignRestorations,restoreExpiredCampaignPrices} from './campaign-lifecycle.mjs';
import {resolveWorkspace} from './workspace-policy.mjs';
import { env } from 'cloudflare:workers';
import { splitState, joinState, diffFragments } from './state-codec.mjs';
import seed from '../data/seed-v28.json';
import seed43 from '../data/seed-v43.json';
import pricingConfig from '../data/pricing-config.json';
import legacy from './legacy-domain.mjs';
import recoverySnapshot from '../data/recovery-v43-revision3.json';
import {planV43Recovery,v43RecoveryWrites} from './v43-recovery.mjs';

export function database(){if(!env.DB)throw new Error('El almacenamiento del ERP no está disponible.');return env.DB;}
export const workspaceId=resolveWorkspace;
export function createSeed(id:string){
  if(id==='v43'){const state=structuredClone(seed43);migrateT1Commission14(state);return state;}
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

export async function readState(id:string,maintain=true){
  const db=database();
  const fetchBatch=()=>db.batch([db.prepare('SELECT revision, initialized, updated_at, last_action FROM erp_workspaces WHERE id=?').bind(id),db.prepare('SELECT name,part,body FROM erp_fragments WHERE workspace=? ORDER BY name,part').bind(id)]);
  let batch=await fetchBatch();
  if(!(batch[0].results[0] as any)?.initialized){await init(id);batch=await fetchBatch();}
  let row:any=batch[0].results[0],state:any;
  try{state=joinState(batch[1].results);}
  catch(error){
    if(id!=='v43')throw error;
    const source:any=joinState(batch[1].results.filter((r:any)=>r.name==='source'));
    const now=new Date().toISOString(),actionId='repair-v43-'+crypto.randomUUID();
    const plan=planV43Recovery(recoverySnapshot,{workspace:id,revision:row.revision,lastAction:row.last_action,sourceSha256:source.source?.sha256},{now,actionId});
    if(!plan)throw error;
    const statements=v43RecoveryWrites(recoverySnapshot,plan).map(write=>db.prepare(write.sql).bind(...write.params));
    await db.batch(statements);
    batch=await fetchBatch();row=batch[0].results[0];state=joinState(batch[1].results);
  }
  if(id==='v43'&&maintain){
    const next=structuredClone(state),now=new Date().toISOString(),actionId='campaign-maintenance-'+crypto.randomUUID();
    const saleIdentifiers=maintainSaleIdentifiers(next,{now});
    const salePromotions=maintainSalePromotions(next,liverpoolPromotions,{now,requestId:actionId,actor:'Propietario · cotejo autorizado de promociones'});
    const orderReference=maintainOrderReference(next,marketplaceOrderReference,{now,requestId:actionId,actor:'Propietario · cotejo autorizado de pedidos y consecutivo SICAR'});
    const orderGross=maintainOrderGross(next,marketplaceGrossEvidence,{now,requestId:actionId,actor:'Propietario · corrección autorizada'});
    const orderEvidence=applyMarketplaceOrderEvidence(next,marketplaceOrderEvidence,{now,requestId:actionId,actor:'Sistema · cotejo autorizado por el propietario'});
    const commissionCorrection=migrateT1Commission14(next,{now,requestId:actionId,actor:'Sistema · instrucción del propietario'});
    const mappingCorrection=correctLiverpoolSmartwatches(next,{now,requestId:actionId,actor:'Sistema · revisión del propietario'});
    const linked=migrateBuenFinFamily(next,{now,requestId:actionId}),backfilled=backfillCampaignRestorations(next,now),closed=restoreExpiredCampaignPrices(next,now);
    const commentCleanup=maintainSaleComments(next,{now,requestId:actionId,actor:'Sistema · limpieza autorizada de comentarios'});
    if(commentCleanup||saleIdentifiers||salePromotions||orderReference||orderGross||orderEvidence||commissionCorrection||mappingCorrection||linked||backfilled||closed){
      const command={id:actionId,type:'pricing.event.maintenance',payload:{linked,backfilled,closed,mappingCorrection,commissionCorrection,orderEvidence,orderGross,orderReference,salePromotions,saleIdentifiers,commentCleanup}};
      const saved=await commitState(id,row.revision,state,next,command,{ok:true},'Sistema',await hashInput(command.payload));
      return saved||readState(id,false);
    }
  }
  return {workspace:id,revision:row.revision,updatedAt:row.updated_at,state};
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

// Retired datasets are not exposed. Their existing team policy remains a single
// internal security record, independent of the operative inventory and sales.
export async function readTeamPolicy(){
 const batch=await database().batch([database().prepare('SELECT revision FROM erp_workspaces WHERE id=?').bind('v28'),database().prepare('SELECT name,part,body FROM erp_fragments WHERE workspace=? AND name=? ORDER BY part').bind('v28','security')]);
 return {revision:Number((batch[0].results[0] as any)?.revision||0),state:joinState(batch[1].results)};
}
