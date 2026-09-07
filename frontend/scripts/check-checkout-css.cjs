const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('@playwright/test');
async function main(){
 const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const css=fs.readFileSync('src/app/merchandise-parity.css','utf8');
  await page.setContent(`<style>*{box-sizing:border-box}${css}</style><aside class="merch-checkout-sidebar" style="width:340px"><section class="merch-checkout-promo"><label>Promo Code</label><div><input placeholder="Enter code"><button>Apply</button></div><small class="is-error">Invalid code</small></section><section class="merch-checkout-payment"><h4>Payment Method</h4><label class="active"><input type="radio" checked>Online Banking (FPX)</label><div class="merch-checkout-payment-terms">Terms</div><button class="merch-checkout-pay merch-checkout-sidebar-pay">Pay Now</button></section></aside>`);
  const style=async(selector,key)=>page.locator(selector).evaluate((e,key)=>getComputedStyle(e)[key],key);
  assert.equal(await style('.merch-checkout-promo input','height'),'42px');
  assert.equal(await style('.merch-checkout-promo button','backgroundColor'),'rgb(234, 179, 8)');
  assert.equal(await style('.merch-checkout-payment','paddingTop'),'22px');
  assert.equal(await style('.merch-checkout-payment > label','display'),'flex');
  assert.equal(await style('.merch-checkout-payment > label','borderTopWidth'),'2px');
  assert.equal(await style('.merch-checkout-sidebar-pay','backgroundColor'),'rgb(234, 179, 8)');
  await page.locator('.merch-checkout-promo button').evaluate(e=>e.disabled=true);
  assert.equal(await style('.merch-checkout-promo button','cursor'),'not-allowed');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await style('.merch-checkout-sidebar','display'),'none');
  await page.locator('aside').evaluate(e=>{e.className='merch-cart-summary-sheet';e.style.width='100%'});
  assert.equal(await style('.merch-checkout-promo','borderTopWidth'),'1px');
  assert.equal(await style('.merch-checkout-promo input','height'),'42px');
  console.log('Checkout promo/payment desktop and mobile computed CSS checks passed');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
