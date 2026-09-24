import type { MerchandiseProduct } from '@/data/merchandise';
import type { MerchandiseOrderEntry } from '@/lib/merchandiseOrder.server';

// Catalogue identity survives title edits and Bundle republication. Provider IDs
// cover the existing fallback feed when the catalogue projection is unavailable.
const featured = [
  { id: '26872431-982f-4ba5-bf84-51a9585a6e0b', apiProductId: 137 }, // Comix Shirt
  { id: 'e6c11fca-97bf-4aa6-a644-e52d25d98895', apiProductId: 132 }, // BASICS Shirt
  { id: '160b913b-c01c-424c-92f0-75380e941909', apiProductId: null }, // ACTION Shirt (draft until published)
  { id: '39a00000-0000-4000-8000-000000000039', apiProductId: 138 }, // TWE SuperLITE SIM
  { id: '40a00000-0000-4000-8000-000000000040', apiProductId: 139 }, // TWE BIZ SIM
  { id: 'd8ddbba5-c901-4a50-ae7f-bbd66fc424c3', apiProductId: 144 }, // Baseball Cap
] as const;

export function orderMerchandiseForAll<T extends Pick<MerchandiseProduct, 'id' | 'apiProductId'>>(products: T[], entries?: MerchandiseOrderEntry[]): T[] {
  const rank = (product: T) => {
    if (entries?.length) {
      const index = entries.findIndex(item => item.catalogueId === product.id || item.bundleProductId === product.apiProductId);
      return index < 0 ? entries.length : index;
    }
    const index = featured.findIndex(item => item.id === product.id || item.apiProductId === product.apiProductId);
    return index < 0 ? featured.length : index;
  };
  // Sort a copy; keep equal-ranked (including all remaining) products in feed order.
  return products.map((product, index) => ({ product, index, rank: rank(product) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ product }) => product);
}
