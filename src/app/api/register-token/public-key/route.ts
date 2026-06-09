import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizePem(value?: string) {
  return value?.trim().replace(/\\n/g, '\n') || '';
}

export function GET() {
  const publicKey = normalizePem(process.env.REGISTER_TOKEN_PUBLIC_KEY_PEM);

  if (!publicKey) {
    return NextResponse.json(
      { error: 'REGISTER_TOKEN_PUBLIC_KEY_PEM is not configured' },
      { status: 404 },
    );
  }

  return NextResponse.json({
    alg: 'ES256',
    kid: process.env.REGISTER_TOKEN_KEY_ID || 'v1',
    iss: process.env.REGISTER_TOKEN_ISSUER || 'shop.tonewow.com',
    aud: process.env.REGISTER_TOKEN_AUDIENCE || 'com.mywow2.app',
    publicKey,
  });
}
