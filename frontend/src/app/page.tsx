import HeroCarousel from '@/components/home/HeroCarousel';
import CategoryTabs from '@/components/home/CategoryTabs';
import { getBanners, getSettings, type AppSettings } from '@/lib/api';
import type { Banner } from '@/types';

const FALLBACK_BANNERS: Banner[] = [
  { id: 1, title: 'Banner 1', desktop_image: '/images/banners/banner1-desktop.jpg', mobile_image: '/images/banners/banner1-mobile.jpg', sort_order: 1 },
  { id: 2, title: 'Banner 2', desktop_image: '/images/banners/banner2-desktop.jpg', mobile_image: '/images/banners/banner2-mobile.jpg', sort_order: 2 },
  { id: 3, title: 'Banner 3', desktop_image: '/images/banners/banner3-desktop.jpg', mobile_image: '/images/banners/banner3-mobile.jpg', sort_order: 3 },
];

const FALLBACK_SETTINGS: AppSettings = {
  showDevices: false,
  showMerchandise: false,
  simBasePrice: 19.50,
};

export default async function HomePage() {
  let banners: Banner[];
  try {
    banners = await getBanners();
    if (!banners || banners.length === 0) banners = FALLBACK_BANNERS;
  } catch {
    banners = FALLBACK_BANNERS;
  }

  let settings: AppSettings;
  try {
    settings = await getSettings();
  } catch {
    settings = FALLBACK_SETTINGS;
  }

  return (
    <div className="has-hero">
      <HeroCarousel banners={banners} />
      <CategoryTabs settings={settings} />
    </div>
  );
}
