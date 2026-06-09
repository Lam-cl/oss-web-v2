'use client';

import type { Brand } from '@/types';

interface Props {
  brands: Brand[];
  activeBrand: string;
  onBrandChange: (slug: string) => void;
}

export default function BrandTabs({ brands, activeBrand, onBrandChange }: Props) {
  return (
    <div className="brand-tabs">
      <button
        className={`brand-tab ${activeBrand === 'all' ? 'active' : ''}`}
        onClick={() => onBrandChange('all')}
      >
        All
      </button>
      {brands.map((brand) => (
        <button
          key={brand.id}
          className={`brand-tab ${activeBrand === brand.slug ? 'active' : ''}`}
          onClick={() => onBrandChange(brand.slug)}
        >
          {brand.name}
        </button>
      ))}
    </div>
  );
}
