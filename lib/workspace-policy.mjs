export const OPERATIVE_WORKSPACE='v43';
export function resolveWorkspace(value){
 if(value==null||value===''||['v43','v28','practice'].includes(value))return OPERATIVE_WORKSPACE;
 throw new Error('Espacio de trabajo inválido.');
}
export function currentWorkspaceWrite(value,type){return value===OPERATIVE_WORKSPACE&&!type?.startsWith('access.')&&type!=='practice.reset';}
