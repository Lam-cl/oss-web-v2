import { NextRequest, NextResponse } from 'next/server';

function publicOriginFor(req: NextRequest): string {
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || req.headers.get('host')?.split(',')[0]?.trim();
  if (host && !host.startsWith('localhost') && !host.startsWith('127.')) {
    const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
    return `${forwardedProto}://${host}`;
  }

  return req.nextUrl.origin;
}

async function handleConfirmation(req: NextRequest, method: string) {
  const { searchParams } = req.nextUrl;
  let refno = searchParams.get('refno') || '';
  let status = searchParams.get('status') || '';
  let description = searchParams.get('desc') || searchParams.get('description') || '';
  let isEsim = searchParams.get('esim') === '1' || searchParams.get('flow') === 'esim';

  if (method === 'POST') {
    try {
      const body = await req.formData();
      refno = refno || body.get('refno')?.toString() || body.get('cartid')?.toString() || '';
      status = status || body.get('status')?.toString() || '';
      description = description || body.get('description')?.toString() || '';
      const bodyEsim = body.get('esim')?.toString() || body.get('isEsim')?.toString() || '';
      isEsim = isEsim || bodyEsim === '1' || bodyEsim.toLowerCase() === 'true';
    } catch { /* body parse failed, use query params only */ }
  }

  const locale = searchParams.get('locale') || 'en';

  const url = new URL('/thank-you', publicOriginFor(req));
  if (refno) url.searchParams.set('refno', refno);
  url.searchParams.set('locale', locale);
  if (isEsim) url.searchParams.set('esim', '1');
  if (status) url.searchParams.set('status', status);
  if (description) url.searchParams.set('desc', description);

  return NextResponse.redirect(url, method === 'POST' ? 303 : 307);
}

export async function GET(req: NextRequest) {
  return handleConfirmation(req, 'GET');
}

export async function POST(req: NextRequest) {
  return handleConfirmation(req, 'POST');
}
