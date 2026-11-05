"""Immutable V43 snapshot, documentary ledger and original commercial photographs.
No macros execute and the original workbook is never saved.
"""
import json, pathlib, subprocess, sys, hashlib, base64
from collections import defaultdict
import openpyxl
ROOT=pathlib.Path(__file__).resolve().parents[1]
SOURCE=pathlib.Path(sys.argv[1])
DEST=ROOT/'data/seed-v43.json'
base=ROOT/'outputs/v43-audit/base-v43.json'
subprocess.run([sys.executable,str(ROOT/'scripts/import-v28.py'),str(SOURCE),str(base)],check=True)
state=json.loads(base.read_text()); values=json.loads((ROOT/'outputs/v43-audit/values.json').read_text())
def rows(name):return [r for r in values[name][1:] if r[0] not in (None,'')]
def text(v):return '' if v is None else str(int(v)) if isinstance(v,float) and v.is_integer() else str(v).strip()
def cents(v):return None if v is None or v=='' else round(float(v)*100)
state['version']=43; state['source'].update(version=43,sha256=hashlib.sha256(SOURCE.read_bytes()).hexdigest(),notes='Copia V43. Los cheques son evidencia documental; ningún depósito bancario se presume confirmado.')
state['config']=json.loads((ROOT/'data/pricing-config.json').read_text())
state['config'].update(source=SOURCE.name,version=43)
for channel,sheet in [('T1 Comercios','CONFIG_T1'),('Coppel','CONFIG_COPPEL'),('Liverpool','CONFIG_LIVERPOOL'),('Elektra','CONFIG_ELEKTRA')]:
 state['config']['commissions'][channel]=[{'category':text(r[0]),'path':text(r[1]),'rate':r[2],'note':text(r[3]),'sourceRow':i} for i,r in enumerate(values[sheet][3:],4) if r[0] and isinstance(r[2],(int,float))]
state['config']['commissions']['Mercado Libre']=[{'category':text(r[0]),'parentCategory':text(r[1]),'path':text(r[2]),'rate':r[3],'premiumRate':r[4],'note':text(r[5]),'sourceRow':i} for i,r in enumerate(values['CONFIG_ML'][3:],4) if r[0] and isinstance(r[3],(int,float))]
for key,index in [('vatWithholding',3),('incomeWithholding',4),('priceEnding',5),('competitiveTolerance',6)]:state['config']['parameters'][key]=values['CONFIG_PARAMETROS'][index][1]
state['config']['parameters']['t1IncludedVat']=values['CONFIG_PARAMETROS'][8][1]
state['config']['shipping']=[dict(zip(['type','min','max','base','note'],r[:5])) for r in values['CONFIG_ENVIOS'][3:] if r[0] and isinstance(r[3],(int,float))]
state['config']['elektraMsi']=[{'label':text(r[5]),'rate':r[6]} for r in values['CONFIG_ELEKTRA'][3:] if len(r)>6 and r[5] and isinstance(r[6],(int,float))]
state['config']['tnGateways']=[dict(zip(['gateway','mode','months','min','max','effectiveRate','weight','included','baseOperation','msiRate','msiVat','extraRate','note'],r[:13])) for r in values['CONFIG_TIENDA_NUBE'][9:21] if r[0]]
state['config']['tnBands']=[dict(zip(['label','min','max','simpleMean','weightedMean','maxRate','usedRate','methodCount','criterion','note'],r[:10])) for r in values['CONFIG_TIENDA_NUBE'][24:30] if r[0]]
state['config']['categoryMappings']=[{'category':text(r[0]),'channels':dict(zip(['T1 Comercios','Coppel','Mercado Libre','Liverpool','Tienda Nube','Elektra'],[text(r[i]) for i in [1,2,3,4,5,7]])),'note':text(r[6]),'shipping':text(r[8])} for r in values['MATCH_CATEGORIAS'][1:] if r[0]]
state['config']['bankReconciliation']={'commissionRate':.18,'vatIncluded':.16,'vatWithholding':.08,'incomeWithholding':.025,'dateWindowDays':90,'companyRfc':'HTM210224BN8'}
for collection in ['products','orders','expenses','purchases','purchasePayments','expensePayments']:
 for row in state[collection]:row['source']='V43'
