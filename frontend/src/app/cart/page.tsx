'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCartStore } from '@/store/cartStore';
import { formatRM } from '@/lib/utils';
import { calculateDeliveryShipping } from '@/lib/shipping';
import type { CartItem } from '@/types';
import CartMerchandiseEditor from '@/components/merchandise/CartMerchandiseEditor';
import { useMerchandiseProducts } from '@/hooks/useMerchandiseProducts';

export default function CartPage() {
  const { products: merchandiseProducts, loading: merchandiseLoading } = useMerchandiseProducts();
  const router = useRouter();
  const items = useCartStore((state) => state.items);
  const removeItem = useCartStore((state) => state.removeItem);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const updateMerchandiseItem = useCartStore((state) => state.updateMerchandiseItem);
  const clear = useCartStore((state) => state.clear);
  const getTotal = useCartStore((state) => state.getTotal);
  const hasMerchandise = items.some((item) => item.type === 'merchandise');
  const [merchandiseMode, setMerchandiseMode] = useState(hasMerchandise);
  const [portalReady, setPortalReady] = useState(false);
  const [editingItem, setEditingItem] = useState<CartItem | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  useEffect(() => {
    if (hasMerchandise) setMerchandiseMode(true);
  }, [hasMerchandise]);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!summaryOpen) return;
    window.history.pushState({ ...window.history.state, merchCartSummary: true }, '');
    const handlePopState = () => setSummaryOpen(false);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [summaryOpen]);

  const shipping = calculateDeliveryShipping(items);
  const subtotal = getTotal();
  const grandTotal = subtotal + shipping;
  const itemCount = items.reduce((total, item) => total + item.quantity, 0);
  const stockIssues = items.filter((item) => item.type === 'merchandise' && (
    item.availableQuantity === undefined
    || item.quantity > item.availableQuantity
    || item.availableQuantity < (item.minimumOrderQuantity || 1)
  ));
  const checkoutBlocked = merchandiseLoading || stockIssues.length > 0;
  const clearCart = () => {
    if (window.confirm('Clear all items from cart?')) clear();
  };
  const closeEditor = useCallback(() => setEditingItem(null), []);
  const closeSummary = () => {
    if (window.history.state?.merchCartSummary) window.history.back();
    else setSummaryOpen(false);
  };
  const merchandiseLink = '/?tab=merchandise#shop';

  if (!merchandiseMode) {
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
              onClick={clearCart}
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
            <div className="cart-items">
              {items.map((item) => (
                <div key={item.id} className="cart-item-card">
                  {item.image && (
                    <div className="cart-item-thumb">
                      <Image src={item.image} alt={item.name} fill sizes="88px" unoptimized />
                    </div>
                  )}
                  <div className="cart-item-info">
                    <h4>{item.name}</h4>
                    {item.description && <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{item.description}</p>}
                    {item.simType && <span className="sim-type-badge">{item.simType === 'esim' ? 'eSIM' : 'Physical SIM'}</span>}
                    {(item.variant || item.size) && (
                      <div className="cart-item-variants">
                        {item.variant && <span>{item.variant}</span>}
                        {item.size && <span>Size {item.size}</span>}
                      </div>
                    )}
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
                + Continue Shopping
              </Link>
            </div>

            <div className="cart-summary">
              <h3>Order Summary</h3>
              <div className="cart-summary-row">
                <span>Subtotal</span>
                <span>{formatRM(subtotal)}</span>
              </div>
              <div className="cart-summary-row">
                <span>Shipping</span>
                <span>{shipping === 0 ? 'FREE' : formatRM(shipping)}</span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 12px' }}>
                Merchandise delivery is RM10 per order. SIM shipping rules remain unchanged. Self-pickup is free.
              </p>
              <div className="cart-summary-total">
                <span>Total</span>
                <span>{formatRM(grandTotal)}</span>
              </div>
              <button
                className="btn btn-primary"
                style={{ width: '100%', marginTop: 16 }}
                onClick={() => router.push('/checkout')}
              >
                Proceed to Checkout
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <main className={`merch-cart-page${items.length === 0 ? ' is-empty' : ''}`}>
      <div className="container merch-cart-container">
        <header className="merch-cart-header">
          <div className="merch-cart-heading-row">
            <div>
              <span className="merch-cart-eyebrow">tone wow Collection</span>
              <h1>Shopping Cart</h1>
              <p>{itemCount} {itemCount === 1 ? 'item' : 'items'}</p>
            </div>
          </div>
        </header>

        {items.length === 0 ? (
          <section className="merch-cart-empty">
            <span className="merch-cart-empty-icon" aria-hidden="true">
              <svg
                width="34"
                height="34"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="9" cy="20" r="1" />
                <circle cx="18" cy="20" r="1" />
                <path d="M2 3h2l2.4 11.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L20 7H5" />
              </svg>
            </span>
            <h2>Your cart is empty</h2>
            <p>Browse the tone wow collection and add your favourites.</p>
            <Link href={merchandiseLink} className="btn btn-primary">Continue Shopping</Link>
          </section>
        ) : (
          <>
            <div className="merch-cart-layout">
              <section className="merch-cart-items" aria-label="Cart items">
                <div className="merch-cart-list-tools">
                  <button type="button" className="merch-cart-clear" onClick={clearCart}>
                    Clear All
                  </button>
                </div>
                {items.map((item) => (
                  <article
                    key={item.id}
                    className={`merch-cart-item merch-cart-item--${item.type}`}
                  >
                    <div className="merch-cart-thumb">
                      {item.image ? (
                        <Image src={item.image} alt={item.name} fill sizes="96px" unoptimized />
                      ) : (
                        <span>{item.type === 'sim' ? 'SIM' : 'tone wow'}</span>
                      )}
                    </div>

                    <div className="merch-cart-item-copy">
                      <h2>{item.name}</h2>
                      <div className="merch-cart-config-row">
                        {item.type === 'merchandise' ? (
                          <button type="button" className="merch-cart-variation" onClick={() => setEditingItem(item)}>
                            <span>{[item.variant || 'Standard', item.size].filter(Boolean).join(' | ')}</span>
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="m9 18 6-6-6-6" />
                            </svg>
                          </button>
                        ) : (
                          <div className="merch-cart-static-option">
                            {item.simType ? (item.simType === 'esim' ? 'eSIM' : 'Physical SIM') : 'Standard'}
                          </div>
                        )}
                        <div className="merch-cart-quantity" aria-label={`Quantity for ${item.name}`}>
                          <button
                            type="button"
                            onClick={() => updateQuantity(item.id, item.quantity - 1)}
                            aria-label={`Reduce ${item.name} quantity`}
                          >
                            -
                          </button>
                          <span>{item.quantity}</span>
                          <button
                            type="button"
                            disabled={item.type === 'merchandise' && item.availableQuantity !== undefined && item.quantity >= item.availableQuantity}
                            onClick={() => updateQuantity(item.id, item.quantity + 1)}
                            aria-label={`Increase ${item.name} quantity`}
                          >
                            +
                          </button>
                        </div>
                      </div>
                      {item.type === 'merchandise' && (item.minimumOrderQuantity || 1) > 1 && (
                        <p className="merch-cart-minimum-order">
                          Minimum order: {item.minimumOrderQuantity} units
                        </p>
                      )}
                      <div className="merch-cart-line-total">
                        <span>Total:</span>
                        <strong>{formatRM(item.price * item.quantity)}</strong>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="merch-cart-remove"
                      onClick={() => removeItem(item.id)}
                      aria-label={`Remove ${item.name} from cart`}
                      title="Remove item"
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="m19 6-1 14H6L5 6" />
                      </svg>
                    </button>
                  </article>
                ))}

                <Link href={merchandiseLink} className="merch-cart-add-more">
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Continue shopping
                </Link>
              </section>

              <aside className="merch-cart-summary">
                <h2>Order Summary</h2>
                <div className="merch-cart-summary-row">
                  <span>Subtotal</span>
                  <strong>{formatRM(subtotal)}</strong>
                </div>
                <div className="merch-cart-summary-row">
                  <span>Shipping</span>
                  <strong>{shipping === 0 ? 'FREE' : formatRM(shipping)}</strong>
                </div>
                <div className="merch-cart-shipping-note">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M10 17h4V5H2v12h3" />
                    <path d="M14 9h4l4 4v4h-3" />
                    <circle cx="7.5" cy="17.5" r="2.5" />
                    <circle cx="16.5" cy="17.5" r="2.5" />
                  </svg>
                  <span>Merchandise delivery is RM10 per order. Self-pickup is free.</span>
                </div>
                <div className="merch-cart-total">
                  <span>Total</span>
                  <strong>{formatRM(grandTotal)}</strong>
                </div>
                <button
                  type="button"
                  className="btn btn-primary merch-cart-checkout"
                  disabled={checkoutBlocked}
                  onClick={() => router.push('/checkout')}
                >
                  {merchandiseLoading ? 'Checking stock…' : stockIssues.length ? 'Review stock limits' : 'Proceed to Checkout'}
                </button>
              </aside>
            </div>

            {portalReady && createPortal(
              <>
                {summaryOpen && (
                  <div className="merch-cart-summary-backdrop" onMouseDown={closeSummary}>
                    <section className="merch-cart-summary-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-cart-summary-title" onMouseDown={(event) => event.stopPropagation()}>
                      <div className="merch-cart-sheet-handle" />
                      <div className="merch-cart-sheet-header">
                        <h2 id="mobile-cart-summary-title">Order Summary</h2>
                        <button type="button" onClick={closeSummary} aria-label="Close order summary">×</button>
                      </div>
                      <div className="merch-cart-summary-row"><span>Subtotal</span><strong>{formatRM(subtotal)}</strong></div>
                      <div className="merch-cart-summary-row"><span>Shipping</span><strong>{shipping === 0 ? 'FREE' : formatRM(shipping)}</strong></div>
                      <div className="merch-cart-shipping-note"><span>Merchandise delivery is RM10 per order. Self-pickup is free.</span></div>
                      <div className="merch-cart-total"><span>Total</span><strong>{formatRM(grandTotal)}</strong></div>
                    </section>
                  </div>
                )}
                <div className="merch-cart-mobile-checkout">
                  <button type="button" className="merch-cart-summary-toggle" onClick={() => setSummaryOpen(true)} aria-expanded={summaryOpen}>
                    <span>View summary</span>
                    <strong>{formatRM(grandTotal)}</strong>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m18 15-6-6-6 6" />
                    </svg>
                  </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={checkoutBlocked}
                  onClick={() => router.push('/checkout')}
                >
                  {merchandiseLoading ? 'Checking…' : stockIssues.length ? 'Review stock' : 'Checkout'}
                </button>
                </div>
              </>,
              document.body,
            )}
          </>
        )}
      </div>
      {editingItem && (() => {
        const product = merchandiseProducts.find((candidate) => (
          candidate.id === editingItem.productId
          || candidate.slug === editingItem.slug
          || candidate.name === editingItem.name
        ));
        if (!product) return null;
        return (
          <CartMerchandiseEditor
            item={editingItem}
            product={product}
            reservedQuantityByVariant={items.reduce<Record<number, number>>((totals, candidate) => {
              if (candidate.id !== editingItem.id && candidate.type === 'merchandise' && candidate.bundleVariantId) {
                totals[candidate.bundleVariantId] = (totals[candidate.bundleVariantId] || 0) + candidate.quantity;
              }
              return totals;
            }, {})}
            onClose={closeEditor}
            onConfirm={(updates) => {
              updateMerchandiseItem(editingItem.id, updates);
            }}
          />
        );
      })()}
    </main>
  );
}
