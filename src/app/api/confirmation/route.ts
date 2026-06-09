import { NextRequest, NextResponse } from 'next/server';

async function handleConfirmation(req: NextRequest, method: string) {
  const { searchParams } = req.nextUrl;
  let refno = searchParams.get('refno') || '';
  let status = '';
  let description = '';

  // Read POST body from GKash return
  if (method === 'POST') {
    try {
      const body = await req.formData();
      refno = refno || body.get('refno')?.toString() || body.get('cartid')?.toString() || '';
      status = body.get('status')?.toString() || '';
      description = body.get('description')?.toString() || '';
    } catch { /* body parse failed, use query params only */ }
  }

  const locale = searchParams.get('locale') || 'en';

  const url = new URL('/thank-you', req.url);
  if (refno) url.searchParams.set('refno', refno);
  url.searchParams.set('locale', locale);
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
