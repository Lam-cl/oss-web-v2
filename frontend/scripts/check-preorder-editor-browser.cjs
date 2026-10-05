// Isolated GUI test of the real editor; no server, authentication, or live writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const root = path.resolve(__dirname,'..');
async function main() {
  const browser = await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE ? {executablePath:process.env.CHROME_EXECUTABLE} : {}),args:['--no-sandbox']});
  try {
    const page = await browser.newPage();
    await page.route('http://127.0.0.1:3319/editor-test',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
    await page.goto('http://127.0.0.1:3319/editor-test');
    for (const file of ['react/umd/react.production.min.js','react-dom/umd/react-dom.production.min.js']) await page.addScriptTag({content:fs.readFileSync(path.join(root,'node_modules',file),'utf8')});
    const files = {
      '@/lib/admin/productEditor':'src/lib/admin/productEditor.ts',
      '@/lib/admin/catalogueVariantBindings':'src/lib/admin/catalogueVariantBindings.ts',
      '@/lib/productDescription':'src/lib/productDescription.ts',
      '@/lib/admin/mediaUrl':'src/lib/admin/mediaUrl.ts',
      editor:'src/components/admin/UnifiedProductEditor.tsx',
    };
    const modules = Object.fromEntries(Object.entries(files).map(([id,file])=>[id,ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React},fileName:file}).outputText]));
    await page.evaluate(modules=>{
      const cache={react:React,'./UnifiedProductEditor.module.css':new Proxy({},{get:(_,key)=>String(key)})};
      function require(id) { if(cache[id])return cache[id]; const m={exports:{}};new Function('exports','require','module',modules[id])(m.exports,require,m);return cache[id]=m.exports; }
      const Editor=require('editor').default;
      function Harness() {
        const [model,setModel]=React.useState({details:{title:'',description:'',price:0,minimumOrderQuantity:1,isPreOrder:false},choices:[],combinations:[{valueKeys:[],price:0,inventory:0}],existingImages:[]});
        const [existingPhotos,setExisting]=React.useState([]),[pendingPhotos,setPending]=React.useState([]);
        const [editorKey,setEditorKey]=React.useState('new');
        const [liveInventory,setInventory]=React.useState(undefined);
        window.loadExisting=(zeroPrices=false)=>{
          const labels=['XS','S','M','L','XL','2XL','3XL','4XL'];
          setModel({details:{title:'Existing Shirt',description:'Original description',price:69,minimumOrderQuantity:1,isPreOrder:zeroPrices,category:'Apparel'},choices:[{key:'choice-size',optionId:20,name:'Size',values:labels.map((label,index)=>({key:`value-${label.toLowerCase()}`,valueId:30+index,label,retired:false}))}],combinations:labels.map((label,index)=>({valueKeys:[`value-${label.toLowerCase()}`],variantId:100+index,sku:`SHIRT-${label}`,price:zeroPrices?0:69,inventory:12})),existingImages:[]});
          setExisting([{mediaId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',url:'/fixture.png',assignment:'all',order:0}]);setPending([]);
          setInventory(new Map(labels.map((label,index)=>[JSON.stringify([`value-${label.toLowerCase()}`]),{valueKeys:[`value-${label.toLowerCase()}`],variantId:100+index,inventory:25}])));
          setEditorKey('existing');window.savedIntent=undefined;
        };
        return React.createElement(Editor,{editorKey,liveInventory,model,onModelChange:setModel,existingPhotos,pendingPhotos,onPhotosChange:(a,b)=>{setExisting(a);setPending(b)},onSave:intent=>{window.savedIntent=intent},onCancel:()=>{}});
      }
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Harness));
    },modules);
    await page.getByLabel('Product name',{exact:true}).fill('(Pre-Order) Pixel Blue Shirt');
    await page.locator('label').filter({hasText:/^Category/}).locator('select').selectOption({label:'Apparel'});
    await page.locator('select[name=isPreOrder]').selectOption('true');
    await page.locator('label').filter({hasText:/^Description/}).locator('textarea').fill('This is a preorder item. These items will only be shipped out AFTER 13th of OCTOBER.');
    await page.getByRole('button',{name:'+ Size',exact:true}).click();
    for(const size of ['XS','S','M','L','XL','2XL','3XL','4XL']) {
      await page.getByPlaceholder('Type a value and press Enter').fill(size);
      await page.getByRole('button',{name:'Add value',exact:true}).click();
    }
    await page.getByLabel('Base price (RM)',{exact:true}).fill('69');
    await page.locator('input[type=file]').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1kAAAAASUVORK5CYII=','base64')});
    const save=page.getByRole('button',{name:'Save product',exact:true});
    assert.equal(await save.isDisabled(),false);
    assert.equal(await page.getByText('Unlimited (pre-order)',{exact:true}).count(),8);
    await save.click();
    const saved=await page.evaluate(()=>({details:window.savedIntent.spec.details,combinations:window.savedIntent.spec.combinations,inventoryChanges:window.savedIntent.inventoryChanges,photos:window.savedIntent.pendingPhotos.length}));
    assert.equal(saved.details.isPreOrder,true);assert.equal(saved.details.price,69);assert.equal(saved.combinations.length,8);assert.equal(saved.photos,1);assert.deepEqual(saved.inventoryChanges,[]);
    assert.deepEqual(saved.combinations.map(c=>c.price),Array(8).fill(69),'choices-before-price flow sets all inherited variant prices');
    const moq=page.getByLabel('Minimum order quantity',{exact:true});
    await moq.fill('1.5');
    assert.equal(await save.isDisabled(),true);
    assert.match(await page.locator('footer').innerText(),/Minimum order quantity.*whole number/);
    await moq.fill('1');assert.equal(await save.isDisabled(),false);
    await page.evaluate(()=>window.loadExisting());
    await page.getByLabel('Product name',{exact:true}).fill('Existing Shirt renamed');
    await page.locator('label').filter({hasText:/^Description/}).locator('textarea').fill('Updated description only');
    const stockInputs=page.locator('label').filter({hasText:/^Stock$/}).locator('input');
    assert.equal(await stockInputs.count(),8);
    assert.deepEqual(await stockInputs.evaluateAll(xs=>xs.map(x=>x.value)),Array(8).fill('25'));
    await save.click();
    let edited=await page.evaluate(()=>({details:window.savedIntent.spec.details,variants:window.savedIntent.spec.combinations.map(x=>x.variantId),adjustments:window.savedIntent.inventoryChanges}));
    assert.equal(edited.details.title,'Existing Shirt renamed');assert.equal(edited.details.description,'Updated description only');assert.deepEqual(edited.variants,[100,101,102,103,104,105,106,107]);assert.deepEqual(edited.adjustments,[]);
    await page.locator('select[name=isPreOrder]').selectOption('true');
    assert.equal(await page.getByText('Unlimited (pre-order)',{exact:true}).count(),8);
    await save.click();
    edited=await page.evaluate(()=>({flag:window.savedIntent.spec.details.isPreOrder,adjustments:window.savedIntent.inventoryChanges,variants:window.savedIntent.spec.combinations.map(x=>x.variantId)}));
    assert.equal(edited.flag,true);assert.deepEqual(edited.adjustments,[]);assert.deepEqual(edited.variants,[100,101,102,103,104,105,106,107]);
    await page.locator('select[name=isPreOrder]').selectOption('false');
    assert.deepEqual(await stockInputs.evaluateAll(xs=>xs.map(x=>x.value)),Array(8).fill('25'));
    await save.click();assert.equal(await page.evaluate(()=>window.savedIntent.spec.details.isPreOrder),false);
    await page.evaluate(()=>window.loadExisting(true));
    await page.getByRole('button',{name:/Set RM0 variants to base price/}).click();
    await save.click();
    const repaired=await page.evaluate(()=>({prices:window.savedIntent.spec.combinations.map(c=>c.price),variants:window.savedIntent.spec.combinations.map(c=>c.variantId),stock:window.savedIntent.spec.combinations.map(c=>c.inventory),adjustments:window.savedIntent.inventoryChanges}));
    assert.deepEqual(repaired.prices,Array(8).fill(69));assert.deepEqual(repaired.variants,[100,101,102,103,104,105,106,107]);assert.deepEqual(repaired.stock,Array(8).fill(12));assert.deepEqual(repaired.adjustments,[]);
    console.log('Real-browser create pre-order with eight sizes/photo, local save and specific MOQ validation: PASS');
    console.log('Real-browser edit existing product, authoritative stock, stable variant IDs and pre-order ON/OFF: PASS');
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
