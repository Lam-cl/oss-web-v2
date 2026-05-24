import { NextResponse } from 'next/server';
import { isDevicesEnabled, isMerchandiseEnabled } from '@/lib/features';

export async function GET() {
  return NextResponse.json({
    showDevices: isDevicesEnabled(),
    showMerchandise: isMerchandiseEnabled(),
    simBasePrice: 19.50,
  });
}

export const dynamic = 'force-static';
