import { NextRequest, NextResponse } from 'next/server';
import { readCatalogueAdminSession, readBoundedCatalogueJson } from '@/lib/admin/catalogueAdminRoute.server';
import { listCatalogueProducts } from '@/lib/admin/catalogueProduct.server';
import { readMerchandiseOrder, saveMerchandiseOrder, validateMerchandiseOrderEntries } from '@/lib/merchandiseOrder.server';
import { ToneWowDataApiError } from '@/lib/dataApiClient.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { error } = await readCatalogueAdminSession(request, false);
  if (error) return error;
  try { return NextResponse.json(await readMerchandiseOrder(), { headers: { 'cache-control': 'no-store' } }); }
  catch { return NextResponse.json({ message: 'Product order is unavailable.' }, { status: 503 }); }
}

export async function PUT(request: NextRequest) {
  const { error } = await readCatalogueAdminSession(request, true);
  if (error) return error;
  try {
    const body = await readBoundedCatalogueJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).sort().join(',') !== 'entries,revision') throw new Error('An exact product order and revision are required.');
    const { revision, entries } = body as Record<string, unknown>;
    const valid = validateMerchandiseOrderEntries(entries);
    const catalogue = await listCatalogueProducts();
    const byId = new Map(catalogue.map(product => [product.catalogueId, product]));
    if (valid.length !== catalogue.length || valid.some(entry => {
      const product = byId.get(entry.catalogueId);
      return !product || product.currentBundleProductId !== entry.bundleProductId;
    })) throw new Error('Product order must contain each current catalogue product exactly once. Reload and try again.');
    return NextResponse.json(await saveMerchandiseOrder(revision as number, valid), { headers: { 'cache-control': 'no-store' } });
  } catch (reason) {
    const status = reason instanceof ToneWowDataApiError ? reason.status === 409 ? 409 : 503 : 400;
    return NextResponse.json({ message: reason instanceof Error ? reason.message : 'Product order could not be saved.' }, { status });
  }
}
