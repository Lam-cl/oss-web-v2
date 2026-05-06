'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { searchNumbers } from '@/lib/api';
import type { NumberResult } from '@/types';

const ITEMS_PER_PAGE = 5;

// Skeuomorphic pill colors: white text, colored bg+border
const CATEGORY_CONFIG: Record<string, { bg: string; border: string }> = {
  VVIP:    { bg: '#1a1a1a', border: '#000000' },
  VIP:     { bg: '#ea580c', border: '#c2410c' },
  PREMIUM: { bg: '#2563eb', border: '#1d4ed8' },
};

function formatRM(amount: number) {
  return `RM ${amount.toLocaleString()}`;
}

export default function SpecialNumberPage() {
  const router = useRouter();
  const [digits, setDigits] = useState('');
  const [allResults, setAllResults] = useState<NumberResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedNumber, setSelectedNumber] = useState<NumberResult | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  const totalPages = Math.ceil(allResults.length / ITEMS_PER_PAGE);
  const paginatedResults = allResults.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const handleSearch = async () => {
    if (!digits || digits.length < 1) return;
    setLoading(true);
    setSearched(true);
    setCurrentPage(1);
    setSelectedNumber(null);
    try {
      const res = await searchNumbers(digits);
      setAllResults(res.data || []);
    } catch {
      setAllResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectNumber = (num: NumberResult) => {
    setSelectedNumber(num);
    localStorage.setItem('tw_selected_number', JSON.stringify(num));
    // Number price already includes SIM + plan — set plan price to 0
    const bizPlan = { slug: 'biz', name: 'Biz', price: 0 };
    localStorage.setItem('tw_selected_plan', JSON.stringify(bizPlan));
    // Auto scroll to the Next button
    setTimeout(() => {
      navRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  };

  return (
    <div className="choose-number-page">
      {/* Step header - no badge icon */}
      <div className="step-header">
        <h1 className="step-title">Choose your number</h1>
      </div>

      {/* Search card */}
      <div className="number-search-card">
        <p className="search-label">Up to 6-digits</p>
        <div className="search-bar">
          <svg className="search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" width="20" height="20">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Up to 6-digits"
            value={digits}
            onChange={(e) => setDigits(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button className="btn-blue" onClick={handleSearch} disabled={loading}>
            {loading ? '...' : 'Search'}
          </button>
        </div>

        {/* Results list */}
        {loading && (
          <div className="number-loading">
            <div style={{
              width: 32, height: 32,
              border: '3px solid var(--border)', borderTopColor: 'var(--tw-blue)',
              borderRadius: '50%', animation: 'spin 0.8s linear infinite',
              margin: '0 auto 12px',
            }} />
            <p>Searching numbers...</p>
          </div>
        )}

        {searched && !loading && allResults.length === 0 && (
          <div className="number-empty">
            <p>No numbers found. Try different digits.</p>
          </div>
        )}

        {/* Legend */}
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

      {/* Back / Next buttons */}
      <div className="step-nav" ref={navRef}>
        <button className="btn btn-blue" onClick={() => router.back()}>Back</button>
        {selectedNumber && (
          <button className="btn btn-blue" onClick={() => router.push('/sim/purchase?special=1')}>
            Next
          </button>
        )}
      </div>
    </div>
  );
}
