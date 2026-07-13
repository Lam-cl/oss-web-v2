'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
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

type SimChoiceScreen = 'main' | 'custom' | 'bundle';

type PreloadBenefitsResponse = {
  metadata?: Record<string, { benefits?: string[] }>;
};

const FALLBACK_MODAL_BENEFITS: Record<string, string[]> = {
  superlite: ['2GB Welcome Data', 'FREE PA Takaful RM10,000'],
  lite: ['2GB Welcome Data', '20GB Bonus Data', 'FREE PA Takaful RM30,000'],
  pro: ['FU 35', 'RM35 / 30 Days', 'FREE for 1 month', '150GB Data', 'Unlimited Calls', 'FREE PA Takaful RM30,000', 'FREE Life Insurance RM4,000'],
  biz: ['FU 60', 'RM60 / 30 Days', 'FREE for 1 month', '500GB Data', 'Unlimited Calls', 'FREE PA Takaful RM50,000', 'FREE Life Insurance RM4,000'],
};

function cleanModalBenefits(items?: string[]) {
  return (items || [])
    .map(item => item.replace(/\s*-\s*validity\s+30\s+days/ig, '').trim())
    .map(item => /^2GB Data$/i.test(item) ? '2GB Welcome Data' : item)
    .filter(item => !/^WELCOME DATA$/i.test(item))
    .filter(item => item && !/subscribe to any plan within 7 days/i.test(item))
    .filter((item, index, arr) => arr.indexOf(item) === index);
}

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

function DataIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 17V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10" />
      <path d="M3 17h18l-1.5 2h-15L3 17Z" />
      <path d="M8 9h8M8 12h5" />
    </svg>
  );
}

function CallsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v2a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 3.2 2 2 0 0 1 4.11 1h2a2 2 0 0 1 2 1.72c.13.96.35 1.9.66 2.8a2 2 0 0 1-.45 2.11L7.5 8.45a16 16 0 0 0 6 6l.82-.82a2 2 0 0 1 2.11-.45c.9.31 1.84.53 2.8.66A2 2 0 0 1 22 16.92Z" />
    </svg>
  );
}

function GiftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 12v8H4v-8M2 7h20v5H2zM12 22V7" />
      <path d="M12 7H7.5A2.5 2.5 0 1 1 10 4.5C10 6 12 7 12 7ZM12 7h4.5A2.5 2.5 0 1 0 14 4.5C14 6 12 7 12 7Z" />
    </svg>
  );
}

function DefaultPlanIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function getPlanBenefitIcon(item: string) {
  const normalized = item.toLowerCase();
  if (normalized.includes('call')) return <CallsIcon />;
  if (normalized.includes('bonus') || normalized.includes('welcome') || normalized.includes('free')) return <GiftIcon />;
  if (normalized.includes('data') || normalized.includes('gb')) return <DataIcon />;
  return <DefaultPlanIcon />;
}

function providerForProtection(item: string) {
  if (/life insurance/i.test(item)) {
    return { className: 'metlife', name: 'A.MetLife', mark: 'am', detail: 'A.MetLife' };
  }
  return { className: 'zurich', name: 'Zurich Takaful', mark: 'Z', detail: 'Zurich Takaful' };
}

function formatProtectionText(item: string) {
  return item.replace(/^FREE\s+/i, 'FREE ');
}

function splitPlanBenefits(benefits: string[] = []) {
  const protection = benefits.filter(item => /takaful|insurance/i.test(item));
  const nonProtection = benefits.filter(item => !/takaful|insurance/i.test(item));
  const planName = nonProtection.find(item => /^FU\s*\d+/i.test(item));
  const price = nonProtection.find(item => /^RM[\d.]+\s*\/\s*\d+\s*Days/i.test(item));
  const promo = nonProtection.find(item => /^FREE\s+for/i.test(item));
  const planBenefits = nonProtection.filter(item => item !== planName && item !== price && item !== promo);

  return { planName, price, promo, planBenefits, protection };
}

type SimCategory = 'normal' | 'special' | null;

