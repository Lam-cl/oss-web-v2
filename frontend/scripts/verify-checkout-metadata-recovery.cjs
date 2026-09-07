// Browser-level failure recovery. All checkout POSTs are fulfilled locally, never sent upstream.
const {chromium,expect}=require('@playwright/test');
const assert=require('node:assert/strict');
async function verify(origin){
 if(new URL(origin).hostname!=='127.0.0.1')throw Error('Recovery fixture is local-only');
 const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});let posts=0;
  await page.route('**/bundle/checkout',route=>{
   if(route.request().method()!=='POST')return route.continue();
   const payload=route.request().postDataJSON();assert(!Object.hasOwn(payload,'paymentMethodId'));assert(!Object.hasOwn(payload,'paymentType'));
   posts++;return route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({code:'ORDER_METADATA_SAVE_FAILED',orderId:'999999',error:'Order #999999 was created, but its checkout details could not be saved. Do not submit another order. Contact support.'})});
  });
  await page.addInitScript(()=>localStorage.setItem('tw_cart',JSON.stringify({state:{items:[{id:'qa-recovery',type:'merchandise',productId:'144',bundleProductId:144,bundleVariantId:465,name:'Baseball Cap',price:39,quantity:1,availableQuantity:77,minimumOrderQuantity:1,variant:'Black',addedAt:new Date().toISOString()}]},version:0})));
  await page.goto(origin+'/checkout',{waitUntil:'domcontentloaded'});
  for(const[key,value]of Object.entries({firstName:'QA',lastName:'Recovery',email:'qa@example.com',phone:'01112345678',ic:'QA20260907',billingAddress:'Test Address',billingCity:'Kuala Lumpur',billingPostcode:'50000'}))await page.locator('[name='+key+']').fill(value);
  await page.locator('[name=billingState]').selectOption({label:'W.P. Kuala Lumpur'});
  await expect(page.getByText('Continue to the payment gateway to complete your payment.')).toBeVisible();
  await expect(page.locator('[name=merchPaymentMethod]')).toHaveCount(0);
  const button=page.locator('.merch-checkout-sidebar-pay');await expect(button).toBeEnabled({timeout:30000});
  await button.click();await expect(page.getByText(/Order #999999 was created/)).toBeVisible();await expect(button).toBeDisabled();
  await page.locator('#checkout-form').evaluate(form=>form.requestSubmit());
  await page.setViewportSize({width:390,height:844});await expect(page.locator('.merch-checkout-mobile-pay .merch-checkout-pay')).toBeDisabled();
  await expect(page.locator('[name=merchPaymentMethod]')).toHaveCount(0);
  assert.equal(posts,1,'failure must not automatically retry or resubmit');
  console.log('Built checkout metadata failure: order message visible, desktop/mobile blocked, exactly one mocked POST');
 }finally{await browser.close();}
}
if(require.main===module)verify(process.argv[2]).catch(e=>{console.error(e.message);process.exitCode=1});
