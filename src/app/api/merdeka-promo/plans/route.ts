import { NextResponse } from 'next/server';
import { fetchMerdekaPlans } from '@/lib/merdekaPromo';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const plans = await fetchMerdekaPlans();
    if (plans.length !== 5) throw new Error('Eligible plans are incomplete.');
    return NextResponse.json({ plans }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to load plans right now.',
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
