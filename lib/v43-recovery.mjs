import {splitState} from './state-codec.mjs';
/** One narrowly guarded repair from the last complete, owner-exported snapshot. */
export function planV43Recovery(snapshot,current,context){
 if(current.workspace!=='v43'||current.revision!==snapshot.expectedRevision||current.lastAction!==snapshot.expectedLastAction||current.sourceSha256!==snapshot.sourceSha256)return null;
 const c=snapshot.collections;
 if(Object.keys(c).sort().join(',')!=='events,orders,settlementLedger'||c.orders?.length!==706||c.settlementLedger?.cheques?.length!==66||c.settlementLedger?.documents?.length!==3||!Array.isArray(c.events))throw new Error('El respaldo de recuperación V43 no pasó la validación.');
 const restored=structuredClone(c);
 restored.events.unshift({id:context.actionId,type:'maintenance.v43.recovery',date:context.now,actor:'Sistema · recuperación V43',result:'ok',message:'Respaldo validado recuperado. Ventas y documentos conservados; inventario sin cambios.',snapshotSha256:snapshot.snapshotSha256,previousAction:snapshot.expectedLastAction});
 return {collections:restored,nextRevision:snapshot.expectedRevision+1,actionId:context.actionId,now:context.now,snapshotSha256:snapshot.snapshotSha256};
}
export function v43RecoveryWrites(snapshot,plan){
 const id='v43',guard='EXISTS(SELECT 1 FROM erp_workspaces WHERE id=? AND revision=? AND last_action=?)',key=[id,plan.nextRevision,plan.actionId];
 const writes=[{sql:'UPDATE erp_workspaces SET revision=?,last_action=?,updated_at=? WHERE id=? AND revision=? AND last_action=?',params:[plan.nextRevision,plan.actionId,plan.now,id,snapshot.expectedRevision,snapshot.expectedLastAction]}];
 for(const name of Object.keys(plan.collections))writes.push({sql:`DELETE FROM erp_fragments WHERE workspace=? AND name=? AND ${guard}`,params:[id,name,...key]});
 for(const part of splitState(plan.collections))writes.push({sql:`INSERT INTO erp_fragments(workspace,name,part,body) SELECT ?,?,CAST(? AS INTEGER),? WHERE ${guard}`,params:[id,part.name,part.part,part.body,...key]});
 writes.push({sql:`INSERT INTO erp_actions(workspace,id,type,input_hash,result,revision,actor,created_at) SELECT ?,?,?,?,?,CAST(? AS INTEGER),?,? WHERE ${guard}`,params:[id,plan.actionId,'maintenance.v43.recovery',plan.snapshotSha256,JSON.stringify({ok:true,message:'Respaldo V43 validado recuperado; inventario conservado.'}),plan.nextRevision,'system',plan.now,...key]});
 return writes;
}
