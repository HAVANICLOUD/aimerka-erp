import {database} from './store';
import {joinState} from './state-codec.mjs';
import {productImageIndex} from './product-image-policy.mjs';
const entries=new Map<string,{expires:number,value:Map<string,any>}>(),pending=new Map<string,Promise<Map<string,any>>>();
export async function productImages(workspace:string,fresh=false):Promise<Map<string,any>>{
 const prior=entries.get(workspace);if(!fresh&&prior&&prior.expires>Date.now())return prior.value;
 if(pending.has(workspace))return pending.get(workspace)!;
 const work=(async()=>{const rows=await database().prepare('SELECT name,part,body FROM erp_fragments WHERE workspace=? AND name IN (?,?) ORDER BY name,part').bind(workspace,'products','settlementLedger').all(),state=joinState(rows.results),financialIds=new Set((state.settlementLedger?.documents||[]).map((d:any)=>d.id));const index=productImageIndex(state.products||[]);for(const [id,image] of index)if(financialIds.has(id))index.set(id,{...image,financial:true});entries.set(workspace,{expires:Date.now()+5000,value:index});return index;})();pending.set(workspace,work);try{return await work;}finally{pending.delete(workspace);}
}
