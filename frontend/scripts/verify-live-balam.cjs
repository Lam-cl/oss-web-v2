const { chromium } = require('@playwright/test');
const assert=require('node:assert/strict');
async function verify(origin, screenshotPath) {
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
 try {
  const page=await browser.newPage();
  await page.goto(origin,{waitUntil:'domcontentloaded',timeout:45000});
  const launcher=page.locator('#Assistant-Shadow-Host img[data-tonewow-balam-launcher]');
  await launcher.waitFor({state:'visible',timeout:45000});
  await page.waitForFunction(()=>{const img=document.getElementById('Assistant-Shadow-Host')?.shadowRoot?.querySelector('img[data-tonewow-balam-launcher]');return img?.complete&&img.naturalWidth>0;},{},{timeout:15000});
  assert.equal(await launcher.count(),1);
  assert.equal(await launcher.evaluate(img=>new URL(img.src).pathname),'/images/balam-tonewow-chat.svg');
  assert.equal(await page.locator('#Assistant-Shadow-Host #Assistant-Toggle .Assistant-icon').evaluateAll(nodes=>nodes.every(el=>getComputedStyle(el).display==='none')),true);
  if(screenshotPath)await page.locator('#Assistant-Shadow-Host #Assistant-Toggle').screenshot({path:screenshotPath});
  console.log('Live Balam: one visible, loaded custom icon; native icon hidden');
 } finally {await browser.close();}
}
module.exports={verify};
if(require.main===module)verify(process.argv[2],process.argv[3]).catch(e=>{console.error(e.message);process.exitCode=1;});
