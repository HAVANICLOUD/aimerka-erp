import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {categorySuggestion, suggestCategory, productFamily, resolveCategory} from '../lib/pricing-v28.mjs';
const config=JSON.parse(readFileSync(new URL('../data/pricing-config.json',import.meta.url)));

for(const [title,inventory,ml] of [
  ['Apple MacBook Air M4 13 pulgadas','LAPTOPS','Laptops'],
  ['Laptop Lenovo ThinkPad 16GB','LAPTOPS','Laptops'],
  ['Notebook portátil HP','LAPTOPS','Laptops'],
  ['Apple iPad Pro M5 256GB','TABLET','Tablets'],
  ['Samsung Galaxy Tab S10','TABLET','Tablets'],
  ['Tableta Android 128GB','TABLET','Tablets'],
  ['Apple iPhone 17 Pro Max','CELULARES SMARTPHONE','Celulares'],
  ['Teléfono celular Motorola','CELULARES SMARTPHONE','Celulares'],
  ['Cable USB-C para MacBook iPad iPhone','CABLES Y CONECTORES','Cables y adaptadores de datos'],
  ['Teclado Magic Keyboard para iPad','TECLADOS PARA TABLETS','Teclados para tablets'],
  ['Apple Pencil para iPad Pro','LÁPICES ÓPTICOS','Lápices ópticos'],
  ['Cargador para iPad','ADAPTADORES DE CARGA','Cables y adaptadores de datos'],
])test(`configured title inference: ${title}`,()=>{
  assert.equal(suggestCategory(config,title),inventory);
  assert.equal(suggestCategory(config,title,'Mercado Libre'),ml);
  if(['LAPTOPS','TABLET'].includes(inventory))for(const channel of ['Coppel','Liverpool','Elektra'])assert.equal(suggestCategory(config,title,channel),channel==='Elektra'?'COMPUTO':'Cómputo');
  const metadata=categorySuggestion(config,title,'Mercado Libre');
  assert.equal(metadata.category,ml);assert.equal(metadata.source,'title-mapping');assert.equal(metadata.requiresReview,true);
});

test('accessories never inherit the core device family when no accessory category exists',()=>{
  for(const title of ['Funda para MacBook Air','Case iPhone 17','Protector de pantalla iPhone']){
    assert.equal(productFamily(title),'accesorios');
    assert.equal(suggestCategory(config,title,'Mercado Libre'), '');
    assert.equal(suggestCategory(config,title), '');
  }
  assert.equal(productFamily('Nueva tablet Android'),'tabletas');
  assert.equal(productFamily('Caseína suplemento'),'');
});

test('configured mappings beat misleading catalogue examples; missing channel categories are never invented',()=>{
  const products=[{name:'MacBook Air M4',category:'TABLET',categoryOverrides:{Coppel:'General'}}];
  assert.equal(suggestCategory(config,'MacBook Air M4','Coppel',products),'Cómputo');
  const c=structuredClone(config);c.commissions.Coppel=[{category:'General'}];
  assert.equal(suggestCategory(c,'MacBook Air M4','Coppel',products),'');
  assert.equal(suggestCategory(c,'MacBook Air M4','Coppel',[]),'');
  assert.equal(suggestCategory(config,'???','Coppel',[{name:'???',category:'C1'}]),'');
  assert.equal(suggestCategory(config,'producto desconocido','Coppel',[{name:'producto desconocido'}]),'');
});

test('catalogue ties abstain independent of product ordering; fixed-rate channels remain compatible',()=>{
  const products=[{name:'Modelo especial XYZ',categories:{Coppel:'Celulares'}},{name:'Modelo especial XYZ',categories:{Coppel:'Electrónica'}}];
  assert.equal(suggestCategory(config,'Modelo especial XYZ','Coppel',products),'');
  assert.equal(suggestCategory(config,'Modelo especial XYZ','Coppel',products.toReversed()),'');
  assert.equal(suggestCategory(config,'Apple cargador','Tienda Nube'),'Todas las categorías');
  assert.equal(suggestCategory(config,'MacBook Air','Sears'),'Todas las categorías');
});

test('proposals do not mutate manual categories, overrides, config, or catalogue',()=>{
  const c=structuredClone(config),products=[{name:'iPhone 17 Pro Max',category:'LAPTOPS',categories:{Liverpool:'Belleza'},categoryOverrides:{Liverpool:'Accesorios'}}];
  const before=structuredClone({c,products});
  categorySuggestion(c,products[0].name,'Liverpool',products);
  assert.equal(resolveCategory(c,products[0],'Liverpool'),'Accesorios');
  assert.deepEqual({c,products},before);
});
