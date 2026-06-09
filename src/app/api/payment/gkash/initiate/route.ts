import { NextRequest, NextResponse } from 'next/server';

const GKASH_INITIATE_URL =
  process.env.GKASH_INITIATE_URL?.trim() ||
  'https://qa.tonegroup.net/api/payment/gkash/initiate';

function refererFor(req: NextRequest): string {
  return req.headers.get('referer') || `${req.nextUrl.origin}/`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const res = await fetch(GKASH_INITIATE_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Referer: refererFor(req),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    const text = await res.text();
    const contentType = res.headers.get('content-type') || '';

    if (contentType.includes('application/json') || text.trim().startsWith('{')) {
      const data = text ? JSON.parse(text) : {};
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(
      {
        success: false,
        error: 'GKash initiate returned a non-JSON response',
        status: res.status,
        body: text.slice(0, 500),
      },
      { status: res.ok ? 502 : res.status },
    );
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e.message || 'GKash initiate proxy error' },
      { status: 500 },
    );
  }
}
