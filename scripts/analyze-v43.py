"""Read the supplied V43 without changing the workbook or executing its VBA."""
from pathlib import Path
import json,sys,hashlib
from datetime import date,datetime
import openpyxl

source=Path('/Users/giovannidaniu/Desktop/ERP_AIMERKA_V43_IMAGENES_Y_VISUALIZACION_PRUEBA.xlsm')
out=Path('outputs/v43-audit');out.mkdir(parents=True,exist_ok=True)
def value(v):
    if isinstance(v,(date,datetime)):return v.isoformat()
    return v
book=openpyxl.load_workbook(source,read_only=True,data_only=True)
data={};summary=[]
for sheet in book:
    if sheet.title in ['DATOS_IMAGENES','FOTOS_EMBEBIDAS']:
        summary.append({'sheet':sheet.title,'rows':sheet.max_row,'columns':sheet.max_column,'imageData':True});continue
    rows=[[value(v) for v in row] for row in sheet.iter_rows(values_only=True)]
    data[sheet.title]=rows
    summary.append({'sheet':sheet.title,'rows':sheet.max_row,'columns':sheet.max_column,'header':rows[0] if rows else []})
(out/'values.json').write_text(json.dumps(data,ensure_ascii=False,default=str))
formulas=openpyxl.load_workbook(source,read_only=True,data_only=False)
formula_data={}
for sheet in formulas:
    cells={c.coordinate:c.value for row in sheet.iter_rows() for c in row if c.data_type=='f'}
    if cells:formula_data[sheet.title]=cells
(out/'formulas.json').write_text(json.dumps(formula_data,ensure_ascii=False))
sys.path.insert(0,'/Users/giovannidaniu/.codex/.chatgpt-projects/g-p-6a05047a01808191be48167418b0beee/work/vba_dependencies')
from pyopenvba import ExcelFile
(out/'vba').mkdir(exist_ok=True)
with ExcelFile(source) as vba:
    modules=vba.module_names()
    for name in modules:(out/'vba'/(name+'.bas')).write_text(vba.get_module(name))
result={'source':source.name,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'sheets':summary,'formulaCount':sum(map(len,formula_data.values())),'modules':modules}
(out/'index.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps({'sheets':len(summary),'formulas':result['formulaCount'],'modules':len(modules),'reconciliationSheets':[r for r in summary if any(k in r['sheet'] for k in ['T1_','CONCILIACION','BANCO','CHEQUE'])]},ensure_ascii=False))
