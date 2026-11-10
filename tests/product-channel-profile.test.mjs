import test from 'node:test';
import assert from 'node:assert/strict';
import {saveProductChannelProfile} from '../lib/product-channel-profile.mjs';
import {listingStatus} from '../lib/product-prices.mjs';
import {renameProductSkus} from '../lib/product-identity.mjs';
import {assertPermission,permissionFor} from '../lib/access-control.mjs';
const fixture=()=>({products:[{sku:'ABC',upc:'195949543906',name:'Producto',costCents:1000,averageCostMxn:10,priceCents:2000,good:4,channelIdentifiers:{Sears:{variantId:'keep',publicationId:'old'}},channelListings:{Sears:{status:'published',publicationId:'old'}}}],orders:[{sku:'ABC'}],events:[]});
const save=(s,profile,market='Sears')=>saveProductChannelProfile(s,{id:'operation',type:'pricing.productChannel.save',payload:{sku:'ABC',market,profile}},{now:'2026-11-10T12:00:00Z',actor:'owner'});
test('channel profile keeps identity, cost, stock, sales and other channel details unchanged',()=>{
 const s=fixture(),before=structuredClone(s);save(s,{title:'Título del canal',description:'<script>plain text</script>',categoryId:'123',categoryName:'Electrónica',sellerSku:'EXT',publicationId:'new',attributes:[{name:'Color',value:'Negro'}],good:999,sku:'FAKE',priceCents:1});
 for(const key of ['sku','upc','name','costCents','averageCostMxn','priceCents','good'])assert.deepEqual(s.products[0][key],before.products[0][key]);
 assert.deepEqual(s.orders,before.orders);assert.equal(s.products[0].channelProfiles.Sears.title,'Título del canal');assert.equal(s.products[0].channelProfiles.Sears.good,undefined);
 assert.equal(s.products[0].channelIdentifiers.Sears.variantId,'keep');assert.equal(listingStatus(s.products[0],'Sears').status,'registered');assert.equal(listingStatus(s.products[0],'Sears').verified,false);
 save(s,{title:'Otro canal'},'Sanborns');assert.equal(s.products[0].channelProfiles.Sears.title,'Título del canal');assert.equal(s.products[0].channelProfiles.Sanborns.title,'Otro canal');
});
test('publication states are declared explicitly and never proven by a profile or saved price',()=>{
 const s=fixture();for(const status of ['published','paused','pending_approval','not_published']){save(s,{publicationStatus:status});assert.equal(listingStatus(s.products[0],'Sears').status,status);assert.equal(listingStatus(s.products[0],'Sears').verified,false);}
 assert.equal(listingStatus(s.products[0],'Elektra').status,'unknown');
});
test('invalid profiles reject before mutation and cannot select an unknown channel',()=>{
 for(const profile of [{title:'x'.repeat(251)},{attributes:[{name:'Color',value:'a'},{name:'color',value:'b'}]},{publicationStatus:'verified'},{description:123}]){const s=fixture(),before=structuredClone(s);assert.throws(()=>save(s,profile));assert.deepEqual(s,before);}
 const s=fixture(),before=structuredClone(s);assert.throws(()=>save(s,{},'Fake'));assert.deepEqual(s,before);
});
test('commercial permissions protect profiles and campaign writes while readers cannot mutate',()=>{
 for(const type of ['pricing.productChannel.save','pricing.event.save','pricing.event.apply']){assert.equal(permissionFor(type),'pricing');assert.throws(()=>assertPermission({active:true,permissions:[]},type));assert.doesNotThrow(()=>assertPermission({active:true,permissions:['pricing']},type));}
});
test('SKU corrections retain selected campaign products and references without changing documents',()=>{
 const s=fixture();s.commercialEvents=[{selection:{skus:['ABC']},rules:{marketReferences:[{sku:'ABC',market:'Sears',price:20}]}}];s.documents=[{original:{sku:'ABC'},lineLinks:[{sku:'ABC'}]}];
 renameProductSkus(s,[{from:'ABC',to:'NEW'}]);assert.deepEqual(s.commercialEvents[0].selection.skus,['NEW']);assert.equal(s.commercialEvents[0].rules.marketReferences[0].sku,'NEW');assert.equal(s.documents[0].original.sku,'ABC');assert.equal(s.documents[0].lineLinks[0].sku,'NEW');assert.equal(s.orders[0].sku,'NEW');
});
