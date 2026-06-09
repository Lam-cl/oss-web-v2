import { NextRequest, NextResponse } from 'next/server';
import { createRegistrationTransport } from '@/lib/registerToken';
import { createTokenRecord } from '@/lib/tokenStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RegisterTokenRequest = {
  serial?: string;
  twe?: string;
  twp?: string;
  referralName?: string;
  createShortUrl?: boolean;
};

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(req: NextRequest) {
  let body: RegisterTokenRequest;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const serial = clean(body.serial);
  const twe = clean(body.twe);
  const twp = clean(body.twp);
  const referralName = clean(body.referralName);
  const createShortUrl = body.createShortUrl !== false;

  if (!serial && !twe && !twp) {
    return NextResponse.json({ error: 'serial, twe, or twp is required' }, { status: 400 });
  }

  const transport = createRegistrationTransport({ serial, twe, twp });
  const hasExplicitReferral = Boolean(twp || twe);
  const referralPrefix = twp ? 'TWP' : 'TWE';
  const referralCode = twp || twe || '8937777';
  const shortId = createShortUrl && transport.token
    ? await createTokenRecord('register', {
        clipboardText: transport.clipboardText,
        referralName: referralName || (hasExplicitReferral ? '' : 'Tone Wow HQ'),
        referralId: hasExplicitReferral ? `${referralPrefix}-${referralCode}` : '',
      }, 7 * 24 * 60 * 60)
    : '';

  return NextResponse.json({
    clipboardText: transport.clipboardText,
    token: transport.token || '',
    registerUrl: shortId ? `/register/${shortId}` : '',
    id: shortId,
    isSigned: transport.isSigned,
  });
}
