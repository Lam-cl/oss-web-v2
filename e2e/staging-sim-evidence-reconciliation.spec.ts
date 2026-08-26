import path from 'node:path';
import { expect, test } from '@playwright/test';

const baseURL = process.env.STAGING_BASE_URL || 'https://tonewow.xifuhalim.com';
const email = process.env.STAGING_ADMIN_EMAIL;
const password = process.env.STAGING_ADMIN_PASSWORD;

test.afterEach(async ({ page }) => {
  await page.request.post('/admin-api/auth/logout', { headers: { origin: baseURL } }).catch(() => undefined);
});

test('SIM Card uses the ordinary create, edit, publish, unpublish and archive lifecycle', async ({ page }) => {
  test.skip(process.env.STAGING_ALLOW_MUTATIONS !== 'yes' || !email || !password, 'Explicit staging mutation credentials are required.');
  const title = `QA SIM Card ${Date.now()}`;
  let catalogueId: string | undefined;

  await page.goto('/admin/login');
  await page.getByLabel('Email address').fill(email!);
  await page.getByLabel('Password').fill(password!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);

  try {
    await page.goto('/admin/products');
    await page.getByRole('button', { name: 'Add product' }).first().click();
    const editor = page.getByRole('form', { name: 'Product editor' });
    await editor.getByLabel('Product name').fill(title);
    await editor.getByLabel('Category').selectOption('SIM Card');
    await editor.getByLabel('Minimum order quantity').fill('2');
    await editor.getByLabel('Description').fill('Temporary staging lifecycle fixture.');
    await editor.locator('input[type="file"]').setInputFiles(path.resolve('public/images/tonewow-sim-clean-transparent.png'));
    await editor.getByLabel('Price (RM)').fill('1');
    await editor.getByLabel('Stock quantity').fill('2');
    await editor.getByRole('button', { name: 'Save product' }).click();
    await expect(page.getByText('Product added successfully.')).toBeVisible();

    const readProduct = async () => {
      const payload = await page.evaluate(async () => {
        const response = await fetch('/admin-api/catalogue-products', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Catalogue request failed (${response.status}).`);
        return response.json();
      }) as { products: Array<any> };
      return payload.products.find((product) => product.model.details.title === title);
    };
    let product = await readProduct();
    expect(product.model.details.category).toBe('SIM Card');
    expect(product.model.details.minimumOrderQuantity).toBe(2);
    catalogueId = product.catalogueId;

    const search = page.getByPlaceholder(/Search title/);
    await search.fill(title);
    let row = page.getByRole('row', { name: new RegExp(title) });
    await row.getByRole('button', { name: new RegExp(`Publish for ${title}`) }).click();
    await expect(page.getByText('Product published successfully. It is now visible in OSS.')).toBeVisible({ timeout: 120_000 });

    row = page.getByRole('row', { name: new RegExp(title) });
    await row.getByRole('button', { name: new RegExp(`Edit ${title}`) }).click();
    const editForm = page.getByRole('form', { name: 'Product editor' });
    await expect(editForm.getByLabel('SIM management policy')).toHaveCount(0);
    await editForm.getByLabel('Stock quantity').fill('3');
    await editForm.getByRole('button', { name: 'Save product' }).click();
    await expect(page.getByText('Product saved.')).toBeVisible();
    product = await readProduct();
    expect(product.model.combinations[0].inventory).toBe(3);
    expect(product.publicationChangeState).toBe('dirty');

    row = page.getByRole('row', { name: new RegExp(title) });
    await row.getByRole('button', { name: new RegExp(`Publish changes for ${title}`) }).click();
    await expect(page.getByText('Product published successfully. It is now visible in OSS.')).toBeVisible({ timeout: 120_000 });
    product = await readProduct();
    expect(product.publicationChangeState).toBe('clean');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('row', { name: new RegExp(title) }).getByRole('button', { name: new RegExp(`Unpublish ${title}`) }).click();
    await expect(page.getByText('Product unpublished. You can now archive it.')).toBeVisible({ timeout: 120_000 });
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('row', { name: new RegExp(title) }).getByRole('button', { name: new RegExp(`Archive ${title}`) }).click();
    await expect(page.getByText('Product archived successfully.')).toBeVisible();
    expect(await readProduct()).toBeUndefined();
    catalogueId = undefined;
  } finally {
    if (catalogueId) {
      const response = await page.request.get('/admin-api/catalogue-products');
      const payload = await response.json().catch(() => ({ products: [] }));
      const product = payload.products?.find((item: any) => item.catalogueId === catalogueId);
      if (product?.status === 'published') await page.request.post(`/admin-api/catalogue-products/${catalogueId}/unpublish`, {
        headers: { origin: baseURL, 'content-type': 'application/json' }, data: { revision: product.revision },
      }).catch(() => undefined);
      const refreshed = await page.request.get('/admin-api/catalogue-products').then((result) => result.json()).catch(() => ({ products: [] }));
      const draft = refreshed.products?.find((item: any) => item.catalogueId === catalogueId);
      if (draft) await page.request.post(`/admin-api/catalogue-products/${catalogueId}/archive`, {
        headers: { origin: baseURL, 'content-type': 'application/json' }, data: { revision: draft.revision },
      }).catch(() => undefined);
    }
  }
});
