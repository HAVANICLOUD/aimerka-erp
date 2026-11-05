/** Explicit local laboratory integration test. Never accepts a hosted destination. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
const base=new URL(process.argv[2]||'http://127.0.0.1:5173');
if(!['127.0.0.1','localhost'].includes(base.hostname))throw new Error('Only a local laboratory can be tested.');
const context={window:{},setTimeout,clearTimeout,Uint8Array};vm.createContext(context);vm.runInContext(fs.readFileSync('public/erp/document-reader.js','utf8'),context);
const report={checks:[],startedAt:new Date().toISOString()},check=(label,fn)=>{fn();report.checks.push(label);};
async function get(workspace='v43'){const res=await fetch(new URL('/api/state?workspace='+workspace,base));assert.equal(res.status,200);return res.json();}
async function upload(file,purpose){const body=new FormData();body.append('file',new File([fs.readFileSync(file)],file.split('/').at(-1)));const res=await fetch(new URL('/api/documents?workspace=v43&purpose='+purpose,base),{method:'POST',body});const data=await res.json();assert.equal(res.status,200,data.error);return data.document;}
async function post(command){const response=await fetch(new URL('/api/action',base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)});return {status:response.status,body:await response.json()};}
let current=await get();assert.equal(current.revision,0,'Use an unused local V43 laboratory. Never reset a modified workspace.');
const untouched=await Promise.all(['v28','practice'].map(get)),stock=s=>JSON.stringify(s.products.map(p=>[p.sku,p.good,p.reserved,p.quarantine,p.damaged,p.averageCostMxn])),initialStock=stock(current.state);
const docroot='/Users/giovannidaniu/Desktop/AIMERKA_DOCUMENTOS_SEARS_SANBORNS_2025_2026/';
const bankroot='/Users/giovannidaniu/Documents/ESTADOS DE CUENTA BANAMEX NOV 25 OCTT 26 HAVANI TECHNOLOGIES MEXICO /';
for(const [kind,path] of [['statement',bankroot+'BANAMEX SEPTIEMBRE 2026.pdf'],['statement',bankroot+'BANAMEX OCTUBRE 2026.pdf'],['cheque',docroot+'Sanborns/SANBORNS_11457.pdf'],['cheque',docroot+'Sears/SEARS_32798.pdf']]){
 const pdf=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(path)),useSystemFonts:true,isEvalSupported:false}).promise,texts=[];
 for(let page=1;page<=pdf.numPages;page++)texts.push(await context.window.DocumentReader29.readPDFText(await pdf.getPage(page),true));await pdf.loadingTask.destroy();
 const document=await upload(path,'settlement'),command={id:crypto.randomUUID(),type:'settlement.'+kind,workspace:'v43',revision:current.revision,payload:{documentId:document.id,text:texts.join('\n\f\n'),extraction:'pdf-text'}};
 const saved=await post(command);assert.equal(saved.status,200,saved.body.error);current=saved.body;
 const repeat=await post(command);check('Exact command replay does not repeat '+kind,()=>assert.equal(repeat.body.result.duplicate,true));assert.equal(repeat.body.revision,current.revision);
 const response=await fetch(new URL('/api/documents/'+document.id+'?workspace=v43',base));check('Original '+kind+' PDF remains attached',()=>assert.equal(response.status,200));assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array(fs.readFileSync(path)));
 if(kind==='statement')check('Bank statement alone cannot confirm held-out cheque',()=>assert.ok(current.state.orders.filter(o=>current.state.settlementLedger.testOrderIds.includes(o.id)).every(o=>o.reconciliation.depositCents===null)));
}
for(const [id,amount,profit] of [['V000996',938692,128776],['V000997',115345,61626],['V001084',230769,61782]])check('Real bank deposit and profit for '+id,()=>{const o=current.state.orders.find(o=>o.id===id);assert.equal(o.reconciliation.depositCents,amount);assert.equal(o.reconciliation.realProfitCents,profit);assert.equal(o.reconciliation.status,'Conciliada');});
check('Bank proof conserves every inventory quantity and exact cost',()=>assert.equal(stock(current.state),initialStock));
const product=current.state.products.find(p=>p.status==='OK'&&p.images?.length&&p.images.length<12),original=structuredClone(product),otherImage=current.state.products.flatMap(p=>p.images||[]).find(i=>!product.images.some(o=>o.id===i.id)),file='public'+otherImage.url,photo=await upload(file,'image');
const added={...product,images:[...product.images.filter(i=>i.id!==photo.id),{...photo,source:'upload',primary:true}]};for(const i of added.images)if(i.id!==photo.id)i.primary=false;
const savedPhoto=await post({id:crypto.randomUUID(),type:'product.save',workspace:'v43',revision:current.revision,payload:{originalSku:product.sku,product:added}});assert.equal(savedPhoto.status,200,savedPhoto.body.error);current=savedPhoto.body;
const image=await fetch(new URL('/api/documents/'+photo.id+'?workspace=v43',base));check('Direct photograph upload is readable after product save',()=>assert.equal(image.status,200));
assert.deepEqual(new Uint8Array(await image.arrayBuffer()),new Uint8Array(fs.readFileSync(file)));
const restore=await post({id:crypto.randomUUID(),type:'product.save',workspace:'v43',revision:current.revision,payload:{originalSku:original.sku,product:original}});assert.equal(restore.status,200,restore.body.error);current=restore.body;
const stale=await post({id:crypto.randomUUID(),type:'settlement.config',workspace:'v43',revision:0,payload:{config:current.state.config.bankReconciliation}});check('Stale revision is rejected',()=>assert.equal(stale.status,409));
const reload=await get();check('A separate reload preserves all three bank confirmations',()=>assert.equal(reload.state.orders.filter(o=>reload.state.settlementLedger.testOrderIds.includes(o.id)&&o.reconciliation.status==='Conciliada').length,3));
check('Inventory remains unchanged after photograph editing',()=>assert.equal(stock(reload.state),initialStock));
for(const before of untouched){const after=await get(before.workspace);check('Existing '+before.workspace+' state is unchanged',()=>{assert.equal(after.revision,before.revision);assert.equal(JSON.stringify(after.state),JSON.stringify(before.state));});}
report.passed=true;report.revision=reload.revision;report.finishedAt=new Date().toISOString();fs.mkdirSync('outputs/v43-audit',{recursive:true});fs.writeFileSync('outputs/v43-audit/api-qa.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
