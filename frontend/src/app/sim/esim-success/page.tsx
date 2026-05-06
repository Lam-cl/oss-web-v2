'use client';

import { useState, useEffect } from 'react';
import HeroCarousel from '@/components/home/HeroCarousel';
import { getBanners } from '@/lib/api';
import type { Banner } from '@/types';

const EID = '8903 3010 2412 3456 7890';
const PIN = '1234';
const PUK = '8765 4321';

const FALLBACK_BANNERS: Banner[] = [
  { id: 1, title: 'Banner 1', desktop_image: '/images/banners/banner1-desktop.jpg', mobile_image: '/images/banners/banner1-mobile.jpg', sort_order: 1 },
  { id: 2, title: 'Banner 2', desktop_image: '/images/banners/banner2-desktop.jpg', mobile_image: '/images/banners/banner2-mobile.jpg', sort_order: 2 },
  { id: 3, title: 'Banner 3', desktop_image: '/images/banners/banner3-desktop.jpg', mobile_image: '/images/banners/banner3-mobile.jpg', sort_order: 3 },
];

type DeviceTab = 'iphone' | 'samsung' | 'huawei';

const DEVICE_STEPS: Record<DeviceTab, { title: string; steps: string[] }> = {
  iphone: {
    title: 'iPhone',
    steps: [
      'Go to <strong>Settings</strong> &gt; <strong>Cellular</strong> &gt; <strong>Add eSIM</strong>',
      'Tap <strong>"Use QR Code"</strong> and scan the QR code above',
      'Label your eSIM (e.g. "tone wow")',
      'Set as default line for <strong>Cellular Data</strong>',
    ],
  },
  samsung: {
    title: 'Samsung',
    steps: [
      'Go to <strong>Settings</strong> &gt; <strong>Connections</strong> &gt; <strong>SIM Manager</strong>',
      'Tap <strong>"Add eSIM"</strong> &gt; <strong>"Scan QR code"</strong>',
      'Scan the QR code above and follow on-screen prompts',
      'Choose <strong>"Primary"</strong> for mobile data',
    ],
  },
  huawei: {
    title: 'Huawei',
    steps: [
      'Go to <strong>Settings</strong> &gt; <strong>Mobile Network</strong> &gt; <strong>eSIM</strong>',
      'Tap <strong>"Add"</strong> and scan the QR code',
      'Name your eSIM profile (e.g. "tone wow")',
      'Enable <strong>"Mobile Data"</strong> for this SIM',
    ],
  },
};