export default function SIMSection() {
  const router = useRouter();
  const sectionRef = useRef<HTMLDivElement>(null);
  const [simCategory, setSimCategory] = useState<SimCategory>(null);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [choiceScreen, setChoiceScreen] = useState<SimChoiceScreen>('main');
  const [preloadBenefits, setPreloadBenefits] = useState<Record<string, string[]>>({});
  const [mounted, setMounted] = useState(false);

  // Special number search state
  const [digits, setDigits] = useState('');
  const [allResults, setAllResults] = useState<NumberResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchSource, setSearchSource] = useState<'auto' | 'manual'>('auto');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedNumber, setSelectedNumber] = useState<NumberResult | null>(null);

  const displayResults = searchSource === 'auto' ? allResults.slice(0, 10) : allResults;
  const totalPages = Math.ceil(displayResults.length / ITEMS_PER_PAGE);
  const paginatedResults = displayResults.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );
  const paginationPages: (number | string)[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) paginationPages.push(i);
  } else {
    paginationPages.push(1);
    if (currentPage > 3) paginationPages.push('...');
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    for (let i = start; i <= end; i++) paginationPages.push(i);
    if (currentPage < totalPages - 2) paginationPages.push('...');
    paginationPages.push(totalPages);
  }

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('sim-choice-modal-open', choiceOpen);
    return () => {
      document.body.classList.remove('sim-choice-modal-open');
    };
  }, [choiceOpen]);

  const doSearch = async (query: string, source: 'auto' | 'manual') => {
    setLoading(true); setSearched(true); setCurrentPage(1); setSelectedNumber(null);
    setSearchSource(source);
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
    doSearch(digits, 'manual');
  };

  // Auto-load random numbers when Special Number tab is opened
  useEffect(() => {
    if (simCategory === 'special' && !searched) {
      const randomDigit = String(Math.floor(1 + Math.random() * 9));
      doSearch(randomDigit, 'auto');
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
    let cancelled = false;
    fetch('https://api.tonewow.com/static-content/slug/preload-benefits')
      .then(res => res.ok ? res.json() : null)
      .then((data: PreloadBenefitsResponse | null) => {
        if (cancelled || !data?.metadata) return;
        const liteBenefits = cleanModalBenefits(data.metadata.LINDUNG_LITE?.benefits);
        const proBenefits = cleanModalBenefits(data.metadata.LINDUNG_PRO?.benefits);
        const bizBenefits = cleanModalBenefits(data.metadata.LINDUNG_BIZ?.benefits);
        setPreloadBenefits({
          lite: liteBenefits.length ? liteBenefits : FALLBACK_MODAL_BENEFITS.lite,
          pro: proBenefits.length ? proBenefits : FALLBACK_MODAL_BENEFITS.pro,
          biz: bizBenefits.length ? bizBenefits : FALLBACK_MODAL_BENEFITS.biz,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const getModalBenefits = (key: keyof typeof FALLBACK_MODAL_BENEFITS) => {
    return preloadBenefits[key] || FALLBACK_MODAL_BENEFITS[key];
  };

  const openChoice = () => {
    setChoiceScreen('main');
    setChoiceOpen(true);
  };

  const closeChoice = () => setChoiceOpen(false);

  const routeToPackage = (href: string) => {
    setChoiceOpen(false);
    router.push(href);
  };

  const renderChoiceCard = ({
    title,
    meta,
    description,
    benefits,
    onClick,
    tone = 'blue',
    detailed = false,
  }: {
    title: string;
    meta?: string;
    description?: string;
    benefits?: string[];
    onClick: () => void;
    tone?: 'blue' | 'navy';
    detailed?: boolean;
  }) => {
    const detail = splitPlanBenefits(benefits);
    const metaMatch = meta?.match(/^(From)\s+(.+)$/i);

    return (
      <button className={`sim-choice-card sim-choice-card--${tone}`} type="button" onClick={onClick}>
        <div className="sim-choice-card-header">
          <h4 className="sim-choice-card-name">{title}</h4>
          {meta && (
            <div className={`sim-choice-card-meta${metaMatch ? ' sim-choice-card-meta--price' : ''}`}>
              {metaMatch ? (
                <>
                  <span className="sim-choice-card-meta-from">{metaMatch[1]}</span>
                  <span className="sim-choice-card-meta-amount">{metaMatch[2]}</span>
                </>
              ) : (
                <span>{meta}</span>
              )}
            </div>
          )}
        </div>
        <div className="sim-choice-card-body">
          <div className="sim-choice-card-divider" />
          {description && <p className="sim-choice-card-subtitle">{description}</p>}

          {detailed ? (
            <>
              <div className="sim-choice-plan-detail">
                {(detail.planName || detail.price || detail.promo) && (
                  <div className="sim-choice-plan-top">
                    {detail.planName && <h5>{detail.planName}</h5>}
                    <div className="sim-choice-plan-price">
                      {detail.price && <span className="sim-choice-plan-strike">{detail.price}</span>}
                      {detail.promo && <span className="sim-choice-plan-free">{detail.promo}</span>}
                    </div>
                  </div>
                )}
                {detail.planBenefits.length > 0 && (
                  <>
                    <ul className="sim-choice-feature-list">
                      {detail.planBenefits.map(item => (
                        <li key={item}>
                          <span className="sim-choice-feature-icon">{getPlanBenefitIcon(item)}</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              {detail.protection.length > 0 && (
                <div className="sim-choice-protection-detail">
                  <p>Protection</p>
                  <ul className="sim-choice-protection-list">
                    {detail.protection.map(item => {
                      const provider = providerForProtection(item);
                      return (
                        <li key={item}>
                          <span className={`sim-choice-provider-logo sim-choice-provider-logo--${provider.className}`} aria-label={provider.name}>
                            <strong>{provider.mark}</strong>
                            <small>{provider.detail}</small>
                          </span>
                          <span>{formatProtectionText(item)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <>
              {benefits && benefits.length > 0 && (
                <>
                  <p className="sim-choice-benefits-label">Includes:</p>
                  <ul className="sim-choice-benefits">
                    {benefits.map(item => (
                      <li key={item}>
                        <CheckIcon />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}

          <div className="sim-choice-card-cta">
            <span>Select</span>
          </div>
        </div>
      </button>
    );
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

      {mounted && createPortal(
        <AnimatePresence>
          {choiceOpen && (
            <motion.div
              className="sim-choice-backdrop"
              role="dialog"
              aria-modal="true"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onMouseDown={closeChoice}
            >
              <motion.div
                className="sim-choice-dialog"
                initial={{ opacity: 0, y: 22, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 14, scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="sim-choice-head">
                  <div>
                    <p className="sim-choice-kicker">Normal Number</p>
                    <h3>
                      {choiceScreen === 'main'
                        ? 'Choose how you want to start'
                        : choiceScreen === 'custom'
                          ? 'Build your own plan'
                          : 'Ready made bundle'}
                    </h3>
                  </div>
                  <button className="sim-choice-close" type="button" onClick={closeChoice} aria-label="Close">×</button>
                </div>

                {choiceScreen !== 'main' && (
                  <button className="sim-choice-back" type="button" onClick={() => setChoiceScreen('main')}>
                    ← Back
                  </button>
                )}

                {choiceScreen === 'main' && (
                  <div className="sim-choice-grid">
                    {renderChoiceCard({
                      title: 'Build your own plan',
                      meta: 'Custom',
                      description: 'Pick SUPERLITE or LITE, then customize your plan and protection.',
                      benefits: ['Choose your plan', 'Flexible protection', 'Checkout after setup'],
                      onClick: () => setChoiceScreen('custom'),
                      tone: 'blue',
                    })}
                    {renderChoiceCard({
                      title: 'Ready made bundle',
                      meta: 'Fast checkout',
                      description: 'Choose Pro or Biz and go straight to checkout.',
                      benefits: ['Preloaded plan', 'Insurance benefits', 'Faster purchase flow'],
                      onClick: () => setChoiceScreen('bundle'),
                      tone: 'navy',
                    })}
                  </div>
                )}

                {choiceScreen === 'custom' && (
                  <div className="sim-choice-grid">
                    {renderChoiceCard({
                      title: 'SUPERLITE',
                      meta: 'From RM10',
                      benefits: getModalBenefits('superlite'),
                      onClick: () => routeToPackage('/sim/purchase?mode=superlite'),
                      tone: 'blue',
                      detailed: true,
                    })}
                    {renderChoiceCard({
                      title: 'LITE',
                      meta: 'From RM19.50',
                      benefits: getModalBenefits('lite'),
                      onClick: () => routeToPackage('/sim/purchase'),
                      tone: 'blue',
                      detailed: true,
                    })}
                  </div>
                )}

                {choiceScreen === 'bundle' && (
                  <div className="sim-choice-grid">
                    {renderChoiceCard({
                      title: 'PRO',
                      meta: 'RM49.50',
                      benefits: getModalBenefits('pro'),
                      onClick: () => routeToPackage('/sim/purchase?bundle=pro'),
                      tone: 'navy',
                      detailed: true,
                    })}
                    {renderChoiceCard({
                      title: 'BIZ',
                      meta: 'RM128',
                      benefits: getModalBenefits('biz'),
                      onClick: () => routeToPackage('/sim/purchase?bundle=biz'),
                      tone: 'navy',
                      detailed: true,
                    })}
                  </div>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}


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
                  {paginationPages.map((p, idx) =>
                    typeof p === 'string' ? (
                      <span key={`dots-${idx}`} className="page-dots">...</span>
                    ) : (
                      <button key={p} className={`page-btn ${currentPage === p ? 'active' : ''}`} onClick={() => setCurrentPage(p)}>{p}</button>
                    )
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
