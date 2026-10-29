import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
const context={window:{},Uint32Array,Uint8Array,DataView};vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../public/erp/file-hash.js',import.meta.url),'utf8'),context);
for(const bytes of [Buffer.alloc(0),Buffer.from('abc'),Buffer.from('AIMERKA · Factura'),randomBytes(55),randomBytes(56),randomBytes(64),randomBytes(65),randomBytes(1000000)]){
 assert.equal(await context.window.DocumentHash29.digest(bytes),createHash('sha256').update(bytes).digest('hex'));
}
console.log('SHA-256 fallback verified against Node crypto, including block boundaries and binary files.');
