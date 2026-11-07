import { readFile,writeFile,mkdir,copyFile } from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
const legacy=await readFile(path.join(root,'lib/legacy-domain.cjs'),'utf8');
const marker='function () {';
const body=legacy.slice(legacy.indexOf(marker)+marker.length,legacy.lastIndexOf('\n});'));
await writeFile(path.join(root,'lib/legacy-domain.mjs'),'// Original v1 motor retained as an ESM factory for the server.\nconst legacy=(function(){'+body+'\n})();\nexport default legacy;\n');
await mkdir(path.join(root,'public/erp/modules'),{recursive:true});
for(const name of ['product-prices.mjs','retention-certificates.mjs','workspace-policy.mjs','product-identity.mjs','inventory-workspace.mjs','purchase-catalogs.mjs','invoice-fiscal-reader.mjs','purchase-workspace.mjs','payment-reconciliation.mjs','settlement-documents.mjs','payout-schedules.mjs','warehouses.mjs','pricing-v28.mjs','operations-v28.mjs','reconciliation-v28.mjs','inventory-v28.mjs','purchase-document-parser.mjs','purchase-document-validation.mjs']){
  await copyFile(path.join(root,'lib',name),path.join(root,'public/erp/modules',name));
}
const html=await readFile(path.join(root,'public/erp/index.html'),'utf8');
await writeFile(path.join(root,'lib/shell.ts'),'export const shell = '+JSON.stringify(html)+';\n');
