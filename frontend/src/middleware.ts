import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-oss-public-origin', req.nextUrl.origin);

  const withOrigin = (res: NextResponse) => {
    res.headers.set('x-oss-public-origin', req.nextUrl.origin);
    return res;
  };

  // Only protect /sim/purchase with dataPlanID param
  if (pathname === '/sim/purchase' && searchParams.has('dataPlanID')) {
    const token = process.env.DIRECT_CHECKOUT_TOKEN;
    if (!token) {
      return NextResponse.next({ request: { headers: requestHeaders } });
    }

    // Check Authorization header, ?token= query param, or auth cookie
    const authHeader = req.headers.get('authorization');
    const queryToken = searchParams.get('token');
    const cookieToken = req.cookies.get('dc_token')?.value;
    const valid = (authHeader === `Bearer ${token}`) || (queryToken === token) || (cookieToken === token);

    if (!valid) {
      const url = req.nextUrl.clone();
      url.searchParams.delete('dataPlanID');
      url.searchParams.delete('token');
      return withOrigin(NextResponse.redirect(url));
    }

    // If token passed via query param, set cookie and strip from URL
    if (queryToken === token) {
      const url = req.nextUrl.clone();
      url.searchParams.delete('token');
      const res = NextResponse.redirect(url);
      res.cookies.set('dc_token', token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 300 });
      return withOrigin(res);
    }
  }

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
