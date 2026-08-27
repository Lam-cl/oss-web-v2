import { expect, test } from '@playwright/test';

const baseURL = process.env.STAGING_BASE_URL || 'https://tonewow.xifuhalim.com';
const email = process.env.STAGING_ADMIN_EMAIL;
const password = process.env.STAGING_ADMIN_PASSWORD;

test.afterEach(async ({ page }) => {
  await page.request.post('/admin-api/auth/logout', { headers: { origin: baseURL } }).catch(() => undefined);
});

test('restores Topi draft stock to its published 1/2/3 evidence through the admin UI', async ({ page }) => {
  test.skip(process.env.STAGING_ALLOW_MUTATIONS !== 'yes' || !email || !password, 'Explicit staging mutation credentials are required.');
  await page.goto('/admin/login');
  await page.getByLabel('Email address').fill(email!);
  await page.getByLabel('Password').fill(password!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/products');

  const catalogue = await page.evaluate(async () => {
    const response = await fetch('/admin-api/catalogue-products', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Catalogue request failed (${response.status}).`);
    return response.json();
  }) as { products: Array<{ currentBundleProductId: number | null; publicationChangeState: string }> };
  const topi = catalogue.products.find((product) => product.currentBundleProductId === 81);
  expect(topi).toBeTruthy();

  const search = page.getByPlaceholder(/Search title/);
  await search.fill('81');
  const row = page.getByRole('row', { name: /Topi/i });
  await expect(row).toBeVisible();
  if (topi!.publicationChangeState === 'dirty') {
    await row.getByRole('button', { name: /Edit/i }).click();
    const editor = page.getByRole('form', { name: 'Product editor' });
    await expect(editor).toBeVisible();
    const stockSection = editor.getByRole('heading', { name: 'Price and stock' }).locator('xpath=ancestor::section[1]');
    const numericInputs = stockSection.locator('input[type="number"]');
    await expect(numericInputs).toHaveCount(7);
    const stockInputs = [numericInputs.nth(1), numericInputs.nth(3), numericInputs.nth(5)];
    await expect(stockInputs[0]).toHaveValue('1');
    await stockInputs[0].fill('1');
    await stockInputs[1].fill('2');
    await stockInputs[2].fill('3');
    await editor.getByRole('button', { name: 'Save product' }).click();
    await expect(page.getByText('Product saved.')).toBeVisible();
    await expect(row.getByRole('button', { name: /Publish changes/i })).toHaveCount(0);
  } else {
    expect(topi!.publicationChangeState).toBe('clean');
    await expect(row.getByRole('button', { name: /Publish changes/i })).toHaveCount(0);
  }
});
