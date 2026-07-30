import { NextRequest, NextResponse } from 'next/server';

const ESIM_INFO_URL = 'https://www.tonegroup.net/gkashwebservice/getEsimInfo';

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const refNo = clean(body?.refNo || body?.refno);

    if (!refNo) {
      return NextResponse.json({ success: false, ready: false, error: 'refNo is required' }, { status: 400 });
    }

    const res = await fetch(ESIM_INFO_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: 'https://www.tonegroup.net/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: new URLSearchParams({ refNo }).toString(),
      cache: 'no-store',
    });

    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      return NextResponse.json(
        { success: false, ready: false, error: 'getEsimInfo returned a non-JSON response', status: res.status },
        { status: res.ok ? 502 : res.status },
      );
    }

    const rawDetails = data?.data || {};
    const details = {
      refNo: clean(rawDetails.refNo) || refNo,
      simSerial: clean(rawDetails.simserial || rawDetails.simSerial),
      esimQR: clean(rawDetails.esimQR),
      pin1: clean(rawDetails.pin1),
      puk1: clean(rawDetails.puk1),
      pin2: clean(rawDetails.pin2),
      puk2: clean(rawDetails.puk2),
    };

    return NextResponse.json({
      success: res.ok && data?.systemCode === '1',
      ready: Boolean(details.simSerial || details.esimQR),
      details,
      systemCode: clean(data?.systemCode),
      systemMessage: clean(data?.systemMessage),
    }, { status: res.ok ? 200 : res.status });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, ready: false, error: error?.message || 'Unable to fetch eSIM details' },
      { status: 500 },
    );
  }
}
