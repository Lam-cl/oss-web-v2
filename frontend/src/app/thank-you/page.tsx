'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

type Status = 'loading' | 'success' | 'failed' | 'pending';
const ESIM_ORDER_STORAGE_KEY = 'tw_esim_order';
const ESIM_ORDER_COOKIE = 'tw_esim_refno';

function clearEsimOrderMarker() {
  localStorage.removeItem(ESIM_ORDER_STORAGE_KEY);
  sessionStorage.removeItem(ESIM_ORDER_STORAGE_KEY);
  document.cookie = `${ESIM_ORDER_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}

function normalizePaymentRefNo(value: string) {
  return value.replace(/^(16|2|3)(twoss)/i, '$2');
}

function hasMatchingStoredEsimOrder(refNo: string) {
  const normalizedRefNo = normalizePaymentRefNo(refNo);
  const isMatch = (raw: string | null) => {
    if (!raw) return false;
    try {
      const order = JSON.parse(raw) as { refNo?: string; paymentRefNo?: string };
      const storedRefNo = order.refNo || '';
      const storedPaymentRefNo = order.paymentRefNo || '';
      return !storedRefNo
        || storedRefNo === refNo
        || storedPaymentRefNo === refNo
        || normalizePaymentRefNo(storedRefNo) === normalizedRefNo
        || normalizePaymentRefNo(storedPaymentRefNo) === normalizedRefNo;
    } catch {
      return false;
    }
  };

  if (isMatch(localStorage.getItem(ESIM_ORDER_STORAGE_KEY))) return true;
  if (isMatch(sessionStorage.getItem(ESIM_ORDER_STORAGE_KEY))) return true;

  const cookieRefNo = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${ESIM_ORDER_COOKIE}=`))
    ?.split('=')
    .slice(1)
    .join('=');

  if (!cookieRefNo) return false;
  const decodedCookieRefNo = decodeURIComponent(cookieRefNo);
  return decodedCookieRefNo === refNo || normalizePaymentRefNo(decodedCookieRefNo) === normalizedRefNo;
}

function ThankYouContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const refNo = searchParams.get('refno') || searchParams.get('order') || '';
  const gkashStatus = searchParams.get('status') || '';
  const gkashDesc = searchParams.get('desc') || '';
  const isEsimReturn = searchParams.get('esim') === '1' || searchParams.get('flow') === 'esim';
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    if (!refNo && !gkashStatus) { setStatus('failed'); return; }

    // If GKash sent status directly, use it
    if (gkashStatus) {
      const isSuccess = gkashStatus.startsWith('88');
      const isFailed = gkashStatus.startsWith('66') || gkashStatus.startsWith('11') || gkashStatus.startsWith('99');
      setStatus(isSuccess ? 'success' : isFailed ? 'failed' : 'pending');
      return;
    }

    // No GKash status — fallback: poll payment API
    let attempts = 0;
    const maxAttempts = 10;

    const check = async () => {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL || '';
        const url = `${apiBase}/api/proxy?url=${encodeURIComponent(`https://www.tonewow.net/tgpayment/getPaymentStatus?refNo=${refNo}`)}`;
        const res = await fetch(url);
        const data = await res.json();

        const paymentStatus = data?.data?.[0]?.status;
        if (paymentStatus === '2') { setStatus('success'); return; }
        if (paymentStatus === '1' && attempts < maxAttempts) {
          attempts++;
          setTimeout(check, 3000);
          return;
        }
        setStatus(paymentStatus === '1' ? 'pending' : 'failed');
      } catch {
        if (attempts < maxAttempts) { attempts++; setTimeout(check, 3000); return; }
        setStatus('failed');
      }
    };

    setTimeout(check, 3000);
  }, [refNo, gkashStatus]);

  useEffect(() => {
    if (status === 'failed') {
      clearEsimOrderMarker();
      return;
    }
    if (status !== 'success') return;
    try {
      if (isEsimReturn || hasMatchingStoredEsimOrder(refNo)) {
        router.replace(`/sim/esim-success${refNo ? `?refno=${encodeURIComponent(refNo)}` : ''}`);
      }
    } catch {
      clearEsimOrderMarker();
    }
  }, [status, refNo, isEsimReturn, router]);

  if (status === 'loading') {
    return (
      <div className="container" style={{ paddingTop: 80, paddingBottom: 80, textAlign: 'center' }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <div style={{
            width: 60, height: 60, borderRadius: '50%', border: '4px solid #e2e8f0',
            borderTopColor: '#0074be', animation: 'spin 0.8s linear infinite',
            margin: '0 auto 24px',
          }} />
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1e293b' }}>Verifying Payment</h2>
          <p style={{ fontSize: 14, color: '#64748b', marginTop: 8 }}>Please wait while we confirm your payment...</p>
          {refNo && <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 16, fontFamily: 'monospace' }}>Ref: {refNo}</p>}
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="container" style={{ paddingTop: 60, paddingBottom: 80 }}>
        <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%', background: '#dcfce7',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 24px',
          }}>
            <svg width="44" height="44" viewBox="0 0 24 24" fill="#16a34a">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
          </div>
          <h2 style={{ fontSize: 26, fontWeight: 800, color: '#1e293b', margin: '0 0 6px' }}>Payment Successful</h2>
          <p style={{ fontSize: 15, color: '#64748b', margin: '0 0 28px' }}>
            Your payment has been received and is being processed.
          </p>
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
          <button onClick={() => router.push('/')} style={{
            background: 'linear-gradient(135deg, #0074be, #273a89)',
            color: '#fff', border: 'none', borderRadius: 12,
            padding: '14px 36px', fontSize: 15, fontWeight: 700, cursor: 'pointer',
          }}>Back to Home</button>
        </div>
      </div>
    );
  }

  // failed or pending — show real description if available
  return (
    <div className="container" style={{ paddingTop: 60, paddingBottom: 80 }}>
      <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
        <div style={{
          width: 80, height: 80, borderRadius: '50%', background: status === 'pending' ? '#fef3c7' : '#fef2f2',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 24px',
        }}>
          {status === 'pending' ? (
            <svg width="44" height="44" viewBox="0 0 24 24" fill="#f59e0b">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
          ) : (
            <svg width="44" height="44" viewBox="0 0 24 24" fill="#dc2626">
              <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/>
            </svg>
          )}
        </div>
        <h2 style={{ fontSize: 26, fontWeight: 800, color: '#1e293b', margin: '0 0 6px' }}>
          {status === 'pending' ? 'Payment Pending' : 'Payment Failed'}
        </h2>
        {gkashDesc ? (
          <p style={{ fontSize: 15, color: '#64748b', margin: '0 0 20px' }}>{decodeURIComponent(gkashDesc)}</p>
        ) : (
          <p style={{ fontSize: 15, color: '#64748b', margin: '0 0 20px' }}>
            {status === 'pending'
              ? 'Your payment is still being processed. We will notify you once confirmed.'
              : 'Your payment could not be verified. Please try again or contact support.'}
          </p>
        )}
        {refNo && (
          <div style={{
            background: '#fff', border: '2px solid #e2e8f0', borderRadius: 14,
            padding: '20px 24px', marginBottom: 28,
          }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 4px' }}>
              Reference
            </p>
            <p style={{ fontSize: 18, fontWeight: 700, color: '#64748b', fontFamily: 'monospace', margin: 0, wordBreak: 'break-all' }}>
              {refNo}
            </p>
          </div>
        )}
        <button onClick={() => router.push('/sim/purchase')} style={{
          background: 'linear-gradient(135deg, #0074be, #273a89)',
          color: '#fff', border: 'none', borderRadius: 12,
          padding: '14px 36px', fontSize: 15, fontWeight: 700, cursor: 'pointer',
        }}>Try Again</button>
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
