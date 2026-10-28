from pathlib import Path
import shutil,json
root=Path(__file__).resolve().parents[1]
starter=root.parent/'aimerka-v28-starter'
public=root/'public'/'erp'
public.mkdir(parents=True,exist_ok=True)
for src in (root/'dist').iterdir():
    dst=public/src.name
    if src.is_dir(): shutil.copytree(src,dst,dirs_exist_ok=True)
    else: shutil.copy2(src,dst)
for src in starter.iterdir():
    if src.name in ['README.md','.openai','.git','node_modules','dist','.sites-runtime']:
        continue
    dst=root/src.name
    if src.is_dir(): shutil.copytree(src,dst,dirs_exist_ok=True)
    else: shutil.copy2(src,dst)
runtime=starter/'.sites-runtime'
if runtime.exists():shutil.copytree(runtime,root/'.sites-runtime',dirs_exist_ok=True)
manifest=json.loads((starter/'.openai/hosting.json').read_text())
manifest['project_id']='appgprj_6adf2e0ebca48191a8dd3fa731830b10'
manifest.pop('static',None)
manifest['d1']={'binding':'DB'}
manifest['r2']=None
(root/'.openai/hosting.json').write_text(json.dumps(manifest,indent=2))
print('Contenido anterior conservado en public/erp; base de servidor preparada.')
