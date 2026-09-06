const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('@playwright/test');
const bootstrap=fs.readFileSync('public/js/tonewow-balam-bootstrap-20260907.js','utf8');
const icon=fs.readFileSync('public/images/balam-tonewow-chat.svg','utf8');
const layout=fs.readFileSync('src/app/layout.tsx','utf8');
assert.match(layout,/src="\/js\/tonewow-balam-bootstrap-20260907.js" strategy="beforeInteractive"/);
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
 try {
  const page=await browser.newPage();
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('.svg'))return route.fulfill({contentType:'image/svg+xml',body:icon});
   if(url.pathname.endsWith('.js'))return route.fulfill({contentType:'application/javascript',body:bootstrap});
   return route.fulfill({contentType:'text/html',body:'<html><head><style>#Assistant-Shadow-Host{visibility:hidden!important}</style><script src="/bootstrap.js"></script></head><body></body></html>'});
  });
  await page.goto('https://balam.test/');
  await page.evaluate(()=>{
   window.originalPatchedAttach=Element.prototype.attachShadow;
   const other=document.createElement('div');document.body.append(other);other.attachShadow({mode:'closed'});window.otherStayedClosed=other.shadowRoot===null;
   window.makeProvider=()=>{
    document.getElementById('Assistant-Shadow-Host')?.remove();
    const host=document.createElement('div');host.id='Assistant-Shadow-Host';document.body.append(host);
    const shadow=host.attachShadow({mode:'closed'});
    window.hiddenBeforeInstall=host.style.visibility==='hidden';
    shadow.innerHTML='<div id="Assistant-Main"><button id="Assistant-Toggle"><span class="Assistant-icon">native robot</span></button></div>';
   };window.makeProvider();
  });
  const launcher=page.locator('#Assistant-Shadow-Host img[data-tonewow-balam-launcher]');
  await launcher.waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>window.otherStayedClosed&&window.hiddenBeforeInstall),true);
  assert.equal(await launcher.count(),1);
  assert.equal(await launcher.evaluate(img=>img.complete&&img.naturalWidth>0),true);
  assert.equal(await page.locator('#Assistant-Shadow-Host .Assistant-icon').evaluate(el=>getComputedStyle(el).display),'none');
  await page.addScriptTag({content:bootstrap});
  assert.equal(await page.evaluate(()=>Element.prototype.attachShadow===window.originalPatchedAttach),true,'Repeated bootstrap does not wrap attachShadow twice');
  await page.evaluate(()=>document.getElementById('Assistant-Shadow-Host').shadowRoot.getElementById('Assistant-Toggle').innerHTML='<span class="Assistant-icon">rerender</span>');
  await launcher.waitFor({state:'visible'});assert.equal(await launcher.count(),1);
  await page.evaluate(()=>window.makeProvider());await launcher.waitFor({state:'visible'});
  await page.evaluate(()=>document.getElementById('Assistant-Shadow-Host').shadowRoot.getElementById('Assistant-Toggle').innerHTML='<span class="Assistant-icon">replacement rerender</span>');
  await launcher.waitFor({state:'visible'});assert.equal(await launcher.count(),1);
  console.log('Real Chromium: closed provider root, unrelated closed root, early hiding, loaded custom icon, duplicate bootstrap, rerenders and replacement host passed');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
