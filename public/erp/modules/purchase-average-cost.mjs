/** New operational receipts only. Historical imported balances are the opening valuation. */
export const PURCHASE_VALUATION_VERSION=1;
export const physicalCostUnits=p=>Math.max(0,Number(p.good||0)+Number(p.quarantine||0)+Number(p.damaged||0));
const exactCost=p=>Number.isFinite(p.averageCostMxn)?p.averageCostMxn*100:Number(p.costCents||0);
function setCost(p,cents,now){p.averageCostMxn=Math.max(0,cents)/100;p.costCents=Math.round(p.averageCostMxn*100);p.sourceCost=p.averageCostMxn;p.costSource='Compras AIMERKA · promedio ponderado';p.costStatus='Confirmado';p.updatedAt=now;}
function history(state,p,data,ctx){(state.purchaseCostHistory??=[]).push({id:String(ctx.requestId||ctx.now)+':'+(state.purchaseCostHistory||[]).length,sku:p.sku,date:ctx.now,actor:ctx.actor,...data});}
export function valuePurchaseReceipt(state,p,{qty,unitCostCents,purchaseId,lineId,receiptId},ctx){
 const beforeQty=physicalCostUnits(p),before=exactCost(p),known=unitCostCents!=null&&Number.isFinite(unitCostCents),unit=known?unitCostCents:before;
 const after=(beforeQty*before+qty*unit)/(beforeQty+qty);
 if(known)setCost(p,after,ctx.now);
 p.lastPurchaseCostCents=known?Math.round(unit):p.lastPurchaseCostCents;p.lastPurchaseDate=ctx.now;
 history(state,p,{type:'receipt',purchaseId,lineId,receiptId,qty,beforeQty,beforeUnitCostCents:before,unitCostCents:unit,afterUnitCostCents:after,pendingInvoice:!known},ctx);
 return {version:PURCHASE_VALUATION_VERSION,provisionalUnitCostCents:unit,appliedUnitCostCents:unit,remainingQty:Math.min(qty,Math.max(0,Number(p.good||0)+Number(p.quarantine||0)+Number(p.damaged||0)+qty)),pendingInvoice:!known};
}
/** Moving-average stock exits remove every receipt's value in the same proportion. */
export function consumeReceiptValuation(state,sku,beforeQty,afterQty){
 if(beforeQty<=0||afterQty>=beforeQty)return;const ratio=Math.max(0,afterQty)/beforeQty;
 for(const receipt of state.purchaseReceipts||[])for(const item of receipt.items||[])if(item.sku===sku&&item.costValuation?.version===PURCHASE_VALUATION_VERSION)item.costValuation.remainingQty*=ratio;
}
/** Late invoices revalue those same received units; stock quantities never change here. */
export function reconcileReceivedPurchaseCost(state,purchase,ctx){
 const receipts=[...(state.purchaseReceipts||[])].filter(r=>r.purchaseId===purchase.id).reverse();
 for(const line of purchase.items||[]){
  if(!(line.invoicedQty>0)||line.invoicedTotalCents==null)continue;
  const rows=receipts.flatMap(r=>(r.items||[]).filter(i=>i.lineId===line.id).map(item=>({receipt:r,item}))),p=state.products.find(p=>p.sku===line.sku);if(!p)continue;
  let coveredBefore=Math.max(0,(line.receivedQty||0)-rows.reduce((s,r)=>s+r.item.qty,0));
  for(const {receipt,item} of rows){
   const covered=Math.min(item.qty,Math.max(0,line.invoicedQty-coveredBefore));coveredBefore+=item.qty;
   const v=item.costValuation;if(v?.version!==PURCHASE_VALUATION_VERSION)continue;
   const invoiceUnit=line.invoicedTotalCents/line.invoicedQty,target=(covered*invoiceUnit+(item.qty-covered)*v.provisionalUnitCostCents)/item.qty,delta=target-v.appliedUnitCostCents;
   v.pendingInvoice=covered<item.qty;if(Math.abs(delta)<1e-7)continue;
   const stock=physicalCostUnits(p),remaining=Math.min(item.qty,Math.max(0,v.remainingQty)),remainingDelta=remaining*delta,before=exactCost(p),after=stock>0?before+remainingDelta/stock:before;
   if(after < -0.5)throw Error('La actualización del costo requiere revisar los movimientos de inventario del producto '+p.sku+'.');
   if(stock>0)setCost(p,after,ctx.now);
   history(state,p,{type:'invoice_adjustment',purchaseId:purchase.id,lineId:line.id,receiptId:receipt.id,qty:item.qty,remainingQty:remaining,inventoryAdjustmentCents:Math.round(remainingDelta),dispatchedCostAdjustmentCents:Math.round((item.qty-remaining)*delta),beforeUnitCostCents:before,afterUnitCostCents:after,invoiceUnitCostCents:invoiceUnit},ctx);
   v.appliedUnitCostCents=target;v.updatedAt=ctx.now;p.lastPurchaseCostCents=Math.round(invoiceUnit);
  }
 }
}
