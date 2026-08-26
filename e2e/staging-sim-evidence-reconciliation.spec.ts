import { expect, test } from '@playwright/test';

const baseURL = process.env.STAGING_BASE_URL || 'https://tonewow.xifuhalim.com';
const email = process.env.STAGING_ADMIN_EMAIL;
const password = process.env.STAGING_ADMIN_PASSWORD;

test.afterEach(async ({ page }) => {
  await page.request.post('/admin-api/auth/logout', { headers: { origin: baseURL } }).catch(() => undefined);
});

test('republishes SIM 39/40 through the dedicated same-ID editor and records clean evidence', async ({ page }) => {
  test.skip(process.env.STAGING_ALLOW_MUTATIONS !== 'yes' || !email || !password, 'Explicit staging mutation credentials are required.');
  await page.goto('/admin/login');
  await page.getByLabel('Email address').fill(email!);
  await page.getByLabel('Password').fill(password!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/products');
  const search = page.getByPlaceholder(/Search title/);

  for (const item of [{ id: 39, title: 'SUPERLITE SIM' }, { id: 40, title: 'BIZ SIM' }]) {
    await search.fill(String(item.id));
    const row = page.getByRole('row', { name: new RegExp(item.title, 'i') });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: new RegExp(`Edit ${item.title}`, 'i') }).click();
    const editor = page.getByRole('form', { name: 'Product editor' });
    await expect(editor.getByLabel('SIM management policy')).toBeVisible();
    await editor.getByRole('button', { name: 'Save SIM changes' }).click();
    await expect(page.getByText('Product saved.')).toBeVisible({ timeout: 120_000 });
  }

  const catalogue = await page.evaluate(async () => {
    const response = await fetch('/admin-api/catalogue-products', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Catalogue request failed (${response.status}).`);
    return response.json();
  }) as { products: Array<{ currentBundleProductId: number | null; publicationChangeState: string }> };
  for (const id of [39, 40]) expect(catalogue.products.find((product) => product.currentBundleProductId === id)?.publicationChangeState).toBe('clean');
});
