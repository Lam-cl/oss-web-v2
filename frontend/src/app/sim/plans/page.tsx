'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getPlans, searchNumbers } from '@/lib/api';
import type { Plan, NumberResult } from '@/types';
import { formatRM } from '@/lib/utils';

const ITEMS_PER_PAGE = 5;

const CATEGORY_CONFIG: Record<string, { bg: string; border: string }> = {
  VVIP:    { bg: '#1a1a1a', border: '#000000' },
  VIP:     { bg: '#ea580c', border: '#c2410c' },
  PREMIUM: { bg: '#2563eb', border: '#1d4ed8' },
};

export default function PlansPage() {
  const router = useRouter();
  const numberSectionRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);

  // Plan state
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);

  // Number search state
  const [digits, setDigits] = useState('');
  const [allResults, setAllResults] = useState<NumberResult[]>([]);
  const [loadingNumbers, setLoadingNumbers] = useState(false);
  const [searched, setSearched] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedNumber, setSelectedNumber] = useState<NumberResult | null>(null);

  const totalPages = Math.ceil(allResults.length / ITEMS_PER_PAGE);
  const paginatedResults = allResults.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  useEffect(() => {
    getPlans()
      .then(setPlans)
      .catch(() => {})
      .finally(() => setLoadingPlans(false));
  }, []);

  const handleSelectPlan = (plan: Plan) => {
    setSelectedPlan(plan);
    localStorage.setItem('tw_selected_plan', JSON.stringify(plan));
    // Scroll to number section
    setTimeout(() => {
      numberSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  };

  const handleSearch = async () => {
    if (!digits || digits.length < 1) return;
    setLoadingNumbers(true);
    setSearched(true);
    setCurrentPage(1);
    setSelectedNumber(null);
    try {
      const res = await searchNumbers(digits);
      setAllResults(res.data || []);
    } catch {
      setAllResults([]);
    } finally {
      setLoadingNumbers(false);
    }
  };

  const handleSelectNumber = (num: NumberResult) => {
    setSelectedNumber(num);
    localStorage.setItem('tw_selected_number', JSON.stringify(num));
    // If special number, auto-set Biz plan
    if (!selectedPlan || selectedPlan.slug !== 'biz') {
      const bizPlan = plans.find(p => p.slug === 'biz') || { slug: 'biz', name: 'Biz', price: 128 };
      setSelectedPlan(bizPlan as Plan);
      localStorage.setItem('tw_selected_plan', JSON.stringify(bizPlan));
    }
    setTimeout(() => {
      navRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  };

  const handleNext = () => {
    if (selectedPlan) {
      localStorage.setItem('tw_selected_plan', JSON.stringify(selectedPlan));
    }
    if (selectedNumber) {
      localStorage.setItem('tw_selected_number', JSON.stringify(selectedNumber));
    } else {
      localStorage.removeItem('tw_selected_number');
    }
    router.push('/sim/order-summary');
  };

  return (
    <div className="choose-number-page">
      {/* ═══════ SECTION 1: Choose Your Plan ═══════ */}
      <div className="step-header">
        <h1 className="step-title">Pilih Pelan Anda</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: 4, fontSize: 14 }}>
          Pilih pelan yang sesuai dengan keperluan anda
        </p>
      </div>

      {loadingPlans ? (
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{
            width: 32, height: 32,
            border: '3px solid var(--border)', borderTopColor: 'var(--tw-blue)',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite',
            margin: '0 auto 12px',
          }} />
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Memuatkan pelan...</p>
        </div>
      ) : (
        <div className="plans-grid">
          {plans.map((plan) => {
            const isActive = selectedPlan?.slug === plan.slug;
            return (
              <div
                key={plan.id}
                className={`plan-card gradient-${plan.gradient} ${isActive ? 'plan-card-selected' : ''}`}
                onClick={() => handleSelectPlan(plan)}
                style={{
                  cursor: 'pointer',
                  outline: isActive ? '3px solid var(--tw-blue)' : 'none',
                  outlineOffset: 2,
                  transform: isActive ? 'scale(1.02)' : 'scale(1)',
                  transition: 'all 0.2s ease',
                }}
              >
                {isActive && (
                  <div style={{
                    position: 'absolute', top: 10, right: 10,
                    width: 28, height: 28, borderRadius: '50%',
                    background: 'var(--tw-blue)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <svg fill="none" stroke="#fff" viewBox="0 0 24 24" width="16" height="16">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
                <div className="plan-card-header">
                  <h3>{plan.name}</h3>
                  <p className="plan-tagline">{plan.tagline}</p>
                </div>
                <div className="plan-card-price">
                  <span className="plan-price-amount">{formatRM(plan.price)}</span>
                </div>
                <ul className="plan-features">
                  {plan.features?.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                  {plan.sub_features?.map((f, i) => (
                    <li key={`sub-${i}`} className="sub-feature">{f}</li>
                  ))}
                  {plan.extras?.map((f, i) => (
                    <li key={`ext-${i}`} className="extra-feature">{f}</li>
                  ))}
                </ul>
                <button
                  className={`btn ${isActive ? 'btn-blue' : 'btn-primary'}`}
                  onClick={(e) => { e.stopPropagation(); handleSelectPlan(plan); }}
                >
                  {isActive ? '✓ Dipilih' : `Pilih ${plan.name}`}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══════ SECTION 2: Choose Your Number ═══════ */}
      <div ref={numberSectionRef} style={{ paddingTop: 40 }}>
        <div className="step-header" style={{ marginBottom: 0 }}>
          <h1 className="step-title">Pilih Nombor Anda</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: 4, fontSize: 14 }}>
            Cari nombor istimewa atau teruskan dengan nombor rawak
          </p>
        </div>

        <div className="number-search-card">
          <p className="search-label">Sehingga 6 digit</p>
          <div className="search-bar">
            <svg className="search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" width="20" height="20">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Masukkan sehingga 6 digit"
              value={digits}
              onChange={(e) => setDigits(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <button className="btn-blue" onClick={handleSearch} disabled={loadingNumbers}>
              {loadingNumbers ? '...' : 'Cari'}
            </button>
          </div>

          {/* Loading */}
          {loadingNumbers && (
            <div className="number-loading">
              <div style={{
                width: 32, height: 32,
                border: '3px solid var(--border)', borderTopColor: 'var(--tw-blue)',
                borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                margin: '0 auto 12px',
              }} />
              <p>Mencari nombor...</p>
            </div>
          )}

          {/* No results */}
          {searched && !loadingNumbers && allResults.length === 0 && (
            <div className="number-empty">
              <p>Tiada nombor dijumpai. Cuba digit lain.</p>
            </div>
          )}

          {/* Legend */}
          {searched && !loadingNumbers && allResults.length > 0 && (
            <div className="number-legend">
              {Object.entries(CATEGORY_CONFIG).map(([cat, cfg]) => (
                <span key={cat} className="legend-item">
                  <span className="legend-dot" style={{ background: cfg.bg }} />
                  {cat}
                </span>
              ))}
            </div>
          )}

          {/* Results */}
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
                      <span
                        className="number-category-badge"
                        style={{
                          color: '#ffffff',
                          background: cfg.bg,
                          border: `1.5px solid ${cfg.border}`,
                        }}
                      >
                        {num.category}
                      </span>
                      <span className="number-text">{num.displayNo || num.phoneNo}</span>
                      <span className="number-price">{formatRM(num.price)}</span>
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="number-pagination">
                  {(() => {
                    const pages: (number | string)[] = [];
                    if (totalPages <= 5) {
                      for (let i = 1; i <= totalPages; i++) pages.push(i);
                    } else {
                      pages.push(1);
                      if (currentPage > 3) pages.push('...');
                      const start = Math.max(2, currentPage - 1);
                      const end = Math.min(totalPages - 1, currentPage + 1);
                      for (let i = start; i <= end; i++) pages.push(i);
                      if (currentPage < totalPages - 2) pages.push('...');
                      pages.push(totalPages);
                    }
                    return pages.map((p, idx) =>
                      typeof p === 'string' ? (
                        <span key={idx} className="page-dots">...</span>
                      ) : (
                        <button
                          key={idx}
                          className={`page-btn ${currentPage === p ? 'active' : ''}`}
                          onClick={() => setCurrentPage(p)}
                        >
                          {p}
                        </button>
                      )
                    );
                  })()}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ═══════ Navigation ═══════ */}
      <div className="step-nav" ref={navRef}>
        <button className="btn btn-blue" onClick={() => router.back()}>Kembali</button>
        {selectedPlan && (
          <button className="btn btn-blue" onClick={handleNext}>
            Seterusnya →
          </button>
        )}
      </div>

      {/* Selected summary bar */}
      {selectedPlan && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: '#fff', borderTop: '1px solid #e5e7eb',
          padding: '12px 20px', display: 'flex', alignItems: 'center',
          justifyContent: 'center', gap: 16, zIndex: 100,
          boxShadow: '0 -4px 12px rgba(0,0,0,0.08)',
        }}>
          <span style={{ fontSize: 14, color: '#475569' }}>
            Pelan: <strong style={{ color: '#1e293b' }}>{selectedPlan.name}</strong> ({formatRM(selectedPlan.price)}/bln)
          </span>
          {selectedNumber && (
            <span style={{ fontSize: 14, color: '#475569' }}>
              | Nombor: <strong style={{ color: '#1e293b' }}>{selectedNumber.displayNo || selectedNumber.phoneNo}</strong> ({formatRM(selectedNumber.price)})
            </span>
          )}
          <button
            className="btn btn-blue"
            style={{ padding: '8px 24px', fontSize: 14 }}
            onClick={handleNext}
          >
            Seterusnya →
          </button>
        </div>
      )}
    </div>
  );
}