export default function EsimSuccessPage() {
  const [deviceTab, setDeviceTab] = useState<DeviceTab>('iphone');
  const [copied, setCopied] = useState(false);
  const [copiedPin, setCopiedPin] = useState(false);
  const [copiedPuk, setCopiedPuk] = useState(false);
  const [animDone, setAnimDone] = useState(false);
  const [promoter, setPromoter] = useState<{ prefix: string; code: string; email: string } | null>(null);
  const [banners, setBanners] = useState<Banner[]>(FALLBACK_BANNERS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('tw_esim_promoter');
      if (raw) setPromoter(JSON.parse(raw));
    } catch { /* ignore */ }
    setTimeout(() => setAnimDone(true), 800);

    getBanners().then(data => {
      if (data && data.length > 0) setBanners(data);
    }).catch(() => {});
  }, []);

  const copyEID = async () => {
    try {
      await navigator.clipboard.writeText(EID.replace(/\s/g, ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard not supported */ }
  };

  const copyPIN = async () => {
    try {
      await navigator.clipboard.writeText(PIN.replace(/\s/g, ''));
      setCopiedPin(true);
      setTimeout(() => setCopiedPin(false), 2000);
    } catch { /* clipboard not supported */ }
  };

  const copyPUK = async () => {
    try {
      await navigator.clipboard.writeText(PUK.replace(/\s/g, ''));
      setCopiedPuk(true);
      setTimeout(() => setCopiedPuk(false), 2000);
    } catch { /* clipboard not supported */ }
  };

  const downloadQR = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 200, 200);
    ctx.fillStyle = '#1e293b';
    const s = 12, m = 16;
    [2,2,2,2,2, 8,8, 10,10, 12,12, 14,14, 16,16, 16,16, 16,16].forEach((x, i) => {
      ctx.fillRect(m + i * (s + 2), m, s, 160);
      if (x > 2) ctx.fillRect(m + i * (s + 2), m + 80, s, 10);
    });
    ctx.fillStyle = '#fff';
    ctx.fillRect(70, 70, 60, 60);
    ctx.fillStyle = '#0074be';
    ctx.beginPath();
    ctx.arc(100, 100, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('tw', 100, 106);

    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'tonewow-esim-qr.png';
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  const registerUrl = promoter?.code
    ? `https://www.tonewow.com/register/?${promoter.prefix.toLowerCase()}=${promoter.code}`
    : 'https://www.tonewow.com/register/?twe=8937777';

  return (
    <div className="has-hero">
      <HeroCarousel banners={banners} />
      <div className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
        <div className="esim-success-page">

          {/* Painted blobs — behind card */}
          <div className="esim-blob esim-blob--1" />
          <div className="esim-blob esim-blob--2" />
          <div className="esim-blob esim-blob--3" />
          <div className="esim-blob esim-blob--4" />
          <div className="esim-blob esim-blob--5" />

        <div className="esim-success-card">

          {/* Animated checkmark */}
          <div className={`esim-check-circle${animDone ? ' esim-check-done' : ''}`}>
            <svg width="44" height="44" viewBox="0 0 24 24" fill="#16a34a"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
            <span className="esim-spark esim-spark-1">✦</span>
            <span className="esim-spark esim-spark-2">✦</span>
            <span className="esim-spark esim-spark-3">✦</span>
            <span className="esim-spark esim-spark-4">✦</span>
          </div>

          <h2 className="esim-success-title">Activate your e-SIM</h2>
          <p className="esim-success-sub">Scan the QR code below to install your eSIM.</p>

          {/* QR + Barcode */}
          <div className="esim-qr-card">
            <div className="esim-qr-placeholder" style={{ cursor: 'pointer' }} onClick={downloadQR}>
              <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.2">
                <rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/>
                <rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="4" height="4"/><rect x="19" y="13" width="2" height="4"/><rect x="13" y="19" width="4" height="2"/><rect x="19" y="19" width="2" height="2"/>
              </svg>
            </div>
            <div className="esim-qr-dl">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Tap to download QR</span>
            </div>
            <div className="esim-barcode-placeholder">
              <svg width="120" height="32" viewBox="0 0 120 32" fill="none" stroke="#1e293b" strokeWidth="2" strokeLinecap="round">
                <line x1="2" y1="2" x2="2" y2="30"/><line x1="6" y1="2" x2="6" y2="30"/><line x1="10" y1="2" x2="10" y2="30"/>
                <line x1="16" y1="2" x2="16" y2="30"/><line x1="22" y1="2" x2="22" y2="30"/>
                <line x1="28" y1="2" x2="28" y2="30"/><line x1="32" y1="2" x2="32" y2="30"/><line x1="36" y1="2" x2="36" y2="30"/>
                <line x1="42" y1="2" x2="42" y2="30"/><line x1="48" y1="2" x2="48" y2="30"/>
                <line x1="54" y1="2" x2="54" y2="30"/><line x1="58" y1="2" x2="58" y2="30"/><line x1="62" y1="2" x2="62" y2="30"/>
                <line x1="68" y1="2" x2="68" y2="30"/><line x1="74" y1="2" x2="74" y2="30"/>
                <line x1="80" y1="2" x2="80" y2="30"/><line x1="84" y1="2" x2="84" y2="30"/><line x1="88" y1="2" x2="88" y2="30"/>
                <line x1="94" y1="2" x2="94" y2="30"/><line x1="100" y1="2" x2="100" y2="30"/>
                <line x1="106" y1="2" x2="106" y2="30"/><line x1="110" y1="2" x2="110" y2="30"/><line x1="114" y1="2" x2="114" y2="30"/>
                <line x1="118" y1="2" x2="118" y2="30"/>
              </svg>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="esim-qr-label">SIM Serial: {EID}</span>
                <button onClick={copyEID} className="esim-copy-btn" title="Copy EID">
                  {copied ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>}
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="esim-qr-label">PUK: {PUK}</span>
                <button onClick={copyPUK} className="esim-copy-btn" title="Copy PUK">
                  {copiedPuk ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>}
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="esim-qr-label">PIN: {PIN}</span>
                <button onClick={copyPIN} className="esim-copy-btn" title="Copy PIN">
                  {copiedPin ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>}
                </button>
              </div>
            </div>
          </div>

          {/* Referral info */}
          <div className="esim-referral-info">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span>Referred by: <strong>{promoter?.code ? `${promoter.prefix.toUpperCase()}-${promoter.code}` : 'Tone Wow HQ'}</strong></span>
          </div>

          {promoter?.email && (
            <div className="esim-email-note">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4L12 13 2 4"/></svg>
              <span>A confirmation email has been sent to <strong>{promoter.email}</strong></span>
            </div>
          )}

          {/* Device tabs */}
          <div className="esim-guide-section">
            <div className="esim-guide-header" onClick={() => { const el = document.getElementById('esim-install'); if (el) el.classList.toggle('open'); }}>
              <h3>How to Install eSIM</h3>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
            </div>
            <div id="esim-install" className="esim-guide-body open">
              <div className="esim-device-tabs">
                {(Object.keys(DEVICE_STEPS) as DeviceTab[]).map(k => (
                  <button key={k} className={`esim-device-tab${deviceTab === k ? ' active' : ''}`}
                    onClick={() => setDeviceTab(k)}>
                    {DEVICE_STEPS[k].title}
                  </button>
                ))}
              </div>
              <ol className="esim-steps">
                {DEVICE_STEPS[deviceTab].steps.map((s, i) => (
                  <li key={i} dangerouslySetInnerHTML={{ __html: s }} />
                ))}
              </ol>
            </div>
          </div>

          {/* How to Register */}
          <div className="esim-guide-section">
            <div className="esim-guide-header" onClick={() => { const el = document.getElementById('esim-register'); if (el) el.classList.toggle('open'); }}>
              <h3>How to Register</h3>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
            </div>
            <div id="esim-register" className="esim-guide-body open">
              <ol className="esim-steps">
                <li>Download the <strong>tone wow 2.0</strong> app from Google Play or App Store</li>
                <li>Tap the button below to register</li>
              </ol>
            </div>
          </div>

          {/* Register CTA — smart based on promoter */}
          {registerUrl && (
            <a href={registerUrl} target="_blank" rel="noopener" className="esim-register-cta">
              <img src="https://bijakbuatduit.com/uploadxxx/uploads/696b17f1e34d5_1768626161.png" alt="tone wow app" className="esim-register-icon" />
              <div>
                <strong>Get the tone wow 2.0 App</strong><br />
                <span>Download & Register Now</span>
              </div>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M7 17L17 7M17 7H7m10 0v10"/></svg>
            </a>
          )}

        </div>
      </div>
    </div>
    </div>
  );
}