byid={o['id']:o for o in state['orders']}
for r in rows('DATOS_CONCILIACION'):
 o=byid.get(text(r[0]))
 if o:
  o['v43Comparison']={k:r[i] for k,i in {'documentaryNetMxn':45,'positiveMxn':46,'returnsMxn':47,'cheques':48,'expectedCommissionMxn':50,'expectedVatMxn':51,'expectedIsrMxn':52,'expectedNetMxn':53,'comparativeMxn':54,'comparativeSource':55,'externalShippingMxn':56,'costMxn':57,'retentionMxn':58,'inferredCommissionMxn':59,'inferredRate':60,'expectedProfitMxn':61,'documentaryProfitMxn':62,'profitDifferenceMxn':63,'condition':66}.items()}
  if o['market'] in ['Sears','Sanborns']:
   o['reconciliation'].update(depositCents=None,depositDate=None,status='Pendiente de banco',bankProofRequired=True)
for r in rows('BORRADOR_CONCILIACION'):
 if text(r[0]) in byid:byid[text(r[0])]['reconciliation']['sourceDraft']=r
for r in rows('LOGISTICA_VENTAS'):
 if text(r[0]) in byid:
  o=byid[text(r[0])];o['sourceLogistics']=r
  if o['market'] not in ['Sears','Sanborns']:
   o.setdefault('marketplace34',{})['logistics']={'confirmed':text(r[8])=='Cobrado','reference':text(r[9]),'charges':[{'kind':kind,'amountCents':cents(r[index]) or 0,'treatment':'Descontado','credit':False,'document':text(r[1]),'date':text(r[10])[:10]} for kind,index in [('Envío',3),('Logística inversa',4),('Seguro',5)] if r[index] not in (None,0)]}
for r in rows('PROMOCIONES_VENTAS'):
 if text(r[0]) in byid:
  o=byid[text(r[0])];o['sourcePromotion']=r;o.setdefault('marketplace34',{})['promotion']={'amountCents':cents(r[3]) or 0,'description':text(r[1]),'msiMonths':r[2] or 0,'treatment':'Informativa','grossCents':o['totalCents'],'customerAmountCents':cents(r[4])}
for r in rows('DATOS_SERIES'):
 if text(r[0]) in byid:
  o=byid[text(r[0])];o.setdefault('sourceSerials',[]).append(r);line=next((l for l in o['items'] if l['id']==text(r[1])),None)
  if line:o.setdefault('marketplace34',{}).setdefault('units',[]).append({'lineId':line['id'],'sku':line['sku'],'unit':r[2],'serial':text(r[3]),'imei':text(r[4])})
for r in rows('DATOS_TRAZA'):
 if text(r[0]) in byid:
  o=byid[text(r[0])];o['sourceTrace']=r;o.setdefault('marketplace34',{})['trace']={**{key:text(r[i])[:10] or None for i,key in enumerate(['creation','dispatch','shipment','delivery','cancelMarketplace','cancelSeller','refundMarketplace','refundSeller','restock'],1)},'reference':text(r[13])}
for r in rows('T1_VENTAS'):
 if text(r[0]) in byid:byid[text(r[0])]['t1Source']={'cheques':text(r[3]),'documentaryNetCents':cents(r[10]),'originalCheque':text(r[39]),'returnCheque':text(r[40]),'condition':text(r[13]),'shippingCents':cents(r[16]),'costMxn':r[20],'withholdingMxn':r[9],'sourceRow':r}
movements=defaultdict(list)
for r in rows('T1_MOVIMIENTOS'):
 movements[text(r[1])+'|'+text(r[2])].append({'id':text(r[0]),'orderNumber':text(r[4]).rstrip('/'),'documentNumber':text(r[5]),'code':text(r[6]),'amountCents':cents(r[7]),'orderId':text(r[12]) or None,'sourceRetentionMxn':r[18],'sourceAllocatedRetentionMxn':r[24]})
cheques=[]
holdout=['Sears|32798','Sanborns|11457']
for r in rows('T1_CHEQUES'):
 key=text(r[1])+'|'+text(r[2]);cheques.append({'id':key,'market':text(r[1]),'number':text(r[2]),'date':text(r[3])[:10],'totalCents':cents(r[4]),'lines':movements[key],'source':'V43','status':'awaiting_ocr' if key in holdout else 'documented','sourceDifferenceCents':cents(r[9]),'sourceWithholdingCents':cents(r[6]),'bankTransactionId':None,'documentId':None})
