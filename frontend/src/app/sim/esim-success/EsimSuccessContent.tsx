'use client';

import { useState, useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { QRCodeCanvas } from 'qrcode.react';
import { detectDeviceType, openToneWowAppWithRegistration, type DeviceType } from '@/app/register/appLauncher';

type EsimDetails = {
  refNo: string;
  simSerial: string;
  esimQR: string;
  pin1: string;
  puk1: string;
  pin2: string;
  puk2: string;
};

type EsimPromoterSession = {
  prefix?: string;
  code?: string;
  name?: string;
  email?: string;
  twpReferenceID?: string;
  alloReferenceID?: string;
};

type ReferralDisplay = {
  label: string;
  copyValue: string;
  canCopy: boolean;
};

type EsimSuccessPageProps = {
  initialTokenId?: string;
};

type ReferralResolution = {
  resolved: boolean;
  promoter: EsimPromoterSession | null;
};

type ReferralLoadStatus = 'checking' | 'ready' | 'error';

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveOrderReferral(refNo: string, contextToken: string): Promise<ReferralResolution> {
  if (!refNo) return { resolved: false, promoter: null };

  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch('/api/esim-referral', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refNo, contextToken }),
        cache: 'no-store',
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.resolved === true) {
        return { resolved: true, promoter: data.promoter || null };
      }
    } catch {
      // Retry transient network and upstream failures below.
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < 2) await wait((attempt + 1) * 1500);
  }

  return { resolved: false, promoter: null };
}

function selectResolvedPromoter(
  resolution: ReferralResolution,
  fallback: EsimPromoterSession | null,
): EsimPromoterSession | null {
  if (!resolution.resolved) return fallback;
  if (!resolution.promoter) return null;

  const recoveredReference = resolution.promoter.twpReferenceID?.trim() || '';
  const fallbackReference = fallback?.twpReferenceID?.trim() || '';
  if (!resolution.promoter.prefix && fallback?.prefix && recoveredReference && recoveredReference === fallbackReference) {
    return { ...fallback, ...resolution.promoter };
  }

  return resolution.promoter;
}

