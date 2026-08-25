'use client';

import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import {
  getMatchingAdxPurchase,
  normalizeAdxPaymentRef,
  trackAdxPaymentOutcome,
  trackAdxPurchase,
} from '@/lib/adxPurchaseTracking';

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

const MERCHANDISE_REFERENCE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function storedMerchandiseReference(refNo: string) {
  if (!refNo) return '';

  try {
    const raw = localStorage.getItem('tw_pending_merchandise_order');
    if (!raw) return '';
    const stored = JSON.parse(raw) as {
      referenceNumber?: string;
      paymentReference?: string;
      storedAt?: number;
    };
    const referenceNumber = String(stored.referenceNumber || '').trim();
    const paymentReference = String(stored.paymentReference || '').trim();
    const storedAt = Number(stored.storedAt);
    if (!referenceNumber || !Number.isFinite(storedAt)
      || Date.now() - storedAt > MERCHANDISE_REFERENCE_MAX_AGE) return '';

    const normalizedRef = normalizeAdxPaymentRef(refNo);
    const matchesCallback = paymentReference
      && normalizeAdxPaymentRef(paymentReference) === normalizedRef;
    const matchesReference = normalizeAdxPaymentRef(referenceNumber) === normalizedRef;
    return matchesCallback || matchesReference ? referenceNumber : '';
  } catch {
    return '';
  }
}

