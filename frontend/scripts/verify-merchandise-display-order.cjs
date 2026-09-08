// Read-only browser verification against a built local or deployed storefront.
const {chromium,expect}=require('@playwright/test');
const assert=require('node:assert/strict');
const {compile}=require('./test-source-helpers.cjs');
const {mergeBundleMerchandiseProducts}=compile('src/data/merchandise.ts');
const {adaptCatalogueStorefrontPayload}=compile('src/lib/catalogueStorefront.ts');
async function main(origin){
 const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.route('**/*',route=>['GET','HEAD'].includes(route.request().method())?route.continue():route.abort());
  const bundle=page.waitForResponse(r=>new URL(r.url()).pathname==='/bundle/merchandise'&&r.ok(),{timeout:45000});
  const catalogue=page.waitForResponse(r=>new URL(r.url()).pathname==='/catalogue-products-api'&&r.ok(),{timeout:45000});
  // Attach rejection handling immediately if navigation is blocked.
  const feeds=Promise.all([bundle,catalogue]).then(async([a,b])=>[await a.json(),await b.json()]);feeds.catch(()=>{});
  const response=await page.goto(origin+'/?tab=merchandise',{waitUntil:'domcontentloaded',timeout:45000});
  if(!response?.ok())throw Error('Storefront navigation returned '+response?.status());
  const [a,b]=await feeds;const products=adaptCatalogueStorefrontPayload(b,mergeBundleMerchandiseProducts(a.data));
  const ids=['26872431-982f-4ba5-bf84-51a9585a6e0b','e6c11fca-97bf-4aa6-a644-e52d25d98895','39a00000-0000-4000-8000-000000000039','40a00000-0000-4000-8000-000000000040','d8ddbba5-c901-4a50-ae7f-bbd66fc424c3'];
  const priority=ids.map(id=>products.find(p=>p.id===id)).filter(Boolean);
  assert.equal(priority.length,5,'All five requested production products should be present');
  const expected=[...priority,...products.filter(p=>!ids.includes(p.id))].map(p=>p.name);
  const cards=page.locator('.merch-card-title');
  await expect(cards).toHaveText(expected,{timeout:30000});
  const noticeClose=page.getByRole('button',{name:'Close',exact:true});
  if(await noticeClose.isVisible())await noticeClose.click();
  for(const category of new Set(products.map(p=>p.category))){
   const tab=page.getByRole('tab',{name:category,exact:true});
   await tab.evaluate(el=>el.scrollIntoView({block:'center'}));await tab.click();
   await expect(cards).toHaveText(products.filter(p=>p.category===category).map(p=>p.name));
  }
  await page.setViewportSize({width:390,height:844});
  const all=page.getByRole('tab',{name:'All',exact:true});await all.evaluate(el=>el.scrollIntoView({block:'center'}));await all.click();await expect(cards).toHaveText(expected);
  console.log(JSON.stringify({origin,firstFive:expected.slice(0,5),total:expected.length,desktopAndMobile:'passed',categoryOrder:'unchanged',writes:0}));
 }finally{await browser.close()}
}
main(process.argv[2]).catch(e=>{console.error(e.message);process.exitCode=1});
