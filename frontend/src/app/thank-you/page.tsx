'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

type Status = 'loading' | 'success' | 'failed' | 'pending';
type EsimDetails = {
  refNo: string;
  simSerial: string;
  esimQR: string;
  pin1: string;
  puk1: string;
  pin2: string;
  puk2: string;
};
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildEsimSuccessUrl(refNo: string, details?: Partial<EsimDetails>) {
  const params = new URLSearchParams();
  if (details?.refNo || refNo) params.set('refno', details?.refNo || refNo);
  if (details?.simSerial) params.set('simserial', details.simSerial);
  if (details?.esimQR) params.set('esimQR', details.esimQR);
  if (details?.pin1) params.set('pin1', details.pin1);
  if (details?.puk1) params.set('puk1', details.puk1);
  if (details?.pin2) params.set('pin2', details.pin2);
  if (details?.puk2) params.set('puk2', details.puk2);
  const query = params.toString();
  return `/sim/esim-success${query ? `?${query}` : ''}`;
}

async function fetchEsimDetails(refNo: string): Promise<EsimDetails | null> {
  for (const endpoint of ['/api/esim-info', '/esim-info']) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refNo }),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ready && data?.details) return data.details as EsimDetails;
    if (res.status !== 404) return null;
  }

  return null;
}

function ThankYouContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const refNo = searchParams.get('refno') || searchParams.get('order') || '';
  const gkashStatus = searchParams.get('status') || '';
  const gkashDesc = searchParams.get('desc') || '';
  const isEsimReturn = searchParams.get('esim') === '1' || searchParams.get('flow') === 'esim';
  const [status, setStatus] = useState<Status>('loading');
  const [esimPreparing, setEsimPreparing] = useState(false);
  const retryPurchase = () => {
    const retryMode = localStorage.getItem('tw_purchase_retry_mode');
    if (retryMode === 'superliteplus' || retryMode === 'superlite') {
      router.push('/sim/purchase');
      return;
    }

    const retryUrl = localStorage.getItem('tw_purchase_retry_url') || '/sim/purchase';
    if (retryUrl.includes('simID=superliteplus')) {
      localStorage.setItem('tw_purchase_retry_mode', 'superliteplus');
      router.push('/sim/purchase');
      return;
    }
    if (retryUrl.includes('simID=superlite')) {
      localStorage.setItem('tw_purchase_retry_mode', 'superlite');
      router.push('/sim/purchase');
      return;
    }
    router.push(retryUrl);
  };

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
    const maxAttempts = 40;

    const retryOrSetPending = () => {
      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(check, 3000);
        return;
      }
      setStatus('pending');
    };

    const check = async () => {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL || '';
        const url = `${apiBase}/api/proxy?url=${encodeURIComponent(`https://www.tonewow.net/tgpayment/getPaymentStatus?refNo=${refNo}`)}`;
        const res = await fetch(url);
        const data = await res.json();

        const paymentRecord = data?.data?.[0];
        const paymentStatus = paymentRecord?.status;
        if (paymentStatus === '2') { setStatus('success'); return; }
        if (paymentRecord && paymentStatus && paymentStatus !== '1') {
          setStatus('failed');
          return;
        }
        retryOrSetPending();
      } catch {
        retryOrSetPending();
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
    let cancelled = false;

    const redirectToEsimSuccess = async () => {
      const knownEsimOrder = isEsimReturn || hasMatchingStoredEsimOrder(refNo);
      const maxAttempts = knownEsimOrder ? 40 : 13;
      const retryDelay = knownEsimOrder ? 3000 : 10000;

      if (knownEsimOrder) setEsimPreparing(true);
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const details = await fetchEsimDetails(refNo);
          if (cancelled) return;
          if (details) {
            try {
              sessionStorage.setItem('tw_esim_details', JSON.stringify(details));
            } catch { /* ignore */ }
            clearEsimOrderMarker();
            router.replace(buildEsimSuccessUrl(refNo, details));
            return;
          }
        } catch { /* retry below */ }

        if (attempt < maxAttempts - 1) await sleep(retryDelay);
        if (cancelled) return;
      }

      if (knownEsimOrder) setEsimPreparing(false);
    };

    redirectToEsimSuccess().catch(() => {
      if (!cancelled) setEsimPreparing(false);
    });

    return () => { cancelled = true; };
  }, [status, refNo, isEsimReturn, router]);

  if (status === 'loading' || esimPreparing) {
    return (
      <div className="container" style={{ paddingTop: 80, paddingBottom: 80, textAlign: 'center' }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <div style={{
            width: 60, height: 60, borderRadius: '50%', border: '4px solid #e2e8f0',
            borderTopColor: '#0074be', animation: 'spin 0.8s linear infinite',
            margin: '0 auto 24px',
          }} />
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1e293b' }}>
            {esimPreparing ? 'Preparing eSIM Details' : 'Verifying Payment'}
          </h2>
          <p style={{ fontSize: 14, color: '#64748b', marginTop: 8 }}>
            {esimPreparing
              ? 'Please wait while we prepare your eSIM QR, PIN, and PUK...'
              : 'Please wait while we confirm your payment...'}
          </p>
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
        <button onClick={retryPurchase} style={{
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