function clearEsimOrderMarker() {
  try { localStorage.removeItem('tw_esim_order'); } catch { /* storage may be disabled */ }
  try { sessionStorage.removeItem('tw_esim_order'); } catch { /* storage may be disabled */ }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasMatchingStoredEsimOrder(refNo: string) {
  let raw: string | null = null;
  try { raw = localStorage.getItem('tw_esim_order'); } catch { /* storage may be disabled */ }
  if (!raw) return false;

  try {
    const order = JSON.parse(raw) as { refNo?: string; paymentRefNo?: string };
    const normalizedRef = normalizeAdxPaymentRef(refNo);
    return !order.refNo
      || normalizeAdxPaymentRef(order.refNo) === normalizedRef
      || normalizeAdxPaymentRef(order.paymentRefNo || '') === normalizedRef;
  } catch {
    return false;
  }
}

async function fetchEsimDetails(refNo: string): Promise<EsimDetails | null> {
  for (const endpoint of ['/esim-info', '/api/esim-info']) {
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

function buildEsimSuccessUrl(refNo: string, details: EsimDetails, referralContext: string, isAdx: boolean) {
  const params = new URLSearchParams({ refno: details.refNo || refNo });
  if (details.simSerial) params.set('simserial', details.simSerial);
  if (details.esimQR) params.set('esimQR', details.esimQR);
  if (details.pin1) params.set('pin1', details.pin1);
  if (details.puk1) params.set('puk1', details.puk1);
  if (details.pin2) params.set('pin2', details.pin2);
  if (details.puk2) params.set('puk2', details.puk2);
  if (referralContext) params.set('refctx', referralContext);
  return `${isAdx ? '/adx/esim-success' : '/sim/esim-success'}?${params.toString()}`;
}

function ThankYouContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const isAdx = pathname.startsWith('/adx/');
  const refNo = searchParams.get('refno') || searchParams.get('order') || '';
  const gkashStatus = searchParams.get('status') || '';
  const gkashDesc = searchParams.get('desc') || '';
  const isEsimReturn = searchParams.get('esim') === '1' || searchParams.get('flow') === 'esim';
  const referralContext = searchParams.get('refctx') || '';
  const [status, setStatus] = useState<Status>('loading');
  const [esimPreparing, setEsimPreparing] = useState(false);
  const [paymentCheckKey, setPaymentCheckKey] = useState(0);
  const [merchandiseReference, setMerchandiseReference] = useState('');

  useEffect(() => {
    if (isAdx || isEsimReturn) {
      setMerchandiseReference('');
      return;
    }
    setMerchandiseReference(storedMerchandiseReference(refNo));
  }, [isAdx, isEsimReturn, refNo]);

  const referencesMatch = Boolean(
    merchandiseReference
    && normalizeAdxPaymentRef(merchandiseReference) === normalizeAdxPaymentRef(refNo),
  );

  const checkPaymentAgain = () => {
    setStatus('loading');
    setPaymentCheckKey((key) => key + 1);
  };

  useEffect(() => {
    if (isAdx || !refNo) return;
    const metadata = getMatchingAdxPurchase(refNo);
    if (!metadata) return;

    const params = new URLSearchParams(searchParams.toString());
    if (metadata.simType === 'esim') params.set('esim', '1');
    router.replace(`/adx/thank-you?${params.toString()}`);
  }, [isAdx, refNo, router, searchParams]);

  useEffect(() => {
    if (!refNo && !gkashStatus) { setStatus('failed'); return; }

    // If GKash sent status directly, use it
    if (gkashStatus && paymentCheckKey === 0) {
      const isSuccess = gkashStatus.startsWith('88');
      const isFailed = gkashStatus.startsWith('66') || gkashStatus.startsWith('11') || gkashStatus.startsWith('99');
      setStatus(isSuccess ? 'success' : isFailed ? 'failed' : 'pending');
      return;
    }

    // No GKash status — fallback: poll payment API
    let attempts = 0;
    let cancelled = false;
    let retryTimer: number | undefined;
    const maxAttempts = 40;

    const retryOrSetPending = () => {
      if (cancelled) return;
      attempts++;
      if (attempts < maxAttempts) {
        retryTimer = window.setTimeout(check, 3000);
        return;
      }
      setStatus('pending');
    };

    const check = async () => {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL || '';
        const url = `${apiBase}/api/proxy?url=${encodeURIComponent(`https://www.tonewow.net/tgpayment/getPaymentStatus?refNo=${refNo}`)}`;
        const res = await fetch(url, { cache: 'no-store' });
        const data = await res.json();
        if (cancelled) return;

        const paymentStatus = data?.data?.[0]?.status;
        if (paymentStatus === '2') { setStatus('success'); return; }
        retryOrSetPending();
      } catch {
        retryOrSetPending();
      }
    };

    retryTimer = window.setTimeout(check, 3000);
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [refNo, gkashStatus, paymentCheckKey]);

  useEffect(() => {
    if (!isAdx || status !== 'success' || !refNo) return;

    let attempts = 0;
    let retryTimer: number | undefined;
    const sendPurchase = () => {
      const result = trackAdxPurchase(refNo);
      if (result !== 'not-ready' || attempts >= 20) return;
      attempts++;
      retryTimer = window.setTimeout(sendPurchase, 500);
    };

    sendPurchase();
    return () => {
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [isAdx, status, refNo]);

  useEffect(() => {
    if (!isAdx || !refNo || (status !== 'failed' && status !== 'pending')) return;

    let attempts = 0;
    let retryTimer: number | undefined;
    const sendOutcome = () => {
      const result = trackAdxPaymentOutcome(refNo, status);
      if (result !== 'not-ready' || attempts >= 20) return;
      attempts++;
      retryTimer = window.setTimeout(sendOutcome, 500);
    };

    sendOutcome();
    return () => {
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [isAdx, status, refNo]);

  useEffect(() => {
    if (status === 'failed') {
      clearEsimOrderMarker();
      return;
    }
    if (status !== 'success') return;
    if (!isAdx && getMatchingAdxPurchase(refNo)) return;

    const knownEsimOrder = isEsimReturn || hasMatchingStoredEsimOrder(refNo);
    if (!knownEsimOrder) return;

    let cancelled = false;
    const prepareEsimDetails = async () => {
      setEsimPreparing(true);
      for (let attempt = 0; attempt < 40; attempt++) {
        try {
          const details = await fetchEsimDetails(refNo);
          if (cancelled) return;
          if (details) {
            try { sessionStorage.setItem('tw_esim_details', JSON.stringify(details)); } catch { /* storage may be disabled */ }
            clearEsimOrderMarker();
            router.replace(buildEsimSuccessUrl(refNo, details, referralContext, isAdx));
            return;
          }
        } catch {
          // The upstream eSIM record can take time to become available.
        }

        if (attempt < 39) await sleep(3000);
        if (cancelled) return;
      }

      setEsimPreparing(false);
    };

    prepareEsimDetails().catch(() => {
      if (!cancelled) setEsimPreparing(false);
    });
    return () => { cancelled = true; };
  }, [status, refNo, router, isAdx, isEsimReturn, referralContext]);

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
          {(refNo || merchandiseReference) && (
            <div style={{
              background: '#fff', border: '2px solid #0074be', borderRadius: 14,
              padding: '20px 24px', marginBottom: 28,
            }}>
              {refNo && <><p style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 4px' }}>
                {referencesMatch ? 'Reference Number' : 'Payment Reference'}
              </p><p style={{ fontSize: 18, fontWeight: 700, color: '#0074be', fontFamily: 'monospace', margin: 0, wordBreak: 'break-all' }}>
                {refNo}
              </p></>}
              {merchandiseReference && !referencesMatch && <><p style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, margin: refNo ? '16px 0 4px' : '0 0 4px' }}>
                Reference Number
              </p><p style={{ fontSize: 18, fontWeight: 700, color: '#0074be', fontFamily: 'monospace', margin: 0, wordBreak: 'break-all' }}>
                {merchandiseReference}
              </p></>}
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
        {(refNo || merchandiseReference) && (
          <div style={{
            background: '#fff', border: '2px solid #e2e8f0', borderRadius: 14,
            padding: '20px 24px', marginBottom: 28,
          }}>
            {refNo && <><p style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 4px' }}>
              {referencesMatch ? 'Reference Number' : 'Payment Reference'}
            </p><p style={{ fontSize: 18, fontWeight: 700, color: '#64748b', fontFamily: 'monospace', margin: 0, wordBreak: 'break-all' }}>
              {refNo}
            </p></>}
            {merchandiseReference && !referencesMatch && <><p style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, margin: refNo ? '16px 0 4px' : '0 0 4px' }}>
              Reference Number
            </p><p style={{ fontSize: 18, fontWeight: 700, color: '#64748b', fontFamily: 'monospace', margin: 0, wordBreak: 'break-all' }}>
              {merchandiseReference}
            </p></>}
          </div>
        )}
        <button
          onClick={status === 'pending' && isAdx ? checkPaymentAgain : () => router.push('/sim/purchase')}
          style={{
          background: 'linear-gradient(135deg, #0074be, #273a89)',
          color: '#fff', border: 'none', borderRadius: 12,
          padding: '14px 36px', fontSize: 15, fontWeight: 700, cursor: 'pointer',
        }}
        >
          {status === 'pending' && isAdx ? 'Check Again' : 'Try Again'}
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
