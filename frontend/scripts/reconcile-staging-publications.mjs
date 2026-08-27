const base = (process.env.STAGING_BASE_URL || 'https://tonewow.xifuhalim.com').replace(/\/$/, '');
const email = process.env.STAGING_ADMIN_EMAIL;
const password = process.env.STAGING_ADMIN_PASSWORD;
const commit = process.env.STAGING_RECONCILE === 'yes';
const expectedIds = [24, 27, 28, 32, 33, 34, 35, 36];

if (!email || !password) throw new Error('STAGING_ADMIN_EMAIL and STAGING_ADMIN_PASSWORD are required.');

const login = await fetch(`${base}/admin-api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: base },
  body: JSON.stringify({ email, password }), redirect: 'manual',
});
if (!login.ok) throw new Error(`Staging admin login failed (${login.status}).`);
const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
if (!cookie?.startsWith('tonewow_admin_session=v1.')) throw new Error('Staging did not issue an opaque admin session.');
const headers = { cookie, origin: base };

async function catalogue() {
  const response = await fetch(`${base}/admin-api/catalogue-products`, { headers, cache: 'no-store' });
  if (!response.ok) throw new Error(`Catalogue read failed (${response.status}).`);
  return response.json();
}

try {
  const before = await catalogue();
  const candidates = before.products
    .filter((product) => product.publicationChangeState === 'unknown' && !/^sim$/i.test(product.model.details.category || ''))
    .sort((left, right) => left.currentBundleProductId - right.currentBundleProductId);
  const actualIds = candidates.map((product) => product.currentBundleProductId);
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    throw new Error(`Exact reconciliation set mismatch: expected ${expectedIds.join(',')}; received ${actualIds.join(',') || 'none'}.`);
  }
  process.stdout.write(`${commit ? 'COMMIT' : 'DRY RUN'} standard publication reconciliation: ${actualIds.join(', ')}\n`);
  if (commit) {
    for (const product of candidates) {
      const response = await fetch(`${base}/admin-api/catalogue-products/${encodeURIComponent(product.catalogueId)}/publish`, {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ revision: product.revision }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`Publication ${product.currentBundleProductId} failed (${response.status}): ${result?.message || 'no safe message'}`);
      process.stdout.write(`published old=${product.currentBundleProductId} new=${result?.product?.currentBundleProductId} catalogue=${product.catalogueId}\n`);
    }
    const after = await catalogue();
    const unresolved = after.products.filter((product) => product.bundleVersions?.some((version) => expectedIds.includes(version.bundleProductId))
      && product.publicationChangeState !== 'clean');
    if (unresolved.length) throw new Error(`Reconciliation verification failed for ${unresolved.map((product) => product.catalogueId).join(',')}.`);
    process.stdout.write('All eight standard legacy publications now have clean evidence.\n');
  }
} finally {
  await fetch(`${base}/admin-api/auth/logout`, { method: 'POST', headers }).catch(() => undefined);
}
