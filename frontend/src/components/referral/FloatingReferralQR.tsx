'use client';

import { useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { QRCodeCanvas } from 'qrcode.react';
import { verifyPromoter, verifyTWPMemberReferral, type TWPMemberReferralFields } from '@/lib/api';

type PromoterType = 'TWE' | 'TWP';
type FieldState = true | false | null;

const TWP_FIELD_LABELS: Record<keyof TWPMemberReferralFields, string> = {
  pbrMemberID: 'Premium Branch Promoter ID (Optional)',
  brMemberID: 'Branch Promoter ID (Optional)',
  pscMemberID: 'Premium Service Center Promoter ID (Optional)',
  scMemberID: 'Service Center Promoter ID (Optional)',
  memberID: 'Promoter ID *',
};

const EMPTY_TWP_FIELDS: TWPMemberReferralFields = {
  pbrMemberID: '',
  brMemberID: '',
  pscMemberID: '',
  scMemberID: '',
  memberID: '',
};

const EMPTY_TWP_STATUS: Record<keyof TWPMemberReferralFields, FieldState> = {
  pbrMemberID: null,
  brMemberID: null,
  pscMemberID: null,
  scMemberID: null,
  memberID: null,
};

function normalizeId(prefix: PromoterType, value: string) {
  const digits = value.replace(prefix, '').replace('-', '').replace(/\D/g, '');
  return digits ? `${prefix}-${digits}` : '';
}

export default function FloatingReferralQR() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<PromoterType>('TWE');
  const [tweId, setTweId] = useState('');
  const [tweValid, setTweValid] = useState<FieldState>(null);
  const [tweMessage, setTweMessage] = useState('');
  const [twpFields, setTwpFields] = useState<TWPMemberReferralFields>(EMPTY_TWP_FIELDS);
  const [twpStatus, setTwpStatus] = useState<Record<keyof TWPMemberReferralFields, FieldState>>(EMPTY_TWP_STATUS);
  const [referenceID, setReferenceID] = useState('');
  const [showAdvancedTwp, setShowAdvancedTwp] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const qrUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const origin = window.location.origin;
    if (type === 'TWE' && tweValid && tweId) return `${origin}/ms?promoterID=${encodeURIComponent(tweId)}`;
    if (type === 'TWP' && referenceID) return `${origin}/ms?referenceID=${encodeURIComponent(referenceID)}`;
    return '';
  }, [type, tweValid, tweId, referenceID]);

  const resetForm = (nextType = type) => {
    setTweId('');
    setTweValid(null);
    setTweMessage('');
    setTwpFields(EMPTY_TWP_FIELDS);
    setTwpStatus(EMPTY_TWP_STATUS);
    setReferenceID('');
    setShowAdvancedTwp(false);
    setError('');
    setLoading(false);
    setType(nextType);
  };

  const updateTwpField = (key: keyof TWPMemberReferralFields, value: string) => {
    setTwpFields(current => ({ ...current, [key]: normalizeId('TWP', value) }));
    setTwpStatus(current => ({ ...current, [key]: null }));
    setReferenceID('');
    setError('');
  };

  const verifyTWE = async () => {
    if (!tweId) {
      setTweValid(false);
      setTweMessage('Please enter a Promoter ID.');
      return;
    }
    setLoading(true);
    setError('');
    setTweMessage('');
    const result = await verifyPromoter(tweId);
    if (result.valid) {
      setTweValid(true);
      setTweMessage(result.name || tweId);
    } else {
      setTweValid(false);
      setTweMessage(result.error || 'Promoter not found');
    }
    setLoading(false);
  };

  const verifyTWP = async () => {
    if (!twpFields.memberID.trim()) {
      setError('Please fill in the Promoter ID field.');
      setTwpStatus(current => ({ ...current, memberID: false }));
      return;
    }
    setLoading(true);
    setError('');
    setReferenceID('');
    const result = await verifyTWPMemberReferral(twpFields);
    if (result.valid && result.referenceID) {
      setReferenceID(result.referenceID);
      setTwpStatus({
        pbrMemberID: true,
        brMemberID: true,
        pscMemberID: true,
        scMemberID: true,
        memberID: true,
      });
    } else {
      const message = result.message || 'Invalid promoter ID(s). Please check and re-enter.';
      setError(message);
      const lower = message.toLowerCase();
      setTwpStatus({
        pbrMemberID: lower.includes('premium branch') ? false : null,
        brMemberID: lower.includes('branch') && !lower.includes('premium') ? false : null,
        pscMemberID: lower.includes('premium service center') ? false : null,
        scMemberID: lower.includes('service center') && !lower.includes('premium') ? false : null,
        memberID: lower.includes('promoter id') || lower.includes('promoterid') || lower.includes('member id') || lower.includes('memberid') ? false : null,
      });
    }
    setLoading(false);
  };

  const copyLink = async () => {
    if (!qrUrl) return;
    await navigator.clipboard.writeText(qrUrl);
  };

  const downloadQR = () => {
    const canvas = document.getElementById('referral-qr-code') as HTMLCanvasElement | null;
    if (!canvas) return;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = type === 'TWE' ? `qr-code-${tweId}.png` : `twp-qr-code-${referenceID}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (pathname === '/sim/purchase') return null;

  return (
    <>
      <motion.div
        className="referral-floating-widget"
        initial={{ y: 18, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        <motion.button
          className="referral-floating-button"
          onClick={() => setOpen(true)}
          aria-label="Generate Promoter QR"
          whileHover={{ y: -2, scale: 1.02 }}
          whileTap={{ scale: 0.96 }}
        >
          <span className="referral-floating-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm11 1h1m4 0h-2m2 4h-5m0-2h1" />
            </svg>
          </span>
          <span className="referral-floating-copy">Refer a Friend</span>
        </motion.button>
      </motion.div>

      <AnimatePresence>
        {open && (
          <motion.div
            className="referral-modal-backdrop"
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onMouseDown={() => setOpen(false)}
          >
          <motion.div
            className="referral-modal"
            initial={{ y: 24, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 16, opacity: 0, scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 360, damping: 32 }}
            onMouseDown={event => event.stopPropagation()}
          >
            <div className="referral-modal-head">
              <span className="referral-head-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm11 1h1m4 0h-2m2 4h-5m0-2h1" />
                </svg>
              </span>
              <div>
                <h2>Create Promoter QR</h2>
                <p>{type === 'TWE' ? 'Generate a QR link for a TWE promoter.' : 'Generate a referral QR link for a TWP promoter.'}</p>
              </div>
              <button className="referral-close" onClick={() => setOpen(false)} aria-label="Close">
                <span aria-hidden="true">x</span>
              </button>
            </div>

            <div className="referral-type-group" aria-label="Promoter type">
              {(['TWE', 'TWP'] as PromoterType[]).map(option => (
                <button
                  key={option}
                  type="button"
                  className={`referral-type-option${type === option ? ' active' : ''}`}
                  onClick={() => resetForm(option)}
                >
                  <strong>{option}</strong>
                </button>
              ))}
            </div>

            <div className="referral-sheet-body">
              <div className="referral-form-panel">
                {type === 'TWE' ? (
                  <>
                    <label className="referral-label">
                      <span>Promoter ID</span>
                      <div className="referral-prefixed-input">
                        <span>TWE-</span>
                        <input
                          value={tweId.replace('TWE-', '')}
                          onChange={event => {
                            setTweId(normalizeId('TWE', event.target.value));
                            setTweValid(null);
                            setTweMessage('');
                          }}
                          placeholder="XXXXX"
                        />
                        {tweValid === true && <b className="referral-ok">OK</b>}
                        {tweValid === false && <b className="referral-bad">x</b>}
                      </div>
                    </label>
                    {tweMessage && <p className={tweValid ? 'referral-success-text' : 'referral-error-text'}>{tweMessage}</p>}
                      <button className="referral-primary" onClick={verifyTWE} disabled={loading}>
                        {loading && <span className="referral-spinner" aria-hidden="true" />}
                        {loading ? 'Checking...' : 'Generate QR'}
                      </button>
                  </>
                ) : (
                  <>
                    <label className="referral-label">
                      <span className="referral-required">{TWP_FIELD_LABELS.memberID}</span>
                      <div className="referral-prefixed-input">
                        <span>TWP-</span>
                        <input
                          value={twpFields.memberID.replace('TWP-', '')}
                          onChange={event => updateTwpField('memberID', event.target.value)}
                          placeholder="XXXXXX"
                        />
                        {twpStatus.memberID === true && <b className="referral-ok">OK</b>}
                        {twpStatus.memberID === false && <b className="referral-bad">x</b>}
                      </div>
                    </label>

                    <button
                      className="referral-advanced-toggle"
                      type="button"
                      onClick={() => setShowAdvancedTwp(current => !current)}
                    >
                      Advanced referral allocation
                      <span>{showAdvancedTwp ? '-' : '+'}</span>
                    </button>

                    <AnimatePresence initial={false}>
                      {showAdvancedTwp && (
                        <motion.div
                          className="referral-twp-fields"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                        >
                      {(['pbrMemberID', 'brMemberID', 'pscMemberID', 'scMemberID'] as Array<keyof TWPMemberReferralFields>).map(key => (
                        <label key={key} className="referral-label">
                          <span>{TWP_FIELD_LABELS[key]}</span>
                          <div className="referral-prefixed-input">
                            <span>TWP-</span>
                            <input
                              value={twpFields[key].replace('TWP-', '')}
                              onChange={event => updateTwpField(key, event.target.value)}
                              placeholder="XXXXXX"
                            />
                            {twpStatus[key] === true && <b className="referral-ok">OK</b>}
                            {twpStatus[key] === false && <b className="referral-bad">x</b>}
                          </div>
                        </label>
                      ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                    {error && <p className="referral-error-box">{error}</p>}
                    <div className="referral-actions">
                      <button className="referral-primary" onClick={verifyTWP} disabled={loading}>
                        {loading && <span className="referral-spinner" aria-hidden="true" />}
                        {loading ? 'Checking...' : 'Generate QR'}
                      </button>
                      <button className="referral-reset-action" onClick={() => resetForm(type)} disabled={loading}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 0 1 15.3-6.4L21 8m0 0V3m0 5h-5M21 12a9 9 0 0 1-15.3 6.4L3 16m0 0v5m0-5h5" />
                        </svg>
                        Reset
                      </button>
                    </div>
                  </>
                )}
              </div>

              <AnimatePresence>
                {qrUrl ? (
                  <motion.div
                    className="referral-qr-panel"
                    initial={{ opacity: 0, y: 14, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <div className="referral-qr-box">
                      <QRCodeCanvas id="referral-qr-code" value={qrUrl} size={180} level="H" includeMargin />
                    </div>
                    {type === 'TWP' && referenceID && (
                      <div className="referral-reference">
                        <span>Reference ID:</span>
                        <strong>{referenceID}</strong>
                      </div>
                    )}
                    <button className="referral-link" onClick={copyLink} title="Click to copy">{qrUrl}</button>
                    <button className="referral-primary referral-download" onClick={downloadQR}>Download QR Code</button>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
