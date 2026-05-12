import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const refno = req.nextUrl.searchParams.get('refno') || '';
  const locale = req.nextUrl.searchParams.get('locale') || 'en';

  // Redirect to thank-you page with refno
  const url = new URL('/thank-you', req.url);
  if (refno) url.searchParams.set('refno', refno);
  url.searchParams.set('locale', locale);

  return NextResponse.redirect(url);
}
