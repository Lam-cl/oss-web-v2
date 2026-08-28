import { NextRequest, NextResponse } from 'next/server';
import { fetchMerdekaPlans } from '@/lib/merdekaPromo';
import { merdekaCors, merdekaPreflight } from '../shared';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const plans = await fetchMerdekaPlans();
    if (plans.length !== 5) throw new Error('Eligible plans are incomplete.');
    return merdekaCors(request, NextResponse.json({ plans }, { headers: { 'Cache-Control': 'no-store' } }));
  } catch (error) {
    return merdekaCors(request, NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to load plans right now.',
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } }));
  }
}

export async function OPTIONS(request: NextRequest) { return merdekaPreflight(request, 'GET, OPTIONS'); }
