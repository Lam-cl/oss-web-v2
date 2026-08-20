import { NextRequest, NextResponse } from 'next/server';
import {
  calculateMerdekaPrice,
  createMerdekaReference,
  fetchMerdekaMember,
  fetchMerdekaPlans,
  isMerdekaDuration,
  normalizeMsisdn,
  writeMerdekaPayment,
  type MerdekaPaymentRecord,
} from '@/lib/merdekaPromo';
import { merdekaPublicOrigin, merdekaSameOrigin } from '../shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAYMENT_ID = '16';
// const GATEWAY_URL = process.env.MERDEKA_PROMO_GATEWAY_URL || 'https://qa.tonegroup.net/gkashwebservice/osspay.jsp';
const GATEWAY_URL = process.env.MERDEKA_PROMO_GATEWAY_URL || 'https://qa.tonegroup.net/gkashwebservice/osspayMerdeka2026.jsp';

function text(value: unknown, max = 160) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export async function POST(request: NextRequest) {
  if (!merdekaSameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });

  try {
    const body = await request.json().catch(() => ({}));
    const duration = Number(body?.duration);
    if (!isMerdekaDuration(duration)) return NextResponse.json({ error: 'Select a valid subscription package.' }, { status: 422 });
    if (body?.acknowledged !== true) return NextResponse.json({ error: 'Please acknowledge the subscription notice.' }, { status: 422 });

    const msisdn = normalizeMsisdn(body?.msisdn);
    if (!msisdn) return NextResponse.json({ error: 'Verify a valid tone wow number first.' }, { status: 422 });

    const [member, plans] = await Promise.all([fetchMerdekaMember(msisdn), fetchMerdekaPlans()]);
    const plan = plans.find((item) => item.id === text(body?.planId, 40));
    if (!plan) return NextResponse.json({ error: 'The selected FU plan is no longer available.' }, { status: 422 });

    const fullName = text(body?.fullName) || member.fullName;
    const documentId = text(body?.documentId, 40) || member.documentId;
    const email = text(body?.email, 180).toLowerCase();
    const phone = normalizeMsisdn(body?.phone) || member.phone;
    const address1 = text(body?.address1);
    const address2 = text(body?.address2);
    const address3 = text(body?.address3);
    const postcode = text(body?.postcode, 5);
    const city = text(body?.city, 80);
    const state = text(body?.state, 80);
    if (!fullName || !documentId || !/^\S+@\S+\.\S+$/.test(email) || !phone || !address1 || !/^\d{5}$/.test(postcode) || !city || !state) {
      return NextResponse.json({ error: 'Complete all required customer and billing details.' }, { status: 422 });
    }

    const amount = calculateMerdekaPrice(plan.monthlyPrice, duration);
    const refNo = createMerdekaReference();
    const paymentRefNo = `${PAYMENT_ID}${refNo}`;
    const record: MerdekaPaymentRecord = {
      refNo,
      paymentRefNo,
      memberId: member.memberId,
      msisdn,
      customerName: fullName,
      email,
      planId: plan.id,
      planName: plan.name,
      duration,
      monthlyPrice: plan.monthlyPrice,
      amount,
      createdAt: new Date().toISOString(),
    };
    await writeMerdekaPayment(record);

    const origin = merdekaPublicOrigin(request);
    const confirmationUrl = new URL('/merdeka-promo-api/confirmation', origin);
    confirmationUrl.searchParams.set('refno', paymentRefNo);
    const total = amount.toFixed(2);
    const params = new URLSearchParams({
      transactionType: 'OSSPayment',
      documentID: documentId,
      paymentId: PAYMENT_ID,
      extraCharges: '0',
      refNo,
      prodDesc: 'PromoMerdeka',
      username: fullName,
      email,
      contact: phone,
      recurringType: String(duration),
      total,
      address1,
      address2,
      address3,
      postcode,
      city,
      state,
      planid: '0',
      subTotal: total,
      lang: 'EN',
      amount: total,
      memberId: member.memberId,
      shippingFee: '0',
      selectedMsisdn: msisdn,
      dataPlanID: plan.id,
      returnurl: confirmationUrl.toString(),
      callbackurl: confirmationUrl.toString(),
      failureurl: confirmationUrl.toString(),
    });

    return NextResponse.json({ paymentUrl: `${GATEWAY_URL}?${params.toString()}`, reference: paymentRefNo });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to prepare payment. Please try again.',
    }, { status: 503 });
  }
}
