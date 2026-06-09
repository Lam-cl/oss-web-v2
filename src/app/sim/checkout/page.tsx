'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useCartStore } from '@/store/cartStore';
import { createOrder, initiatePayment, verifyPromoter, checkExistingMember } from '@/lib/api';
import { formatRM } from '@/lib/utils';
import { MALAYSIAN_STATES } from '@/lib/constants';

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

/* ─── shared styles ─── */
const sectionStyle: React.CSSProperties = {
  marginBottom: 28,
  paddingBottom: 24,
  borderBottom: '1px solid #e5e7eb',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: '#1e293b',
  marginBottom: 16,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
};

const radioGroupStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  flexWrap: 'wrap',
};

const radioLabelStyle = (isActive: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '12px 20px',
  borderRadius: 10,
  border: isActive ? '2px solid #2563eb' : '2px solid #d1d5db',
  background: isActive ? '#eff6ff' : '#fff',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: isActive ? 600 : 400,
  transition: 'all 0.15s',
  flex: '1 1 0',
  minWidth: 140,
  justifyContent: 'center',
});

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  border: '1.5px solid #d1d5db',
  borderRadius: 8,
  fontSize: 14,
  outline: 'none',
  transition: 'border-color 0.15s',
  background: '#fff',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  color: '#374151',
  marginBottom: 6,
};

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

