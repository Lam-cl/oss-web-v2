'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import styles from '../promo.module.css';

type PaymentState = {
  status: 'pending' | 'success' | 'failed';
  payment: {
    reference: string;
    planName: string;
    duration: number;
    monthlyPrice: number;
    amount: number;
  };
};

function money(value: number) {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(value);
}

function ConfirmationContent() {
  const params = useSearchParams();
  const reference = params.get('ref') || '';
  const invalid = params.get('invalid') === '1';
  const [result, setResult] = useState<PaymentState | null>(null);
  const [error, setError] = useState(invalid ? 'This payment reference is invalid or has expired.' : '');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!reference || invalid) return;
    let stopped = false;
    let attempts = 0;
    let timer: number | undefined;
    const check = async () => {
      try {
        const response = await fetch(`/merdeka-promo-api/status?ref=${encodeURIComponent(reference)}`, { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to check this payment.');
        if (stopped) return;
        setResult(data as PaymentState);
        setError('');
        if (data.status === 'pending' && attempts < 39) {
          attempts += 1;
          timer = window.setTimeout(check, 3000);
        }
      } catch (caught) {
        if (stopped) return;
        setError(caught instanceof Error ? caught.message : 'Unable to check this payment.');
      }
    };
    check();
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [reference, invalid, retryKey]);

  const status = error ? 'error' : result?.status || 'pending';
  return (
    <main className={styles.confirmPage}>
      <div className={styles.confirmCard}>
        <div className={`${styles.confirmIcon} ${styles[`confirmIcon_${status}`]}`} aria-hidden="true">
          {status === 'success' ? '✓' : status === 'failed' || status === 'error' ? '×' : <span />}
        </div>
        <span className={styles.confirmEyebrow}>Merdeka Promo</span>
        <h1>{status === 'success' ? 'Payment confirmed' : status === 'failed' ? 'Payment unsuccessful' : status === 'error' ? 'We could not verify this payment' : 'Confirming your payment'}</h1>
        <p>{status === 'success'
          ? 'Your campaign payment has been received. The subscription will be processed by tone wow.'
          : status === 'failed'
            ? 'Your payment was not completed. No campaign payment has been charged.'
            : status === 'error'
              ? error
              : 'This normally takes only a moment. Please keep this page open.'}</p>

        {result?.payment && (
          <div className={styles.confirmSummary}>
            <div><span>FU plan</span><strong>{result.payment.planName}</strong></div>
            <div><span>Campaign period</span><strong>{result.payment.duration} months</strong></div>
            <div><span>One-time payment</span><strong>{money(result.payment.amount)}</strong></div>
            <div><span>Payment reference</span><strong>{result.payment.reference}</strong></div>
          </div>
        )}

        <div className={styles.confirmActions}>
          {(status === 'error' || status === 'failed') && reference && <button type="button" onClick={() => { setError(''); setResult(null); setRetryKey((key) => key + 1); }}>Check again</button>}
          {status === 'failed' && <Link href="/merdeka-promo">Try payment again</Link>}
          {status === 'success' && <Link href="/merdeka-promo">Back to Home</Link>}
        </div>
        {status === 'pending' && <small className={styles.pendingNote}>Do not refresh or close this page while we check your transaction.</small>}
      </div>
    </main>
  );
}

export default function MerdekaPromoConfirmationPage() {
  return <Suspense fallback={<main className={styles.confirmPage}><div className={styles.confirmCard}>Loading…</div></main>}><ConfirmationContent /></Suspense>;
}
