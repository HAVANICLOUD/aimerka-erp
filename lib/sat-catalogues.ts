// Static imports are bundled by Vite; Workers must not resolve JSON import attributes.
// Keep these large catalogues out of the engine also shipped to browsers.
import products from '../data/sat-products.json';
import units from '../data/sat-units.json';

export const satCatalogues=[products,units].map(catalogue=>
  new Map(catalogue.rows.map(row=>[String(row[0]).toUpperCase(),row]))
);
