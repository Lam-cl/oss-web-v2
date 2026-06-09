import { NextRequest, NextResponse } from 'next/server';

type ValidateResponse = {
  dataEntry?: string;
  idvalue?: string;
  [key: string]: unknown;
};

const VALIDATE_BASE_URL = 'https://www.tonewow.net/gwp/api/sim/x6/validate';
const PREFIX_URL = 'https://www.tonewow.net/gwp/api/register/x1/getsimprefix/productcode/TWE';

type PrefixItem = {
  prefix?: string;
  id?: number | string;
};

function getPrefixDigits(value: string) {
  return String(value || '').match(/\d+/)?.[0] || '';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const simserial = String(body?.simserial || '').replace(/\D/g, '');

    if (!simserial) {
      return NextResponse.json({ registered: false, message: 'Unable to verify registration right now. Please try again.' }, { status: 400 });
    }

    const prefixRes = await fetch(PREFIX_URL, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 ToneWow OSS',
      },
      next: { revalidate: 3600 },
    });

    if (!prefixRes.ok) {
      return NextResponse.json(
        { registered: false, message: 'Unable to verify registration right now. Please try again.' },
        { status: 200 },
      );
    }

    const prefixes = ((await prefixRes.json()) as PrefixItem[])
      .map((item) => ({ id: item.id, prefix: getPrefixDigits(String(item.prefix || '')) }))
      .filter((item) => item.id && item.prefix && simserial.startsWith(item.prefix))
      .sort((a, b) => b.prefix.length - a.prefix.length);

    const matched = prefixes[0];
    if (!matched) {
      return NextResponse.json(
        {
          registered: false,
          message: 'Your SIM is not registered yet. Please complete registration in the tone wow 2.0 app first, then come back to install your eSIM.',
        },
        { status: 200 },
      );
    }

    const serialSuffix = simserial.slice(matched.prefix.length);
    const url = `${VALIDATE_BASE_URL}/productcode/TWE/simprefixid/${encodeURIComponent(String(matched.id))}/simserial/${encodeURIComponent(serialSuffix)}/lang/bm`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 ToneWow OSS',
      },
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          registered: false,
          message: 'Your SIM is not registered yet. Please complete registration in the tone wow 2.0 app first, then come back to install your eSIM.',
        },
        { status: 200 },
      );
    }

    const data = (await res.json()) as ValidateResponse;
    const registered = Boolean(String(data.idvalue || '').trim() && String(data.dataEntry || '').trim());

    return NextResponse.json({
      registered,
      message: registered
        ? 'SIM registration verified.'
        : 'Your SIM is not registered yet. Please complete registration in the tone wow 2.0 app first, then come back to install your eSIM.',
    });
  } catch {
    return NextResponse.json(
      { registered: false, message: 'Unable to verify registration right now. Please try again.' },
      { status: 200 },
    );
  }
}
