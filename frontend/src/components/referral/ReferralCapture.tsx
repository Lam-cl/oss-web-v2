'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { verifyPromoter } from '@/lib/api';
import {
  buildMemberID,
  normalizeReferralCode,
  saveReferralContext,
  type ReferralPrefix,
  type StoredReferralContext,
} from '@/lib/referral';

function isReferralPrefix(value: string | null): value is ReferralPrefix {
  return value === 'TWE' || value === 'TWP';
}

function ReferralCaptureInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [captured, setCaptured] = useState<StoredReferralContext | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const prefixRaw = searchParams.get('promoter')?.toUpperCase() || null;
    const rawCode = searchParams.get('code') || '';
    const referenceID = searchParams.get('referenceID') || '';

    if (!isReferralPrefix(prefixRaw) || !rawCode) return;

    const code = normalizeReferralCode(prefixRaw, rawCode);
    if (!code) return;

    const memberID = buildMemberID(prefixRaw, code);

    (async () => {
      setLoading(true);
      setError('');
      const result = await verifyPromoter(memberID);
      if (cancelled) return;

      if (!result.valid) {
        setError(result.error || 'Unable to verify referral.');
        setLoading(false);
        router.replace('/', { scroll: false });
        return;
      }

      const context: StoredReferralContext = {
        prefix: prefixRaw,
        code,
        memberID,
        name: result.name || memberID,
        twpReferenceID: prefixRaw === 'TWP' ? referenceID : '',
        alloReferenceID: prefixRaw === 'TWP' ? referenceID : '',
        capturedAt: Date.now(),
      };
      saveReferralContext(context);
      setCaptured(context);
      setLoading(false);
      router.replace('/', { scroll: false });
    })();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  const close = () => {
    setCaptured(null);
    setError('');
  };

  if (!loading && !captured && !error) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="referral-modal-backdrop referral-capture-backdrop"
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        <motion.div
          className={`referral-capture-card${error && !loading ? ' referral-capture-card--error' : ''}`}
          initial={{ y: 24, opacity: 0, scale: 0.96 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 16, opacity: 0, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        >
          {loading && (
            <div className="referral-capture-content">
              <div className="referral-capture-loader" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <h2>Verifying referral</h2>
              <p className="referral-capture-copy">Please wait while we apply your referral.</p>
            </div>
          )}

          {captured && !loading && (
            <motion.div
              className="referral-capture-content"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, delay: 0.08 }}
            >
              <motion.span
                className="referral-capture-icon"
                initial={{ scale: 0.72, rotate: -5 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 460, damping: 22 }}
                aria-hidden="true"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l7 4v6c0 5-3.5 9-7 10-3.5-1-7-5-7-10V6l7-4z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="m9 12 2 2 4-4" />
                </svg>
              </motion.span>
              <p className="referral-capture-eyebrow">Referral Applied</p>
              <h2>Your Referral is</h2>
              <div className="referral-capture-ref">
                <strong>{captured.name}</strong>
                <span>{captured.memberID}</span>
              </div>
              <p className="referral-capture-copy">This referral will stay with your SIM purchase until another referral link is opened.</p>
              <button className="referral-primary referral-capture-action" onClick={close}>
                Continue
              </button>
            </motion.div>
          )}

          {error && !loading && (
            <motion.div
              className="referral-capture-content"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, delay: 0.08 }}
            >
              <motion.span
                className="referral-capture-icon"
                initial={{ scale: 0.72, rotate: -5 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 460, damping: 22 }}
                aria-hidden="true"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                </svg>
              </motion.span>
              <p className="referral-capture-eyebrow">Referral Not Applied</p>
              <h2>Unable to verify referral</h2>
              <p className="referral-capture-copy">{error}</p>
              <button className="referral-primary referral-capture-action" onClick={close}>
                Okay
              </button>
            </motion.div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default function ReferralCapture() {
  return (
    <Suspense fallback={null}>
      <ReferralCaptureInner />
    </Suspense>
  );
}
