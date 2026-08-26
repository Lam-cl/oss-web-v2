'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { DayPicker } from 'react-day-picker';
import { useCartStore } from '@/store/cartStore';
import { initiateBundleGuestPayment } from '@/lib/api';
import { formatRM } from '@/lib/utils';
import { MALAYSIAN_STATES } from '@/lib/constants';
import { lookupMalaysianPostcode } from '@/lib/malaysiaPostcodes';
import { calculateMerchandiseCourierCharge, type ShippingSettings } from '@/lib/shipping';
import { isKualaLumpurWorkingDay, localDateToPickupDate, malaysiaDate, minimumPickupDate, pickupAddress, pickupDateToLocalDate } from '@/lib/pickup';
import { useMerchandiseProducts } from '@/hooks/useMerchandiseProducts';

const verifyBtnStyle: React.CSSProperties = {
  height: 46,
  padding: '0 18px',
  background: '#eab308',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 46,
};

const ENABLED_PAYMENT_METHODS = new Set(
  (process.env.NEXT_PUBLIC_MERCH_PAYMENT_METHODS || '16').split(',').map((value) => value.trim()),
);

export default function CheckoutPage() {
  const items = useCartStore((s) => s.items);
  const getTotal = useCartStore((s) => s.getTotal);
  const { loading: merchandiseLoading } = useMerchandiseProducts();
  const stockIssues = items.filter((item) => item.type === 'merchandise' && (
    item.selectionRequired
    ||
    item.availableQuantity === undefined
    || item.quantity > item.availableQuantity
    || item.availableQuantity < (item.minimumOrderQuantity || 1)
  ));

  const [pickupOption, setPickupOption] = useState<'delivery' | 'self'>('delivery');
  const sameAsBilling = true;

  const [form, setForm] = useState({
    firstName: '', lastName: '',
    email: '', phone: '', ic: '',
    billingAddress: '', billingCity: '', billingState: '', billingPostcode: '', pickupDate: '',
    shippingFirstName: '', shippingLastName: '',
    shippingAddress: '', shippingCity: '', shippingState: '', shippingPostcode: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [paymentData, setPaymentData] = useState<{
    paymentUrl: string;
    paymentParams: Record<string, string>;
  } | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [shippingSettings, setShippingSettings] = useState<ShippingSettings | null>(null);
  const [shippingSettingsError, setShippingSettingsError] = useState('');
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [pickupCalendarOpen, setPickupCalendarOpen] = useState(false);
  const pickupMinimumDate = minimumPickupDate(malaysiaDate());
  const pickupMinimumLocalDate = pickupDateToLocalDate(pickupMinimumDate)!;
  const selectedPickupDate = pickupDateToLocalDate(form.pickupDate);
  const [paymentMethodId, setPaymentMethodId] = useState<'16' | '2' | '3'>('16');
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState<{ code: string; discount: number } | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoMessage, setPromoMessage] = useState('');

  useEffect(() => setPortalReady(true), []);
  useEffect(() => { fetch('/shipping-settings-api', { cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject()).then(setShippingSettings).catch(() => setShippingSettingsError('Courier settings are temporarily unavailable. Please try again.')); }, []);

  useEffect(() => {
    if (!summaryOpen) return;
    window.history.pushState({ ...window.history.state, checkoutSummary: true }, '');
    const handlePopState = () => setSummaryOpen(false);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [summaryOpen]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name } = e.target;
    const isPostcode = name === 'billingPostcode' || name === 'shippingPostcode';
    const value = isPostcode ? e.target.value.replace(/\D/g, '').slice(0, 5) : e.target.value;
    setForm((previous) => {
      const next = { ...previous, [name]: value };
      const location = isPostcode ? lookupMalaysianPostcode(value) : null;
      if (location) {
        if (name === 'billingPostcode') { next.billingCity = location.city; next.billingState = location.state; }
        else { next.shippingCity = location.city; next.shippingState = location.state; }
      }
      return next;
    });
  };

  const shippingState = sameAsBilling ? form.billingState : form.shippingState;
  const courier = calculateMerchandiseCourierCharge(items, shippingState, shippingSettings || undefined);
  const shipping = pickupOption === 'self' ? 0 : courier.amount;
  const shippingPending = pickupOption === 'delivery' && (!shippingSettings || !shippingState);
  const shippingUnavailable = pickupOption === 'delivery' && Boolean(shippingSettings && shippingState && courier.unclassified.length);
  const merchandiseSubtotal = getTotal();
  const grandTotal = Math.max(0, merchandiseSubtotal + shipping - (promo?.discount || 0));
  const itemLabel = (item: (typeof items)[number]) => {
    if (item.selectionRequired) return `${item.name} (${item.selectionRequired})`;
    const selection = [item.variant, item.size].filter(Boolean).join(' · ');
    return `${item.name}${selection ? ` (${selection})` : ''}`;
  };

  const checkoutItems = () => items.map((item) => {
    if (item.selectionRequired) throw new Error(`${item.name}: ${item.selectionRequired}.`);
    if (!item.bundleProductId || !item.bundleVariantId) throw new Error(`${item.name} needs to be refreshed from the merchandise catalogue.`);
    return { productId: item.bundleProductId, variantId: item.bundleVariantId, quantity: item.quantity };
  });

  async function applyPromo() {
    const code = promoInput.trim().toUpperCase();
    if (!code) { setPromoMessage('Enter a promo code.'); return; }
    setPromoBusy(true); setPromoMessage('');
    try {
      const response = await fetch('/bundle/vouchers/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, items: checkoutItems(), customerEmail: form.email }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || payload.message || 'Promo code is not valid.');
      const value = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
      const discount = Number(value.discountAmount ?? value.discount ?? value.voucherDiscount ?? value.amountOff);
      if (!Number.isFinite(discount) || discount < 0 || discount > merchandiseSubtotal) throw new Error('Promo code returned an invalid discount.');
      setPromo({ code, discount }); setPromoInput(code); setPromoMessage(`Promo applied. You save ${formatRM(discount)}.`);
    } catch (reason) { setPromo(null); setPromoMessage(reason instanceof Error ? reason.message : 'Promo validation failed.'); }
    finally { setPromoBusy(false); }
  }

  const renderPromo = () => <section className="merch-checkout-promo" aria-label="Promo Code"><label>Promo Code</label><div><input value={promoInput} disabled={promoBusy || Boolean(promo)} onChange={(event) => { setPromoInput(event.target.value.toUpperCase()); setPromoMessage(''); }} placeholder="Enter code"/><button type="button" disabled={promoBusy} onClick={() => promo ? (setPromo(null), setPromoInput(''), setPromoMessage('')) : applyPromo()}>{promoBusy ? 'Checking…' : promo ? 'Remove' : 'Apply'}</button></div>{promoMessage && <small className={promo ? 'is-success' : 'is-error'}>{promoMessage}</small>}</section>;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shippingSettings || shippingSettingsError) {
      setError(shippingSettingsError || 'Loading courier settings. Please wait.');
      return;
    }
    if (merchandiseLoading) {
      setError('Please wait while current stock is checked.');
      return;
    }
    if (stockIssues.length) {
      setError('One or more cart items exceed the currently available stock. Return to cart and adjust the quantity.');
      return;
    }
    if (!form.firstName || !form.lastName || !form.email || !form.phone || !form.ic) {
      setError('Please fill in all required fields');
      return;
    }
    if (!form.billingAddress || !form.billingCity || !form.billingState || !/^\d{5}$/.test(form.billingPostcode)) {
      setError('Please enter a complete billing address');
      return;
    }
    if (pickupOption === 'self' && (!isKualaLumpurWorkingDay(form.pickupDate) || form.pickupDate < pickupMinimumDate)) {
      setError(`Please select a collection date from ${pickupMinimumLocalDate.toLocaleDateString('en-GB')} onward`);
      return;
    }
    if (pickupOption === 'delivery' && courier.unclassified.length > 0) {
      setError(`Delivery is not configured for: ${courier.unclassified.join(', ')}`);
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const customerName = `${form.firstName} ${form.lastName}`.trim();
      const shippingAddr = pickupOption === 'self' ? {
        address1: pickupAddress(form.pickupDate), address2: '', address3: '',
        city: '', state: '', postcode: '',
      } : sameAsBilling ? {
        address1: form.billingAddress, address2: '', address3: '',
        city: form.billingCity, state: form.billingState, postcode: form.billingPostcode,
      } : {
        address1: form.shippingAddress, address2: '', address3: '',
        city: form.shippingCity, state: form.shippingState, postcode: form.shippingPostcode,
      };

      const resolvedCheckoutItems = checkoutItems();
      const orderItemSummary = items.map((item) => {
        const selection = [item.variant, item.size].filter(Boolean).join(' / ');
        return `${item.name}${selection ? ` [${selection}]` : ''} x${item.quantity}`;
      }).join('; ');

      const billingAddress = {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone,
        fullName: customerName,
        address: form.billingAddress,
        city: form.billingCity,
        state: form.billingState,
        country: 'Malaysia',
        postalCode: form.billingPostcode,
        phoneNumber: form.phone,
        idNumber: form.ic,
      };
      const bundleShippingAddress = {
        firstName: pickupOption === 'self' || sameAsBilling ? form.firstName : form.shippingFirstName,
        lastName: pickupOption === 'self' || sameAsBilling ? form.lastName : form.shippingLastName,
        email: form.email,
        phone: form.phone,
        fullName: pickupOption === 'self'
          ? customerName
          : `${sameAsBilling ? form.firstName : form.shippingFirstName} ${sameAsBilling ? form.lastName : form.shippingLastName}`.trim(),
        address: shippingAddr.address1,
        city: shippingAddr.city,
        state: shippingAddr.state,
        country: 'Malaysia',
        postalCode: shippingAddr.postcode,
        phoneNumber: form.phone,
      };

      const payment = await initiateBundleGuestPayment({
        customerName,
        customerEmail: form.email,
        customerPhone: form.phone,
        description: `tone wow Merchandise Order: ${orderItemSummary} (${formatRM(grandTotal)})`,
        items: resolvedCheckoutItems,
        billingAddress,
        shippingAddress: bundleShippingAddress,
        isGuest: true,
        deliveryOption: pickupOption === 'self' ? 'PICKUP' : 'DELIVER',
        paymentMethodId,
        voucherCode: promo?.code,
        expectedTotal: grandTotal,
      });

      if (!payment.success || !payment.paymentUrl) {
        throw new Error(payment.error || 'Failed to initiate payment');
      }

      if (payment.orderId) localStorage.setItem('tw_pending_order', payment.orderId);
      if (payment.orderId && payment.referenceNumber) {
        const callbackReference = Object.entries(payment.paymentParams || {}).find(([key]) => (
          ['v_cartid', 'cartid', 'refno'].includes(key.toLowerCase())
        ))?.[1] || '';
        localStorage.setItem('tw_pending_merchandise_order', JSON.stringify({
          orderId: payment.orderId,
          referenceNumber: payment.referenceNumber,
          paymentReference: callbackReference,
          storedAt: Date.now(),
        }));
      }
      if (payment.redirectMethod === 'GET') {
        window.location.assign(payment.paymentUrl);
        return;
      }
      setPaymentData({
        paymentUrl: payment.paymentUrl,
        paymentParams: payment.paymentParams || {},
      });
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const closeSummary = () => {
    if (window.history.state?.checkoutSummary) window.history.back();
    else setSummaryOpen(false);
  };

  // POST redirect fallback for gateways that require form fields.
  if (paymentData) {
    return (
      <div className="merch-checkout-redirect">
        <div className="merch-checkout-spinner" />
        <h3>Redirecting to payment...</h3>
        <p>
          Please wait. You will be redirected to the payment page.
        </p>
        <form
          id="payment-form"
          method="POST"
          action={paymentData.paymentUrl}
          ref={(form) => {
            if (form) setTimeout(() => form.submit(), 1000);
          }}
        >
          {Object.entries(paymentData.paymentParams).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
        </form>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="merch-checkout-empty">
        <h3>Your cart is empty</h3>
        <p>Add items before checking out.</p>
        <Link href="/?tab=merchandise#shop" className="btn btn-primary">Shop Merchandise</Link>
      </div>
    );
  }

  const card: React.CSSProperties = { background: '#fff', borderRadius: 8, padding: '22px 24px', border: '1px solid #e2e8f0', marginBottom: 14 };
  const lbl: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 };
  const inp: React.CSSProperties = { width: '100%', padding: '12px 14px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none', background: '#fff' };
  const sec: React.CSSProperties = { fontSize: 16, fontWeight: 800, color: '#0f172a', marginBottom: 16 };
  return (
    <div className="merch-checkout-page">
      <div className="merch-checkout-layout">

        {/* ── SIDEBAR ── */}
        <aside className="merch-checkout-sidebar">
          <div className="sidebar-order">
            <h4 className="sidebar-order-title">Order Summary</h4>
            {items.map((item) => (
              <div key={item.id} className="sidebar-order-row">
                <span className="sidebar-order-description">{itemLabel(item)} × {item.quantity}</span>
                <span>{formatRM(item.price * item.quantity)}</span>
              </div>
            ))}
            <div className="sidebar-order-row">
              <span>Shipping</span>
              <span>{shippingPending ? 'Select state' : shippingUnavailable ? 'Unavailable' : shipping === 0 ? 'FREE' : formatRM(shipping)}</span>
            </div>
            {promo && <div className="sidebar-order-row merch-promo-discount"><span>Promo ({promo.code})</span><span>−{formatRM(promo.discount)}</span></div>}
            <div className="sidebar-order-divider" />
            <div className="sidebar-order-row sidebar-order-total">
              <span>{shippingPending || shippingUnavailable ? 'Total before shipping' : 'Total'}</span>
              <span>{formatRM(grandTotal)}</span>
            </div>
          </div>
          {renderPromo()}
          <section className="merch-checkout-payment">
            <h4>Payment Method</h4>
            <label className={paymentMethodId === '16' ? 'active' : ''}><input type="radio" name="merchPaymentMethod" value="16" checked={paymentMethodId === '16'} onChange={() => setPaymentMethodId('16')} />Online Banking (FPX)</label>
            {ENABLED_PAYMENT_METHODS.has('2') && <label className={paymentMethodId === '2' ? 'active' : ''}><input type="radio" name="merchPaymentMethod" value="2" checked={paymentMethodId === '2'} onChange={() => setPaymentMethodId('2')} />Credit / Debit Card</label>}
            {ENABLED_PAYMENT_METHODS.has('3') && <label className={paymentMethodId === '3' ? 'active' : ''}><input type="radio" name="merchPaymentMethod" value="3" checked={paymentMethodId === '3'} onChange={() => setPaymentMethodId('3')} />eWallet</label>}
            <div className="merch-checkout-payment-terms">By placing an order you agree to our <strong>Terms &amp; Conditions</strong> and <strong>Privacy Policy</strong>.</div>
            <button type="submit" form="checkout-form" className="btn merch-checkout-pay merch-checkout-sidebar-pay" disabled={submitting || merchandiseLoading || stockIssues.length > 0 || shippingPending || shippingUnavailable}>
              {submitting ? 'Processing...' : 'Pay Now'}
            </button>
          </section>
        </aside>

        {/* ── MAIN ── */}
        <main className="merch-checkout-main">
          <Link href="/cart" className="merch-checkout-back">← Back to cart</Link>
          <span className="merch-cart-eyebrow">Secure checkout</span>
          <h1>Complete Your Order</h1>
          <p className="merch-checkout-intro">Enter your details and review your order before payment.</p>

          <form id="checkout-form" className="merch-checkout-form" onSubmit={handleSubmit}>

            {/* Identity */}
            <div style={card}>
              <p style={sec}>Identity</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                <div><label style={lbl}>First Name <span style={{ color: '#ef4444' }}>*</span></label><input name="firstName" value={form.firstName} onChange={handleChange} required style={inp} /></div>
                <div><label style={lbl}>Last Name <span style={{ color: '#ef4444' }}>*</span></label><input name="lastName" value={form.lastName} onChange={handleChange} required style={inp} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                <div><label style={lbl}>Email <span style={{ color: '#ef4444' }}>*</span></label><input name="email" type="email" value={form.email} onChange={handleChange} required style={inp} /></div>
                <div><label style={lbl}>Phone <span style={{ color: '#ef4444' }}>*</span></label><input name="phone" type="tel" value={form.phone} onChange={handleChange} required style={inp} /></div>
              </div>
              <div><label style={lbl}>NRIC / Passport <span style={{ color: '#ef4444' }}>*</span></label><input name="ic" value={form.ic} onChange={handleChange} required style={inp} /></div>
            </div>

            {/* Delivery */}
            <div style={card}>
              <p style={sec}>Delivery Option</p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
                {(['delivery', 'self'] as const).map((o) => (
                  <label key={o} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderRadius: 10, border: pickupOption === o ? '2px solid #2563eb' : '2px solid #d1d5db', background: pickupOption === o ? '#eff6ff' : '#fff', cursor: 'pointer', fontSize: 14, fontWeight: pickupOption === o ? 600 : 400, flex: '1 1 0', minWidth: 140, justifyContent: 'center' }}>
                    <input type="radio" name="pickupOption" value={o} checked={pickupOption === o} onChange={() => setPickupOption(o)} style={{ accentColor: '#2563eb' }} />
                    {o === 'delivery' ? 'Delivery' : 'Self Pick-up'}
                  </label>
                ))}
              </div>

              {pickupOption === 'self' && (
                <div>
                  <p style={{ ...sec, marginBottom: 14 }}>Self Pick-up Details</p>
                  <div className="merch-pickup-date" style={{ marginBottom: 14 }} onKeyDown={(event) => { if (event.key === 'Escape') setPickupCalendarOpen(false); }}>
                    <label style={lbl}>Collection date <span style={{ color: '#ef4444' }}>*</span></label>
                    <button type="button" className="merch-pickup-date-trigger" aria-haspopup="dialog" aria-expanded={pickupCalendarOpen} onClick={() => setPickupCalendarOpen((open) => !open)}>
                      <span>{selectedPickupDate ? selectedPickupDate.toLocaleDateString('en-GB') : 'dd/mm/yyyy'}</span>
                      <span aria-hidden="true">▣</span>
                    </button>
                    <input type="hidden" name="pickupDate" value={form.pickupDate} />
                    {pickupCalendarOpen && portalReady && createPortal(
                      <>
                      <button type="button" className="merch-pickup-calendar-backdrop" aria-label="Close collection calendar" onClick={() => setPickupCalendarOpen(false)} />
                      <div className="merch-pickup-calendar" role="dialog" aria-modal="true" aria-label="Choose collection date">
                        <DayPicker
                          mode="single"
                          selected={selectedPickupDate}
                          defaultMonth={selectedPickupDate || pickupMinimumLocalDate}
                          disabled={[{ before: pickupMinimumLocalDate }, (date) => !isKualaLumpurWorkingDay(localDateToPickupDate(date))]}
                          navLayout="after"
                          onSelect={(date) => {
                            if (!date) return;
                            const value = localDateToPickupDate(date);
                            if (!isKualaLumpurWorkingDay(value) || value < pickupMinimumDate) return;
                            setForm((previous) => ({ ...previous, pickupDate: value }));
                            setError('');
                            setPickupCalendarOpen(false);
                          }}
                        />
                      </div>
                      </>, document.body)}
                  </div>
                  <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: 13, fontWeight: 400, lineHeight: 1.45 }}>Available after 3 Kuala Lumpur working days. Weekends and public holidays are unavailable.</p>
                </div>
              )}

              <p style={{ ...sec, marginBottom: 14 }}>{pickupOption === 'self' ? 'Billing Address' : 'Shipping Address'}</p>
              <div style={{ marginBottom: 14 }}><label style={lbl}>Address <span style={{ color: '#ef4444' }}>*</span></label><input name="billingAddress" value={form.billingAddress} onChange={handleChange} required style={inp} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
                <div><label style={lbl}>City <span style={{ color: '#ef4444' }}>*</span></label><input name="billingCity" value={form.billingCity} onChange={handleChange} required style={inp} /></div>
                <div><label style={lbl}>State <span style={{ color: '#ef4444' }}>*</span></label><select name="billingState" value={form.billingState} onChange={handleChange} required style={{ ...inp, height: 46 }}><option value="" disabled>Select state</option>{MALAYSIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
                <div><label style={lbl}>Postcode <span style={{ color: '#ef4444' }}>*</span></label><input name="billingPostcode" value={form.billingPostcode} onChange={handleChange} required pattern="[0-9]{5}" inputMode="numeric" maxLength={5} style={inp} /></div>
              </div>

            </div>

            {error && <p style={{ color: '#ef4444', fontSize: 14, marginBottom: 12 }}>{error}</p>}

          </form>
        </main>
      </div>
      {portalReady && createPortal(
        <>
          {summaryOpen && (
            <div className="merch-cart-summary-backdrop" onMouseDown={closeSummary}>
              <section className="merch-cart-summary-sheet" role="dialog" aria-modal="true" aria-labelledby="checkout-mobile-summary-title" onMouseDown={(event) => event.stopPropagation()}>
                <div className="merch-cart-sheet-handle" />
                <div className="merch-cart-sheet-header">
                  <h2 id="checkout-mobile-summary-title">Order Summary</h2>
                  <button type="button" onClick={closeSummary} aria-label="Close order summary">×</button>
                </div>
                {items.map((item) => (
                  <div key={item.id} className="merch-cart-summary-row">
                    <span>{itemLabel(item)} × {item.quantity}</span>
                    <strong>{formatRM(item.price * item.quantity)}</strong>
                  </div>
                ))}
                <div className="merch-cart-summary-row"><span>Shipping</span><strong>{shippingPending ? 'Select state' : shippingUnavailable ? 'Unavailable' : shipping === 0 ? 'FREE' : formatRM(shipping)}</strong></div>
                {promo && <div className="merch-cart-summary-row merch-promo-discount"><span>Promo ({promo.code})</span><strong>−{formatRM(promo.discount)}</strong></div>}
                <div className="merch-cart-total"><span>{shippingPending || shippingUnavailable ? 'Total before shipping' : 'Total'}</span><strong>{formatRM(grandTotal)}</strong></div>
                {renderPromo()}
              </section>
            </div>
          )}
          <div className="merch-checkout-mobile-pay">
            <button type="button" className="merch-cart-summary-toggle" onClick={() => setSummaryOpen(true)} aria-expanded={summaryOpen}>
              <span>View summary</span>
              <strong>{formatRM(grandTotal)}</strong>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m18 15-6-6-6 6" />
              </svg>
            </button>
            <button type="submit" form="checkout-form" className="btn btn-primary merch-checkout-pay" disabled={submitting || merchandiseLoading || stockIssues.length > 0 || shippingPending || shippingUnavailable}>
              {submitting ? 'Processing...' : 'Pay Now'}
            </button>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
