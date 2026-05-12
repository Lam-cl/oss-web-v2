'use client';

import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { Suspense } from 'react';

function ThankYouContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const refNo = searchParams.get('refno') || searchParams.get('order') || '';

  return (
    <div className="container" style={{ paddingTop: 60, paddingBottom: 80 }}>
      <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
        {/* Success animation */}
        <div style={{
          width: 80, height: 80, borderRadius: '50%', background: '#dcfce7',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 24px',
        }}>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="#16a34a">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
        </div>

        <h2 style={{ fontSize: 26, fontWeight: 800, color: '#1e293b', margin: '0 0 6px' }}>
          Payment Successful
        </h2>
        <p style={{ fontSize: 15, color: '#64748b', margin: '0 0 28px' }}>
          Your payment has been received and is being processed.
        </p>

        {/* Reference Card */}
        {refNo && (
          <div style={{
            background: '#fff', border: '2px solid #0074be', borderRadius: 14,
            padding: '20px 24px', marginBottom: 28,
          }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 4px' }}>
              Payment Reference
            </p>
            <p style={{ fontSize: 18, fontWeight: 700, color: '#0074be', fontFamily: 'monospace', margin: 0, wordBreak: 'break-all' }}>
              {refNo}
            </p>
          </div>
        )}

        <p style={{ fontSize: 14, color: '#94a3b8', marginBottom: 28 }}>
          A confirmation email will be sent shortly.
        </p>

        <button
          onClick={() => router.push('/')}
          style={{
            background: 'linear-gradient(135deg, #0074be, #273a89)',
            color: '#fff', border: 'none', borderRadius: 12,
            padding: '14px 36px', fontSize: 15, fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Back to Home
        </button>
      </div>
    </div>
  );
}

export default function ThankYouPage() {
  return (
    <Suspense fallback={<div className="container" style={{ padding: '80px 20px', textAlign: 'center' }}>
      <p style={{ color: '#64748b' }}>Loading...</p>
    </div>}>
      <ThankYouContent />
    </Suspense>
  );
}
