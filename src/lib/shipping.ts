import type { CartItem } from '@/types';

export function calculateDeliveryShipping(items: CartItem[]) {
  let shippingTotal = 0;
  let hasMerchandise = false;

  for (const item of items) {
    if (item.type === 'merchandise') {
      hasMerchandise = true;
      continue;
    }

    if (item.type === 'sim') {
      const category = (item.category || item.numberType || '').toUpperCase();
      const isSpecial = ['PREMIUM', 'VIP', 'VVIP'].includes(category);
      if (!isSpecial) shippingTotal += 10 * item.quantity;
    }
  }

  return shippingTotal + (hasMerchandise ? 10 : 0);
}
