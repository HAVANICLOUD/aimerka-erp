import {canReadFinance} from './access-control.mjs';
import {reconcileLedger} from './settlement-documents.mjs?v=20261120-t1-current14';

/** Display calculations must never change the persisted input to fragment diffs. */
export function projectState(data,access){
 const output={...data,state:{...data.state},access};
 if(data.workspace==='v43'&&data.state.settlementLedger){
  output.state.orders=structuredClone(data.state.orders);
  output.state.settlementLedger=structuredClone(data.state.settlementLedger);
  reconcileLedger(output.state,{now:data.updatedAt});
 }
 if(!canReadFinance(access)){delete output.state.commissionPolicyHistory;delete output.state.orderGrossCorrectionHistory;}
 if(!access.permissions.includes('access'))delete output.state.security;
 if(!canReadFinance(access)&&output.state.settlementLedger)output.state.settlementLedger={testOrderIds:output.state.settlementLedger.testOrderIds,restricted:true};
 return output;
}
