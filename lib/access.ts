import {readState} from './store';
import {accessView,assertPermission} from './access-control.mjs';
// Owner verified against this existing Site's access configuration. Local preview
// uses the Sites mock identity only in development, never on a production host.
export const OWNER_EMAIL='geovanyjk@msn.com';
export async function requestAccess(request:Request,current?:any){
 const email=request.headers.get('oai-authenticated-user-email')||'';
 const local=import.meta.env.DEV&&['127.0.0.1','localhost'].includes(new URL(request.url).hostname);
 const policy=current?.workspace==='v28'?current:await readState('v28');
 return accessView(policy.state,{email:local?OWNER_EMAIL:email},OWNER_EMAIL);
}
export {assertPermission};
export function visibleState(data:any,access:any){
 const output={...data,state:{...data.state},access};if(!access.permissions.includes('access'))delete output.state.security;
 if(!access.permissions.includes('finance')&&output.state.settlementLedger){output.state.settlementLedger={testOrderIds:output.state.settlementLedger.testOrderIds,restricted:true};}
 return output;
}
