import { NextRequest, NextResponse } from 'next/server';

function handleConfirmation(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const refno = searchParams.get('refno') || '';
  const locale = searchParams.get('locale') || 'en';

  const url = new URL('/thank-you', req.url);
  if (refno) url.searchParams.set('refno', refno);
  url.searchParams.set('locale', locale);

  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  return handleConfirmation(req);
}

export async function POST(req: NextRequest) {
  return handleConfirmation(req);
}
