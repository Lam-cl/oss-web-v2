export function checkoutTotal(input: {
  subtotal: number;
  discount: number;
  pickup: boolean;
  shippingReady: boolean;
  shipping: number;
}): number | null {
  if (!input.pickup && !input.shippingReady) return null;
  return Math.max(0, Math.round((input.subtotal + (input.pickup ? 0 : input.shipping) - input.discount) * 100) / 100);
}
