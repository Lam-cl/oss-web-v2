'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getDevice, getBundleProductBySlug } from '@/lib/api';
import type { Device } from '@/types';
import Link from 'next/link';

/* ─── Color Map ──────────────────────────────────────────────────── */
const COLOR_MAP: Record<string, string> = {
  'black': '#1a1a1a', 'midnight black': '#1a1a1a',
  'white': '#f5f5f5', 'blade white': '#f0f0f0', 'pearl white': '#f8f8f0',
  'blue': '#2563eb', 'moonlight blue': '#4a90d9', 'navy blue': '#1e3a5f',
  'ocean blue': '#0077b6', 'sky blue': '#87ceeb',
  'green': '#16a34a', 'mint green': '#6fcf97', 'forest green': '#228b22',
  'orange': '#ea580c', 'twilight orange': '#f4845f', 'sunset orange': '#fd7f20',
  'red': '#dc2626', 'rose': '#f43f5e', 'pink': '#ec4899',
  'purple': '#7c3aed', 'violet': '#8b5cf6',
  'gold': '#d4a017', 'champagne gold': '#f0d080',
  'silver': '#a8a9ad', 'grey': '#94a3b8', 'gray': '#94a3b8',
  'shadow ash': '#6b7280', 'ash': '#6b7280', 'titanium': '#8d9093',
  'yellow': '#eab308', 'cyan': '#06b6d4', 'teal': '#0d9488',
  'brown': '#92400e', 'bronze': '#cd7f32',
};

/* ─── Constants ──────────────────────────────────────────────────── */
const DEVICE_STEPS = ['Device Details', 'Checkout', 'Payment'];
const CURRENT_STEP = 0; // 0-based, "Device Details" is active

const INCLUSIVE: Record<number, string[]> = {
  25: ['Phone with zero upfront payment', '20GB monthly bonus data', 'PA & Life Insurance RM56,000'],
  50: ['Phone with zero upfront payment', '50GB monthly bonus data', 'PA & Life Insurance RM59,000'],
};

/* ─── Types ──────────────────────────────────────────────────────── */
interface BundleDevice extends Device {
  _description?: string;
  _gallery?: string[];
  _options?: Array<{ id: number; name: string; values: Array<{ id: number; value: string }> }>;
  _productVariants?: Array<{ id: number; sku: string; price: number }>;
}

/* ─── Helpers ────────────────────────────────────────────────────── */
function bundleProductToDevice(product: any): BundleDevice {
  const sortedImages = [...(product.images || [])].sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
  return {
    id: 90000 + product.id,
    slug: product.slug || `bundle-${product.id}`,
    name: product.name,
    _description: product.description || '',
    _options: product.options || [],
    _productVariants: product.productVariants || [],
    brand: { id: 0, name: 'itel', slug: 'itel', sort_order: 1, is_active: true },
    brand_id: 0,
    tag: '',
    rrp: product.price,
    monthly_price: Math.round(product.price / 24),
    image_url: sortedImages[0]?.url || '/images/devices/placeholder.png',
    _gallery: sortedImages.map((img: any) => img.url),
    is_sold_out: false,
    is_api_device: true,
    external_id: String(product.id),
    sort_order: 0,
  };
}

/* ─── Icons ──────────────────────────────────────────────────────── */
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

