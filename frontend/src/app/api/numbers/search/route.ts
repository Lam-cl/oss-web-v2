import { NextRequest, NextResponse } from 'next/server';

/** Server-only. Nest global prefix is `/api` → base ends with `/api`. */
function nestApiBase(): string {
  const raw = process.env.NEST_API_BASE_URL?.trim().replace(/\/$/, '');
  if (raw) return raw;
  return 'http://localhost:4000/api';
}

export async function GET(req: NextRequest) {
  const digits = req.nextUrl.searchParams.get('digits');
  if (!digits || digits.length < 1) {
    return NextResponse.json({ data: [], message: 'Please provide digits to search' });
  }

  const base = nestApiBase();
  const upstream = `${base}/numbers/search?digits=${encodeURIComponent(digits)}`;

  try {
    const res = await fetch(upstream, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    const body = await res.json().catch(() => ({}));
    return NextResponse.json(body, { status: res.status });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Upstream error';
    return NextResponse.json({ data: [], error: message }, { status: 502 });
  }
}

export const dynamic = 'force-dynamic';
