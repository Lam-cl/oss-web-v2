import { NextRequest, NextResponse } from 'next/server';
import { verifySignedToken } from '@/lib/registerToken';
import { readTokenRecord } from '@/lib/tokenStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EsimSuccessRecord = {
  details: unknown;
  promoter: unknown;
};

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim() || '';

  if (!token) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 });
  }

  try {
    if (!token.includes('.')) {
      const record = await readTokenRecord<EsimSuccessRecord>('esim-success', token);
      if (!record) {
        return NextResponse.json({ error: 'Saved eSIM details not found or expired' }, { status: 404 });
      }
      return NextResponse.json(record);
    }

    const payload = verifySignedToken(token);
    if (payload.typ !== 'tonewow_esim_success') {
      return NextResponse.json({ error: 'Invalid eSIM success token type' }, { status: 400 });
    }

    return NextResponse.json({
      details: payload.details,
      promoter: payload.promoter,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Invalid token' }, { status: 400 });
  }
}
