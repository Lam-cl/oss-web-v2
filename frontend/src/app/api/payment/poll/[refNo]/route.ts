import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest, { params }: { params: { refNo: string } }) {
  // Payment polling disabled — no local DB
  return NextResponse.json({ status: 'ok', refNo: params.refNo });
}
