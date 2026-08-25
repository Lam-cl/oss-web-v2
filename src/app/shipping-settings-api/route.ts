import { NextResponse } from 'next/server';
import { readShippingSettings } from '@/lib/shippingSettings.server';
export const dynamic = 'force-dynamic';
export async function GET() { return NextResponse.json(await readShippingSettings(), { headers: { 'cache-control': 'no-store' } }); }
