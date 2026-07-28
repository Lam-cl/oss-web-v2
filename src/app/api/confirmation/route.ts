import { NextRequest, NextResponse } from 'next/server';

async function handleConfirmation(req: NextRequest, method: string) {
  const { searchParams } = req.nextUrl;
  let refno = searchParams.get('refno') || '';
  let status = searchParams.get('status') || '';
  let description = searchParams.get('desc') || searchParams.get('description') || '';
  let flow = searchParams.get('flow') || '';
  let prodDesc = searchParams.get('prodDesc')
    || searchParams.get('proddesc')
    || searchParams.get('PRODDESC')
    || '';
  let isEsim = searchParams.get('esim') === '1';

  // Read POST body from GKash return
  if (method === 'POST') {
    try {
      const body = await req.formData();
      refno = refno || body.get('refno')?.toString() || body.get('cartid')?.toString() || '';
      status = status || body.get('status')?.toString() || '';
      description = description || body.get('desc')?.toString() || body.get('description')?.toString() || '';
      flow = flow || body.get('flow')?.toString() || '';
      prodDesc = prodDesc
        || body.get('prodDesc')?.toString()
        || body.get('proddesc')?.toString()
        || body.get('PRODDESC')?.toString()
        || '';
      const bodyEsim = body.get('esim')?.toString() || body.get('isEsim')?.toString() || '';
      isEsim = isEsim || bodyEsim === '1' || bodyEsim.toLowerCase() === 'true';
    } catch { /* body parse failed, use query params only */ }
  }

  const locale = searchParams.get('locale') || 'en';
  const isAdx = flow.toLowerCase() === 'adx' || prodDesc.toLowerCase() === 'osspaymentadx';

  const url = new URL(isAdx ? '/adx/thank-you' : '/thank-you', req.url);
  if (refno) url.searchParams.set('refno', refno);
  url.searchParams.set('locale', locale);
  if (isEsim) url.searchParams.set('esim', '1');
  if (status) url.searchParams.set('status', status);
  if (description) url.searchParams.set('desc', description);

  // 303 forces browser to GET (POST→GET redirect)
  return NextResponse.redirect(url, method === 'POST' ? 303 : 307);
}

export async function GET(req: NextRequest) {
  return handleConfirmation(req, 'GET');
}

export async function POST(req: NextRequest) {
  return handleConfirmation(req, 'POST');
}
