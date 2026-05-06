'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

function ThankYouContent() {
  const searchParams = useSearchParams();
  const orderNumber = searchParams.get('order');

  return (
    <div className="container" style={{ paddingTop: 80, paddingBottom: 80, textAlign: 'center' }}>
      <div style={{ maxWidth: 500, margin: '0 auto' }}>
        <svg fill="none" stroke="#10b981" viewBox="0 0 24 24" style={{ width: 80, height: 80, margin: '0 auto 24px' }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>

        <h1 style={{ marginBottom: 8 }}>Thank You!</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 18, marginBottom: 24 }}>
          Your order has been placed successfully.
        </p>

        {orderNumber && (
          <div style={{
            background: 'var(--bg-alt)', borderRadius: 12, padding: '20px 24px', marginBottom: 32,
          }}>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 4 }}>Order Number</p>
            <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--tw-blue)' }}>{orderNumber}</p>
          </div>
        )}

        <p style={{ color: 'var(--text-secondary)', marginBottom: 32 }}>
          We&apos;ll send a confirmation email with your order details shortly.
        </p>

        <Link href="/" className="btn btn-primary">Continue Shopping</Link>
      </div>
    </div>
  );
}

export default function ThankYouPage() {
  return (
    <Suspense fallback={<div className="container" style={{ padding: '80px 20px', textAlign: 'center' }}>Loading...</div>}>
      <ThankYouContent />
    </Suspense>
  );
}
