const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function loadTypeScriptModule(path, aliases = {}) {
  const source = fs.readFileSync(path, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (id) => aliases[id] || require(id);
  new Function('exports', 'require', 'module', output)(module.exports, localRequire, module);
  return module.exports;
}

const { productImageOrderPayload } = loadTypeScriptModule('src/lib/admin/imageOrder.ts');
assert.deepEqual(productImageOrderPayload([{ id: 30 }, { id: 10 }, { id: 20 }]), {
  images: [{ id: 30, order: 0 }, { id: 10, order: 1 }, { id: 20, order: 2 }],
});

const merchandise = loadTypeScriptModule('src/data/merchandise.ts', {
  '@/lib/minimumOrderQuantity': { getProductMinimumOrderQuantity: () => 1 },
  '@/lib/productDescription': { parseProductDescription: () => ({ description: '', details: [] }) },
});
const inputImages = [
  { id: 6, order: 5, url: 'image-6' },
  { id: 2, order: 1, url: 'image-2' },
  { id: 4, order: 3, url: 'image-4' },
  { id: 1, order: 0, url: 'image-1' },
  { id: 5, order: 4, url: 'image-5' },
  { id: 3, order: 2, url: 'image-3' },
];
const [product] = merchandise.mergeBundleMerchandiseProducts([{
  id: 999,
  title: 'Six image product',
  slug: 'six-image-product',
  price: 10,
  images: inputImages,
  options: [{ name: 'Colour', values: [{ value: 'Blue', imageUrl: 'option-blue' }] }],
  productVariants: [{ id: 1, inventory: 1, price: 10 }],
}]);
assert.deepEqual(product.gallery, ['image-1', 'image-2', 'image-3', 'image-4', 'image-5', 'image-6']);
assert.equal(product.gallery.length, 6);
assert.equal(product.options[0].image, 'option-blue');

const [mapped] = merchandise.mergeBundleMerchandiseProducts([{
  id: 1000,
  title: 'Mapped shirt',
  slug: 'mapped-shirt',
  price: 39,
  images: [1, 2, 3, 4, 5].map((id) => ({ id, order: id, url: `image-${id}` })),
  imageColorAssignments: { 1: 11, 2: 11, 3: 12, 4: 12, 5: 'all' },
  options: [{ name: 'Color', values: [{ id: 11, value: 'Stoney' }, { id: 12, value: 'Sand' }] }],
  productVariants: [{ id: 1, inventory: 1, price: 39 }, { id: 2, inventory: 1, price: 39 }],
}]);
assert.deepEqual(mapped.options[0].gallery, ['image-1', 'image-2', 'image-5']);
assert.deepEqual(mapped.options[1].gallery, ['image-3', 'image-4', 'image-5']);
assert.equal(mapped.options[0].image, 'image-1');
assert.equal(mapped.options[1].image, 'image-3');
assert.deepEqual(mapped.gallery, ['image-1', 'image-2', 'image-3', 'image-4', 'image-5']);
assert.equal(merchandise.getMerchandiseGalleryIndexForOption(mapped, 0), 0);
assert.equal(merchandise.getMerchandiseGalleryIndexForOption(mapped, 1), 2);
assert.equal(merchandise.getMerchandiseOptionIndexForImage(mapped, 'image-4'), 1);

const publicRoute = fs.readFileSync('src/app/api/bundle/merchandise/route.ts', 'utf8');
assert(publicRoute.includes('imageColorAssignments'), 'public merchandise response must include local assignments');
const mainGallery = fs.readFileSync('src/components/home/MerchandiseSection.tsx', 'utf8');
assert(mainGallery.includes('return getProductGallery(product)'), 'main storefront must keep the full product gallery visible');
assert(mainGallery.includes('getMerchandiseOptionIndexForImage'), 'main storefront must sync Color when a mapped image is selected');
const cartGallery = fs.readFileSync('src/components/merchandise/CartMerchandiseEditor.tsx', 'utf8');
assert(cartGallery.includes('return getProductGallery(product)'), 'cart editor must keep the full product gallery visible');
assert(!cartGallery.includes('getMerchandiseOptionIndexForImage'), 'cart editor media must not replace the cart option without an explicit option click');
console.log('product image order and canonical gallery checks passed');
