'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

function FailedContent() {
  const searchParams = useSearchParams();
  const orderNumber = searchParams.get('order');
  const reason = searchParams.get('reason');

  return (
    <div className="container" style={{ paddingTop: 80, paddingBottom: 80, textAlign: 'center' }}>
      <div style={{ maxWidth: 500, margin: '0 auto' }}>
        {/* Error icon */}
        <div style={{
          width: 80, height: 80, borderRadius: '50%', background: '#fef2f2',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 24px',
        }}>
          <svg fill="none" stroke="#ef4444" viewBox="0 0 24 24" width="48" height="48">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>

        <h1 style={{ marginBottom: 8, fontSize: 28 }}>Pembayaran Gagal</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 18, marginBottom: 24 }}>
          Maaf, pembayaran anda tidak berjaya diproses.
        </p>

        {reason && (
          <div style={{
            background: '#fef2f2', borderRadius: 12, padding: '16px 24px', marginBottom: 16,
            border: '1px solid #fecaca',
          }}>
            <p style={{ color: '#dc2626', fontSize: 14 }}>{reason}</p>
          </div>
        )}

        {orderNumber && (
          <div style={{
            background: 'var(--bg-alt)', borderRadius: 12, padding: '16px 24px', marginBottom: 24,
          }}>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 4 }}>No. Pesanan</p>
            <p style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' }}>{orderNumber}</p>
          </div>
        )}

        <p style={{ color: 'var(--text-secondary)', marginBottom: 32, lineHeight: 1.6 }}>
          Sila cuba lagi atau hubungi khidmat pelanggan kami jika masalah berterusan.
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/sim/checkout" className="btn btn-blue" style={{ display: 'inline-block', padding: '12px 32px' }}>
            Cuba Lagi
          </Link>
          <Link href="/" className="btn" style={{
            display: 'inline-block', padding: '12px 32px',
            border: '1px solid var(--border)', borderRadius: 50, color: 'var(--text-primary)',
            textDecoration: 'none',
          }}>
            Kembali ke Laman Utama
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function PaymentFailedPage() {
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
      <FailedContent />
    </Suspense>
  );
}
