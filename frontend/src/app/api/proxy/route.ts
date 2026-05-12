import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_HOSTS = ['tonewow.net', 'bundleapi.tonewow.com', 'qa.tonegroup.net'];

function validateUrl(url: string): URL {
  if (!url) throw new Error('Missing url parameter');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }
  const allowed = ALLOWED_HOSTS.some(
    h => parsed.hostname === h || parsed.hostname.endsWith('.' + h),
  );
  if (!allowed) throw new Error(`Host not allowed: ${parsed.hostname}`);
  return parsed;
}

export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl.searchParams.get('url');
    validateUrl(url!);
    const res = await fetch(url!, {
      headers: {
        Accept: 'application/json',
        Referer: 'https://shop.tonewow.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Proxy error' }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const url = req.nextUrl.searchParams.get('url');
    validateUrl(url!);
    const body = await req.json().catch(() => ({}));
    const res = await fetch(url!, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Referer: 'https://shop.tonewow.com/',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Proxy error' }, { status: 400 });
  }
}
