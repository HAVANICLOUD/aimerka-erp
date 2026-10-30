import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/erp/document-reader.js',import.meta.url),'utf8').replace("import('/erp/vendor/pdfjs/pdf.min.mjs')",'Promise.resolve(pdfjs)');
function readerFor(page,destroy=()=>Promise.resolve()){
  const pdfjs={GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>page}),destroy})};
  const context={window:{},pdfjs,Uint8Array,setTimeout,clearTimeout,document:{createElement:()=>{throw new Error('OCR should not be needed');}}};
  vm.createContext(context);vm.runInContext(source,context);return context.window.DocumentReader29;
}

test('PDF extraction supports Safari streams without an async iterator and does not depend on getTextContent',async()=>{
  let released=false,chunk=0;
  const page={getTextContent:()=>{throw new TypeError('ReadableStream has no async iterator');},streamTextContent:()=>({getReader:()=>({read:async()=>chunk++?{done:true}:{done:false,value:{items:[{str:'Orden: 599633002',hasEOL:true},{str:'BMG 37144420 Total $4,099.00',hasEOL:true}]}},releaseLock:()=>{released=true;}})}),cleanup(){}};
  const reader=readerFor(page),result=await reader.extract(new File(['%PDF-1.7 test'],'factura.pdf',{type:'application/pdf'}));
  assert.equal(result.extraction,'pdf-text');assert.match(result.text,/599633002/);assert.match(result.text,/BMG 37144420/);assert.equal(released,true);
});

test('a nonresponsive PDF cleanup cannot swallow the extracted invoice result',async()=>{
  const page={getTextContent:async()=>({items:[{str:'Orden: 599633002 BMG 37144423 Total $4,099.00 Cantidad 1'}]}),cleanup(){}};
  const reader=readerFor(page,()=>new Promise(()=>{}));
  const result=await Promise.race([reader.extract(new File(['%PDF-1.7 test'],'factura.pdf')),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Cleanup blocked completed extraction')),150))]);
  assert.equal(result.extraction,'pdf-text');assert.match(result.text,/37144423/);
});

test('a rejected text stream releases its lock and remains a read failure instead of returning partial text',async()=>{
  let released=false,cancelled=false;
  const page={streamTextContent:()=>({getReader:()=>({read:async()=>{throw new Error('Broken stream');},cancel:()=>{cancelled=true;return new Promise(()=>{});},releaseLock:()=>{released=true;}})})};
  await assert.rejects(readerFor(page).readPDFText(page),/Broken stream/);assert.equal(released,true);assert.equal(cancelled,true);
});
