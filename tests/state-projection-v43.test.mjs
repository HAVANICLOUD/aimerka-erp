import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {projectState} from '../lib/state-view.mjs';
import {splitState,joinState,diffFragments} from '../lib/state-codec.mjs';
import {applyCommand} from '../lib/commands.mjs';
import {reconcileLedger} from '../lib/settlement-documents.mjs';
import {planV43Recovery,v43RecoveryWrites} from '../lib/v43-recovery.mjs';
const seed=()=>JSON.parse(fs.readFileSync(new URL('../data/seed-v43.json',import.meta.url)));
const recovery=JSON.parse(fs.readFileSync(new URL('../data/recovery-v43-revision3.json',import.meta.url)));
const fixture=name=>fs.readFileSync(new URL('./fixtures/v43/'+name+'.txt',import.meta.url),'utf8');
const access={permissions:['access','finance'],active:true,email:'test'};
const rowKey=r=>r.name+'|'+r.part;
function persist(rows,before,after){const diff=diffFragments(before,after);for(const r of diff.deletes)rows.delete(rowKey(r));for(const r of diff.upserts)rows.set(rowKey(r),r);}
function command(state,i,name,kind){const documentId=String(i+1).repeat(64);return applyCommand(state,{id:'fragment-case-'+i,type:'settlement.'+kind,payload:{documentId,text:fixture(name)}},{workspace:'v43',actor:'test',now:'2026-11-05T03:00:00Z',accountHash:'test-account',verifiedDocuments:[{id:documentId,name:name+'.pdf'}]});}
const cases=[['SANBORNS_11457','cheque'],['SEARS_32798','cheque'],['BANAMEX_SEPTIEMBRE','statement'],['BANAMEX_OCTUBRE','statement']];

test('display projection never shifts persisted fragment boundaries across all four document saves and reloads',()=>{
 const initial=seed();initial.config.bankReconciliation.companyRfc='AAA010101AAA';const rows=new Map(splitState(initial).map(r=>[rowKey(r),r]));
 for(const [i,[name,kind]]of cases.entries()){
  const raw=joinState([...rows.values()]),unchanged=JSON.stringify(raw),view=projectState({workspace:'v43',state:raw,revision:i,updatedAt:'2026-11-05T03:00:00Z'},access);
  assert.equal(JSON.stringify(raw),unchanged);assert.notEqual(view.state.orders,raw.orders);assert.notEqual(view.state.settlementLedger,raw.settlementLedger);assert.equal(view.state.products,raw.products);
  const next=structuredClone(raw);command(next,i,name,kind);persist(rows,raw,next);assert.deepEqual(joinState([...rows.values()]),next,name);
 }
 const saved=joinState([...rows.values()]);assert.equal(saved.orders.filter(o=>saved.settlementLedger.testOrderIds.includes(o.id)&&o.reconciliation.status==='Conciliada').length,3);
 assert.deepEqual(saved.products,initial.products);
});

test('the former in-place read calculation reproduces the production corruption after the third document',()=>{
 const initial=seed();initial.config.bankReconciliation.companyRfc='AAA010101AAA';const rows=new Map(splitState(initial).map(r=>[rowKey(r),r]));let failedAt=-1;
 for(const [i,[name,kind]]of cases.entries()){
  const raw=joinState([...rows.values()]);reconcileLedger(raw);const next=structuredClone(raw);command(next,i,name,kind);persist(rows,raw,next);
  try{joinState([...rows.values()]);}catch{failedAt=i;break;}
 }
 assert.equal(failedAt,2);
});

test('recovery is restricted to the exact damaged V43 revision, last action and workbook fingerprint',()=>{
 const current={workspace:'v43',revision:3,lastAction:recovery.expectedLastAction,sourceSha256:recovery.sourceSha256},ctx={now:'2026-11-05T06:00:00Z',actionId:'repair-owner-export'};
 for(const change of [{workspace:'v28'},{workspace:'practice'},{revision:4},{lastAction:'another-action'},{sourceSha256:'another-workbook'}])assert.equal(planV43Recovery(recovery,{...current,...change},ctx),null);
 const plan=planV43Recovery(recovery,current,ctx);assert.deepEqual(Object.keys(plan.collections).sort(),['events','orders','settlementLedger']);assert.equal(plan.nextRevision,4);assert.equal(plan.collections.events[0].type,'maintenance.v43.recovery');assert.equal(recovery.collections.events.length,3);
});

test('actual SQLite repair is atomic, preserves inventory/other workspaces, and a losing concurrent repair cannot overwrite it',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE erp_workspaces(id TEXT PRIMARY KEY, revision INTEGER, last_action TEXT, updated_at TEXT); CREATE TABLE erp_fragments(workspace TEXT,name TEXT,part INTEGER,body TEXT,PRIMARY KEY(workspace,name,part)); CREATE TABLE erp_actions(workspace TEXT,id TEXT,type TEXT,input_hash TEXT,result TEXT,revision INTEGER,actor TEXT,created_at TEXT,PRIMARY KEY(workspace,id));');
 db.prepare('INSERT INTO erp_workspaces VALUES(?,?,?,?)').run('v43',3,recovery.expectedLastAction,'before');db.prepare('INSERT INTO erp_workspaces VALUES(?,?,?,?)').run('v28',12,'existing','before');
 for(const [workspace,name,body] of [['v43','orders','broken-array'],['v43','settlementLedger','broken-ledger'],['v43','events','[]'],['v43','products','[{"sku":"keep","good":7}]'],['v28','orders','["untouched"]']])db.prepare('INSERT INTO erp_fragments VALUES(?,?,?,?)').run(workspace,name,0,body);
 const current={workspace:'v43',revision:3,lastAction:recovery.expectedLastAction,sourceSha256:recovery.sourceSha256},first=planV43Recovery(recovery,current,{now:'first',actionId:'repair-first'}),second=planV43Recovery(recovery,current,{now:'second',actionId:'repair-second'}),batch=writes=>{db.exec('BEGIN');try{for(const w of writes)db.prepare(w.sql).run(...w.params);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}};
 const writes=v43RecoveryWrites(recovery,first);assert.throws(()=>batch([...writes.slice(0,3),{sql:'INVALID SQL',params:[]}]));assert.equal(db.prepare('SELECT revision FROM erp_workspaces WHERE id=?').get('v43').revision,3);assert.equal(db.prepare('SELECT body FROM erp_fragments WHERE workspace=? AND name=?').get('v43','orders').body,'broken-array');
 batch(writes);const restored=joinState(db.prepare('SELECT name,part,body FROM erp_fragments WHERE workspace=? ORDER BY name,part').all('v43'));assert.equal(restored.orders.length,706);assert.equal(restored.settlementLedger.documents.length,3);assert.deepEqual(restored.products,[{sku:'keep',good:7}]);
 batch(v43RecoveryWrites(recovery,second));assert.equal(db.prepare('SELECT COUNT(*) AS n FROM erp_actions').get().n,1);assert.equal(db.prepare('SELECT last_action FROM erp_workspaces WHERE id=?').get('v43').last_action,'repair-first');assert.equal(db.prepare('SELECT revision FROM erp_workspaces WHERE id=?').get('v28').revision,12);assert.equal(db.prepare('SELECT body FROM erp_fragments WHERE workspace=?').get('v28').body,'["untouched"]');db.close();
});
