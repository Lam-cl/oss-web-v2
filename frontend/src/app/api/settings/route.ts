import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    showDevices: false,
    showMerchandise: false,
    simBasePrice: 19.50,
  });
}

export const dynamic = 'force-static';
