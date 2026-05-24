import { NextRequest, NextResponse } from 'next/server';
import { createTokenRecord } from '@/lib/tokenStore';
import { createRegistrationTransport } from '@/lib/registerToken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ESIM_SUCCESS_TTL_SECONDS = 180 * 24 * 60 * 60;

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(req: NextRequest) {
  let body: any;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const details = {
    refNo: clean(body?.details?.refNo),
    simSerial: clean(body?.details?.simSerial),
    esimQR: clean(body?.details?.esimQR),
    pin1: clean(body?.details?.pin1),
    puk1: clean(body?.details?.puk1),
    pin2: clean(body?.details?.pin2),
    puk2: clean(body?.details?.puk2),
  };

  if (!details.simSerial && !details.esimQR) {
    return NextResponse.json({ error: 'eSIM details are required' }, { status: 400 });
  }

  const promoter = {
    prefix: clean(body?.promoter?.prefix),
    code: clean(body?.promoter?.code),
    name: clean(body?.promoter?.name),
    email: clean(body?.promoter?.email),
    twpReferenceID: clean(body?.promoter?.twpReferenceID),
    alloReferenceID: clean(body?.promoter?.alloReferenceID),
  };
  const prefix = promoter.prefix.toLowerCase();
  const registrationInput = {
    serial: details.simSerial,
    twe: prefix === 'twe' && promoter.code ? promoter.code : prefix === 'twp' ? '' : '8937777',
    twp: prefix === 'twp' && promoter.code ? promoter.code : '',
  };
  const registrationTransport = createRegistrationTransport(registrationInput);
  const hasExplicitReferral = Boolean(registrationInput.twp || (prefix === 'twe' && promoter.code));
  const referralPrefix = registrationInput.twp ? 'TWP' : 'TWE';
  const referralCode = registrationInput.twp || registrationInput.twe || '8937777';
  const id = await createTokenRecord('esim-success', {
    details,
    promoter,
    registration: {
      clipboardText: registrationTransport.clipboardText,
      referralName: promoter.name || (hasExplicitReferral ? '' : 'Tone Wow HQ'),
      referralId: hasExplicitReferral ? `${referralPrefix}-${referralCode}` : '',
    },
  }, ESIM_SUCCESS_TTL_SECONDS);

  return NextResponse.json({
    id,
    successUrl: `/sim/esim-success/${id}`,
  });
}
