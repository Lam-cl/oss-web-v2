import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_GATE_COOKIE, hasActiveAdminGateCookie } from '@/lib/admin/session';

// Next 14.2 always compiles middleware for the edge runtime; a `runtime`
// export here is ignored, so none is declared.

async function readPostedToken(req: NextRequest): Promise<string> {
  try {
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await req.json();
      return typeof body?.token === 'string' ? body.token : '';
    }
    const form = await req.formData();
    const value = form.get('token');
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

export async function middleware(req: NextRequest) {
  const { pathname, search, searchParams } = req.nextUrl;

  // Nothing in this app reads x-oss-public-origin. It is still forwarded on the
  // external rewrites (next.config.mjs) because the upstream services are not in
  // this repo and may read it.
  if (
    pathname === '/api-proxy' || pathname.startsWith('/api-proxy/')
    || pathname === '/oss-nest-proxy' || pathname.startsWith('/oss-nest-proxy/')
  ) {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-oss-public-origin', req.nextUrl.origin);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    const login = pathname === '/admin/login';
    // This is a navigation guard only. Full Bundle session validation still
    // happens in every admin API route, where the remote store is reachable.
    const session = hasActiveAdminGateCookie(req.cookies.get(ADMIN_GATE_COOKIE)?.value);

    if (!login && !session) {
      const url = req.nextUrl.clone();
      url.pathname = '/admin/login';
      url.searchParams.set('next', `${pathname}${search}`);
      return NextResponse.redirect(url);
    }
    if (login && session) {
      const url = req.nextUrl.clone();
      url.pathname = '/admin';
      url.search = '';
      return NextResponse.redirect(url);
    }
    const response = NextResponse.next();
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    response.headers.set('Cache-Control', 'private, no-store, max-age=0');
    return response;
  }

  const merchandiseEnabled = process.env.NEXT_PUBLIC_ENABLE_MERCHANDISE?.trim().toLowerCase() === 'true';
  if (!merchandiseEnabled) {
    const merchandisePage = pathname === '/merchandise' || pathname.startsWith('/merchandise/')
      || pathname === '/checkout' || pathname.startsWith('/checkout/');
    const merchandiseApi = pathname === '/bundle/checkout' || pathname === '/api/bundle/checkout'
      || pathname === '/bundle/merchandise' || pathname === '/api/bundle/merchandise'
      || pathname === '/catalogue-products-api' || pathname.startsWith('/catalogue-products-api/')
      || pathname === '/api/catalogue-products' || pathname.startsWith('/api/catalogue-products/')
      || pathname === '/shipping-settings-api' || pathname.startsWith('/shipping-settings-api/');

    if (merchandiseApi) {
      return NextResponse.json(
        { message: 'Not found.' },
        { status: 404, headers: { 'cache-control': 'private, no-store, max-age=0' } },
      );
    }
    if (merchandisePage) {
      const url = req.nextUrl.clone();
      url.pathname = '/';
      url.search = '';
      url.hash = 'shop';
      return NextResponse.redirect(url, 307);
    }
  }

  // Preserve the existing protection for direct/specialized purchase links.
  if (
    pathname === '/sim/purchase' &&
    (searchParams.has('dataPlanID') || ['superlite', 'superliteplus'].includes(searchParams.get('simID') || ''))
  ) {
    const token = process.env.DIRECT_CHECKOUT_TOKEN;
    if (!token) return NextResponse.next();

    if (req.method === 'POST') {
      const postedToken = await readPostedToken(req);
      const simID = searchParams.get('simID') || '';
      const validSimID = ['superlite', 'superliteplus'].includes(simID);
      const url = req.nextUrl.clone();
      url.searchParams.delete('dataPlanID');
      url.searchParams.delete('token');
      if (validSimID && postedToken === token) {
        url.searchParams.set('simID', simID);
        const res = NextResponse.redirect(url, 303);
        res.cookies.set('dc_token', token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 1800 });
        return res;
      }
      url.searchParams.delete('simID');
      return NextResponse.redirect(url, 303);
    }

    const authHeader = req.headers.get('authorization');
    const queryToken = searchParams.get('token');
    const cookieToken = req.cookies.get('dc_token')?.value;
    const valid = authHeader === `Bearer ${token}` || queryToken === token || cookieToken === token;
    if (!valid) {
      const url = req.nextUrl.clone();
      url.searchParams.delete('dataPlanID');
      url.searchParams.delete('simID');
      url.searchParams.delete('token');
      return NextResponse.redirect(url);
    }
    if (queryToken === token) {
      const url = req.nextUrl.clone();
      url.searchParams.delete('token');
      const res = NextResponse.redirect(url);
      res.cookies.set('dc_token', token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 1800 });
      return res;
    }
  }

  return NextResponse.next();
}

// Only the paths the branches above act on. Next needs literal strings here
// (it reads them at build time); middleware.test.mjs checks the coverage.
// `/x/:path*` also matches `/x` itself.
export const config = {
  matcher: [
    // x-oss-public-origin forwarding on external rewrites
    '/api-proxy/:path*',
    '/oss-nest-proxy/:path*',
    // admin navigation guard and no-store/noindex headers
    '/admin/:path*',
    // merchandise flag gating (pages)
    '/merchandise/:path*',
    '/checkout/:path*',
    // merchandise flag gating (APIs)
    '/bundle/checkout',
    '/api/bundle/checkout',
    '/bundle/merchandise',
    '/api/bundle/merchandise',
    '/catalogue-products-api/:path*',
    '/api/catalogue-products/:path*',
    '/shipping-settings-api/:path*',
    // direct checkout token protection
    '/sim/purchase',
  ],
};
