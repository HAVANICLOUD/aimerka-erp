/** Opt-in local API smoke test. Only writes/restores a note in workspace practice. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base=new URL(process.argv[2]||'http://localhost:4173');
if(!['localhost','127.0.0.1','terminal.local'].includes(base.hostname))throw new Error('This test is restricted to the local preview.');
const workspace='practice',id='qa-note-'+crypto.randomUUID(),marker='QA persistencia '+id;
const result={workspace,startedAt:new Date().toISOString(),assertions:[]};
async function get(){const res=await fetch(new URL('/api/state?workspace='+workspace,base),{cache:'no-store',signal:AbortSignal.timeout(20000)});assert.equal(res.status,200);return res.json();}
async function post(command){const res=await fetch(new URL('/api/action',base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(20000)});return {status:res.status,body:await res.json()};}
const check=(name,fn)=>{fn();result.assertions.push(name);};
const inventory=s=>JSON.stringify(s.products.map(p=>[p.sku,p.good,p.reserved,p.quarantine,p.damaged,p.safety]));
let original,targetId,noteWritten=false,writeCommand,writeSnapshot;
try{
  let initial=await get();result.startingRevision=initial.revision;assert.ok(initial.state.orders.length);
  const target=initial.state.orders.find(o=>!o.comments?.startsWith('QA persistencia'))||initial.state.orders[0];targetId=target.id;original={comments:target.comments||'',priority:target.priority,followupStatus:target.followupStatus};
  for(let attempt=0;attempt<5;attempt++){
    if(attempt)initial=await get();
    writeCommand={id,type:'sale.note',workspace,revision:initial.revision,payload:{orderId:targetId,comments:marker}};
    const response=await post(writeCommand);
    if(response.status===409&&!response.body.result?.duplicate)continue;
    assert.equal(response.status,200);writeSnapshot=response.body;noteWritten=true;
    check('write advances revision once',()=>assert.equal(writeSnapshot.revision,initial.revision+1));
    check('note write leaves all stock unchanged',()=>assert.equal(inventory(writeSnapshot.state),inventory(initial.state)));
    break;
  }
  assert.ok(noteWritten,'Concurrent changes prevented the test write.');result.savedRevision=writeSnapshot.revision;
  const reload=await get();
  check('separate GET reads saved note',()=>assert.equal(reload.state.orders.find(o=>o.id===targetId).comments,marker));
  check('single event for original request',()=>assert.equal(reload.state.events.filter(e=>e.id===id).length,1));
  const repeated=await post(writeCommand);
  check('same key and payload returns duplicate success',()=>{assert.equal(repeated.status,200);assert.equal(repeated.body.result.duplicate,true);});
  check('duplicate creates no second event',()=>assert.equal(repeated.body.state.events.filter(e=>e.id===id).length,1));result.replayedRevision=repeated.body.revision;
  const changed=await post({...writeCommand,payload:{...writeCommand.payload,comments:'Este texto no debe guardarse'}});
  check('same key with different payload is rejected',()=>assert.equal(changed.status,409));
  const stale=await post({...writeCommand,id:'qa-stale-'+crypto.randomUUID(),payload:{...writeCommand.payload,comments:'La revisión anterior no debe guardar esta nota'}});
  check('stale revision is rejected',()=>assert.equal(stale.status,409));
  const final=await get();
  check('rejections leave saved note intact',()=>assert.equal(final.state.orders.find(o=>o.id===targetId).comments,marker));
  check('rejections create no event for rejected operation',()=>assert.equal(final.state.events.filter(e=>e.id===id).length,1));
  result.passed=true;
}catch(error){result.passed=false;result.error=error.message;process.exitCode=1;}
finally{
  if(noteWritten){
    let restored=false;
    for(let attempt=0;attempt<5;attempt++){
      const current=await get(),target=current.state.orders.find(o=>o.id===targetId);
      if(target.comments!==marker){result.restore='Skipped: note changed independently; no overwrite.';break;}
      const response=await post({id:'qa-restore-'+crypto.randomUUID(),type:'sale.note',workspace,revision:current.revision,payload:{orderId:targetId,...original}});
      if(response.status===409)continue;
      assert.equal(response.status,200);const readBack=await get();assert.equal(readBack.state.orders.find(o=>o.id===targetId).comments,original.comments);
      result.restoredRevision=response.body.revision;restored=true;result.restore='Original note restored and read back.';break;
    }
    if(!restored&&!result.restore){result.restore='Could not restore because concurrent writes continued.';result.passed=false;process.exitCode=1;}
  }
  result.finishedAt=new Date().toISOString();
  const evidenceDir=new URL('../../v28-audit/',import.meta.url);
  fs.mkdirSync(evidenceDir,{recursive:true});
  fs.writeFileSync(new URL('api-persistence-result.json',evidenceDir),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}
