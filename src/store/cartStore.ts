'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartItem } from '@/types';
import { getMerchandiseVariantId, getMerchandiseVariantInventory, merchandiseVariantKey, type MerchandiseProduct } from '@/data/merchandise';

function clampQuantity(item: { minimumOrderQuantity?: number; availableQuantity?: number }, requested: number) {
  const minimum = Math.max(1, item.minimumOrderQuantity || 1);
  const normalized = Math.max(minimum, Math.floor(Number(requested) || minimum));
  if (item.availableQuantity === undefined) return normalized;
  return Math.min(Math.max(0, item.availableQuantity), normalized);
}

export function cartItemsWithUpdatedQuantity(items: CartItem[], id: string, requested: number) {
  return items.flatMap((item) => {
    if (item.id !== id) return [item];
    const minimum = Math.max(1, item.minimumOrderQuantity || 1);
    return requested < minimum ? [] : [{ ...item, quantity: clampQuantity(item, requested) }];
  });
}

interface CartState {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'id' | 'addedAt'> & { id?: string }) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  updateMerchandiseItem: (
    id: string,
    updates: Pick<CartItem, 'variant' | 'size' | 'image' | 'quantity' | 'bundleVariantId' | 'availableQuantity'>,
  ) => void;
  reconcileMerchandiseCatalog: (products: MerchandiseProduct[]) => void;
  clear: () => void;
  getTotal: () => number;
  getCount: () => number;
}

export function reconcileMerchandiseCartItems(items: CartItem[], products: MerchandiseProduct[]) {
  return items.map((item) => {
    if (item.type !== 'merchandise') return item;
    const product = products.find((candidate) => (
      candidate.apiProductId === item.bundleProductId
      || candidate.id === item.productId
      || candidate.slug === item.slug
      || candidate.name === item.name
    ));
    if (!product || !product.apiProductId) return item;
    let option = product.options.find((candidate) => candidate.name === item.variant);
    let bundleVariantId = option
      ? getMerchandiseVariantId(product, option.name, item.size)
      : undefined;
    let singleVariantRebind = false;
    const stableIdentity = product.id === item.productId || product.slug === item.slug;
    const candidateSingleOption = product.options.length === 1 ? product.options[0] : null;
    const singleOption = stableIdentity && candidateSingleOption
      && !(candidateSingleOption.sizes || product.sizes)?.length ? candidateSingleOption : null;
    if (singleOption) {
      const singleVariantId = getMerchandiseVariantId(product, singleOption.name);
      if (singleVariantId) {
        option = singleOption;
        bundleVariantId = singleVariantId;
        singleVariantRebind = true;
      }
    }
    if (!option || !bundleVariantId
      || !singleVariantRebind && (product.apiProductId !== item.bundleProductId
        || bundleVariantId !== item.bundleVariantId)) return {
      ...item,
      productId: product.id,
      bundleProductId: product.apiProductId,
      bundleVariantId: undefined,
      variant: undefined,
      size: undefined,
      availableQuantity: undefined,
      selectionRequired: 'Variant selection required' as const,
    };
    const availableQuantity = getMerchandiseVariantInventory(product, bundleVariantId);
    const { selectionRequired: _selectionRequired, ...current } = item;
    return {
      ...current,
      productId: product.id,
      bundleProductId: product.apiProductId,
      bundleVariantId,
      slug: product.slug,
      name: product.name,
      description: product.unitLabel || product.description,
      variant: option.name,
      image: option.image,
      price: product.variantPrices?.[merchandiseVariantKey(option.name)] ?? product.price,
      minimumOrderQuantity: product.minimumOrderQuantity,
      availableQuantity,
      quantity: clampQuantity({ minimumOrderQuantity: product.minimumOrderQuantity, availableQuantity }, item.quantity),
    };
  });
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (item) => {
        set((state) => {
          const minimumOrderQuantity = Math.max(1, item.minimumOrderQuantity || 1);
          const availableQuantity = item.availableQuantity;
          const existing = state.items.find(
            (i) => item.type === 'merchandise'
              ? i.type === 'merchandise'
                && i.productId === item.productId
                && i.bundleVariantId === item.bundleVariantId
                && i.variant === item.variant
                && i.size === item.size
              : i.type === item.type && i.plan === item.plan && i.number === item.number,
          );
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.id === existing.id
                  ? {
                      ...i,
                      minimumOrderQuantity,
                      availableQuantity,
                      quantity: clampQuantity(
                        { minimumOrderQuantity, availableQuantity },
                        i.quantity + Math.max(minimumOrderQuantity, item.quantity || 1),
                      ),
                    }
                  : i,
              ),
            };
          }
          return {
            items: [
              ...state.items,
              {
                ...item,
                id: item.id || Date.now().toString(),
                minimumOrderQuantity,
                availableQuantity,
                quantity: clampQuantity({ minimumOrderQuantity, availableQuantity }, item.quantity || 1),
                addedAt: new Date().toISOString(),
              } as CartItem,
            ],
          };
        });
      },

      removeItem: (id) => {
        set((state) => ({
          items: state.items.filter((i) => i.id !== id),
        }));
      },

      updateQuantity: (id, quantity) => {
        set((state) => ({ items: cartItemsWithUpdatedQuantity(state.items, id, quantity) }));
      },

      updateMerchandiseItem: (id, updates) => {
        set((state) => {
          const current = state.items.find((item) => item.id === id);
          if (!current || current.type !== 'merchandise') return state;
          const minimumOrderQuantity = Math.max(1, current.minimumOrderQuantity || 1);

          const duplicate = state.items.find(
            (item) => item.id !== id
              && item.type === 'merchandise'
              && item.productId === current.productId
              && item.bundleVariantId === updates.bundleVariantId
              && item.variant === updates.variant
              && item.size === updates.size,
          );

          if (duplicate) {
            return {
              items: state.items
                .filter((item) => item.id !== id)
                .map((item) => item.id === duplicate.id
                  ? {
                      ...item,
                      image: updates.image,
                      bundleVariantId: updates.bundleVariantId,
                      availableQuantity: updates.availableQuantity,
                      minimumOrderQuantity,
                      quantity: clampQuantity(
                        { minimumOrderQuantity, availableQuantity: updates.availableQuantity },
                        item.quantity + Math.max(minimumOrderQuantity, updates.quantity),
                      ),
                    }
                  : item),
            };
          }

          return {
            items: state.items.map((item) => item.id === id
              ? {
                  ...item,
                  variant: updates.variant,
                  size: updates.size,
                  image: updates.image,
                  bundleVariantId: updates.bundleVariantId,
                  availableQuantity: updates.availableQuantity,
                  minimumOrderQuantity,
                  quantity: clampQuantity(
                    { minimumOrderQuantity, availableQuantity: updates.availableQuantity },
                    updates.quantity,
                  ),
                }
              : item),
          };
        });
      },

      reconcileMerchandiseCatalog: (products) => {
        set((state) => ({ items: reconcileMerchandiseCartItems(state.items, products) }));
      },

      clear: () => set({ items: [] }),

      getTotal: () => {
        return get().items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      },

      getCount: () => {
        return get().items.reduce((sum, item) => sum + item.quantity, 0);
      },
    }),
    {
      name: 'tw_cart',
    },
  ),
);
