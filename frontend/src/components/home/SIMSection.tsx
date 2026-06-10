'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { searchNumbers } from '@/lib/api';
import type { NumberResult } from '@/types';
import USPBar from './USPBar';

const ITEMS_PER_PAGE = 5;

const CATEGORY_CONFIG: Record<string, { bg: string; border: string }> = {
  VVIP:    { bg: '#1a1a1a', border: '#000000' },
  VIP:     { bg: '#ea580c', border: '#c2410c' },
  PREMIUM: { bg: '#2563eb', border: '#1d4ed8' },
};

const FEATURED_PLANS = [
  { name: 'FU35',  data: '150 GB',  price: 'RM35',  period: '/month', validity: '30 Days' },
  { name: 'FU60',  data: '500 GB',  price: 'RM60',  period: '/month', validity: '30 Days', popular: true },
  { name: 'FU120', data: '800 GB',  price: 'RM120', period: '/month', validity: '30 Days' },
];

const CARD_FEATURES = [
  'High-speed 5G/4G Internet',
  'Unlimited Calls',
  'Shared Hotspot',
];

const NORMAL_NUMBER_BENEFITS = [
  'Customizable SIM plan',
  'Select your random number upon registration',
  'Free welcome data upon activation',
  'Cashback with every top up',
  'Free 20GB bonus data with data plan subscription',
  'CelcomDigi network coverage nationwide',
];

const SPECIAL_NUMBER_TIERS = [
  { label: 'Premium', price: 'RM988', plan: 'FU35', details: '150GB x 18 months' },
  { label: 'VIP', price: 'RM2298', plan: 'FU50', details: '300GB x 36 months' },
  { label: 'VVIP', price: 'RM3088', plan: 'FU60', details: '500GB x 36 months' },
];

const SPECIAL_NUMBER_BENEFITS = [
  'Free insurance up to RM54,000',
  'Auto monthly reload',
  'CelcomDigi network coverage nationwide',
];

const SPECIAL_NUMBER_INCLUDES = [
  ...SPECIAL_NUMBER_TIERS.map((tier) => `${tier.label}: ${tier.price} · ${tier.plan} · ${tier.details}`),
  ...SPECIAL_NUMBER_BENEFITS,
];

const simUSPItems = [
  {
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    ),
    text: 'Cashback with every Top Up',
  },
  {
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 2l7 4v6c0 5-3.5 9-7 10-3.5-1-7-5-7-10V6l7-4z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4" /></svg>
    ),
    text: 'Free Insurance up to RM54k',
  },
  {
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 12v10H4V12m18-5H2v5h20V7zM12 22V7m0 0H7.5A2.5 2.5 0 1110 4.5C10 6 12 7 12 7zm0 0h4.5A2.5 2.5 0 1014 4.5C14 6 12 7 12 7z" /></svg>
    ),
    text: 'FREE Welcome Data',
  },
  {
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 17V7m0 10h16M4 7h16m0 0v10M8 11h1m3 0h1m3 0h1M8 14h1m3 0h1m3 0h1" /></svg>
    ),
    text: 'FREE 20GB Bonus Data',
  },
  {
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.957a1 1 0 00.95.69h4.16c.969 0 1.371 1.24.588 1.81l-3.366 2.445a1 1 0 00-.364 1.118l1.286 3.957c.3.921-.755 1.688-1.539 1.118l-3.366-2.445a1 1 0 00-1.176 0l-3.366 2.445c-.784.57-1.838-.197-1.539-1.118l1.286-3.957a1 1 0 00-.364-1.118L4.06 9.384c-.783-.57-.38-1.81.588-1.81h4.16a1 1 0 00.95-.69l1.286-3.957z" /></svg>
    ),
    text: 'FREE Loyalty Data',
  },
  {
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    ),
    text: 'Money Back Guarantee',
  },
  {
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2 1m2-1L12 3m2 1v2.5M6 7l-2 1m2-1l-2-1m2 1v2.5" /></svg>
    ),
    text: 'Refer & Earn',
  },
];

function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </svg>
  );
}

type SimCategory = 'normal' | 'special' | null;

