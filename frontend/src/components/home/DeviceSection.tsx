'use client';

import { useState, useEffect } from 'react';
import { getDevices, getBrands, getBundleProducts } from '@/lib/api';
import type { Device, Brand, DeviceResponse } from '@/types';
import BrandTabs from './BrandTabs';
import DeviceCard from './DeviceCard';
import Pagination from './Pagination';
import USPBar from './USPBar';
import PrivilegeSection from './PrivilegeSection';

const DEVICES_PER_PAGE = 6;

// Set true to show only Bundle API devices and hide brand tabs + local DB devices
const BUNDLE_ONLY_MODE = true;

const deviceUSPItems = [
  {
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" /></svg>
    ),
    text: 'Bundle with PhoneStar',
  },
  {
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
    ),
    text: 'Free Delivery',
  },
  {
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
    ),
    text: '1 Year Warranty',
  },
];

// Convert Bundle API product to Device format
function bundleProductToDevice(product: any, index: number): Device {
  const sortedImages = [...(product.images || [])].sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
  return {
    id: 90000 + product.id, // high ID to avoid collision with local devices
    slug: product.slug || `bundle-${product.id}`,
    name: product.name,
    brand: { id: 0, name: 'itel', slug: 'itel', sort_order: 1, is_active: true },
    brand_id: 0,
    tag: '',
    rrp: product.price,
    monthly_price: Math.round(product.price / 24),
    image_url: sortedImages[0]?.url || '/images/devices/placeholder.png',
    is_sold_out: false,
    is_api_device: true,
    external_id: String(product.id),
    sort_order: index,
  };
}

