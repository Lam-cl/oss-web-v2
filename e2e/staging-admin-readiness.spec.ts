import { expect, test } from '@playwright/test';

const email = process.env.STAGING_ADMIN_EMAIL;
const password = process.env.STAGING_ADMIN_PASSWORD;

test.afterEach(async ({ page }) => {
  await page.request.post('/admin-api/auth/logout', { headers: { origin: process.env.STAGING_BASE_URL || 'https://tonewow.xifuhalim.com' } }).catch(() => undefined);
});

test('admin uses an opaque session and renders evidence-backed publication actions', async ({ page, context }) => {
  test.skip(!email || !password, 'STAGING_ADMIN_EMAIL and STAGING_ADMIN_PASSWORD are required.');
  await page.goto('/admin/login');
  await page.getByLabel('Email address').fill(email!);
  await page.getByLabel('Password').fill(password!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);

  const cookie = (await context.cookies()).find((item) => item.name === 'tonewow_admin_session');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.value).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);

  await page.goto('/admin/products');
  await expect(page.getByRole('heading', { name: 'Product catalogue' })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();

  const catalogue = await page.evaluate(async () => {
    const response = await fetch('/admin-api/catalogue-products', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Catalogue request failed (${response.status}).`);
    return response.json();
  }) as { products: Array<{ currentBundleProductId: number | null; status: string; managementDomain?: string; model: { details: { title: string; category?: string } }; publicationChangeState: string }> };
  const byId = new Map(catalogue.products.map((product) => [product.currentBundleProductId, product]));
  expect(byId.get(91)?.publicationChangeState).toBe('clean');
  expect(byId.get(39)?.model.details.category).toBe('SIM Card');
  expect(byId.get(39)?.managementDomain).toBeUndefined();
  expect(byId.get(40)?.model.details.category).toBe('SIM Card');
  expect(byId.get(90)?.publicationChangeState).toBe('dirty');
  expect(catalogue.products.filter((product) => product.publicationChangeState === 'unknown')).toHaveLength(0);

  const search = page.getByPlaceholder(/Search title/);
  await search.fill('Water Bottle 975ml');
  const bottle = page.getByRole('row', { name: /Water Bottle 975ml/i });
  await expect(bottle).toBeVisible();
  await expect(bottle.getByRole('button', { name: /Publish changes/i })).toHaveCount(0);

  await search.fill('Topi');
  const topi = page.getByRole('row', { name: /Topi/i });
  await expect(topi).toBeVisible();
  const topiEvidence = catalogue.products.find((product) => /Topi/i.test(product.model.details.title));
  if (topiEvidence?.publicationChangeState === 'dirty') {
    await expect(topi.getByRole('button', { name: /Publish(?: changes)? for/i })).toBeEnabled();
  } else {
    expect(topiEvidence?.publicationChangeState).toBe('clean');
    await expect(topi.getByRole('button', { name: /Publish(?: changes)? for/i })).toHaveCount(0);
    await expect(topi.getByRole('button', { name: /Unpublish/i })).toBeEnabled();
  }

  await search.fill('90');
  const sim = page.getByRole('row', { name: /QA.*SIM SUPERLITE/i });
  await expect(sim).toBeVisible();
  await expect(sim.getByRole('button', { name: /Publish changes/i })).toBeEnabled();
  await expect(sim.getByRole('button', { name: /Unpublish/i })).toBeEnabled();

  await search.fill('39');
  const superlite = page.getByRole('row', { name: /SUPERLITE SIM/i });
  await superlite.getByRole('button', { name: /Edit SUPERLITE SIM/i }).click();
  const simEditor = page.getByRole('form', { name: 'Product editor' });
  await expect(simEditor.getByLabel('SIM management policy')).toHaveCount(0);
  await expect(simEditor.getByLabel('Product name')).toBeEnabled();
  await expect(simEditor.getByLabel('Category')).toHaveValue('SIM Card');
  await expect(simEditor.getByLabel('Minimum order quantity')).toHaveValue('2');
  await expect(simEditor.getByRole('button', { name: 'Save product' })).toBeEnabled();
  await simEditor.getByRole('button', { name: 'Cancel' }).click();
  await expect(superlite.getByRole('button', { name: /Unpublish SUPERLITE SIM/i })).toBeEnabled();

  await page.getByRole('banner').getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/admin\/login/);
});
