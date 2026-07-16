import { NextRequest } from 'next/server';
import { handlePaymentConfirmation } from '@/lib/paymentConfirmation';

export async function GET(req: NextRequest) {
  return handlePaymentConfirmation(req, 'GET');
}

export async function POST(req: NextRequest) {
  return handlePaymentConfirmation(req, 'POST');
}
