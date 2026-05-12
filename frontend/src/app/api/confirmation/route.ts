import { NextRequest, NextResponse } from 'next/server';

function handleConfirmation(req: NextRequest, method: string) {
  const { searchParams } = req.nextUrl;
  const refno = searchParams.get('refno') || '';
  const locale = searchParams.get('locale') || 'en';

  const url = new URL('/thank-you', req.url);
  if (refno) url.searchParams.set('refno', refno);
  url.searchParams.set('locale', locale);

  // 303 forces browser to GET (POST→GET redirect)
  return NextResponse.redirect(url, method === 'POST' ? 303 : 307);
}

export async function GET(req: NextRequest) {
  return handleConfirmation(req, 'GET');
}

export async function POST(req: NextRequest) {
  return handleConfirmation(req, 'POST');
}
