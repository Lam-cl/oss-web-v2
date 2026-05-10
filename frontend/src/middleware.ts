import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // Only protect /sim/purchase with dataPlanID param
  if (pathname === '/sim/purchase' && searchParams.has('dataPlanID')) {
    const token = process.env.DIRECT_CHECKOUT_TOKEN;
    if (!token) return NextResponse.next(); // no token configured — allow

    const authHeader = req.headers.get('authorization');
    const expected = `Bearer ${token}`;

    if (!authHeader || authHeader !== expected) {
      return new NextResponse(
        JSON.stringify({ error: 'Unauthorized', message: 'Valid bearer token required for this endpoint' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/sim/purchase',
};
