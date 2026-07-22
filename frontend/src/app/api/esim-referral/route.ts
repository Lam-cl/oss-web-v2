import { NextRequest, NextResponse } from 'next/server';
import { getReferralProfile } from '@/lib/referralProfile';
import { verifyPaymentReferralContext } from '@/lib/paymentReferralContext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAYMENT_STATUS_URL = 'https://www.tonewow.net/tgpayment/getPaymentStatus';

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const refNo = clean(body?.refNo);
    const contextToken = clean(body?.contextToken);
    if (!/^[A-Za-z0-9_-]{6,80}$/.test(refNo)) {
      return NextResponse.json({ error: 'A valid refNo is required' }, { status: 400 });
    }

    let signedContext = null;
    if (contextToken) {
      try {
        signedContext = verifyPaymentReferralContext(contextToken, refNo);
      } catch {
        signedContext = null;
      }
    }

    let paymentResolved = false;
    let referralCode = '';
    try {
      const statusUrl = new URL(PAYMENT_STATUS_URL);
      statusUrl.searchParams.set('refNo', refNo);
      const statusRes = await fetch(statusUrl, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      const statusData = await statusRes.json().catch(() => null);
      const record = statusData?.data?.[0];
      paymentResolved = statusRes.ok && statusData?.systemCode === '0' && Boolean(clean(record?.status));
      referralCode = paymentResolved ? clean(record?.referralCode) : '';
    } catch {
      paymentResolved = false;
    }

    if (signedContext && (!referralCode || referralCode === signedContext.referenceID)) {
      return NextResponse.json({
        resolved: true,
        source: 'signed-context',
        promoter: {
          prefix: signedContext.prefix,
          code: signedContext.code,
          name: signedContext.name,
          twpReferenceID: signedContext.referenceID,
          alloReferenceID: signedContext.referenceID,
        },
      });
    }

    const memberMatch = referralCode.toUpperCase().match(/^(TWE|TWP)-(\d+)$/);
    if (memberMatch) {
      const prefix = memberMatch[1] as 'TWE' | 'TWP';
      const code = memberMatch[2];
      if (prefix === 'TWE' && code === '8937777') {
        return NextResponse.json({ resolved: true, source: 'payment', promoter: null });
      }
      const profile = await getReferralProfile(prefix, code);
      return NextResponse.json({
        resolved: true,
        source: 'payment',
        promoter: { prefix, code, name: profile?.fullName || '' },
      });
    }

    if (referralCode) {
      return NextResponse.json({
        resolved: true,
        source: 'payment-reference',
        promoter: { twpReferenceID: referralCode, alloReferenceID: referralCode },
      });
    }

    return NextResponse.json({ resolved: paymentResolved, source: paymentResolved ? 'payment' : 'unavailable', promoter: null });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unable to resolve referral' }, { status: 500 });
  }
}
