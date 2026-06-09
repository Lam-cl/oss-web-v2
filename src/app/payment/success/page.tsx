'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useEffect } from 'react';
import { useCartStore } from '@/store/cartStore';

function SuccessContent() {
  const searchParams = useSearchParams();
  const orderNumber = searchParams.get('order');
  const paymentRef = searchParams.get('ref');
  const clear = useCartStore((s) => s.clear);

  // Clear cart and localStorage ONLY after confirmed payment success
  useEffect(() => {
    clear();
    localStorage.removeItem('tw_selected_plan');
    localStorage.removeItem('tw_selected_number');
    localStorage.removeItem('tw_pending_order');
  }, [clear]);

  return (
    <div className="container" style={{ paddingTop: 80, paddingBottom: 80, textAlign: 'center' }}>
      <div style={{ maxWidth: 500, margin: '0 auto' }}>
        {/* Success checkmark */}
        <div style={{
          width: 80, height: 80, borderRadius: '50%', background: '#ecfdf5',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 24px',
        }}>
          <svg fill="none" stroke="#10b981" viewBox="0 0 24 24" width="48" height="48">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 style={{ marginBottom: 8, fontSize: 28 }}>Pembayaran Berjaya!</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 18, marginBottom: 24 }}>
          Pesanan anda telah berjaya dibuat dan pembayaran diterima.
        </p>

        {orderNumber && (
          <div style={{
            background: 'var(--bg-alt)', borderRadius: 12, padding: '20px 24px', marginBottom: 16,
          }}>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 4 }}>No. Pesanan</p>
            <p style={{ fontSize: 22, fontWeight: 700, color: 'var(--tw-blue)' }}>{orderNumber}</p>
          </div>
        )}

        {paymentRef && (
          <div style={{
            background: 'var(--bg-alt)', borderRadius: 12, padding: '16px 24px', marginBottom: 24,
          }}>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 4 }}>Rujukan Pembayaran</p>
            <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>{paymentRef}</p>
          </div>
        )}

        <p style={{ color: 'var(--text-secondary)', marginBottom: 32, lineHeight: 1.6 }}>
          Kami akan menghantar emel pengesahan dengan butiran pesanan anda.
          Sila semak emel anda untuk maklumat lanjut.
        </p>

        <Link href="/" className="btn btn-blue" style={{ display: 'inline-block', padding: '12px 32px' }}>
          Teruskan Membeli-belah
        </Link>
      </div>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={
      <div className="container" style={{ padding: '80px 20px', textAlign: 'center' }}>
        <div style={{
          width: 32, height: 32,
          border: '3px solid var(--border)', borderTopColor: 'var(--tw-blue)',
          borderRadius: '50%', animation: 'spin 0.8s linear infinite',
          margin: '0 auto',
        }} />
      </div>
    }>
      <SuccessContent />
    </Suspense>
  );
}
