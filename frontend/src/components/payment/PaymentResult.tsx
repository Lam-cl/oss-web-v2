'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  PAYMENT_POLL_END_SECONDS,
  PAYMENT_POLL_INTERVAL_SECONDS,
  PAYMENT_POLL_START_SECONDS,
  paymentResultUrl,
  readPendingPayment,
  type PaymentStatus,
} from '@/lib/paymentProcessing';

const MERCHANDISE_REFERENCE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function normalizeReference(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase();
}

function readReferenceNumber(orderNumber?: string | null, paymentRef?: string | null) {
  try {
    const raw = localStorage.getItem('tw_pending_merchandise_order');
    if (!raw) return '';
    const stored = JSON.parse(raw) as { orderId?: string; referenceNumber?: string; paymentReference?: string; storedAt?: number };
    const referenceNumber = String(stored.referenceNumber || '').trim();
    const storedAt = Number(stored.storedAt);
    if (!referenceNumber || !Number.isFinite(storedAt)
      || Date.now() - storedAt > MERCHANDISE_REFERENCE_MAX_AGE) return '';
    const matchesOrder = orderNumber && normalizeReference(stored.orderId) === normalizeReference(orderNumber);
    const matchesPayment = paymentRef && [stored.paymentReference, referenceNumber]
      .some((value) => normalizeReference(value) === normalizeReference(paymentRef));
    return matchesOrder || matchesPayment ? referenceNumber : '';
  } catch {
    return '';
  }
}

export default function PaymentResult({
  status,
  orderNumber,
  paymentRef,
  reason,
  processing: processingPage = false,
}: {
  status:'success'|'failed';
  orderNumber?: string | null;
  paymentRef?: string | null;
  reason?: string | null;
  processing?: boolean;
}) {
  const success = status === 'success';
  const processing = !success && processingPage;
  const resultHref=success?'/':'/checkout';
  const [referenceNumber, setReferenceNumber] = useState('');
  const [processingMessage, setProcessingMessage] = useState('Sila tunggu sementara kami menyemak status pembayaran anda.');

  useEffect(() => {
    if (processing) return;
    const storedReference = readReferenceNumber(orderNumber, paymentRef);
    if (storedReference) {
      setReferenceNumber(storedReference);
      return;
    }
    if (!orderNumber || !/^\d+$/.test(orderNumber)) return;
    const controller = new AbortController();
    fetch(`/bundle/payment-reference?orderId=${encodeURIComponent(orderNumber)}`, { cache: 'no-store', signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => {
        const serverReference = String(result?.referenceNumber || '').trim();
        if (serverReference) setReferenceNumber(serverReference);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [orderNumber, paymentRef, processing]);

  useEffect(() => {
    if (!processing) return;
    let pending;
    try {
      pending = readPendingPayment(localStorage.getItem('tw_pending_merchandise_order'));
    } catch {
      pending = { error: 'missing' as const };
    }
    if ('error' in pending) {
      setProcessingMessage(pending.error === 'expired'
        ? 'Rujukan pembayaran ini telah tamat tempoh. Hubungi sokongan dengan bukti pembayaran anda.'
        : 'Rujukan pembayaran tidak ditemui. Hubungi sokongan dengan bukti pembayaran anda.');
      return;
    }

    setReferenceNumber(pending.referenceNumber);
    const startedAt = Date.now();
    let nextAt = PAYMENT_POLL_START_SECONDS;
    let cancelled = false;
    let timer: number | undefined;

    const schedule = () => {
      if (cancelled) return;
      if (nextAt > PAYMENT_POLL_END_SECONDS) {
        setProcessingMessage('Pengesahan masih belum tersedia. Status tidak ditandakan gagal; hubungi sokongan jika bayaran telah ditolak.');
        return;
      }
      const target = nextAt;
      nextAt += PAYMENT_POLL_INTERVAL_SECONDS;
      timer = window.setTimeout(check, Math.max(0, target * 1000 - (Date.now() - startedAt)));
    };
    const check = async () => {
      try {
        const params = new URLSearchParams({ orderId: pending.orderId, referenceNumber: pending.referenceNumber });
        const response = await fetch(`/bundle/payment-status?${params}`, { cache: 'no-store' });
        const result = response.ok ? await response.json() as PaymentStatus : null;
        if (cancelled) return;
        const redirect = result ? paymentResultUrl(result) : '';
        if (redirect) {
          window.location.replace(redirect);
          return;
        }
      } catch { /* unavailable remains processing */ }
      schedule();
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [processing]);

  const accent = processing ? '#f59e0b' : success ? '#16a34a' : '#dc2626';
  return (
    <div className="container" style={{ paddingTop: 60, paddingBottom: 80 }}>
      <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ width: 80, height: 80, borderRadius: '50%', background: processing ? '#fef3c7' : success ? '#dcfce7' : '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
          {processing ? (
            <div aria-label="Memproses pembayaran" style={{ width: 40, height: 40, border: '4px solid #fde68a', borderTopColor: accent, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          ) : (
            <svg width="44" height="44" viewBox="0 0 24 24" fill={accent} aria-hidden="true">
              <path d={success ? 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z' : 'M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z'} />
            </svg>
          )}
        </div>
        <h2 style={{ fontSize: 26, fontWeight: 800, color: '#1e293b', margin: '0 0 6px' }}>
          {processing ? 'Payment sedang disahkan' : success ? 'Payment Successful' : 'Payment Failed'}
        </h2>
        <p aria-live="polite" style={{ fontSize: 15, color: '#64748b', margin: '0 0 24px' }}>
          {processing ? processingMessage : success
            ? 'Your payment has been received and your order is being processed.'
            : reason || 'Your payment could not be completed. Your cart has been kept so you can try again.'}
        </p>
        {referenceNumber && (
          <div style={{ background: '#fff', border: `2px solid ${success ? '#0074be' : '#e2e8f0'}`, borderRadius: 14, padding: '20px 24px', marginBottom: 28 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 4px' }}>Payment Reference</p>
            <p style={{ fontSize: 18, fontWeight: 700, color: success ? '#0074be' : '#64748b', fontFamily: 'monospace', margin: 0, wordBreak: 'break-all' }}>{referenceNumber}</p>
          </div>
        )}
        {!processing && <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href={resultHref} className="btn btn-blue" style={{ display: 'inline-block', padding: '14px 36px' }}>{success ? 'Back to Home' : 'Try Again'}</Link>
          {!success && <Link href="/" className="btn" style={{ display: 'inline-block', padding: '14px 30px', border: '1px solid var(--border)', borderRadius: 50, color: 'var(--text-primary)', textDecoration: 'none' }}>Back to Home</Link>}
        </div>}
      </div>
    </div>
  );
}
