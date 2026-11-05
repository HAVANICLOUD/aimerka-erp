"""Read-only import of AIMERKA V28 into normalized JSON for the private prototype.
Never executes VBA, recalculates formulas, or writes back to the source workbook.
"""
import json
import math
import pathlib
import sys
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP

import openpyxl

BASE = pathlib.Path(__file__).resolve().parents[1]
SOURCE = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else BASE.parent / 'upload/ERP_AIMERKA_V28_CONCILIACION_LOTES_PRUEBA.xlsm'
DESTINATION = pathlib.Path(sys.argv[2]) if len(sys.argv)>2 else BASE / 'data/seed-v28.json'
w = openpyxl.load_workbook(SOURCE, read_only=True, data_only=True, keep_vba=True)


def txt(value):
    if value is None:
        return ''
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def cents(value):
    if value is None or value == '' or isinstance(value, str) and value.startswith('#'):
        return None
    try:
        return int((Decimal(str(value)) * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
    except Exception:
        return None


def iso(value):
    if isinstance(value, datetime):
        if value.year < 2000:
            return None
        return value.isoformat(timespec='seconds') if value.time() != datetime.min.time() else value.date().isoformat()
    if isinstance(value, date) and value.year >= 2000:
        return value.isoformat()
    if isinstance(value, (int, float)) and 36526 <= value < 2958100:
        return iso(openpyxl.utils.datetime.from_excel(value))
    return None


def rows(name, width=None):
    return [[c.value for c in row] for row in w[name].iter_rows(min_row=2, max_col=width) if row[0].value not in (None, '')]


def raw(name, header_row=1):
    data = [[c.value for c in row] for row in w[name].iter_rows()]
    return {'headers': data[header_row-1], 'rows': [r for r in data[header_row:] if r[0] not in (None, '')]}


market_categories = ['T1 Comercios', 'Coppel', 'Mercado Libre', 'Liverpool', 'Tienda Nube', 'Elektra']
products = []
for number, r in enumerate(rows('CONFIG_PRODUCTOS', 30), 2):
    stock = r[6] if isinstance(r[6], (int, float)) else None
    sku = txt(r[27]) or 'UPC-' + txt(r[0])
    products.append({
        'sku': sku, 'sellerSku': txt(r[27]), 'upc': txt(r[0]), 'name': txt(r[1]),
        'brand': txt(r[26]) or txt(r[2]), 'department': txt(r[2]), 'category': txt(r[3]), 'status': txt(r[7]), 'sourceStatus': txt(r[7]),
        'costCents': cents(r[4]), 'sourceCost': r[4], 'averageCostMxn': r[4], 'priceCents': cents(r[5]),
        'good': max(0, stock or 0), 'reserved': 0, 'quarantine': 0, 'damaged': 0, 'safety': 0, 'minStock': 3,
        'sourceStock': stock, 'stockStatus': 'Por revisar' if stock is None or stock < 0 else 'Importado V28',
        'categories': dict(zip(market_categories, [txt(r[i]) for i in [8,9,10,11,12,14]])),
        'categoryOverrides': dict(zip(market_categories, [txt(r[i]) for i in range(18,24)])),
        'shippingType': txt(r[17]), 'shippingException': txt(r[15]), 'shippingSuggested': txt(r[16]),
        'generalCategory': txt(r[24]), 'commercialDepartment': txt(r[25]), 'satCode': txt(r[28]),
        'review': txt(r[29]), 'source': 'V28', 'sourceRow': number, 'icon': 'box'
    })
by_upc = {p['upc']: p for p in products}
lines = {}
for r in rows('VENTA_PARTIDAS', 11):
    p = by_upc.get(txt(r[3]), {})
    item = {'id': txt(r[0]), 'orderId': txt(r[1]), 'sku': p.get('sku') or txt(r[2]),
            'sellerSku': txt(r[2]), 'upc': txt(r[3]), 'name': txt(r[4]), 'qty': r[5],
            'unitPriceCents': cents(r[6]), 'totalCents': cents(r[7]), 'costCents': p.get('costCents'),
            'reintegratedQty': r[8] or 0, 'date': iso(r[9]), 'sourceMode': txt(r[10])}
    lines.setdefault(txt(r[1]), []).append(item)
recon_by_order = {txt(r[0]): r for r in rows('DATOS_CONCILIACION',44)}
orders = []
for number, r in enumerate(rows('DATOS_VENTAS', 37), 2):
    items = lines.get(txt(r[0]), [])
    order = {'id': txt(r[0]), 'number': txt(r[2]), 'market': txt(r[1]), 'account': 'HAVANI Technologies México',
             'sicar': txt(r[3]), 'sicarUuid': txt(r[29]), 'sicarUrl': txt(r[34]), 'ventiId': '',
             'date': iso(r[28]) or iso(r[14]), 'documentDate': iso(r[14]), 'creationDate': iso(r[28]),
             'totalCents': cents(r[23]), 'shippingChargedCents': cents(r[27]) or 0,
             'sku': items[0]['sku'] if items else '', 'qty': sum(i['qty'] or 0 for i in items),
             'unitPriceCents': items[0]['unitPriceCents'] if items else None,
             'status': 'cancelled' if txt(r[15]) == 'Cancelada' else 'historical',
             'commercialStatus': txt(r[15]), 'paymentStatus': 'refunded' if txt(r[16]) == 'Reembolsada' else 'unknown',
             'sourcePaymentStatus': txt(r[16]), 'returnStatus': 'none', 'sourceReturnStatus': txt(r[17]),
             'stockMode': 'historical', 'source': 'V28', 'items': items, 'history': [],
             'comments': txt(r[4]), 'priority': txt(r[5]), 'followupStatus': txt(r[6]),
             'registeredAt': iso(r[7]), 'updatedAt': iso(r[8]), 'targetDate': iso(r[9]),
             'sourceDescription': txt(r[10]), 'sourceSheet': txt(r[11]), 'sourceRow': r[12] or number,
             'review': txt(r[13]), 'cancellationReason': txt(r[18]), 'cancelledAt': iso(r[19]),
             'refundedAt': iso(r[20]), 'returnedAt': iso(r[21]), 'resolvedAt': iso(r[22]),
             'currency': txt(r[24]) or 'MXN', 'partsStatus': txt(r[26]), 'productConfidence': txt(r[30]),
             'orderOrigin': txt(r[31]), 'literalNumber': txt(r[32]), 'orderControl': txt(r[33]),
             'sourceNetMovementCents': cents(r[35]), 'productNames': txt(r[36]),
             'commissionBps': 0, 'msiBps': 0, 'shippingCents': 0, 'withholdingCents': 0,
             'paidCents': None, 'incident': ''}
    re = recon_by_order.get(order['id'])
    if re:
        order['reconciliation'] = {'conditions':{'publication':txt(re[16]) or 'CLASICA',
            'msi':txt(re[17]) or txt(re[31]) or 'Sin MSI', 'shippingCents':cents(re[19])},
            'estimate':None, 'depositCents':cents(re[10]), 'depositDate':iso(re[11]),
            'status':txt(re[13]) or 'Sin revisar', 'notes':txt(re[14]), 'selected':txt(re[21])=='Sí',
            'draft':None, 'history':[], 'sourceScope':txt(re[25]), 'sourceRow':number}
    orders.append(order)


def payments(name):
    return [{'id': txt(r[0]), 'entityId': txt(r[1]), 'number': int(r[2] or 1), 'amountCents': cents(r[3]),
             'date': iso(r[4]), 'notes': txt(r[5]), 'recordedAt': iso(r[6]), 'sourceRow': r[7],
             'originalPaidDate': txt(r[8]), 'installmentsCovered': int(r[9] or 1),
             'recommendedCents': cents(r[10]), 'mode': txt(r[11]), 'source': 'V28'} for r in rows(name,12)]


purchase_payments = payments('ABONOS_COMPRAS')
expense_payments = payments('ABONOS_GASTOS')
purchase_lines = {}
for r in rows('COMPRAS_PARTIDAS',7):
    purchase_lines.setdefault(txt(r[1]), []).append({'id':txt(r[0]), 'purchaseId':txt(r[1]), 'skuOrUpc':txt(r[2]),
        'name':txt(r[3]), 'qty':r[4], 'unitCostCents':cents(r[5]), 'totalCents':cents(r[6])})
purchases = []
for r in rows('DATOS_COMPRAS',25):
    purchases.append({'id':txt(r[0]), 'sicar':txt(r[1]), 'date':iso(r[2]), 'originalDate':txt(r[2]),
        'firstPaymentDate':iso(r[3]), 'lender':txt(r[4]), 'instrument':txt(r[5]), 'term':int(r[6] or 1),
        'supplier':txt(r[7]), 'originalDocument':txt(r[8]), 'taxInvoice':txt(r[9]), 'supplierOrder':txt(r[10]),
        'receiptStatus':txt(r[11]), 'satReviewed':txt(r[12]), 'amountCents':cents(r[13]),
        'originalPaidDate':txt(r[14]), 'paidCents':cents(r[15]) or 0, 'balanceCents':cents(r[16]),
        'review':txt(r[17]), 'status':txt(r[18]), 'createdAt':iso(r[19]), 'updatedAt':iso(r[20]),
        'notes':txt(r[21]), 'sourceRow':r[22], 'originalBalanceCents':cents(r[23]),
        'reviewStatus':txt(r[24]), 'items':purchase_lines.get(txt(r[0]),[]), 'source':'V28'})
expenses = []
for r in rows('DATOS_GASTOS',28):
    expenses.append({'id':txt(r[0]), 'date':iso(r[1]), 'category':txt(r[2]), 'description':txt(r[3]),
        'lender':txt(r[4]), 'instrument':txt(r[5]), 'taxInvoice':txt(r[6]), 'merchantReference':txt(r[7]),
        'invoiceDate':iso(r[8]), 'originalInvoiceDate':txt(r[8]), 'amountCents':cents(r[9]), 'term':int(r[10] or 1),
        'firstPaymentDate':iso(r[11]), 'paidCents':cents(r[12]) or 0, 'balanceCents':cents(r[13]),
        'status':txt(r[14]), 'createdAt':iso(r[15]), 'updatedAt':iso(r[16]), 'notes':txt(r[17]),
        'sourceFile':txt(r[18]), 'sourceRow':r[19], 'originalPaidDate':txt(r[20]), 'review':txt(r[21]),
        'originalStatus':txt(r[22]), 'originalTermMissing':bool(r[23]), 'originalDocument':txt(r[24]),
        'originalPaidCents':cents(r[25]), 'paidConfirmedByUserCents':cents(r[26]), 'sourceSheet':txt(r[27]), 'source':'V28'})


def list_column(sheet, column):
    values = []
    for (c,) in w[sheet].iter_rows(min_row=2,min_col=column,max_col=column):
        value = txt(c.value)
        if value and value.casefold() not in [x.casefold() for x in values]:
            values.append(value)
    return values


catalogs = {'lenders':list_column('CONFIG_COMPRAS',27), 'instruments':list_column('CONFIG_COMPRAS',28),
    'suppliers':list_column('CONFIG_COMPRAS',29), 'expenseCategories':list_column('CONFIG_GASTOS',27),
    'expenseDescriptions':list_column('CONFIG_GASTOS',28)}
for key, col in [('lenders',30),('instruments',29)]:
    for value in list_column('CONFIG_GASTOS',col):
        if value.casefold() not in [x.casefold() for x in catalogs[key]]:
            catalogs[key].append(value)
credit_rules = []
for row in w['CONFIG_FINANZAS'].iter_rows(min_row=2,min_col=27,max_col=34):
    r = [c.value for c in row]
    if not txt(r[0]) or not txt(r[1]):
        continue
    credit_rules.append({'id':'CR-'+str(len(credit_rules)+1), 'lender':txt(r[0]), 'instrument':txt(r[1]),
        'paymentDay':int(r[2]) if r[2] not in (None,'') else None, 'active':txt(r[3])=='Sí',
        'note':txt(r[4]), 'cutoffDay':int(r[5]) if r[5] not in (None,'') else None, 'issuer':txt(r[6]), 'source':'V28'})
sicar = []
for r in rows('SICAR_MOVIMIENTOS',20):
    sicar.append({'id':txt(r[0]), 'orderId':txt(r[1]), 'sicar':txt(r[2]), 'market':txt(r[3]),
        'documentDate':iso(r[4]), 'creationDate':iso(r[5]), 'type':txt(r[6]), 'amountCents':cents(r[7]),
        'qty':r[8], 'products':txt(r[9]), 'skuLiteral':txt(r[10]), 'number':txt(r[11]), 'literalNumber':txt(r[12]),
        'productConfidence':txt(r[13]), 'orderControl':txt(r[14]), 'orderOrigin':txt(r[15]), 'sourceUrl':txt(r[16]),
        'sourceRow':r[17], 'date':iso(r[18]), 'dateOrigin':txt(r[19]), 'source':'V28'})
cotejo = []
for row in w['COTEJO_SICAR'].iter_rows(min_row=6,max_row=17,min_col=2,max_col=7):
    r=[c.value for c in row]
    if iso(r[0]):
        cotejo.append({'month':iso(r[0])[:7], 'sicarCreationCents':cents(r[1]), 'erpCreationCents':cents(r[2]),
            'differenceCents':cents(r[3]), 'erpDocumentCents':cents(r[4]), 'dateDifferenceCents':cents(r[5])})

audit = []
for row in w['REGISTRO_CAMBIOS'].iter_rows(min_row=4,min_col=2,max_col=9):
    r=[c.value for c in row]
    if any(v is not None for v in r):
        audit.append({'date':iso(r[0]), 'action':txt(r[1]), 'market':txt(r[2]), 'key':txt(r[3]),
            'before':r[4], 'after':r[5], 'user':txt(r[6]), 'detail':txt(r[7]), 'source':'V28'})

seed = {'schema':1, 'version':28, 'products':products, 'orders':orders, 'purchases':purchases, 'expenses':expenses,
    'purchasePayments':purchase_payments, 'expensePayments':expense_payments, 'creditRules':credit_rules,
    'catalogs':catalogs, 'movements':[], 'events':[], 'processedEventIds':[], 'nextOrder':max(int(o['id'][1:]) for o in orders)+1,
    'sicarMovements':sicar, 'sicarMonthlyReference':cotejo, 'sourceAudit':audit,
    'rawReconciliation':raw('DATOS_CONCILIACION'), 'rawReconciliationDetail':raw('DETALLE_CONCILIACION'),
    'config':{}, 'source':{'file':SOURCE.name, 'version':28, 'reviewMode':'Lectura estática; macros sin ejecutar',
    'salesImportedWithoutInventoryMovement':True, 'sicarComparisonDate':'2026-10-24',
    'counts':{'sheets':len(w.sheetnames), 'products':len(products), 'orders':len(orders), 'orderLines':sum(len(i) for i in lines.values()),
    'purchases':len(purchases), 'expenses':len(expenses), 'sicarMovements':len(sicar)}}}
DESTINATION.parent.mkdir(parents=True,exist_ok=True)
DESTINATION.write_text(json.dumps(seed,ensure_ascii=False,indent=2,default=lambda x:iso(x) if isinstance(x,(date,datetime)) else str(x)))
print(json.dumps({'destination':str(DESTINATION),'counts':seed['source']['counts'],'bytes':DESTINATION.stat().st_size}))
