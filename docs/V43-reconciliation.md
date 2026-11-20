# Laboratorio V43

The new `v43` workspace is an immutable import from the supplied V43 workbook. Existing `v28` and `practice` records are never migrated or replaced. Importers read cached formula values and extract images; they do not execute macros or write the workbook.

Imported: 706 sales, 326 products, 49 purchases, 45 expenses, 66 cheques, 420 payment movements and 1,468 product photographs. Original line identifiers, leading UPC/order zeros, exact average costs, preliminary deposits, source tax certificate fields, logistics, promotions, serials and traceability are retained. Photographs are commercial catalog assets. Cheque originals are delivered by the server only to finance users; uploaded originals use private R2 storage. Bank account numbers are replaced by a hash and last four digits in persisted transaction records.

The operative payment chain is cheque → exact marketplace/order link → Banamex credit → per-sale deposit. Initial documentary evidence never confirms a bank deposit. Latest cheques Sears 32798 and Sanborns 11457 are held out for recognition. Other documentary evidence comes from the workbook. The three-order test view is a display filter; a bank statement can reconcile other matching documentary cheques in this new laboratory.

Bank matching requires the configured corporate RFC, marketplace origin, normalized cheque reference, date window, and exact amount. The reader preserves columns and cross-page transactions. Balances and withdrawals are not credits. Duplicate file hashes, cheque identities and bank traces cannot create a second payment. Unknown order links, contradictory documents, multiple candidate credits and amount differences remain unconfirmed.

NP amounts already net are not reduced by withholding twice. Global CR/DR amounts are allocated across the cheque's orders with deterministic cent conservation. LD/ND and SI/SV remain separate movements. External shipping reduces profit, not the deposit. An estimated withholding is never represented as a SAT certificate. Expected commission uses editable quotation rules; a documentary or inferred historical commission remains a separate comparison. Bank confirmation is against the cheque, not against the expected commission model.

V43 T1 calculator withholding uses gross / (1 + included VAT) before commission. Other workspace calculators retain their prior behavior. Profit uses exact current average cost until final rounding. Returns/cancellations retain their evidence without inventing realized profit. Manual legacy deposit and batch routes cannot bypass bank proof for Sears/Sanborns.

Validation: 243 automated tests, including all 713 nonblank source expected net/profit values within one cent. Local API QA uploaded the four actual PDFs, reopened byte-identical originals, verified command replay/stale revisions and image upload, and confirmed no stock/cost changes or changes to V28/Practice. The actual PDF.js layout reader was also run against both bank statements. Browser QA covers the bank upload, duplicate retry and image OCR of both latest cheques. Direct image upload and byte-identical retrieval are covered by the local API test. Generated local evidence is in ignored `outputs/v43-audit/`.

This is an adaptation of the workbook's business data and calculations to the existing web modules, not an execution environment for Excel VBA. The source workbook and the previous V34 review remain available as their original references. No prices or inventory are sent to VentiApp or SICAR.

Additional parity checks cover every cheque-linked documentary amount, including signed withholding allocation on returns and SI/SV adjustments. Eight sale-level results differ by one cent from independently rounded Excel values because the bank allocation conserves the cheque total exactly; original fractional values remain in source fields. Orders without a cheque use the expected net in debt, and later adjustments remain pending until bank proof arrives.

Persistence repair: display calculations now operate on cloned orders/ledger and never mutate the raw state used for fragment comparisons. Regression tests reproduce the original third-document failure and verify four saves with reloads. A one-time recovery is restricted to V43 revision 3, its exact last action UUID and workbook fingerprint; only orders, documentary ledger and audit events are restored from the complete owner-exported snapshot. SQLite tests verify rollback and concurrent guards. Local D1/API QA verifies recovery to revision 4, October save to revision 5, a fresh reload, duplicate replay and preservation of stock and other workspaces.

## Comisión vigente Sears y Sanborns — 20/11/2026

Por instrucción del propietario, la tarifa operativa compartida T1 es 14% en
calculadoras, comparador, eventos comerciales, liquidaciones y estimaciones de
conciliación. El 18% deja de ser tarifa vigente y no se ofrece como alternativa.
La retención estimada conserva su base independiente: venta sin IVA, antes de
comisión. Este cambio de tarifa no modifica la regla fiscal.

`migrateT1Commission14` aplica una sola vez la tarifa a los catálogos persistidos
y retira los pronósticos importados o guardados que fueron calculados al 18%.
Los originales de esos pronósticos quedan en `commissionPolicyHistory`, separado
de la estimación activa y restringido a consulta financiera. Los nuevos valores
visibles se calculan con la tarifa vigente; no se presentan pronósticos del 18%
como datos actuales. La marca evita repetir la migración o sobrescribir una
configuración que el propietario cambie posteriormente.

Los depósitos, comprobantes bancarios, cheques, certificados SAT, retenciones
documentales, comisiones inferidas, conciliaciones y snapshots históricos de
precios no se reescriben. Una venta cuya evidencia resulte en 18% conserva ese
porcentaje real. Un depósito aislado no prueba por sí mismo la comisión: se
mantiene la diferenciación de calidad documental en `commissionEvidence`.
