import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Merdeka Promo | tone wow',
  description: 'Save up to 2 months on selected 6 or 12-month tone wow FU plans with one upfront payment.',
};

export default function MerdekaPromoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