export default function CheckoutPage() {
  const router = useRouter();
  const items = useCartStore((s) => s.items);
  const getTotal = useCartStore((s) => s.getTotal);
  const clear = useCartStore((s) => s.clear);

  const [customerType, setCustomerType] = useState<'new' | 'existing'>('new');
  const [pickupOption, setPickupOption] = useState<'delivery' | 'self'>('delivery');
  const [sameAsBilling, setSameAsBilling] = useState(true);
  const [buyingFor, setBuyingFor] = useState<'personal' | 'agent'>('personal');

  // Existing customer fields
  const [memberType, setMemberType] = useState('');
  const [existingPhone, setExistingPhone] = useState('');
  const [existingMemberName, setExistingMemberName] = useState('');
  const [existingMemberError, setExistingMemberError] = useState('');
  const [existingMemberVerifying, setExistingMemberVerifying] = useState(false);
  const existingPhoneDebounce = useRef<NodeJS.Timeout | null>(null);

  const doVerifyExistingMember = useCallback(async (phone: string) => {
    if (!phone.trim() || phone.trim().length < 10) {
      setExistingMemberName('');
      setExistingMemberError('');
      setExistingMemberVerifying(false);
      return;
    }
    setExistingMemberVerifying(true);
    setExistingMemberName('');
    setExistingMemberError('');
    setMemberType('');
    const result = await checkExistingMember(phone.trim());
    setExistingMemberVerifying(false);
    if (result.valid && result.name) {
      setExistingMemberName(result.name);
      setExistingMemberError('');
      if (result.memberType) setMemberType(result.memberType);
    } else {
      setExistingMemberName('');
      setExistingMemberError(result.error || 'Number not found');
    }
  }, []);

  const handleExistingPhoneChange = (value: string) => {
    setExistingPhone(value);
    setExistingMemberName('');
    setExistingMemberError('');
    setMemberType('');
    if (existingPhoneDebounce.current) clearTimeout(existingPhoneDebounce.current);
    if (value.trim().length >= 10) {
      existingPhoneDebounce.current = setTimeout(() => {
        doVerifyExistingMember(value);
      }, 600);
    }
  };

  const [form, setForm] = useState({
    firstName: '', lastName: '',
    email: '', phone: '', ic: '',
    billingAddress: '', billingCity: '', billingState: 'Johor', billingPostcode: '',
    shippingFirstName: '', shippingLastName: '',
    shippingAddress: '', shippingCity: '', shippingState: 'Johor', shippingPostcode: '',
    promoterPrefix: 'TWE', promoterCode: '',
    promoCode: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [paymentData, setPaymentData] = useState<{
    paymentUrl: string;
    paymentParams: Record<string, string>;
  } | null>(null);

  // Promoter ID verification
  const [promoterName, setPromoterName] = useState('');
  const [promoterError, setPromoterError] = useState('');
  const [promoterVerifying, setPromoterVerifying] = useState(false);
  const promoterDebounce = useRef<NodeJS.Timeout | null>(null);

  const doVerifyPromoter = useCallback(async (prefix: string, code: string) => {
    if (!code.trim()) {
      setPromoterName('');
      setPromoterError('');
      setPromoterVerifying(false);
      return;
    }
    setPromoterVerifying(true);
    setPromoterName('');
    setPromoterError('');
    const memberId = `${prefix}-${code.trim()}`;
    const result = await verifyPromoter(memberId);
    setPromoterVerifying(false);
    if (result.valid && result.name) {
      setPromoterName(result.name);
      setPromoterError('');
    } else {
      setPromoterName('');
      setPromoterError(result.error || 'Promoter ID not found');
    }
  }, []);

  const handlePromoterCodeChange = (value: string) => {
    setForm((prev) => ({ ...prev, promoterCode: value }));
    setPromoterName('');
    setPromoterError('');
    if (promoterDebounce.current) clearTimeout(promoterDebounce.current);
    if (value.trim()) {
      promoterDebounce.current = setTimeout(() => {
        doVerifyPromoter(form.promoterPrefix, value);
      }, 600);
    }
  };

  const handlePromoterPrefixChange = (value: string) => {
    setForm((prev) => ({ ...prev, promoterPrefix: value }));
    if (form.promoterCode.trim()) {
      doVerifyPromoter(value, form.promoterCode);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.firstName || !form.email || !form.phone || !form.ic) {
      setError('Please fill in all required fields');
      return;
    }
    if (pickupOption === 'delivery' && !form.billingAddress) {
      setError('Please enter shipping address');
      return;
    }
    if (customerType === 'existing' && !existingPhone) {
      setError('Please enter existing phone number');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const customerName = `${form.firstName} ${form.lastName}`.trim();
      const shipping = calculateShipping(items);
      const grandTotal = getTotal() + shipping;

      const shippingAddr = pickupOption === 'self' ? {
        address1: 'Self Pick Up', address2: '', address3: '',
        city: '', state: '', postcode: '',
      } : sameAsBilling ? {
        address1: form.billingAddress, address2: '', address3: '',
        city: form.billingCity, state: form.billingState, postcode: form.billingPostcode,
      } : {
        address1: form.shippingAddress, address2: '', address3: '',
        city: form.shippingCity, state: form.shippingState, postcode: form.shippingPostcode,
      };

      const order = await createOrder({
        customer_name: customerName,
        customer_email: form.email,
        customer_phone: form.phone,
        customer_ic: form.ic,
        shipping_address: shippingAddr,
        items: items.map((i) => ({
          name: i.name, type: i.type, plan: i.plan,
          number: i.number, price: i.price, quantity: i.quantity, simType: i.simType,
        })),
        total: grandTotal,
        shipping: shipping,
        promo_code: form.promoCode || undefined,
        promoter_id: form.promoterCode ? `${form.promoterPrefix}${form.promoterCode}` : undefined,
        customer_type: customerType,
        pickup_option: pickupOption,
        buying_for: buyingFor,
        member_type: customerType === 'existing' ? memberType : undefined,
        existing_phone: customerType === 'existing' ? existingPhone : undefined,
      });

      if (!order || !order.order_number) {
        throw new Error('Failed to create order');
      }

      const payment = await initiatePayment({
        orderId: order.order_number,
        amount: grandTotal,
        customerName,
        customerEmail: form.email,
        description: `tone wow Order ${order.order_number}`,
      });

      if (!payment.success || !payment.paymentUrl || !payment.paymentParams) {
        throw new Error(payment.error || 'Failed to initiate payment');
      }

      localStorage.setItem('tw_pending_order', order.order_number);
      setPaymentData({
        paymentUrl: payment.paymentUrl,
        paymentParams: payment.paymentParams,
      });
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // GKash redirect form
  if (paymentData) {
    return (
      <div className="container" style={{ padding: '80px 20px', textAlign: 'center' }}>
        <div style={{
          width: 48, height: 48,
          border: '3px solid #e5e7eb', borderTopColor: '#2563eb',
          borderRadius: '50%', animation: 'spin 0.8s linear infinite',
          margin: '0 auto 24px',
        }} />
        <h3>Redirecting to GKash payment...</h3>
        <p style={{ color: '#64748b', marginBottom: 24 }}>
          Please wait. You will be redirected to the payment page.
        </p>
        <form
          id="gkash-form"
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
      <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '80px 20px' }}>
        <h3 style={{ fontSize: 20, fontWeight: 700 }}>Your cart is empty</h3>
        <p style={{ color: '#64748b' }}>Add items before checking out.</p>
        <a href="/" className="btn btn-blue">Shop Now</a>
      </div>
    );
  }

  const shipping = calculateShipping(items);
  const grandTotal = getTotal() + shipping;

  const card: React.CSSProperties = { background: '#fff', borderRadius: 14, padding: '24px 28px', border: '1px solid #e5e7eb', marginBottom: 20 };
  const lbl: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 };
  const inp: React.CSSProperties = { width: '100%', padding: '12px 14px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none', background: '#fff' };
  const sec: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.5px' };

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      <div className="purchase-layout">

        {/* ── SIDEBAR ── */}
        <aside className="purchase-sidebar">
          <div className="sidebar-order">
            <h4 className="sidebar-order-title">Order Summary</h4>
            {items.map((item) => (
              <div key={item.id} className="sidebar-order-row">
                <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                <span>{formatRM(item.price * item.quantity)}</span>
              </div>
            ))}
            {shipping > 0 && (
              <div className="sidebar-order-row">
                <span>Shipping</span>
                <span>{formatRM(shipping)}</span>
              </div>
            )}
            <div className="sidebar-order-divider" />
            <div className="sidebar-order-row sidebar-order-total">
              <span>Total</span>
              <span>{formatRM(grandTotal)}</span>
            </div>
          </div>
        </aside>

        {/* ── MAIN ── */}
        <main className="purchase-main">
          <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 24 }}>Checkout</h2>

          <form onSubmit={handleSubmit}>

            {/* Customer Type */}
            <div style={card}>
              <p style={sec}>Customer Type</p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {(['new', 'existing'] as const).map((t) => (
                  <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderRadius: 10, border: customerType === t ? '2px solid #2563eb' : '2px solid #d1d5db', background: customerType === t ? '#eff6ff' : '#fff', cursor: 'pointer', fontSize: 14, fontWeight: customerType === t ? 600 : 400, flex: '1 1 0', minWidth: 140, justifyContent: 'center' }}>
                    <input type="radio" name="customerType" value={t} checked={customerType === t} onChange={() => setCustomerType(t)} style={{ accentColor: '#2563eb' }} />
                    {t === 'new' ? 'New Customer' : 'Existing Customer'}
                  </label>
                ))}
              </div>

              {customerType === 'existing' && (
                <div style={{ marginTop: 20, padding: '16px 20px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                  <label style={lbl}>Existing Phone Number <span style={{ color: '#ef4444' }}>*</span></label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="tel" value={existingPhone} onChange={(e) => handleExistingPhoneChange(e.target.value)} placeholder="e.g. 01170770000" style={{ ...inp, flex: 1, height: 46 }} />
                    <button type="button" style={{ ...verifyBtnStyle, opacity: existingMemberVerifying || !existingPhone.trim() ? 0.7 : 1 }} disabled={existingMemberVerifying || !existingPhone.trim()} onClick={() => doVerifyExistingMember(existingPhone)}>
                      {existingMemberVerifying ? <span style={{ display: 'inline-block', width: 18, height: 18, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> : <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="20" height="20"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>}
                    </button>
                  </div>
                  {existingMemberVerifying && <p style={{ marginTop: 8, fontSize: 13, color: '#2563eb' }}>Verifying...</p>}
                  {existingMemberName && !existingMemberVerifying && <p style={{ marginTop: 8, fontSize: 13, color: '#16a34a' }}>✓ {existingMemberName}{memberType ? ` (${memberType})` : ''}</p>}
                  {existingMemberError && !existingMemberVerifying && <p style={{ marginTop: 8, fontSize: 13, color: '#ef4444' }}>✗ {existingMemberError}</p>}
                </div>
              )}
            </div>

            {/* Identity */}
            <div style={card}>
              <p style={sec}>Identity</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                <div><label style={lbl}>First Name <span style={{ color: '#ef4444' }}>*</span></label><input name="firstName" value={form.firstName} onChange={handleChange} required style={inp} /></div>
                <div><label style={lbl}>Last Name</label><input name="lastName" value={form.lastName} onChange={handleChange} style={inp} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                <div><label style={lbl}>Email <span style={{ color: '#ef4444' }}>*</span></label><input name="email" type="email" value={form.email} onChange={handleChange} required style={inp} /></div>
                <div><label style={lbl}>Phone</label><input name="phone" type="tel" value={form.phone} onChange={handleChange} style={inp} /></div>
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

              <p style={{ ...sec, marginBottom: 14 }}>Billing Address</p>
              <div style={{ marginBottom: 14 }}><label style={lbl}>Address <span style={{ color: '#ef4444' }}>*</span></label><input name="billingAddress" value={form.billingAddress} onChange={handleChange} required={pickupOption === 'delivery'} style={inp} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
                <div><label style={lbl}>City <span style={{ color: '#ef4444' }}>*</span></label><input name="billingCity" value={form.billingCity} onChange={handleChange} style={inp} /></div>
                <div><label style={lbl}>State</label><select name="billingState" value={form.billingState} onChange={handleChange} style={{ ...inp, height: 46 }}>{MALAYSIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
                <div><label style={lbl}>Postcode <span style={{ color: '#ef4444' }}>*</span></label><input name="billingPostcode" value={form.billingPostcode} onChange={handleChange} style={inp} /></div>
              </div>

              {pickupOption === 'delivery' && (
                <>
                  <p style={{ ...sec, marginBottom: 14 }}>Shipping Address</p>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer', marginBottom: 14 }}>
                    <input type="checkbox" checked={sameAsBilling} onChange={(e) => setSameAsBilling(e.target.checked)} style={{ accentColor: '#2563eb', width: 18, height: 18 }} />
                    Same as billing address
                  </label>
                  {!sameAsBilling && (
                    <div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                        <div><label style={lbl}>First Name <span style={{ color: '#ef4444' }}>*</span></label><input name="shippingFirstName" value={form.shippingFirstName} onChange={handleChange} required style={inp} /></div>
                        <div><label style={lbl}>Last Name</label><input name="shippingLastName" value={form.shippingLastName} onChange={handleChange} style={inp} /></div>
                      </div>
                      <div style={{ marginBottom: 14 }}><label style={lbl}>Address <span style={{ color: '#ef4444' }}>*</span></label><input name="shippingAddress" value={form.shippingAddress} onChange={handleChange} required style={inp} /></div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                        <div><label style={lbl}>City <span style={{ color: '#ef4444' }}>*</span></label><input name="shippingCity" value={form.shippingCity} onChange={handleChange} required style={inp} /></div>
                        <div><label style={lbl}>State</label><select name="shippingState" value={form.shippingState} onChange={handleChange} style={{ ...inp, height: 46 }}>{MALAYSIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
                        <div><label style={lbl}>Postcode <span style={{ color: '#ef4444' }}>*</span></label><input name="shippingPostcode" value={form.shippingPostcode} onChange={handleChange} required style={inp} /></div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Promoter + Purpose + Promo */}
            <div style={card}>
              <p style={sec}>Promoter ID (optional)</p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                <select name="promoterPrefix" value={form.promoterPrefix} onChange={(e) => handlePromoterPrefixChange(e.target.value)} style={{ ...inp, width: 80, height: 46 }}>
                  <option value="TWE">TWE</option><option value="TWP">TWP</option>
                </select>
                <input name="promoterCode" placeholder="909707" value={form.promoterCode} onChange={(e) => handlePromoterCodeChange(e.target.value)} style={{ ...inp, flex: 1, height: 46 }} />
              </div>
              {promoterVerifying && <p style={{ fontSize: 13, color: '#2563eb', marginBottom: 8 }}>Verifying...</p>}
              {promoterName && !promoterVerifying && <p style={{ fontSize: 13, color: '#16a34a', marginBottom: 8 }}>✓ {promoterName}</p>}
              {promoterError && !promoterVerifying && <p style={{ fontSize: 13, color: '#ef4444', marginBottom: 8 }}>✗ {promoterError}</p>}

              <p style={{ ...sec, marginBottom: 14 }}>Buying Purpose</p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
                {(['personal', 'agent'] as const).map((b) => (
                  <label key={b} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderRadius: 10, border: buyingFor === b ? '2px solid #2563eb' : '2px solid #d1d5db', background: buyingFor === b ? '#eff6ff' : '#fff', cursor: 'pointer', fontSize: 14, fontWeight: buyingFor === b ? 600 : 400, flex: '1 1 0', minWidth: 140, justifyContent: 'center' }}>
                    <input type="radio" name="buyingFor" value={b} checked={buyingFor === b} onChange={() => setBuyingFor(b)} style={{ accentColor: '#2563eb' }} />
                    {b === 'personal' ? 'Personal Use' : 'Earn Passive Income'}
                  </label>
                ))}
              </div>

              <p style={{ ...sec, marginBottom: 14 }}>Promo Code</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input name="promoCode" placeholder="Enter promo code" value={form.promoCode} onChange={handleChange} style={{ ...inp, flex: 1, height: 46 }} />
                <button type="button" style={verifyBtnStyle} onClick={() => { if (form.promoCode.trim()) alert('Promo code validation coming soon.'); }}>
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="20" height="20"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                </button>
              </div>
            </div>

            {/* T&C + errors + submit */}
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12, padding: 12, background: '#f8fafc', borderRadius: 8 }}>
              By placing an order, you agree to our <strong>Terms & Conditions</strong> and <strong>Privacy Policy</strong>.
            </div>
            {error && <p style={{ color: '#ef4444', fontSize: 14, marginBottom: 12 }}>{error}</p>}

            <div className="step-nav" style={{ marginBottom: 32 }}>
              <button type="button" className="btn btn-blue" onClick={() => router.back()}>Back</button>
              <button type="submit" className="btn btn-blue" disabled={submitting} style={{ background: '#eab308', borderColor: '#eab308' }}>
                {submitting ? 'Processing...' : `Pay ${formatRM(grandTotal)}`}
              </button>
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}
