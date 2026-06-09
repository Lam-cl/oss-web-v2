'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCartStore } from '@/store/cartStore';
import { formatRM } from '@/lib/utils';

function calculateShipping(items: any[]) {
  let shippingTotal = 0;
  for (const item of items) {
    if (item.type === 'sim') {
      const cat = (item.category || item.numberType || '').toUpperCase();
      const isSpecial = ['PREMIUM', 'VIP', 'VVIP'].includes(cat);
      if (!isSpecial) {
        shippingTotal += 10 * item.quantity;
      }
    }
  }
  return shippingTotal;
}

export default function CartPage() {
  const router = useRouter();
  const items = useCartStore((s) => s.items);
  const removeItem = useCartStore((s) => s.removeItem);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const clear = useCartStore((s) => s.clear);
  const getTotal = useCartStore((s) => s.getTotal);

  const shipping = calculateShipping(items);
  const grandTotal = getTotal() + shipping;

  return (
    <div className="container" style={{ paddingTop: 48, paddingBottom: 48 }}>
      <div style={{ marginBottom: 24 }}>
        <Link href="/" style={{ color: 'var(--tw-blue)', fontWeight: 500 }}>← Continue Shopping</Link>
      </div>

      <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Your Cart</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: 6 }}>
            {items.length} item(s) in your cart
          </p>
        </div>
        {items.length > 0 && (
          <button
            onClick={() => { if (confirm('Clear all items from cart?')) clear(); }}
            style={{
              background: 'none',
              border: 'none',
              color: '#ef4444',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
              padding: '8px 0',
            }}
          >
            Clear All
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '80px 20px' }}>
          <h3 style={{ marginBottom: 8 }}>Your cart is empty</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>Browse our SIM plans and add items to get started.</p>
          <Link href="/" className="btn btn-primary">Shop Now</Link>
        </div>
      ) : (
        <div className="cart-grid">
          {/* Cart Items */}
          <div className="cart-items">
            {items.map((item) => (
              <div key={item.id} className="cart-item-card">
                <div className="cart-item-info">
                  <h4>{item.name}</h4>
                  {item.description && <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{item.description}</p>}
                  {item.simType && <span className="sim-type-badge">{item.simType === 'esim' ? 'eSIM' : 'Physical SIM'}</span>}
                </div>
                <div className="cart-item-actions">
                  <div className="quantity-control">
                    <button onClick={() => updateQuantity(item.id, item.quantity - 1)}>-</button>
                    <span>{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.id, item.quantity + 1)}>+</button>
                  </div>
                  <div className="cart-item-price">{formatRM(item.price * item.quantity)}</div>
                  <button className="cart-remove-btn" onClick={() => removeItem(item.id)}>Remove</button>
                </div>
              </div>
            ))}

            {/* Add Another Plan Button */}
            <Link
              href="/"
              style={{
                display: 'block',
                textAlign: 'center',
                padding: '14px 24px',
                border: '2px dashed var(--border-color, #d1d5db)',
                borderRadius: 12,
                color: 'var(--tw-blue)',
                fontWeight: 600,
                fontSize: 15,
                textDecoration: 'none',
                marginTop: 12,
                transition: 'all 0.2s',
              }}
            >
              + Add Another Plan
            </Link>
          </div>

          {/* Cart Summary */}
          <div className="cart-summary">
            <h3>Order Summary</h3>
            <div className="cart-summary-row">
              <span>Subtotal</span>
              <span>{formatRM(getTotal())}</span>
            </div>
            <div className="cart-summary-row">
              <span>Shipping</span>
              <span>{shipping === 0 ? 'FREE' : formatRM(shipping)}</span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 12px' }}>
              Shipping: RM10 per BIASA SIM. Special numbers (PREMIUM/VIP/VVIP) ship for FREE.
            </p>
            <div className="cart-summary-total">
              <span>Total</span>
              <span>{formatRM(grandTotal)}</span>
            </div>
            <button
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 16 }}
              onClick={() => router.push('/sim/checkout')}
            >
              Proceed to Checkout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