export default function SIMSection() {
  const router = useRouter();
  const sectionRef = useRef<HTMLDivElement>(null);
  const [simCategory, setSimCategory] = useState<SimCategory>(null);

  // Special number search state
  const [digits, setDigits] = useState('');
  const [allResults, setAllResults] = useState<NumberResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedNumber, setSelectedNumber] = useState<NumberResult | null>(null);

  const displayResults = allResults.slice(0, 10);
  const totalPages = Math.ceil(displayResults.length / ITEMS_PER_PAGE);
  const paginatedResults = displayResults.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const doSearch = async (query: string) => {
    setLoading(true); setSearched(true); setCurrentPage(1); setSelectedNumber(null);
    try {
      const res = await searchNumbers(query);
      setAllResults(res.data || []);
    } catch {
      setAllResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!digits) return;
    doSearch(digits);
  };

  // Auto-load random numbers when Special Number tab is opened
  useEffect(() => {
    if (simCategory === 'special' && !searched) {
      const randomDigit = String(Math.floor(1 + Math.random() * 9));
      doSearch(randomDigit);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simCategory]);

  const handleSelectNumber = (num: NumberResult) => {
    setSelectedNumber(num);
    localStorage.setItem('tw_selected_number', JSON.stringify(num));
    // Number price already includes SIM + plan — set plan price to 0
    const bizPlan = { slug: 'biz', name: 'Biz', price: 0 };
    localStorage.setItem('tw_selected_plan', JSON.stringify(bizPlan));
    router.push('/sim/purchase?special=1');
  };

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('sim-visible');
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="sim-section" ref={sectionRef}>
      <USPBar items={simUSPItems} />

      <div className="priv-cards sim-priv-cards">
        <button
          className="priv-card sim-priv-card"
          onClick={() => router.push('/sim/purchase')}
          type="button"
        >
          <div className="priv-card-header">
            <h4 className="priv-card-name">Normal Number</h4>
          </div>
          <div className="priv-card-body">
            <div className="priv-card-divider" />
            <p className="sim-priv-subtitle">Perfect for everyday use</p>
            <p className="priv-benefits-label">Includes:</p>
            <ul className="priv-card-benefits">
              {NORMAL_NUMBER_BENEFITS.slice(0, 2).map((benefit) => (
                <li key={benefit} className="priv-card-benefit">
                  <CheckIcon />
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
            <div className="priv-card-cta">
              <span className="priv-btn priv-btn--default">Select</span>
            </div>
          </div>
        </button>

        <button
          className={`priv-card priv-card--best sim-priv-card${simCategory === 'special' ? ' priv-card--active' : ''}`}
          onClick={() => setSimCategory('special')}
          type="button"
        >
          <div className="priv-card-header">
            <span className="priv-best-badge">Memorable Number</span>
            <h4 className="priv-card-name">Special Number</h4>
          </div>
          <div className="priv-card-body">
            <div className="priv-card-divider" />
            <p className="sim-priv-subtitle">Choose a memorable number and stand out</p>
            <p className="priv-benefits-label">Includes:</p>
            <ul className="priv-card-benefits">
              {SPECIAL_NUMBER_INCLUDES.slice(0, 3).map((benefit) => (
                <li key={benefit} className="priv-card-benefit">
                  <CheckIcon />
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
            <div className="priv-card-cta">
              {simCategory === 'special' ? (
                <span className="priv-btn priv-btn--selected">Selected ✓</span>
              ) : (
                <span className="priv-btn priv-btn--default">Select</span>
              )}
            </div>
          </div>
        </button>
      </div>


      {simCategory === 'special' && (
        <div className="number-search-card">
          <p className="search-label">Search by up to 6 digits</p>
          <div className="search-bar">
            <svg className="search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" width="20" height="20">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="e.g. 8888, 1234, 168"
              value={digits}
              onChange={(e) => setDigits(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <button className="btn-blue" onClick={handleSearch} disabled={loading}>
              {loading ? '...' : 'Search'}
            </button>
          </div>

          {loading && (
            <div className="number-loading">
              <div style={{ width: 28, height: 28, border: '3px solid var(--border)', borderTopColor: 'var(--tw-blue)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 8px' }} />
              <p>Searching numbers...</p>
            </div>
          )}

          {!searched && !loading && (
            <p style={{ textAlign: 'center', color: '#94a3b8', padding: '16px 0', fontSize: 13 }}>
              Loading numbers...
            </p>
          )}

          {searched && !loading && allResults.length === 0 && (
            <div className="number-empty"><p>No numbers found. Try different digits.</p></div>
          )}

          {searched && !loading && allResults.length > 0 && (
            <div className="number-legend">
              {Object.entries(CATEGORY_CONFIG).map(([cat, cfg]) => (
                <span key={cat} className="legend-item">
                  <span className="legend-dot" style={{ background: cfg.bg }} />
                  {cat}
                </span>
              ))}
            </div>
          )}

          {paginatedResults.length > 0 && (
            <>
              <div className="number-list">
                {paginatedResults.map((num, i) => {
                  const cfg = CATEGORY_CONFIG[num.category] || CATEGORY_CONFIG.PREMIUM;
                  const isSelected = selectedNumber?.phoneNo === num.phoneNo;
                  return (
                    <div
                      key={i}
                      className={`number-row ${isSelected ? 'number-row-selected' : ''}`}
                      onClick={() => handleSelectNumber(num)}
                    >
                      <span className="number-category-badge" style={{ color: '#fff', background: cfg.bg, border: `1.5px solid ${cfg.border}` }}>
                        {num.category}
                      </span>
                      <span className="number-text">{num.displayNo || num.phoneNo}</span>
                      <span className="number-price">RM {num.price.toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>

              {totalPages > 1 && (
                <div className="number-pagination">
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i + 1).map(p => (
                    <button key={p} className={`page-btn ${currentPage === p ? 'active' : ''}`} onClick={() => setCurrentPage(p)}>{p}</button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
