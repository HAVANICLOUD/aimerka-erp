import {readTeamPolicy} from './store';
import {accessView,assertPermission} from './access-control.mjs';
import {projectState} from './state-view.mjs';
// Owner verified against this existing Site's access configuration. Local preview
// uses the Sites mock identity only in development, never on a production host.
export const OWNER_EMAIL='geovanyjk@msn.com';
export async function requestAccess(request:Request,current?:any){
 const email=request.headers.get('oai-authenticated-user-email')||'';
 const local=import.meta.env.DEV&&['127.0.0.1','localhost'].includes(new URL(request.url).hostname);
 const policy=await readTeamPolicy();
 return {...accessView(policy.state,{email:local?OWNER_EMAIL:email},OWNER_EMAIL),teamRevision:policy.revision};
}
export {assertPermission};
export const visibleState=projectState;
