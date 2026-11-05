/** Reproduce/repair the confirmed V43 persistence fault using local D1 only. */
import fs from 'node:fs';import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';
import {splitState,joinState,diffFragments} from '../lib/state-codec.mjs';
import {applyCommand} from '../lib/commands.mjs';import {reconcileLedger} from '../lib/settlement-documents.mjs';
const base=new URL(process.argv[2]||'http://127.0.0.1:5173');if(!['localhost','127.0.0.1'].includes(base.hostname))throw new Error('Local recovery test only.');
const recovery=JSON.parse(fs.readFileSync('data/recovery-v43-revision3.json')),seed=JSON.parse(fs.readFileSync('data/seed-v43.json')),rows=new Map(splitState(seed).map(r=>[r.name+'|'+r.part,r]));
const docs=recovery.collections.settlementLedger.documents;
for(let i=0;i<3;i++){
 const document=docs[i],name=document.kind==='statement'?'BANAMEX SEPTIEMBRE 2026':document.name.replace(/\.pdf$/i,''),event=recovery.collections.events.find(e=>e.date===document.importedAt&&e.type==='settlement.'+document.kind);
 assert.ok(event);const before=joinState([...rows.values()]);reconcileLedger(before,{now:document.importedAt});const next=structuredClone(before);
 applyCommand(next,{id:event.id,type:event.type,payload:{documentId:document.id,text:fs.readFileSync('outputs/v43-audit/pdf-text/pdfjs-'+name+'.pdf.txt','utf8')}},{workspace:'v43',actor:document.actor,now:document.importedAt,accountHash:recovery.collections.settlementLedger.transactions[0].accountHash,verifiedDocuments:[document]});
 const diff=diffFragments(before,next);for(const r of diff.deletes)rows.delete(r.name+'|'+r.part);for(const r of diff.upserts)rows.set(r.name+'|'+r.part,r);
}
assert.throws(()=>joinState([...rows.values()]));
const out='outputs/v43-audit';fs.writeFileSync(out+'/corrupted-local-fixture.json',JSON.stringify([...rows.values()]));
const python='/Users/giovannidaniu/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const sql=String.raw`import sqlite3,json,pathlib,sys
p=next(p for p in pathlib.Path('.wrangler/state/v3/d1/miniflare-D1DatabaseObject').glob('*.sqlite') if p.name!='metadata.sqlite')
c=sqlite3.connect(p);c.row_factory=sqlite3.Row;backup=pathlib.Path('outputs/v43-audit/local-before-recovery-test.json')
if sys.argv[1]=='prepare':
 saved={name:[dict(r) for r in c.execute('SELECT * FROM '+name+' WHERE '+('id' if name=='erp_workspaces' else 'workspace')+'=?',('v43',))] for name in ['erp_workspaces','erp_fragments','erp_actions']}
 backup.write_text(json.dumps(saved));fixture=json.loads(pathlib.Path('outputs/v43-audit/corrupted-local-fixture.json').read_text());recovery=json.loads(pathlib.Path('data/recovery-v43-revision3.json').read_text())
 with c:
  c.execute('DELETE FROM erp_fragments WHERE workspace=?',('v43',))
  for r in fixture:c.execute('INSERT INTO erp_fragments(workspace,name,part,body) VALUES(?,?,?,?)',('v43',r['name'],r['part'],r['body']))
  c.execute('UPDATE erp_workspaces SET revision=3,last_action=?,initialized=1 WHERE id=?',(recovery['expectedLastAction'],'v43'))
else:
 saved=json.loads(backup.read_text())
 with c:
  for table,records in saved.items():
   c.execute('DELETE FROM '+table+' WHERE '+('id' if table=='erp_workspaces' else 'workspace')+'=?',('v43',))
   for r in records:c.execute('INSERT INTO '+table+' ('+','.join(r)+') VALUES ('+','.join('?' for _ in r)+')',list(r.values()))
print('Local fixture '+sys.argv[1]+' complete.')`;
const stock=s=>JSON.stringify(s.products.map(p=>[p.sku,p.good,p.reserved,p.quarantine,p.damaged,p.safety,p.averageCostMxn]));
async function get(workspace){const r=await fetch(new URL('/api/state?workspace='+workspace,base));assert.equal(r.status,200);return r.json();}
const otherBefore=await Promise.all(['v28','practice'].map(get));let prepared=false;
try{
 execFileSync(python,['-c',sql,'prepare']);prepared=true;
 let current=await get('v43');assert.equal(current.revision,4);assert.equal(current.state.events[0].type,'maintenance.v43.recovery');assert.equal(current.state.settlementLedger.documents.length,3);assert.equal(stock(current.state),stock(seed));
 const file='/Users/giovannidaniu/Documents/ESTADOS DE CUENTA BANAMEX NOV 25 OCTT 26 HAVANI TECHNOLOGIES MEXICO /BANAMEX OCTUBRE 2026.pdf',form=new FormData();form.append('file',new File([fs.readFileSync(file)],'BANAMEX OCTUBRE 2026.pdf',{type:'application/pdf'}));
 let response=await fetch(new URL('/api/documents?workspace=v43&purpose=settlement',base),{method:'POST',body:form}),upload=await response.json();assert.equal(response.status,200,upload.error);
 const command={id:crypto.randomUUID(),type:'settlement.statement',workspace:'v43',revision:current.revision,payload:{documentId:upload.document.id,text:fs.readFileSync('outputs/v43-audit/pdf-text/pdfjs-BANAMEX OCTUBRE 2026.pdf.txt','utf8')}},options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)};
 response=await fetch(new URL('/api/action',base),options);const saved=await response.json();assert.equal(response.status,200,saved.error);assert.equal(saved.revision,5);
 current=await get('v43');assert.equal(current.revision,5);for(const [id,deposit,profit] of [['V000996',938692,128776],['V000997',115345,61626],['V001084',230769,61782]]){const o=current.state.orders.find(o=>o.id===id);assert.equal(o.reconciliation.depositCents,deposit);assert.equal(o.reconciliation.realProfitCents,profit);assert.equal(o.reconciliation.status,'Conciliada');}
 response=await fetch(new URL('/api/action',base),options);const repeated=await response.json();assert.equal(response.status,200,repeated.error);assert.equal(repeated.result.duplicate,true);assert.equal((await get('v43')).revision,5);assert.equal(stock(current.state),stock(seed));
 for(const before of otherBefore){const after=await get(before.workspace);assert.equal(after.revision,before.revision);assert.deepEqual(after.state,before.state);}
 const report={passed:true,corruptionReproduced:true,recoveryRevision:4,nextSaveRevision:5,subsequentReloadValid:true,threeOrdersReconciled:true,duplicateRejected:true,stockAndOtherWorkspacesUnchanged:true};fs.writeFileSync(out+'/recovery-api-qa.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(prepared)console.log(execFileSync(python,['-c',sql,'restore'],{encoding:'utf8'}).trim());}
