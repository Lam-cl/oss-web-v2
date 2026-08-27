import { NextRequest, NextResponse } from 'next/server';
import { addCatalogueMedia, listCatalogueMedia } from '@/lib/admin/catalogueMedia.server';
import {
  activeSimMediaMutationError,
  catalogueMediaAuthError,
  catalogueMediaBadRequest,
  catalogueMediaRequestError,
  isActiveCatalogueMediaAssignment,
  publicCatalogueMedia,
  readBoundedCatalogueMediaForm,
  readCatalogueMediaProduct,
} from '@/lib/admin/catalogueMediaRoute.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: { id: string } };

export async function GET(request: NextRequest, { params }: Context) {
  const denied = await catalogueMediaAuthError(request, false);
  if (denied) return denied;
  const { error } = await readCatalogueMediaProduct(params.id);
  if (error) return error;
  try {
    const media = await listCatalogueMedia(params.id);
    return NextResponse.json({ media: media.map(publicCatalogueMedia) }, { headers: { 'cache-control': 'no-store' } });
  } catch (reason) { return catalogueMediaRequestError(reason); }
}

export async function POST(request: NextRequest, { params }: Context) {
  const denied = await catalogueMediaAuthError(request, true);
  if (denied) return denied;
  const { product, error } = await readCatalogueMediaProduct(params.id);
  if (error) return error;
  const simDenied = await activeSimMediaMutationError(product);
  if (simDenied) return simDenied;

  let form: FormData;
  try { form = await readBoundedCatalogueMediaForm(request); }
  catch (reason) { return catalogueMediaRequestError(reason); }
  const entries = Array.from(form.entries());
  const keys = entries.map(([key]) => key).sort();
  if (entries.length !== 3 || keys.join(',') !== 'assignment,file,order') return catalogueMediaBadRequest();
  const file = form.get('file');
  const order = form.get('order');
  const assignment = form.get('assignment');
  if (!(file instanceof Blob) || typeof (file as File).name !== 'string'
    || typeof order !== 'string' || !/^\d+$/.test(order)
    || !isActiveCatalogueMediaAssignment(product, assignment)) return catalogueMediaBadRequest();
  const numericOrder = Number(order);
  if (!Number.isSafeInteger(numericOrder)) return catalogueMediaBadRequest();

  try {
    const media = await addCatalogueMedia(params.id, {
      name: (file as File).name,
      type: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
      body: file,
      order: numericOrder,
      assignment,
    });
    return NextResponse.json({ media: publicCatalogueMedia(media) }, {
      status: 201,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (reason) { return catalogueMediaRequestError(reason); }
}