export default function DeviceSection() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [activeBrand, setActiveBrand] = useState('all');
  const [localDevices, setLocalDevices] = useState<Device[]>([]);
  const [bundleDevices, setBundleDevices] = useState<Device[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalLocal, setTotalLocal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedPrivilege, setSelectedPrivilege] = useState<string | null>(null);

  // Fetch brands and bundle products on mount
  useEffect(() => {
    getBrands()
      .then(setBrands)
      .catch(() => {});

    // Fetch itel devices from Bundle API
    getBundleProducts(20)
      .then((products) => {
        const mapped = products.map((p: any, i: number) => bundleProductToDevice(p, i));
        setBundleDevices(mapped);
      })
      .catch(() => {});
  }, []);

  // Fetch local DB devices when brand or page changes
  useEffect(() => {
    // In bundle-only mode, skip all local DB fetches
    if (BUNDLE_ONLY_MODE) {
      setLoading(false);
      return;
    }

    setLoading(true);

    // If filtering by itel brand, only show bundle devices
    if (activeBrand === 'itel') {
      setLoading(false);
      return;
    }

    // For other brands, fetch from local DB
    // When showing "all", we need to account for bundle devices taking slots on page 1
    const isAll = activeBrand === 'all';
    const bundleCount = bundleDevices.length;

    let localPage = currentPage;
    let localLimit = DEVICES_PER_PAGE;

    if (isAll && currentPage === 1 && bundleCount > 0) {
      // Page 1 shows bundle devices first, then fill remaining slots with local
      const remainingSlots = Math.max(0, DEVICES_PER_PAGE - bundleCount);
      localLimit = remainingSlots;
      localPage = 1;
    } else if (isAll && bundleCount > 0) {
      // Subsequent pages - offset by the bundle devices
      const offset = bundleCount;
      const adjustedIndex = (currentPage - 1) * DEVICES_PER_PAGE - offset;
      localPage = Math.floor(adjustedIndex / DEVICES_PER_PAGE) + 1;
      localLimit = DEVICES_PER_PAGE;
      // If bundle devices spill over, calculate proper skip
      const localSkip = (currentPage - 1) * DEVICES_PER_PAGE - bundleCount;
      if (localSkip >= 0) {
        localPage = Math.floor(localSkip / DEVICES_PER_PAGE) + 1;
        localLimit = DEVICES_PER_PAGE;
      }
    }

    getDevices({
      brand: activeBrand === 'all' ? 'all' : activeBrand,
      page: localPage,
      limit: localLimit,
    })
      .then((res: DeviceResponse) => {
        setLocalDevices(res.data);
        setTotalLocal(res.meta.total);
        // Calculate total pages including bundle devices
        if (isAll) {
          const totalItems = res.meta.total + bundleCount;
          setTotalPages(Math.ceil(totalItems / DEVICES_PER_PAGE));
        } else {
          setTotalPages(res.meta.totalPages);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeBrand, currentPage, bundleDevices]);

  const handleBrandChange = (slug: string) => {
    setActiveBrand(slug);
    setCurrentPage(1);
  };

  const handlePrivilegeChange = (plan: string | null) => {
    setSelectedPrivilege(plan);
    setCurrentPage(1);
  };

  // Compute displayed devices
  let displayDevices: Device[] = [];

  if (BUNDLE_ONLY_MODE) {
    // Only bundle API devices, paginated
    const start = (currentPage - 1) * DEVICES_PER_PAGE;
    displayDevices = bundleDevices.slice(start, start + DEVICES_PER_PAGE);
  } else if (activeBrand === 'itel') {
    const start = (currentPage - 1) * DEVICES_PER_PAGE;
    displayDevices = bundleDevices.slice(start, start + DEVICES_PER_PAGE);
  } else if (activeBrand === 'all') {
    if (currentPage === 1) {
      displayDevices = [...bundleDevices, ...localDevices].slice(0, DEVICES_PER_PAGE);
    } else {
      displayDevices = localDevices;
    }
  } else {
    displayDevices = localDevices;
  }

  // Apply Privilege+ filter — exact monthly price match
  if (selectedPrivilege === 'bijak') {
    displayDevices = displayDevices.filter((d) => d.monthly_price === 25);
  } else if (selectedPrivilege === 'jaga') {
    displayDevices = displayDevices.filter((d) => d.monthly_price === 50);
  }

  const effectiveTotalPages = BUNDLE_ONLY_MODE
    ? Math.ceil(bundleDevices.length / DEVICES_PER_PAGE)
    : activeBrand === 'itel'
      ? Math.ceil(bundleDevices.length / DEVICES_PER_PAGE)
      : totalPages;

  return (
    <div style={{ paddingTop: 16 }}>
      <USPBar items={deviceUSPItems} />
      <PrivilegeSection selected={selectedPrivilege} onSelect={handlePrivilegeChange} />
      {!BUNDLE_ONLY_MODE && <BrandTabs brands={brands} activeBrand={activeBrand} onBrandChange={handleBrandChange} />}

      {!selectedPrivilege ? (
        <div className="device-empty-selection">
          <div className="device-empty-selection-icon">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <h4>Select a PhoneStar package first</h4>
          <p>Choose PhoneStar25 or PhoneStar50 above to view eligible phones.</p>
        </div>
      ) : (
        <>
          {/* Device Grid */}
          <div className="device-list">
            {loading && !BUNDLE_ONLY_MODE && activeBrand !== 'itel' ? (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px 0' }}>
                <div style={{
                  width: 40, height: 40,
                  border: '3px solid var(--border)', borderTopColor: 'var(--tw-blue)',
                  borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                  margin: '0 auto 16px',
                }} />
                <p style={{ color: 'var(--text-muted)' }}>Loading devices...</p>
              </div>
            ) : displayDevices.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px 0' }}>
                <p style={{ color: 'var(--text-muted)' }}>No devices found.</p>
              </div>
            ) : (
              displayDevices.map((device) => (
                <DeviceCard key={`${device.is_api_device ? 'api' : 'db'}-${device.id}`} device={device} />
              ))
            )}
          </div>

          <Pagination
            currentPage={currentPage}
            totalPages={effectiveTotalPages}
            onPageChange={setCurrentPage}
          />
        </>
      )}
    </div>
  );
}
