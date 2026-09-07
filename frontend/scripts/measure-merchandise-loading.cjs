// Read-only browser comparison. Run against a built candidate, never creates an order.
const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const [candidate,report,baseline='https://shop.tonewow.com']=process.argv.slice(2);
 if(!candidate||!report)throw Error('Usage: node scripts/measure-merchandise-loading.cjs candidate-origin absolute-report-path');
 const fixtures={};
 for(const endpoint of ['/bundle/merchandise','/catalogue-products-api']){
  for(let attempt=1;attempt<=3;attempt++){
   const r=await fetch(baseline+endpoint);
   if(r.ok){fixtures[endpoint]=await r.text();break;}
   if(attempt===3)throw Error('Cannot read fixture '+endpoint+' HTTP '+r.status);
   console.log('Retrying read-only fixture',endpoint,r.status);await delay(2000);
  }
 }
 const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
 const results=[];
 try{
  for(const origin of [baseline,candidate]){
   const page=await browser.newPage();const requests=[];
   await page.addInitScript(()=>{
    window.__merchCardTimes=[];
    let present=false;
    new MutationObserver(()=>{
     const next=Boolean(document.querySelector('.merch-product-card'));
     if(next&&!present)window.__merchCardTimes.push(Date.now());
     present=next;
    }).observe(document,{childList:true,subtree:true});
    document.addEventListener('click',event=>{
     if(event.target.closest?.('.category-tab')?.textContent.trim()==='Merchandise')window.__merchTabClickAt=Date.now();
    },true);
   });
   await page.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.origin===origin&&fixtures[u.pathname]&&!u.search){
     requests.push({endpoint:u.pathname,at:Date.now()});
     await delay(u.pathname==='/bundle/merchandise'?400:800);
     return route.fulfill({status:200,contentType:'application/json',body:fixtures[u.pathname]});
    }
    return route.continue();
   });
   await page.goto(origin+'/?tab=merchandise',{waitUntil:'domcontentloaded'});
   await page.getByRole('button',{name:'Close',exact:true}).first().click();
   await page.locator('.merch-product-card').first().waitFor({timeout:45000});
   const visibleAt=await page.evaluate(()=>window.__merchCardTimes[0]);await delay(1000);
   const coldRequests=requests.slice();
   await page.getByRole('button',{name:'SIM',exact:true}).evaluate(e=>e.scrollIntoView({block:'center'}));
   await page.getByRole('button',{name:'SIM',exact:true}).click();
   const reopenAt=Date.now();await page.getByRole('button',{name:'Merchandise',exact:true}).click();
   await page.locator('.merch-product-card').first().waitFor();
   const reopenMs=await page.evaluate(()=>window.__merchCardTimes.at(-1)-window.__merchTabClickAt);await delay(1000);
   const result={origin,controlledDelaysMs:{bundle:400,catalogue:800},coldRequests:coldRequests.map(r=>({...r,at:r.at-coldRequests[0].at})),firstCardsAfterRequestMs:visibleAt-coldRequests[0].at,reopenMs,totalDataRequests:requests.length};
   if(origin===candidate){
    assert.equal(coldRequests.length,2,'one request per data source, no duplicate projection');
    assert(Math.abs(coldRequests[0].at-coldRequests[1].at)<250,'independent requests must overlap');
    assert.equal(requests.length,2,'fresh tab remount must not refetch');
    assert.equal(await page.getByText('Loading merchandise...', {exact:true}).count(),0);
   }
   results.push(result);await page.close();
  }
 }finally{await browser.close();}
 fs.writeFileSync(report,JSON.stringify(results,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(results,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
