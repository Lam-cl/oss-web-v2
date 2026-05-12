'use client';

import { useState } from 'react';
import DeviceSection from './DeviceSection';
import SIMSection from './SIMSection';
import type { AppSettings } from '@/lib/api';

type TabKey = 'devices' | 'sim' | 'merchandise';

interface Props {
  settings: AppSettings;
}

const DeviceIcon = (
  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
  </svg>
);
const SimIcon = (
  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
  </svg>
);
const MerchIcon = (
  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
  </svg>
);

function ComingSoonHero({ kind }: { kind: 'devices' | 'merchandise' }) {
  const config = kind === 'devices'
    ? { title: 'Devices', tagline: 'Latest smartphones, bundled with the perfect plan.', accent: '#0074be', accent2: '#273a89', icon: DeviceIcon }
    : { title: 'Merchandise', tagline: 'Exclusive tone wow gear, curated for the community.', accent: '#7c3aed', accent2: '#1a56db', icon: MerchIcon };

  return (
    <div className="coming-soon-hero">
      <div className="cs-orbs" aria-hidden="true">
        <div className="cs-orb cs-orb-1" style={{ background: config.accent }} />
        <div className="cs-orb cs-orb-2" style={{ background: config.accent2 }} />
      </div>

      <div className="cs-content">
        <h2 className="cs-title">{config.title}</h2>
        <h3 className="cs-headline">
          Coming <span className="cs-headline-grad">Soon</span>
        </h3>
        <p className="cs-tagline">{config.tagline}</p>

        <div className="cs-sparkles" aria-hidden="true">
          <span className="cs-spark cs-spark-1">✦</span>
          <span className="cs-spark cs-spark-2">✧</span>
          <span className="cs-spark cs-spark-3">✦</span>
          <span className="cs-spark cs-spark-4">✧</span>
        </div>
      </div>
    </div>
  );
}

export default function CategoryTabs({ settings }: Props) {
  const { showDevices, showMerchandise } = settings;
  const [activeTab, setActiveTab] = useState<TabKey>('sim');

  return (
    <section className="container" style={{ paddingTop: 32, paddingBottom: 40 }}>
      <div className="category-tabs">
        <button
          disabled
          className="category-tab"
          style={{ cursor: 'not-allowed', opacity: 0.6 }}
        >
          {DeviceIcon}
          Coming Soon
        </button>
        <button
          onClick={() => setActiveTab('sim')}
          className={`category-tab ${activeTab === 'sim' ? 'active' : ''}`}
        >
          {SimIcon}
          SIM
        </button>
        <button
          onClick={() => setActiveTab('merchandise')}
          className={`category-tab ${activeTab === 'merchandise' ? 'active' : ''}`}
        >
          {MerchIcon}
          Merchandise
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'devices' && (showDevices ? <DeviceSection /> : <ComingSoonHero kind="devices" />)}
      {activeTab === 'sim' && <SIMSection />}
      {activeTab === 'merchandise' && (showMerchandise ? (
        <div style={{ padding: '48px 0', textAlign: 'center' }}>
          <h2>Merchandise</h2>
          <p style={{ color: 'var(--text-secondary)', marginTop: 8, fontSize: '1.1rem' }}>
            Coming Soon
          </p>
        </div>
      ) : <ComingSoonHero kind="merchandise" />)}
    </section>
  );
}
