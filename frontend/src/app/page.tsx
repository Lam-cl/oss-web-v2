import HeroCarousel from '@/components/home/HeroCarousel';
import CategoryTabs from '@/components/home/CategoryTabs';
import ReferralCapture from '@/components/referral/ReferralCapture';
import { getSettings, type AppSettings } from '@/lib/api';
import type { Banner } from '@/types';

const FALLBACK_BANNERS: Banner[] = [
  { id: 1, title: 'Banner 1', desktop_image: '/images/banners/MBG.png', mobile_image: '/images/banners/MBG.png', sort_order: 1 },
  { id: 2, title: 'Banner 2', desktop_image: '/images/banners/CASHBACK.png', mobile_image: '/images/banners/CASHBACK.png', sort_order: 2 },
  { id: 3, title: 'Banner 3', desktop_image: '/images/banners/INSURANCE.png', mobile_image: '/images/banners/INSURANCE.png', sort_order: 3 },
 { id: 4, title: 'Banner 4', desktop_image: '/images/banners/ESIM.png', mobile_image: '/images/banners/ESIM.png', sort_order: 4 },
];

const FALLBACK_SETTINGS: AppSettings = {
  showDevices: false,
  showMerchandise: false,
  simBasePrice: 19.50,
};

export default async function HomePage() {
  const banners = FALLBACK_BANNERS;

  let settings: AppSettings;
  try {
    settings = await getSettings();
  } catch {
    settings = FALLBACK_SETTINGS;
  }

  return (
    <div className="has-hero">
      <ReferralCapture />
      <HeroCarousel banners={banners} />
      <CategoryTabs settings={settings} />
    </div>
  );
}
