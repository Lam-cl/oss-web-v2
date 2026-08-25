const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pagePath = path.join(root, 'src/app/admin/product-editor-preview/page.tsx');
const componentPath = path.join(root, 'src/components/admin/UnifiedProductEditor.tsx');
const cssPath = path.join(root, 'src/components/admin/UnifiedProductEditor.module.css');
const clientPath = path.join(root, 'src/hooks/useCatalogueProductEditor.ts');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

assert(fs.existsSync(pagePath), 'authenticated admin preview route exists');
if (!fs.existsSync(pagePath)) process.exit(1);

const source = fs.readFileSync(pagePath, 'utf8');

assert(/^['"]use client['"];?/m.test(source), 'preview is a client-controlled page');
assert(/import\s+UnifiedProductEditor(?:\s*,\s*\{[^}]*\})?\s+from\s+['"]@\/components\/admin\/UnifiedProductEditor['"]/.test(source), 'route imports UnifiedProductEditor');
assert(source.includes('UI Preview only · No data will be saved'), 'prominent no-save preview label is present');
assert(!/\b(?:fetch|adminFetch)\s*\(/.test(source), 'preview contains no fetch or adminFetch calls');
assert(/useState<ProductEditorSpec>\s*\(/.test(source), 'product model is controlled in local state');
assert(/useState<UnifiedProductEditorExistingPhoto\[\]>\s*\(/.test(source), 'existing photos are controlled in local state');
assert(/useState<UnifiedProductEditorPendingPhoto\[\]>\s*\(/.test(source), 'pending photos are controlled in local state');
assert(/onModelChange=\{setModel\}/.test(source), 'model change callback updates preview state');
assert(/onPhotosChange=\{handlePhotosChange\}/.test(source), 'photo change callback updates preview state');
assert(/onSave=\{handlePreviewSave\}/.test(source), 'save is handled by a local preview-only callback');
assert(/choices:\s*\[[\s\S]*?name:\s*['"]Color['"][\s\S]*?name:\s*['"]Size['"]/.test(source), 'fixture includes two realistic choices');
assert(/combinations:\s*\[[\s\S]*?inventory:/.test(source), 'fixture includes a stock matrix');
assert(!/(?:password|secret|token|api[_-]?key)\s*[:=]/i.test(source), 'preview contains no embedded credentials');

assert(fs.existsSync(componentPath), 'unified editor component exists');
assert(fs.existsSync(cssPath), 'unified editor styles exist');
assert(fs.existsSync(clientPath), 'catalogue editor frontend client exists');
if (fs.existsSync(componentPath) && fs.existsSync(cssPath)) {
  const component = fs.readFileSync(componentPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert(/type=["']file["'][^>]*multiple[^>]*accept=["']image\/jpeg,image\/png,image\/webp["']/.test(component), 'photo picker accepts the supported image formats');
  assert(component.includes('name="productDetails"'), 'product information includes a separate Product details field');
  assert(component.includes('parseProductDescription') && component.includes('formatProductDescription'), 'description and Product details share the canonical storage bridge');
  assert(component.includes('value={descriptionDraft}') && component.includes('value={productDetailsDraft}'), 'textareas preserve raw editing drafts instead of trimming every keystroke');
  assert(component.includes('setDescriptionDraft(description)') && component.includes('setProductDetailsDraft(details)'), 'space-preserving draft state updates before canonical persistence');
  assert(component.includes('editorKey: string') && component.includes('}, [editorKey]);'), 'controlled product identity resets local drafts explicitly');
  assert(component.includes('createdObjectUrls.current.clear()'), 'successful save releases pending photo preview URLs');
  assert(component.includes('function NumericInput('), 'all editor numeric controls share one clearable input');
  assert(component.includes("if (!combination.valueKeys.length) return 'Product inventory'"), 'no-choice stock uses clear product-level wording');
  assert(component.includes('No choices added. Set one price and stock quantity for the whole product.'), 'no-choice helper explains whole-product stock');
  assert(component.includes('add Product choices in Step 02'), 'no-choice state directs admin back to product choices');
  assert(component.includes("model.choices.length === 0\n        ? model.combinations.map((combination) => ({ ...combination, price }))"), 'no-choice product price stays synced with base price');
  assert(component.includes("combination.valueKeys.length === 0 ? 'Stock quantity' : 'Stock'"), 'stock label adapts to product-level versus choice-level inventory');
  assert(component.includes('Product Code') && component.includes('Auto-generated if blank'), 'technical SKU wording is replaced by a clear auto-generated Product Code');
  assert(component.includes('Variant Price (RM)'), 'technical price override wording is replaced by Variant Price (RM)');
  assert(component.includes('Defaults to Base price. Change only when this option has a different price.'), 'variant price explains its Base price default');
  assert(component.includes('className={styles.standardSku}'), 'no-choice product shows Product Code directly without a duplicate variant price');
  assert(component.includes('useState(() => String(value))'), 'zero remains an explicit numeric draft value');
  assert(component.includes("onChange('')"), 'clearing a numeric field reports an empty draft for validation');
  assert(!component.includes('onBlur={() =>'), 'numeric parsing is not duplicated on blur');
  assert(component.includes('<label>Category<select'), 'category uses a reliable native select control');
  for (const category of ['Apparel', 'Bottles', 'Marketing Material', 'Stationary', 'SIM Card']) {
    assert(component.includes(`'${category}'`), `category presets include ${category}`);
  }
  assert(component.includes('Add new category…'), 'category select exposes an explicit create-new option');
  assert(component.includes('New category<input'), 'custom category mode exposes a separate category-name field');
  assert(component.includes('selectCategory(event.target.value)'), 'category can be reselected after the first choice');
  assert(component.includes('availableCategories?: string[]'), 'editor accepts saved Catalogue categories');
  assert(component.includes('mergeProductCategories(availableCategories)'), 'saved and preset categories share one case-insensitive list');
  assert(component.includes('selectedCategory'), 'existing custom category casing resolves to a visible dropdown option');
  assert(component.includes('URL.createObjectURL'), 'new photo files receive local previews');
  assert(component.includes('10 * 1024 * 1024'), 'photo picker enforces the API 10 MB file limit');
  assert(component.includes("value.retired ? 'Undo' : 'Hide'"), 'choice values use clear Hide and Undo wording');
  assert(!component.includes("'Retire'"), 'technical Retire wording is not user-facing');
  assert(component.includes('Add product photos'), 'photo upload has a visible accessible label');
  assert(component.includes('Choices and photos') && component.includes('Set up product choices first'), 'section explains the choices-first flow');
  assert(component.indexOf('className={styles.choiceBuilder}') < component.indexOf('className={styles.photoUpload}'), 'product choices render before the photo uploader');
  assert(/\.choiceBuilder \+ \.photoUpload\b/.test(css), 'choices-first layout keeps clear spacing before photos');
  assert(/\.photoUpload\b/.test(css), 'photo upload is styled in the editor visual system');
  assert(/\.editor label\s*\{[^}]*align-content:\s*start/s.test(css), 'paired form controls align at the top when helper text makes one label taller');
  assert(/\.editor select\s*\{[^}]*height:\s*43px/s.test(css), 'select and adjacent text input keep the same control height');
}
if (fs.existsSync(clientPath)) {
  const client = fs.readFileSync(clientPath, 'utf8');
  assert(client.includes('/admin-api/catalogue-products/'), 'client targets the public frontend admin alias');
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    assert(new RegExp(`method:\\s*['\"]${method}['\"]`).test(client), `client declares ${method} catalogue operations`);
  }
  assert(client.includes("method: 'PATCH'"), 'save uses the item route PATCH method');
  assert(client.includes('existingImages: snapshot.product.model.existingImages'), 'metadata saves preserve authoritative existing image bindings from the exact preimage snapshot');
  assert(client.includes("form.append('file', photo.file)"), 'pending photos upload as multipart files');
  assert(client.includes("form.append('assignment', photo.assignment)"), 'photo Used for association reaches the media API');
  assert(!/(?:bundleClient|providerId|vendorId)/.test(client), 'frontend client contains no provider identity coupling');
}

if (!process.exitCode) console.log('Unified Product Editor preview source checks passed.');
