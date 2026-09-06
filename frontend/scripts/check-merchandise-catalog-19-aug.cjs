const fs=require('fs');
const assert=require('assert');
const section=fs.readFileSync('src/components/home/MerchandiseSection.tsx','utf8');
const route=fs.readFileSync('src/app/api/bundle/merchandise/route.ts','utf8');
const data=fs.readFileSync('src/data/merchandise.ts','utf8');
const drawer=fs.readFileSync('src/components/admin/ProductDrawer.tsx','utf8');
assert(!section.includes('tone wow Collection'),'collection eyebrow must be removed');
assert(section.includes('Shop official tone wow merchandise and SIM cards.'),'catalog intro missing');
assert(route.includes("'pen-2-0'"),'Pen 2.0 must be excluded from customer catalogue');
assert(drawer.includes('JSON.stringify(category.trim() ? [category.trim()] : [])'),'category edit must send Bundle JSON array');
for(const value of ['Bottles','Marketing Material','Stationery']) assert(drawer.includes(`'${value}'`),`missing category ${value}`);
for(const value of ["23: 'Apparel'","24: 'Apparel'","25: 'Bottles'","26: 'Bottles'","27: 'Bottles'","28: 'Marketing Material'","29: 'Stationery'","32: 'Stationery'","33: 'Stationery'","34: 'Marketing Material'","35: 'Apparel'","36: 'Apparel'"]) assert(data.includes(value),`missing category mapping: ${value}`);
for(const value of ['tone wow Baseball Cap','tone wow BASICS Shirt','tone wow T-Stand Bunting','tone wow 3-Fold Flyers','100% Cotton','280gsm','210gsm','Regular fit','6 ft (H) x 2 ft (W)','Plastic Tube (Top & Bottom)','Hanging String','No Stand','3-Fold Accordion Fold','Double Sided','50 pieces']) assert(data.includes(value),`missing catalogue enrichment: ${value}`);
(async()=>{
 const response=await fetch('https://bundleapi.tonewow.com/api/products?type=MERCHANDISE&limit=100'); assert(response.ok,`Bundle API ${response.status}`);
 const body=await response.json(); const byId=new Map(body.data.map(p=>[p.id,p])); assert(!byId.has(51),'tshirt testing must be deleted from active catalogue');
 const expected={23:['tone wow Lanyard','Apparel'],24:['tone wow Baseball Cap','Apparel'],25:['Water Bottle 500ml','Bottles'],26:['Water Bottle 975ml','Bottles'],27:['Tumbler 1180ml','Bottles'],28:['tone wow T-Stand Bunting','Marketing Material'],29:['tone wow Button Badge','Stationery'],32:['tone wow Yellow Pen','Stationery'],33:['tone wow Non-Woven Bag','Stationery'],34:['tone wow 3-Fold Flyers','Marketing Material'],35:['tone wow Comix Shirt','Apparel'],36:['tone wow BASICS Shirt','Apparel']};
 for(const [id,[title,category]] of Object.entries(expected)){const p=byId.get(Number(id));assert(p,`missing product ${id}`);if(Number(id)===28) assert(/T-Stand Bunting$/.test(p.title),`title ${id}`); else assert.strictEqual(p.title,title,`title ${id}`)}
 assert.deepStrictEqual(byId.get(24).productVariants.map(v=>v.inventory),[30,30,30,30],'cap inventory');
 console.log('Merchandise catalogue 19 Aug regression check passed');
})().catch(error=>{console.error(error);process.exit(1)});
