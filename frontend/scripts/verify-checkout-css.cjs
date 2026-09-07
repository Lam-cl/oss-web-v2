// Read-only real-page check with an isolated browser-local cart. No order is submitted.
const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict');
async function verify(origin,directory){
 const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.route('**/*',route=>route.request().method()==='POST'&&new URL(route.request().url()).pathname.endsWith('/bundle/checkout')?route.abort():route.continue());
  await page.addInitScript(()=>localStorage.setItem('tw_cart',JSON.stringify({state:{items:[{id:'qa-css',type:'merchandise',productId:'144',bundleProductId:144,bundleVariantId:465,name:'Baseball Cap',price:39,quantity:1,availableQuantity:77,minimumOrderQuantity:1,variant:'Black',addedAt:new Date().toISOString()}]},version:0})));
  await page.goto(origin+'/checkout',{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('input[name=firstName]').waitFor({timeout:30000});
  const style=async(selector,key)=>page.locator(selector+':visible').first().evaluate((e,key)=>getComputedStyle(e)[key],key);
  assert.equal(await style('.merch-checkout-promo input','height'),'42px');
  assert.equal(await style('.merch-checkout-payment','backgroundColor'),'rgb(255, 255, 255)');
  assert.equal(await style('.merch-checkout-payment > label','display'),'flex');
  assert.equal(await style('.merch-checkout-sidebar-pay','backgroundColor'),'rgb(234, 179, 8)');
  if(directory)await page.screenshot({path:directory+'/checkout-desktop-fixed.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert(await page.locator('.merch-checkout-sidebar').isHidden());
  await page.locator('.merch-checkout-mobile-pay .merch-cart-summary-toggle').click();
  await page.locator('.merch-checkout-promo input:visible').waitFor();
  assert.equal(await style('.merch-checkout-promo input','height'),'42px');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(directory)await page.screenshot({path:directory+'/checkout-mobile-fixed.png',fullPage:true});
  console.log('Real checkout desktop/sidebar/mobile summary CSS verified; no order submitted');
 }finally{await browser.close();}
}
module.exports={verify};
if(require.main===module)verify(process.argv[2],process.argv[3]).catch(e=>{console.error(e.message);process.exitCode=1});
