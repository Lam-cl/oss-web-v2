import { NextRequest, NextResponse } from 'next/server';
import { catalogueAdminError, catalogueAdminRoute, readBoundedCatalogueJson, readCatalogueAdminSession } from '@/lib/admin/catalogueAdminRoute.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Context = { params: { id: string } };

export async function GET(request: NextRequest, { params }: Context) {
  const { session, error } = await readCatalogueAdminSession(request, false);
  if (error) return error;
  try {
    return NextResponse.json(await catalogueAdminRoute.inventory(params.id, session!.token), { headers: { 'cache-control': 'no-store' } });
  } catch (reason) {
    return catalogueAdminError(reason);
  }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const { session, error } = await readCatalogueAdminSession(request, true);
  if (error) return error;
  try {
    return NextResponse.json(await catalogueAdminRoute.updateInventory(params.id, await readBoundedCatalogueJson(request), session!.token), { headers: { 'cache-control': 'no-store' } });
  } catch (reason) {
    return catalogueAdminError(reason);
  }
}