export function EsimSuccessContent({ initialTokenId = '' }: EsimSuccessPageProps) {
  const barcodeRef = useRef<SVGSVGElement | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedPin, setCopiedPin] = useState(false);
  const [copiedPuk, setCopiedPuk] = useState(false);
  const [copiedReferral, setCopiedReferral] = useState(false);
  const [animDone, setAnimDone] = useState(false);
  const [installChecking, setInstallChecking] = useState(false);
  const [installMessage, setInstallMessage] = useState('');
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerMessage, setRegisterMessage] = useState('');
  const [successTokenId, setSuccessTokenId] = useState('');
  const [registrationClipboardText, setRegistrationClipboardText] = useState('');
  const [deviceType, setDeviceType] = useState<DeviceType>('other');
  const [promoter, setPromoter] = useState<EsimPromoterSession | null>(null);
  const [referralStatus, setReferralStatus] = useState<ReferralLoadStatus>('checking');
  const [referralError, setReferralError] = useState('');
  const [referralRetryKey, setReferralRetryKey] = useState(0);
  const [details, setDetails] = useState<EsimDetails>({
    refNo: '',
    simSerial: '',
    esimQR: '',
    pin1: '',
    puk1: '',
    pin2: '',
    puk2: '',
  });

  const { simSerial, esimQR, pin1, puk1 } = details;

  useEffect(() => {
    setDeviceType(detectDeviceType());

    const readStoredPromoter = () => {
      try {
        const raw = localStorage.getItem('tw_esim_promoter');
        return raw ? JSON.parse(raw) as EsimPromoterSession : null;
      } catch {
        return null;
      }
    };

    const readParams = (source: string) => {
      const qs = source.includes('?') ? source.slice(source.indexOf('?') + 1) : source;
      const params = new URLSearchParams(qs);
      return {
        refNo: params.get('refno') || '',
        simSerial: params.get('simserial') || '',
        esimQR: params.get('esimQR') || '',
        pin1: params.get('pin1') || '',
        puk1: params.get('puk1') || '',
        pin2: params.get('pin2') || '',
        puk2: params.get('puk2') || '',
      };
    };

    const loadDetails = async () => {
      setReferralStatus('checking');
      setReferralError('');
      const storedPromoter = readStoredPromoter();

      const params = new URLSearchParams(window.location.search);
      const successToken = initialTokenId || params.get('id')?.trim() || params.get('token')?.trim();
      const referralContext = params.get('refctx')?.trim() || '';

      if (successToken) {
        setSuccessTokenId(successToken);
        try {
          const res = await fetch(`/esim-success-token/resolve?token=${encodeURIComponent(successToken)}`);
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.details) throw new Error(data?.error || 'Unable to load saved eSIM details.');
          const tokenDetails = data.details as EsimDetails;
          const tokenPromoter = data.promoter as EsimPromoterSession | null;
          const resolution = await resolveOrderReferral(tokenDetails.refNo, referralContext);
          const hasTrustedTokenReferral = Boolean(
            (tokenPromoter?.prefix?.trim() && tokenPromoter?.code?.trim())
            || tokenPromoter?.twpReferenceID?.trim()
            || tokenPromoter?.alloReferenceID?.trim(),
          );
          if (!resolution.resolved && !hasTrustedTokenReferral) {
            setReferralError('We could not verify the referral for this order. Please try again.');
            setReferralStatus('error');
            return;
          }
          const resolvedPromoter = selectResolvedPromoter(resolution, tokenPromoter || storedPromoter);
          setDetails(tokenDetails);
          setPromoter(resolvedPromoter);
          if (!resolution.resolved && data.registration?.clipboardText) {
            setRegistrationClipboardText(data.registration.clipboardText);
          }
          try {
            sessionStorage.setItem('tw_esim_details', JSON.stringify(data.details));
          } catch { /* ignore */ }
          setReferralStatus('ready');
        } catch (error: any) {
          setInstallMessage(error?.message || 'Unable to load saved eSIM details.');
          setReferralError(error?.message || 'Unable to load saved eSIM details.');
          setReferralStatus('error');
        }
        return;
      }

      const urlDetails = readParams(window.location.href);
      const hasUrlDetails = Boolean(urlDetails.simSerial || urlDetails.esimQR || urlDetails.pin1 || urlDetails.puk1 || urlDetails.pin2 || urlDetails.puk2);
      let nextDetails = urlDetails;

      if (!hasUrlDetails) {
        try {
          const stored = sessionStorage.getItem('tw_esim_details');
          if (stored) nextDetails = JSON.parse(stored) as EsimDetails;
        } catch { /* ignore */ }
      }

      setDetails(nextDetails);
      const resolution = await resolveOrderReferral(nextDetails.refNo, referralContext);
      if (!resolution.resolved) {
        setReferralError(nextDetails.refNo
          ? 'We could not verify the referral for this order. Please try again.'
          : 'The payment reference is missing. Please reopen the confirmation link from your payment receipt.');
        setReferralStatus('error');
        return;
      }
      const resolvedPromoter = selectResolvedPromoter(resolution, storedPromoter);
      setPromoter(resolvedPromoter);
      setReferralStatus('ready');

      if (hasUrlDetails) {
        try {
          sessionStorage.setItem('tw_esim_details', JSON.stringify(nextDetails));
        } catch { /* ignore */ }

        try {
          const res = await fetch('/esim-success-token/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ details: nextDetails, promoter: resolvedPromoter }),
          });
          const data = await res.json().catch(() => null);
          if (data?.id) setSuccessTokenId(data.id);
          const cleanUrl = data?.successUrl || `${window.location.origin}/sim/esim-success`;
          window.history.replaceState({}, document.title, cleanUrl);
        } catch {
          // Keep the original query details when durable short-token storage is unavailable.
        }
      }
    };

    loadDetails();
    const animationTimer = setTimeout(() => setAnimDone(true), 800);
    return () => clearTimeout(animationTimer);
  }, [initialTokenId, referralRetryKey]);

  useEffect(() => {
    if (referralStatus !== 'ready' || !barcodeRef.current || !simSerial) return;
    try {
      JsBarcode(barcodeRef.current, simSerial, {
        format: 'CODE128',
        displayValue: false,
        margin: 0,
        width: 1.5,
        height: 58,
      });
    } catch {
      // Keep the serial visible even if barcode rendering fails.
    }
  }, [simSerial, referralStatus]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const legacyDetails = {
      refNo: params.get('refno') || '',
      simSerial: params.get('simserial') || '',
      esimQR: params.get('esimQR') || '',
      pin1: params.get('pin1') || '',
      puk1: params.get('puk1') || '',
      pin2: params.get('pin2') || '',
      puk2: params.get('puk2') || '',
      };
      if (legacyDetails.simSerial || legacyDetails.esimQR) setDetails(legacyDetails);
    } catch { /* ignore */ }
  }, []);

  const copyEID = async () => {
    if (!simSerial) return;
    try {
      await navigator.clipboard.writeText(simSerial.replace(/\s/g, ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard not supported */ }
  };

  const copyPIN = async () => {
    if (!pin1) return;
    try {
      await navigator.clipboard.writeText(pin1.replace(/\s/g, ''));
      setCopiedPin(true);
      setTimeout(() => setCopiedPin(false), 2000);
    } catch { /* clipboard not supported */ }
  };

  const copyPUK = async () => {
    if (!puk1) return;
    try {
      await navigator.clipboard.writeText(puk1.replace(/\s/g, ''));
      setCopiedPuk(true);
      setTimeout(() => setCopiedPuk(false), 2000);
    } catch { /* clipboard not supported */ }
  };

  const getReferralDisplay = (): ReferralDisplay => {
    const prefix = promoter?.prefix?.trim().toUpperCase() || '';
    const code = promoter?.code?.trim() || '';
    const twpReferenceID = promoter?.twpReferenceID?.trim() || '';
    const alloReferenceID = promoter?.alloReferenceID?.trim() || '';

    if (prefix && code) {
      const referralId = `${prefix}-${code}`;
      return { label: referralId, copyValue: referralId, canCopy: true };
    }

    if (twpReferenceID) {
      return { label: `TWP Reference ID: ${twpReferenceID}`, copyValue: twpReferenceID, canCopy: true };
    }

    if (alloReferenceID) {
      return { label: `Reference ID: ${alloReferenceID}`, copyValue: alloReferenceID, canCopy: true };
    }

    return { label: 'Tone Wow HQ', copyValue: '', canCopy: false };
  };

  const referralDisplay = getReferralDisplay();

  const copyReferral = async () => {
    if (!referralDisplay.canCopy) return;
    try {
      await navigator.clipboard.writeText(referralDisplay.copyValue);
      setCopiedReferral(true);
      setTimeout(() => setCopiedReferral(false), 2000);
    } catch { /* clipboard not supported */ }
  };

  const validateEsimRegistration = async () => {
    if (!simSerial) {
      setInstallMessage('eSIM installation details are not available. Please check your email for a copy of your eSIM details.');
      return false;
    }

    setInstallChecking(true);
    setInstallMessage('');
    setShowInstallGuide(false);
    try {
      const res = await fetch('/esim-install/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simserial: simSerial }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || 'Unable to verify registration right now. Please try again.');
      }
      if (!data?.registered) {
        setInstallMessage(data?.message || 'Your SIM is not registered yet. Please complete registration in the tone wow 2.0 app first, then come back to install your eSIM.');
        return false;
      }

      setShowInstallGuide(true);
      return true;
    } catch (error: any) {
      setInstallMessage(error?.message || 'Unable to verify registration right now. Please try again.');
      return false;
    } finally {
      setInstallChecking(false);
    }
  };

  const installEsimOnIphone = async () => {
    if (!esimQR) {
      setInstallMessage('eSIM installation details are not available. Please check your email for a copy of your eSIM details.');
      return;
    }
    const valid = await validateEsimRegistration();
    if (valid) {
      window.location.href = `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(esimQR)}`;
    }
  };

  const downloadQrCode = () => {
    const canvas = qrCanvasRef.current;
    if (!canvas) {
      setInstallMessage('QR code is not available. Please check your email for a copy of your eSIM details.');
      return;
    }
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `tonewow-esim-qr-${serialDigits || 'details'}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const registerPrefix = promoter?.prefix?.trim().toLowerCase() || '';
  const registerCode = promoter?.code?.trim() || '';

  const serialDigits = simSerial.replace(/\D/g, '');
  const groupedSerial = serialDigits ? serialDigits.replace(/(.{4})/g, '$1 ').trim() : 'SIM serial not available';
  const isDetailsPending = !simSerial && !esimQR;

  const openRegisterToken = async () => {
    setRegisterLoading(true);
    setRegisterMessage('');

    try {
      if (registrationClipboardText) {
        await openToneWowAppWithRegistration(registrationClipboardText, deviceType);
        setRegisterLoading(false);
        return;
      }

      const body: { serial?: string; twe?: string; twp?: string; referralName?: string; createShortUrl: boolean } = { createShortUrl: false };
      if (simSerial) body.serial = simSerial;
      if (promoter?.name) body.referralName = promoter.name;
      if (registerPrefix === 'twp' && registerCode) body.twp = registerCode;
      else if (registerPrefix === 'twe' && registerCode) body.twe = registerCode;
      else body.twe = '8937777';

      const res = await fetch('/register-token/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.clipboardText) {
        throw new Error(data?.error || 'Unable to prepare registration token. Please try again.');
      }

      setRegistrationClipboardText(data.clipboardText);
      await openToneWowAppWithRegistration(data.clipboardText, deviceType);
      setRegisterLoading(false);
    } catch (err: any) {
      setRegisterMessage(err?.message || 'Unable to prepare registration token. Please try again.');
      setRegisterLoading(false);
    }
  };

  const renderCopyIcon = (active: boolean) => active ? (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
  ) : (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
  );

  if (referralStatus === 'checking') {
    return (
      <div className="container" style={{ minHeight: '68vh', display: 'grid', placeItems: 'center', padding: '72px 20px' }}>
        <div style={{ textAlign: 'center', maxWidth: 420 }} role="status" aria-live="polite">
          <div style={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            border: '4px solid #dbeafe',
            borderTopColor: '#0074be',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto 20px',
          }} />
          <h2 style={{ margin: '0 0 8px', color: '#172554', fontSize: 21, fontWeight: 800 }}>Verifying your referral</h2>
          <p style={{ margin: 0, color: '#64748b', fontSize: 14, lineHeight: 1.6 }}>Please wait while we securely confirm your order details.</p>
        </div>
      </div>
    );
  }

  if (referralStatus === 'error') {
    return (
      <div className="container" style={{ minHeight: '68vh', display: 'grid', placeItems: 'center', padding: '72px 20px' }}>
        <div style={{ textAlign: 'center', maxWidth: 440 }} role="alert">
          <div style={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            background: '#fff7ed',
            color: '#c2410c',
            fontSize: 28,
            fontWeight: 800,
            margin: '0 auto 20px',
          }}>!</div>
          <h2 style={{ margin: '0 0 8px', color: '#172554', fontSize: 21, fontWeight: 800 }}>Unable to verify referral</h2>
          <p style={{ margin: '0 0 22px', color: '#64748b', fontSize: 14, lineHeight: 1.6 }}>{referralError}</p>
          <button
            type="button"
            onClick={() => setReferralRetryKey((value) => value + 1)}
            style={{ border: 0, borderRadius: 6, background: '#0074be', color: '#fff', padding: '11px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="container" style={{ paddingTop: 48, paddingBottom: 60 }}>
        <div className="esim-success-page">
          <div className="esim-success-card">
            <section className="esim-activate-panel">
              <div>
                <h2 className="esim-success-title">Activate your line</h2>
                <p className="esim-success-sub">Download the tone wow 2.0 app to register your eSIM.</p>
              </div>

              <img src="/images/tonewow-app.png" alt="tone wow 2.0 app" className="esim-app-art" />

              <button type="button" onClick={openRegisterToken} disabled={registerLoading} className="esim-register-cta">
                  <img src="/images/tonewow-app.png" alt="tone wow app" className="esim-register-icon" />
                  <div>
                    <strong>{registerLoading ? 'Preparing secure registration...' : 'Get the tone wow 2.0 App'}</strong><br />
                    <span>Download & Register Now</span>
                  </div>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M7 17L17 7M17 7H7m10 0v10"/></svg>
              </button>
              {registerMessage && <p style={{ margin: '10px 0 0', color: '#b91c1c', fontSize: 13 }}>{registerMessage}</p>}
            </section>

            <section className="esim-details-panel">
              <div className="esim-details-header">
                <div className={`esim-check-circle${animDone ? ' esim-check-done' : ''}`}>
                  <svg width="38" height="38" viewBox="0 0 24 24" fill="#0f8f4d"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                </div>
                <div>
                  <h3>Enter these details during App Registration</h3>
                  <p>During App Registration</p>
                </div>
              </div>

              <div className="esim-email-note">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#075985" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4L12 13 2 4"/></svg>
                <span>
                  {isDetailsPending ? (
                    <>Your eSIM details are still being prepared. Please refresh this page shortly or check your email for a copy.</>
                  ) : promoter?.email ? (
                    <>We have also sent a copy of your eSIM details to <strong>{promoter.email}</strong>. Please check your inbox.</>
                  ) : (
                    <>Please check your email for a copy of your eSIM details. Keep it safe for future reference.</>
                  )}
                </span>
              </div>

              <div className="esim-details-card">
                <div className="esim-details-card-header">
                  <span className="esim-details-card-check" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
                  </span>
                  <div>
                    <h4>eSIM Details</h4>
                    <p>Keep these details for registration</p>
                  </div>
                </div>

                <div className="esim-details-field">
                  <label>ICCID / SIM Serial</label>
                  <div className="esim-details-pill esim-details-serial-pill">
                    <strong>{groupedSerial}</strong>
                    {simSerial && <button onClick={copyEID} className="esim-copy-btn esim-detail-copy" title="Copy ICCID / SIM Serial">{renderCopyIcon(copied)}</button>}
                  </div>
                </div>

                <div className="esim-details-field">
                  <label>Barcode</label>
                  <div className="esim-details-barcode-box">
                    {simSerial ? (
                      <svg ref={barcodeRef} aria-label="Scannable ICCID barcode" />
                    ) : (
                      <div className="esim-sim-barcode-empty">Barcode not available</div>
                    )}
                    <div className="esim-details-barcode-text">{groupedSerial}</div>
                  </div>
                </div>

                <div className="esim-details-code-grid">
                  <div className="esim-details-field">
                    <label>PIN</label>
                    <div className="esim-details-pill">
                      <strong>{pin1 || (isDetailsPending ? 'Pending' : '0000')}</strong>
                      {pin1 && <button onClick={copyPIN} className="esim-copy-btn esim-detail-copy" title="Copy PIN">{renderCopyIcon(copiedPin)}</button>}
                    </div>
                  </div>
                  <div className="esim-details-field">
                    <label>PUK</label>
                    <div className="esim-details-pill">
                      <strong>{puk1 || (isDetailsPending ? 'Pending' : '00000000')}</strong>
                      {puk1 && <button onClick={copyPUK} className="esim-copy-btn esim-detail-copy" title="Copy PUK">{renderCopyIcon(copiedPuk)}</button>}
                    </div>
                  </div>
                </div>
              </div>

              <div className="esim-referral-info">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                <span>Referral ID: <strong>{referralDisplay.label}</strong></span>
                {referralDisplay.canCopy && (
                  <button onClick={copyReferral} className="esim-copy-btn esim-referral-copy" title="Copy Referral ID">
                    {renderCopyIcon(copiedReferral)}
                  </button>
                )}
              </div>

              {esimQR && (
                <div className="esim-qr-expand-card is-open">
                  <div className="esim-qr-static-header">
                    <strong>eSIM QR Code</strong>
                    <small>Use this after successful registration in the tone wow 2.0 app.</small>
                  </div>
                    <div className="esim-qr-expand-body">
                      <QRCodeCanvas ref={qrCanvasRef} value={esimQR} size={168} level="H" includeMargin />
                      <p>After successful registration in the tone wow 2.0 app, scan this QR code to install your eSIM.</p>
                      <button type="button" className="esim-download-link" onClick={downloadQrCode}>
                        Download QR Code
                      </button>
                      <button
                        type="button"
                        className="esim-install-button"
                        onClick={validateEsimRegistration}
                        disabled={installChecking || !simSerial}
                      >
                        {installChecking ? 'Checking registration...' : 'How to Install'}
                      </button>
                      {showInstallGuide && (
                        <div className="esim-install-guide-panel">
                          <div className="esim-install-guide-item">
                            <strong>iPhone</strong>
                            <p>Go to Settings &gt; Cellular / Mobile Data &gt; Add eSIM &gt; Use QR Code, then scan the QR code above.</p>
                            {esimQR && (
                              <button type="button" className="esim-install-direct-link" onClick={installEsimOnIphone}>
                                Install directly on iPhone
                              </button>
                            )}
                          </div>
                          <div className="esim-install-guide-item">
                            <strong>Android</strong>
                            <p>Go to Settings &gt; Network &amp; Internet / Connections &gt; SIM Manager &gt; Add eSIM, then scan the QR code above.</p>
                          </div>
                        </div>
                      )}
                      {deviceType !== 'ios' && !showInstallGuide && (
                        <span className="esim-install-note">
                          {deviceType === 'android'
                            ? 'Android setup may differ by phone model. Use the guide after registration is verified.'
                            : 'Open this page on your phone or download the QR code for installation.'}
                        </span>
                      )}
                    </div>
                </div>
              )}
            </section>
          </div>

          {installMessage && (
            <div className="esim-install-dialog" role="alertdialog" aria-modal="true" aria-labelledby="esim-install-dialog-title">
              <div className="esim-install-dialog-card">
                <h3 id="esim-install-dialog-title">Registration required</h3>
                <p>{installMessage}</p>
                <button type="button" onClick={() => setInstallMessage('')}>OK</button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
