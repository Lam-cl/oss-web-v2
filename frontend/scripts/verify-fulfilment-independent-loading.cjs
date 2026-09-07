// Local built UI only. All admin/catalogue data and writes are intercepted fixtures.
const {chromium,expect}=require('@playwright/test');
const assert=require('node:assert/strict');
async function main(origin){
 if(new URL(origin).hostname!=='127.0.0.1')throw Error('Local-only fixture');
 const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  // Local navigation gate only; no authenticated provider session is created or used.
  await page.context().addCookies([{name:'tonewow_admin_gate',value:Buffer.from(JSON.stringify({email:'qa@example.com',role:'ADMIN',expiresAt:Date.now()+3600000})).toString('base64url')+'.local-fixture',url:origin}]);
  const orders=[{id:12,status:'PAID',deliveryOption:'DELIVER',items:[],totalAmount:49},{id:13,status:'PAID',deliveryOption:'PICKUP',items:[],totalAmount:39}];
  let simSlow=true,courierFails=false,metadataFails=false;const writes=[];
  const choices=Array.from({length:8},(_,i)=>({id:i+1,name:'Courier '+(i+1),isActive:true}));
  await page.route('**/catalogue-products-api*',r=>r.fulfill({json:{products:[]}}));
  await page.route('**/admin-api/**',async r=>{
   const p=new URL(r.request().url()).pathname;
   if(r.request().method()!=='GET'){writes.push(p);return r.fulfill({status:500,json:{message:'Unexpected write blocked by fixture'}});}
   if(p.endsWith('/auth/session'))return r.fulfill({json:{user:{email:'qa@example.com',role:'ADMIN'}}});
   if(p.endsWith('/couriers'))return r.fulfill({status:courierFails?503:200,json:courierFails?{message:'Courier unavailable'}:choices});
   if(p.endsWith('/fulfilment-metadata'))return r.fulfill({status:metadataFails?503:200,json:metadataFails?{message:'Metadata unavailable'}:{updatedAt:''}});
   if(p.endsWith('/sim-assignments')){
    if(simSlow)await new Promise(resolve=>setTimeout(resolve,25000));
    return r.fulfill({json:{totalUnits:0,assignedUnits:0,assignments:[],prefixOptions:[]}}).catch(()=>{});
   }
   const id=p.match(/\/orders\/(\d+)$/)?.[1];
   if(id)return r.fulfill({json:orders.find(o=>o.id===Number(id))});
   if(p.endsWith('/orders'))return r.fulfill({json:{data:orders,total:2,page:1,limit:1000}});
   return r.fulfill({json:{}});
  });
  await page.goto(origin+'/admin/orders',{waitUntil:'domcontentloaded'});
  await page.getByText('#12',{exact:true}).click();
  const drawer=page.locator('.adm-drawer');const courier=drawer.getByLabel('Courier service');
  await expect(courier).toBeEnabled({timeout:15000});await expect(courier.locator('option')).toHaveCount(9);
  await expect(drawer.locator('[data-detail=sims]')).toContainText('Loading');
  await courier.selectOption('7');await drawer.getByLabel('Tracking number',{exact:true}).fill('QA-NOT-SAVED');
  await expect(drawer.locator('.courier-save')).toBeEnabled();
  await drawer.getByLabel('Order status').selectOption('SHIPPED');
  await expect(drawer.getByRole('button',{name:'Update status',exact:true})).toBeDisabled();
  await expect(drawer.getByRole('button',{name:'Retry SIM fulfilment',exact:true})).toBeVisible({timeout:25000});
  await expect(courier).toBeEnabled();await expect(courier).toHaveValue('7');
  simSlow=false;await drawer.getByRole('button',{name:'Retry SIM fulfilment',exact:true}).click();
  await expect(drawer.getByRole('button',{name:'Update status',exact:true})).toBeEnabled();
  await drawer.getByRole('button',{name:'Close',exact:true}).click();
  courierFails=true;metadataFails=true;
  await page.getByText('#12',{exact:true}).click();
  await expect(drawer.getByRole('button',{name:'Retry courier services',exact:true})).toBeVisible();
  await expect(drawer.locator('.courier-save')).toBeDisabled();
  await drawer.getByLabel('Tracking number',{exact:true}).fill('KEEP-EDIT');
  courierFails=false;await drawer.getByRole('button',{name:'Retry courier services',exact:true}).click();
  await expect(courier).toBeEnabled();await courier.selectOption('7');
  await expect(drawer.locator('.courier-save')).toBeDisabled();
  metadataFails=false;await drawer.getByRole('button',{name:'Retry order metadata',exact:true}).click();
  await expect(drawer.locator('.courier-save')).toBeEnabled();
  await expect(drawer.getByLabel('Tracking number',{exact:true})).toHaveValue('KEEP-EDIT');await expect(courier).toHaveValue('7');
  await drawer.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByText('#13',{exact:true}).click();await expect(drawer.getByLabel('Pickup status')).toBeVisible();await expect(courier).toHaveCount(0);
  assert.deepEqual(writes,[]);console.log('Built fulfilment UI: courier available during 20s SIM timeout, isolated retries, shipping guard, metadata guard, edit preservation and pickup passed; zero writes');
 }finally{await browser.close()}
}
main(process.argv[2]).catch(e=>{console.error(e.message);process.exitCode=1});
