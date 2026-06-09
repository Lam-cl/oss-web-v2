'use client';

import { useEffect, useRef } from 'react';

const InfoIcon = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16, flexShrink: 0 }}>
    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
  </svg>
);

const CheckIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
  </svg>
);

const ShieldIcon = () => (
  <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 40, height: 40 }}>
    <path d="M24 4L8 12v12c0 11.1 6.8 21.5 16 24 9.2-2.5 16-12.9 16-24V12L24 4z" fill="currentColor" opacity="0.12" />
    <path d="M24 4L8 12v12c0 11.1 6.8 21.5 16 24 9.2-2.5 16-12.9 16-24V12L24 4z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" fill="none" />
    <path d="M17 24l4 4 10-10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ShieldPlusIcon = () => (
  <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 40, height: 40 }}>
    <path d="M24 4L8 12v12c0 11.1 6.8 21.5 16 24 9.2-2.5 16-12.9 16-24V12L24 4z" fill="currentColor" opacity="0.12" />
    <path d="M24 4L8 12v12c0 11.1 6.8 21.5 16 24 9.2-2.5 16-12.9 16-24V12L24 4z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" fill="none" />
    <path d="M24 17v14M17 24h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

interface Props {
  selected: string | null;
  onSelect: (plan: string | null) => void;
}

const PLANS = [
  {
    key: 'bijak',
    name: 'PhoneStar25',
    price: 'RM25',
    period: '/month',
    icon: ShieldIcon,
    benefits: [
      'Phone with zero upfront payment',
      '20GB monthly bonus data',
      'PA & Life Insurance RM56,000',
    ],
  },
  {
    key: 'jaga',
    name: 'PhoneStar50',
    price: 'RM50',
    period: '/month',
    icon: ShieldPlusIcon,
    best: true,
    benefits: [
      'Phone with zero upfront payment',
      '50GB monthly bonus data',
      'PA & Life Insurance RM59,000',
    ],
  },
];

export default function PrivilegeSection({ selected, onSelect }: Props) {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('priv-visible');
          obs.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const toggle = (plan: string) => {
    const next = selected === plan ? null : plan;
    onSelect(next);
  };

  const clear = () => {
    onSelect(null);
  };

  return (
    <>
      <div className="priv-section" ref={sectionRef}>
        <div className="priv-header">
          <h3 className="priv-title">Privilege+</h3>
          <p className="priv-subtitle">Add protection &amp; data to your prepaid plan</p>
        </div>

        <div className="priv-cards">
          {PLANS.map((plan) => {
            const isActive = selected === plan.key;
            return (
              <button
                key={plan.key}
                className={`priv-card${'best' in plan && plan.best ? ' priv-card--best' : ''}${isActive ? ' priv-card--active' : ''}`}
                onClick={() => toggle(plan.key)}
                type="button"
              >
                {/* --- HEADER --- */}
                <div className="priv-card-header">
                  {'best' in plan && plan.best && <span className="priv-best-badge">Best Value</span>}
                  <h4 className="priv-card-name">{plan.name}</h4>
                  <div className="priv-card-price">
                    <span className="priv-price-amount">{plan.price}</span>
                    <span className="priv-price-period">{plan.period}</span>
                  </div>
                </div>

                {/* --- BODY --- */}
                <div className="priv-card-body">
                  <div className="priv-card-divider" />
                  <p className="priv-benefits-label">Includes:</p>
                  <ul className="priv-card-benefits">
                    {plan.benefits.map((b, i) => (
                      <li key={i} className="priv-card-benefit">
                        <CheckIcon />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="priv-card-cta">
                    {isActive ? (
                      <span className="priv-btn priv-btn--selected">Selected ✓</span>
                    ) : (
                      <span className="priv-btn priv-btn--default">Select</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <p className="priv-requirement">Requires base plan FU35 / WOW35 or above</p>

      </div>
    </>
  );
}
