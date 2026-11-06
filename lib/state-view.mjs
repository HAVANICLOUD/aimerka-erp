import {canReadFinance} from './access-control.mjs';
import {reconcileLedger} from './settlement-documents.mjs';

/** Display calculations must never change the persisted input to fragment diffs. */
export function projectState(data,access){
 const output={...data,state:{...data.state},access};
 if(data.workspace==='v43'&&data.state.settlementLedger){
  output.state.orders=structuredClone(data.state.orders);
  output.state.settlementLedger=structuredClone(data.state.settlementLedger);
  reconcileLedger(output.state,{now:data.updatedAt});
 }
 if(!access.permissions.includes('access'))delete output.state.security;
 if(!canReadFinance(access)&&output.state.settlementLedger)output.state.settlementLedger={testOrderIds:output.state.settlementLedger.testOrderIds,restricted:true};
 return output;
}