/* ─── Main Component ─────────────────────────────────────────────── */
export default function DeviceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [device, setDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedColorIdx, setSelectedColorIdx] = useState(0);
  const [specsOpen, setSpecsOpen] = useState(false);

  useEffect(() => {
    if (!params.slug) return;
    const slug = params.slug as string;

    (async () => {
      try {
        const d = await getDevice(slug);
        if (d && d.id) { setDevice(d); setLoading(false); return; }
      } catch { /* try bundle */ }

      try {
        const bundleProduct = await getBundleProductBySlug(slug);
        if (bundleProduct) { setDevice(bundleProductToDevice(bundleProduct)); setLoading(false); return; }
      } catch { /* not found */ }

      setDevice(null);
      setLoading(false);
    })();
  }, [params.slug]);

  if (loading) {
    return (
      <div style={{ padding: '80px 20px', textAlign: 'center' }}>
        <div style={{
          width: 40, height: 40, border: '3px solid #e5e7eb', borderTopColor: '#2563eb',
          borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px',
        }} />
        <p style={{ color: '#94a3b8' }}>Loading device details...</p>
      </div>
    );
  }

  if (!device) {
    return (
      <div style={{ padding: '80px 20px', textAlign: 'center' }}>
        <h3 style={{ marginBottom: 8 }}>Device not found</h3>
        <p style={{ color: '#94a3b8', marginBottom: 24 }}>The device you&apos;re looking for doesn&apos;t exist or has been removed.</p>
        <Link href="/" className="btn btn-primary">Browse All Devices</Link>
      </div>
    );
  }

  const bd = device as BundleDevice;
  const gallery = bd._gallery?.length ? bd._gallery : [device.image_url];
  const mainImage = gallery[selectedColorIdx] || gallery[0];
  const colorOption = bd._options?.find(o => o.name === 'Color');
  const colorValues = colorOption?.values || [];

  const rawLines = (bd._description || '').split('\n').map((l: string) => l.trim()).filter(Boolean);
  const specs = rawLines
    .filter(l => l.startsWith('•') || l.startsWith('-') || l.startsWith('\t•'))
    .map(l => l.replace(/^[\t•\-]\s*/, ''));

  const benefits = INCLUSIVE[device.monthly_price] || [];

  return (
    <>
      <div className="dd-layout">
        {/* ── LEFT SIDEBAR: Step Indicator ── */}
        <aside className="dd-sidebar">
          <div className="dd-stepper">
            {DEVICE_STEPS.map((s, i) => {
              const completed = i < CURRENT_STEP;
              const active = i === CURRENT_STEP;
              return (
                <div key={i} className="dd-step">
                  <div className="dd-step-row">
                    <div className={`dd-step-circle${completed ? ' completed' : active ? ' active' : ''}`}>
                      {completed ? '✓' : i + 1}
                    </div>
                    <span className={`dd-step-label${active ? ' active' : ''}`}>{s}</span>
                  </div>
                  {i < DEVICE_STEPS.length - 1 && (
                    <div className={`dd-step-connector${completed ? ' completed' : ''}`} />
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        {/* ── MAIN CONTENT ── */}
        <main className="dd-main">
          {/* Breadcrumb */}
          <div className="dd-breadcrumb">
            <Link href="/">All Devices</Link>
            <span className="dd-breadcrumb-sep">›</span>
            <span>{device.name}</span>
          </div>

          {/* Product Panel */}
          <div className="dd-product-grid">
            {/* ── Gallery Column ── */}
            <div className="dd-gallery-col">
              <div className="dd-main-img-wrap">
                <img src={mainImage} alt={device.name} className="dd-main-img" />
              </div>
              {/* Thumbnail strip */}
              {gallery.length > 1 && (
                <div className="dd-thumbs">
                  {gallery.map((img: string, i: number) => (
                    <button
                      key={i}
                      onClick={() => setSelectedColorIdx(i)}
                      className={`dd-thumb${i === selectedColorIdx ? ' active' : ''}`}
                    >
                      <img src={img} alt={`${device.name} ${i + 1}`} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── Info Column ── */}
            <div className="dd-info-col">
              {/* Brand badge */}
              <div className="dd-brand-badge">{device.brand?.name?.toUpperCase()}</div>

              {/* Device name */}
              <h1 className="dd-device-name">{device.name}</h1>

              {/* Price card */}
              <div className="dd-price-card">
                <div className="dd-price-label">Monthly instalment</div>
                <div className="dd-price-amount">RM{device.monthly_price}<span>/month</span></div>
                <div className="dd-price-sub">× 24 months · Zero upfront</div>
              </div>

              {/* Inclusive benefits */}
              {benefits.length > 0 && (
                <div className="dd-benefits">
                  <p className="dd-benefits-title">Inclusive Benefits</p>
                  <ul className="dd-benefits-list">
                    {benefits.map((b: string, i: number) => (
                      <li key={i} className="dd-benefit-item">
                        <CheckCircleIcon />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Color picker */}
              {colorValues.length > 0 && (
                <div className="dd-color-section">
                  <p className="dd-color-label">
                    Color: <span className="dd-color-value">{colorValues[selectedColorIdx]?.value}</span>
                  </p>
                  <div className="dd-color-swatches">
                    {colorValues.map((c, i) => {
                      const dot = COLOR_MAP[c.value.toLowerCase()] || '#94a3b8';
                      const active = i === selectedColorIdx;
                      return (
                        <button
                          key={c.id}
                          onClick={() => setSelectedColorIdx(i)}
                          className={`dd-color-chip${active ? ' active' : ''}`}
                          title={c.value}
                        >
                          <span className="dd-color-dot" style={{ background: dot }} />
                          {c.value}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Specs accordion */}
              {specs.length > 0 && (
                <div className="dd-specs-accordion">
                  <button
                    className="dd-specs-toggle"
                    onClick={() => setSpecsOpen(!specsOpen)}
                  >
                    <span>Device Specs</span>
                    <ChevronIcon open={specsOpen} />
                  </button>
                  {specsOpen && (
                    <ul className="dd-specs-list">
                      {specs.map((s: string, i: number) => (
                        <li key={i} className="dd-spec-item">
                          <span className="dd-spec-dot">•</span>
                          {s}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* CTA */}
              {device.is_sold_out ? (
                <div className="dd-sold-out">Sold Out</div>
              ) : (
                <button
                  className="dd-buy-btn"
                  onClick={() => {
                    const selectedVariantId = bd._productVariants?.[selectedColorIdx]?.id ?? bd._productVariants?.[0]?.id;
                    const variantParam = selectedVariantId ? `&variantId=${selectedVariantId}` : '';
                    router.push(`/devices/checkout?id=${bd.external_id || device.id}${variantParam}`);
                  }}
                >
                  Buy Now — RM{device.monthly_price}/month
                </button>
              )}

              <p className="dd-delivery-note">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <rect x="1" y="3" width="15" height="13" rx="2" /><path d="M16 8h4l3 5v3h-7V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
                </svg>
                Free delivery · 1 year warranty
              </p>
            </div>
          </div>
        </main>
      </div>

      {/* ── Mobile Step Bar ── */}
      <div className="dd-mobile-steps">
        <div className="dd-mobile-step-row">
          {DEVICE_STEPS.map((s, i) => {
            const completed = i < CURRENT_STEP;
            const active = i === CURRENT_STEP;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div className={`dd-mobile-circle${completed ? ' completed' : active ? ' active' : ''}`}>
                  {completed ? '✓' : i + 1}
                </div>
                {i < DEVICE_STEPS.length - 1 && (
                  <div className={`dd-mobile-connector${completed ? ' completed' : ''}`} />
                )}
              </div>
            );
          })}
        </div>
        <p className="dd-mobile-step-title">{DEVICE_STEPS[CURRENT_STEP]}</p>
      </div>

      <style>{`
        /* ── Layout ── */
        .dd-layout {
          display: flex; gap: 32px; max-width: 1200px;
          margin: 0 auto; padding: 32px 20px 60px;
          min-height: 100vh;
        }

        /* ── Sidebar ── */
        .dd-sidebar {
          width: 240px; flex-shrink: 0;
          position: sticky; top: 24px; align-self: flex-start;
        }
        .dd-stepper { display: flex; flex-direction: column; }
        .dd-step-row { display: flex; align-items: center; gap: 12px; }
        .dd-step-circle {
          width: 36px; height: 36px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 13px; font-weight: 700; flex-shrink: 0;
          background: #e5e7eb; color: #94a3b8; transition: all 0.2s;
        }
        .dd-step-circle.completed { background: #16a34a; color: #fff; }
        .dd-step-circle.active { background: #2563eb; color: #fff; }
        .dd-step-label { font-size: 14px; color: #94a3b8; }
        .dd-step-label.active { font-weight: 700; color: #1e293b; }
        .dd-step-connector {
          width: 2px; height: 28px; margin-left: 17px;
          background: #e5e7eb; transition: background 0.2s;
        }
        .dd-step-connector.completed { background: #16a34a; }

        /* ── Main ── */
        .dd-main { flex: 1; min-width: 0; }
        .dd-breadcrumb {
          display: flex; align-items: center; gap: 6px;
          font-size: 13px; color: #94a3b8; margin-bottom: 20px;
        }
        .dd-breadcrumb a { color: #2563eb; text-decoration: none; font-weight: 500; }
        .dd-breadcrumb a:hover { text-decoration: underline; }
        .dd-breadcrumb-sep { color: #cbd5e1; font-size: 16px; }

        /* ── Product Grid ── */
        .dd-product-grid {
          display: grid; grid-template-columns: 1fr 440px; gap: 40px;
          align-items: start;
        }

        /* ── Gallery ── */
        .dd-gallery-col { display: flex; flex-direction: column; gap: 12px; }
        .dd-main-img-wrap {
          background: #f8fafc; border-radius: 16px;
          padding: 32px; display: flex; align-items: center; justify-content: center;
          min-height: 380px; border: 1px solid #f1f5f9;
        }
        .dd-main-img {
          max-width: 100%; max-height: 340px; object-fit: contain;
          transition: opacity 0.2s;
        }
        .dd-thumbs {
          display: flex; gap: 8px; flex-wrap: wrap;
        }
        .dd-thumb {
          width: 64px; height: 64px; border-radius: 10px; overflow: hidden;
          border: 2px solid #e5e7eb; background: #fff; padding: 6px;
          cursor: pointer; transition: all 0.15s; flex-shrink: 0;
        }
        .dd-thumb:hover { border-color: #93c5fd; }
        .dd-thumb.active { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.15); }
        .dd-thumb img { width: 100%; height: 100%; object-fit: contain; }

        /* ── Info Column ── */
        .dd-info-col { display: flex; flex-direction: column; gap: 20px; }

        .dd-brand-badge {
          display: inline-block; font-size: 11px; font-weight: 700;
          letter-spacing: 1px; color: #2563eb; background: #dbeafe;
          padding: 3px 10px; border-radius: 20px; width: fit-content;
        }
        .dd-device-name {
          font-size: 26px; font-weight: 800; color: #0f172a;
          line-height: 1.25; margin: 0;
        }

        /* Price card */
        .dd-price-card {
          background: linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%);
          border-radius: 14px; padding: 20px 24px; color: #fff;
        }
        .dd-price-label { font-size: 12px; font-weight: 500; opacity: 0.8; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.4px; }
        .dd-price-amount { font-size: 36px; font-weight: 900; line-height: 1; }
        .dd-price-amount span { font-size: 17px; font-weight: 500; opacity: 0.85; margin-left: 2px; }
        .dd-price-sub { font-size: 13px; opacity: 0.75; margin-top: 6px; }

        /* Benefits */
        .dd-benefits {
          background: #fff; border: 1.5px solid #2563eb; border-radius: 12px; padding: 16px 18px;
        }
        .dd-benefits-title {
          font-size: 11px; font-weight: 700; color: #2563eb;
          text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 10px;
        }
        .dd-benefits-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 7px; }
        .dd-benefit-item { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; color: #0f172a; }

        /* Color picker */
        .dd-color-section { display: flex; flex-direction: column; gap: 8px; }
        .dd-color-label { font-size: 13px; font-weight: 600; color: #374151; margin: 0; }
        .dd-color-value { font-weight: 400; color: #2563eb; }
        .dd-color-swatches { display: flex; flex-wrap: wrap; gap: 8px; }
        .dd-color-chip {
          display: flex; align-items: center; gap: 7px;
          padding: 7px 14px 7px 9px; border-radius: 24px;
          border: 2px solid #e2e8f0; background: #fff;
          font-size: 13px; font-weight: 500; color: #374151;
          cursor: pointer; transition: all 0.15s;
        }
        .dd-color-chip:hover { border-color: #93c5fd; }
        .dd-color-chip.active {
          border-color: #2563eb; background: #eff6ff; color: #2563eb;
          box-shadow: 0 0 0 2px rgba(37,99,235,0.12);
        }
        .dd-color-dot {
          width: 15px; height: 15px; border-radius: 50%; flex-shrink: 0;
          border: 1.5px solid rgba(0,0,0,0.12); display: inline-block;
        }

        /* Specs */
        .dd-specs-accordion {
          border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;
        }
        .dd-specs-toggle {
          width: 100%; display: flex; justify-content: space-between; align-items: center;
          padding: 14px 18px; background: #f8fafc; border: none; cursor: pointer;
          font-size: 14px; font-weight: 600; color: #1e293b; transition: background 0.15s;
        }
        .dd-specs-toggle:hover { background: #f1f5f9; }
        .dd-specs-list {
          list-style: none; padding: 12px 18px 16px; margin: 0;
          display: flex; flex-direction: column; gap: 2px;
        }
        .dd-spec-item {
          display: flex; align-items: flex-start; gap: 8px;
          font-size: 13px; color: #475569; padding: 3px 0;
        }
        .dd-spec-dot { color: #2563eb; font-weight: 700; flex-shrink: 0; }

        /* CTA */
        .dd-buy-btn {
          width: 100%; padding: 16px; border-radius: 12px; border: none;
          background: #2563eb; color: #fff; font-size: 16px; font-weight: 700;
          cursor: pointer; transition: all 0.2s; letter-spacing: 0.2px;
        }
        .dd-buy-btn:hover { background: #1d4ed8; transform: translateY(-1px); box-shadow: 0 4px 16px rgba(37,99,235,0.35); }
        .dd-buy-btn:active { transform: translateY(0); }
        .dd-sold-out {
          width: 100%; padding: 16px; border-radius: 12px; text-align: center;
          background: #f1f5f9; color: #94a3b8; font-size: 16px; font-weight: 600;
        }
        .dd-delivery-note {
          display: flex; align-items: center; gap: 7px;
          font-size: 13px; color: #64748b; margin: 0;
          justify-content: center;
        }

        /* ── Mobile Steps Bar ── */
        .dd-mobile-steps { display: none; }
        .dd-mobile-step-row {
          display: flex; align-items: center; gap: 4px; justify-content: center;
        }
        .dd-mobile-circle {
          width: 30px; height: 30px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 12px; font-weight: 700;
          background: #e5e7eb; color: #94a3b8; transition: all 0.2s;
        }
        .dd-mobile-circle.completed { background: #16a34a; color: #fff; }
        .dd-mobile-circle.active { background: #2563eb; color: #fff; }
        .dd-mobile-connector { width: 22px; height: 2px; background: #e5e7eb; border-radius: 1px; }
        .dd-mobile-connector.completed { background: #16a34a; }
        .dd-mobile-step-title {
          text-align: center; font-size: 13px; font-weight: 600;
          color: #1e293b; margin: 8px 0 0;
        }

        /* ── Responsive ── */
        @media (max-width: 1024px) {
          .dd-product-grid { grid-template-columns: 1fr 380px; gap: 28px; }
        }
        @media (max-width: 768px) {
          .dd-layout { padding: 16px 16px 100px; gap: 0; }
          .dd-sidebar { display: none; }
          .dd-product-grid { grid-template-columns: 1fr; gap: 20px; }
          .dd-main-img-wrap { min-height: 260px; padding: 20px; }
          .dd-device-name { font-size: 22px; }
          .dd-price-amount { font-size: 30px; }
          .dd-mobile-steps {
            display: block; padding: 14px 20px 10px;
            background: #fff; border-bottom: 1px solid #f1f5f9;
          }
        }
      `}</style>
    </>
  );
}
