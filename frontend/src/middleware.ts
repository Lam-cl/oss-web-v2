import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // Only protect /sim/purchase with dataPlanID param
  if (pathname === '/sim/purchase' && searchParams.has('dataPlanID')) {
    const token = process.env.DIRECT_CHECKOUT_TOKEN;
    if (!token) return NextResponse.next();

    // Check Authorization header, ?token= query param, or auth cookie
    const authHeader = req.headers.get('authorization');
    const queryToken = searchParams.get('token');
    const cookieToken = req.cookies.get('dc_token')?.value;
    const valid = (authHeader === `Bearer ${token}`) || (queryToken === token) || (cookieToken === token);

    if (!valid) {
      const url = req.nextUrl.clone();
      url.searchParams.delete('dataPlanID');
      url.searchParams.delete('token');
      return NextResponse.redirect(url);
    }

    // If token passed via query param, set cookie and strip from URL
    if (queryToken === token) {
      const url = req.nextUrl.clone();
      url.searchParams.delete('token');
      const res = NextResponse.redirect(url);
      res.cookies.set('dc_token', token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 300 });
      return res;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/sim/purchase',
};