state['settlementLedger']={'cheques':cheques,'statements':[],'transactions':[],'documents':[],'testOrderIds':['V000996','V000997','V001084'],'sourceCounts':{'cheques':len(cheques),'lines':sum(len(c['lines']) for c in cheques)},'demoChequeIds':holdout}
source_cheques={text(r[1])+'|'+text(r[2]):r for r in rows('T1_CHEQUES')}
for c in cheques:
 r=source_cheques[c['id']];c['sourceRow']=r;c['retentionCertificate']={'uuid':r[24] or '', 'condition':r[25] or '', 'vatMxn':r[22], 'incomeMxn':r[23], 'reference':r[15] or ''}
# The supporting PDFs are bundled only in server source, delivered behind finance permission.
archive=pathlib.Path('/Users/giovannidaniu/Desktop/AIMERKA_DOCUMENTOS_SEARS_SANBORNS_2025_2026')
sourcepdfs={}
for c in cheques:
 candidates=list((archive/c['market']).glob('*'+c['number']+'.pdf'))
 if len(candidates)==1:
  raw=candidates[0].read_bytes();sourcepdfs[c['id']]={'name':candidates[0].name,'sha256':hashlib.sha256(raw).hexdigest(),'data':base64.b64encode(raw).decode()}
(ROOT/'data/source-cheques-v43.json').write_text(json.dumps(sourcepdfs,separators=(',',':')))
# Complete source tables remain server-side in the state; explicit sheets allow parity audits.
state['v43SourceTables']={k:values[k] for k in ['PROMOCIONES_PARTIDAS','PROMOCIONES_VENTAS','DATOS_SERIES','DATOS_TRAZA','ALIAS_PRODUCTOS_MKP','CONFIG_PARAMETROS','CONFIG_T1','CONFIG_ELEKTRA','CONFIG_LIVERPOOL','CONFIG_COPPEL','CONFIG_MERCADOLIBRE'] if k in values}
book=openpyxl.load_workbook(SOURCE,read_only=True,data_only=True)
metadata={i:r for i,r in enumerate(book['DATOS_IMAGENES'].iter_rows(values_only=True),1) if i>1 and r[0]}
chunks=defaultdict(list)
for r in book['FOTOS_EMBEBIDAS'].iter_rows(min_row=2,values_only=True):
 if r[4] and r[7]:chunks[int(r[4])].append((int(r[6] or 0),str(r[7])))
byupc={p['upc']:p for p in state['products']};count=0;size=0
folder=ROOT/'public/erp/catalog-v43';folder.mkdir(exist_ok=True)
for imageid,parts in chunks.items():
 meta=metadata.get(imageid)
 if not meta:continue
 p=byupc.get(text(meta[0]))
 if not p:continue
 try:data=base64.b64decode(''.join(s for _,s in sorted(parts)),validate=True)
 except Exception:continue
 ext='jpg' if data[:3]==b'\xff\xd8\xff' else 'png' if data[:8]==b'\x89PNG\r\n\x1a\n' else None
 if not ext:continue
 digest=hashlib.sha256(data).hexdigest();name=digest+'.'+ext;(folder/name).write_bytes(data);url='/erp/catalog-v43/'+name
 image={'id':digest,'url':url,'name':'Imagen '+str(meta[3] or count+1),'source':'V43','primary':text(meta[4]).lower() in ['sí','si']}
 gallery=p.setdefault('images',[])
 if not any(i['id']==digest for i in gallery):gallery.append(image);count+=1;size+=len(data)
 if image['primary'] or not p.get('imageUrl'):p['imageUrl']=url
state['source']['counts'].update(cheques=len(cheques),paymentLines=sum(map(len,movements.values())),images=count)
DEST.write_text(json.dumps(state,ensure_ascii=False,separators=(',',':')))
print(json.dumps({'orders':len(state['orders']),'cheques':len(cheques),'images':count,'imageBytes':size,'seedBytes':DEST.stat().st_size}))
