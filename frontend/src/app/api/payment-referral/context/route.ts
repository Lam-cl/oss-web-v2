import { NextRequest, NextResponse } from 'next/server';
import { getReferralProfile } from '@/lib/referralProfile';
import { createPaymentReferralContext } from '@/lib/paymentReferralContext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SAVE_ALLOCATION_URL = 'https://www.tonewow.net/tgpayment/saveRefAllocation';

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const refNo = clean(body?.refNo);
    const memberID = clean(body?.memberID).toUpperCase();
    const memberMatch = memberID.match(/^TWP-(\d+)$/);

    if (!/^[A-Za-z0-9_-]{6,80}$/.test(refNo) || !memberMatch) {
      return NextResponse.json({ error: 'A valid refNo and TWP member ID are required' }, { status: 400 });
    }

    const code = memberMatch[1];
    const profile = await getReferralProfile('TWP', code);
    if (!profile || profile.memberID.toUpperCase() !== memberID) {
      return NextResponse.json({ error: 'TWP member ID could not be verified' }, { status: 400 });
    }

    const allocationUrl = new URL(SAVE_ALLOCATION_URL);
    allocationUrl.searchParams.set('productCode', 'TWP');
    allocationUrl.searchParams.set('promoterID', memberID);
    allocationUrl.searchParams.set('isPBR', '');
    allocationUrl.searchParams.set('isBR', '');
    allocationUrl.searchParams.set('isPSC', '');
    allocationUrl.searchParams.set('isSC', '');

    const allocationRes = await fetch(allocationUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: '{}',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    const allocationData = await allocationRes.json().catch(() => null);
    const referenceID = clean(allocationData?.data?.[0]?.referenceID);

    if (!allocationRes.ok || allocationData?.systemCode !== '1' || !referenceID) {
      return NextResponse.json(
        { error: clean(allocationData?.systemMessage) || 'Unable to generate TWP reference ID' },
        { status: 502 },
      );
    }

    const context = {
      refNo,
      prefix: 'TWP' as const,
      code,
      memberID,
      referenceID,
      name: profile.fullName,
    };
    const token = createPaymentReferralContext(context);
    if (!token) {
      return NextResponse.json({ error: 'Payment referral signing key is not configured' }, { status: 500 });
    }

    return NextResponse.json({ token, referenceID, promoter: context });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Unable to prepare payment referral' },
      { status: 500 },
    );
  }
}
