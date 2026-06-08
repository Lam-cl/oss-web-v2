'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { getBundleProductById } from '@/lib/api';
import { MALAYSIAN_STATES } from '@/lib/constants';
import Link from 'next/link';

/* ─── Step flow ─── */
const DEVICE_STEPS = ['Device Details', 'Checkout Details', 'Payment'];
const CURRENT_STEP = 1;

/* ─── Inclusive benefits ─── */
const INCLUSIVE: Record<number, string[]> = {
  25: ['Phone with zero upfront payment', '20GB monthly bonus data', 'PA & Life Insurance RM56,000'],
  50: ['Phone with zero upfront payment', '50GB monthly bonus data', 'PA & Life Insurance RM59,000'],
};

/* ─── Postcode → [state, city] ─── */
const POSKOD_MAP: Record<string, [string, string]> = {
  '01':['Perlis','Kangar'],'02':['Kedah','Alor Setar'],'03':['Kedah','Sungai Petani'],'04':['Kedah','Sungai Petani'],'05':['Kedah','Alor Setar'],'06':['Kedah','Pendang'],
  '08':['Kedah','Sungai Petani'],'09':['Kedah','Kulim'],
  '10':['Pulau Pinang','Georgetown'],'11':['Pulau Pinang','Bayan Lepas'],'12':['Pulau Pinang','Butterworth'],'13':['Pulau Pinang','Butterworth'],'14':['Pulau Pinang','Bukit Mertajam'],
  '15':['Kelantan','Kota Bharu'],'16':['Kelantan','Kota Bharu'],'17':['Kelantan','Pasir Mas'],'18':['Kelantan','Tanah Merah'],
  '20':['Terengganu','Kuala Terengganu'],'21':['Terengganu','Kuala Terengganu'],'22':['Terengganu','Kemaman'],'23':['Terengganu','Dungun'],'24':['Terengganu','Kemaman'],
  '25':['Pahang','Kuantan'],'26':['Pahang','Kuantan'],'27':['Pahang','Kuantan'],'28':['Pahang','Temerloh'],'29':['Pahang','Pekan'],
  '30':['Perak','Ipoh'],'31':['Perak','Ipoh'],'32':['Perak','Sitiawan'],'33':['Perak','Ipoh'],'34':['Perak','Taiping'],'35':['Perak','Taiping'],'36':['Perak','Teluk Intan'],
  '39':['Pahang','Tanah Rata'],
  '40':['Selangor','Shah Alam'],'41':['Selangor','Klang'],'42':['Selangor','Petaling Jaya'],'43':['Selangor','Kajang'],'44':['Selangor','Kuala Kubu Bharu'],'45':['Selangor','Kuala Selangor'],'46':['Selangor','Petaling Jaya'],'47':['Selangor','Petaling Jaya'],'48':['Selangor','Rawang'],
  '50':['W.P. Kuala Lumpur','Kuala Lumpur'],'51':['W.P. Kuala Lumpur','Kuala Lumpur'],'52':['W.P. Kuala Lumpur','Kuala Lumpur'],'53':['W.P. Kuala Lumpur','Kuala Lumpur'],'54':['W.P. Kuala Lumpur','Kuala Lumpur'],'55':['W.P. Kuala Lumpur','Kuala Lumpur'],'56':['W.P. Kuala Lumpur','Kuala Lumpur'],'57':['W.P. Kuala Lumpur','Kuala Lumpur'],'58':['W.P. Kuala Lumpur','Kuala Lumpur'],'59':['W.P. Kuala Lumpur','Kuala Lumpur'],
  '60':['W.P. Kuala Lumpur','Kuala Lumpur'],'61':['Selangor','Shah Alam'],'62':['W.P. Putrajaya','Putrajaya'],'63':['Selangor','Cyberjaya'],'64':['Selangor','Sepang'],
  '68':['Selangor','Batu Caves'],'69':['Selangor','Gombak'],
  '70':['Negeri Sembilan','Seremban'],'71':['Negeri Sembilan','Port Dickson'],'72':['Negeri Sembilan','Seremban'],'73':['Negeri Sembilan','Tampin'],
  '75':['Melaka','Melaka'],'76':['Melaka','Melaka'],'77':['Melaka','Jasin'],'78':['Melaka','Alor Gajah'],
  '79':['Johor','Johor Bahru'],'80':['Johor','Johor Bahru'],'81':['Johor','Johor Bahru'],'82':['Johor','Pontian'],'83':['Johor','Batu Pahat'],'84':['Johor','Muar'],'85':['Johor','Segamat'],'86':['Johor','Kluang'],'87':['Johor','Kota Tinggi'],
  '88':['Sabah','Kota Kinabalu'],'89':['Sabah','Sandakan'],
  '90':['Sabah','Sandakan'],'91':['Sabah','Tawau'],'93':['Sarawak','Kuching'],'94':['Sarawak','Kuching'],'95':['Sarawak','Samarahan'],'96':['Sarawak','Sibu'],'97':['Sarawak','Miri'],'98':['Sarawak','Miri'],
};

function normalizeState(apiState: string): string {
  if (!apiState) return 'W.P. Kuala Lumpur';
  const s = apiState.toLowerCase().trim();
  if (s.includes('sembilan')) return 'Negeri Sembilan';
  if (s.includes('pinang') || s.includes('penang')) return 'Pulau Pinang';
  if (s.includes('kuala lumpur') || s === 'kl') return 'W.P. Kuala Lumpur';
  if (s.includes('putrajaya')) return 'W.P. Putrajaya';
  if (s.includes('labuan')) return 'W.P. Labuan';
  const match = MALAYSIAN_STATES.find(ms => ms.toLowerCase().includes(s) || s.includes(ms.toLowerCase()));
  return match || 'W.P. Kuala Lumpur';
}

/* ─── Shared styles ─── */
const cardStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 14, padding: '24px 28px', border: '1px solid #e5e7eb',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 14px', border: '1.5px solid #d1d5db',
  borderRadius: 8, fontSize: 14, outline: 'none', background: '#fff',
};
const sectionTitle: React.CSSProperties = {
  fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 16,
  textTransform: 'uppercase' as const, letterSpacing: '0.5px',
};

function formatRM(v: number) {
  return 'RM ' + v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function CheckCircle() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0, color: '#2563eb' }}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </svg>
  );
}

const emptyAddr = { address1: '', address2: '', postcode: '', city: '', state: 'W.P. Kuala Lumpur' };

/* ─── Working-day helpers ─── */
function getMinPickupDate(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  let count = 0;
  while (count < 3) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return d;
}

const CAL_DAYS   = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const CAL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function PickupCalendar({ value, onChange }: { value: Date | null; onChange: (d: Date) => void }) {
  const minDate = getMinPickupDate();
  const [viewDate, setViewDate] = React.useState(() => {
    const d = new Date(minDate);
    d.setDate(1);
    return d;
  });

  const year  = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(i);

  const isDisabled = (day: number) => {
    const d = new Date(year, month, day);
    d.setHours(0, 0, 0, 0);
    return d < minDate;
  };
  const isSelected = (day: number) =>
    !!value && value.getFullYear() === year && value.getMonth() === month && value.getDate() === day;
  const isToday = (day: number) => {
    const t = new Date();
    return t.getFullYear() === year && t.getMonth() === month && t.getDate() === day;
  };

  const canGoPrev = () => {
    const today = new Date();
    return !(year === today.getFullYear() && month === today.getMonth());
  };

  const navBtn: React.CSSProperties = {
    width: 32, height: 32, borderRadius: 8, border: '1px solid #e5e7eb',
    background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: 16, color: '#374151',
  };

  return (
    <div style={{ maxWidth: 340 }}>
      {/* Month nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <button type="button" onClick={() => canGoPrev() && setViewDate(new Date(year, month - 1, 1))}
          style={{ ...navBtn, opacity: canGoPrev() ? 1 : 0.3, cursor: canGoPrev() ? 'pointer' : 'not-allowed' }}>‹</button>
        <span style={{ fontWeight: 700, fontSize: 15, color: '#0d1b3e' }}>{CAL_MONTHS[month]} {year}</span>
        <button type="button" onClick={() => setViewDate(new Date(year, month + 1, 1))} style={navBtn}>›</button>
      </div>

      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 6 }}>
        {CAL_DAYS.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: '#94a3b8', padding: '4px 0' }}>{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const disabled = isDisabled(day);
          const selected = isSelected(day);
          const today    = isToday(day);
          return (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={() => !disabled && onChange(new Date(year, month, day))}
              style={{
                padding: '8px 0', borderRadius: 8, fontSize: 13, fontWeight: selected ? 700 : 400,
                border: selected ? '2px solid #2563eb' : today ? '1px solid #bae6fd' : '1px solid transparent',
                background: selected ? '#2563eb' : today ? '#eff6ff' : 'transparent',
                color: disabled ? '#d1d5db' : selected ? '#fff' : '#1e293b',
                cursor: disabled ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {day}
            </button>
          );
        })}
      </div>

      {/* Selected date badge */}
      {value && (
        <div style={{ marginTop: 14, padding: '10px 14px', background: '#eff6ff', borderRadius: 10, fontSize: 13, color: '#1a56db', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>📅</span>
          <span>Pickup on {value.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
        </div>
      )}
    </div>
  );
}

function DeviceCheckoutInner() {
  const searchParams = useSearchParams();
  const productId = searchParams.get('id');
  const variantId = searchParams.get('variantId');

  const [device, setDevice] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [mobileOrderOpen, setMobileOrderOpen] = useState(false);
  const [memberId, setMemberId] = useState('');
  const [paymentData, setPaymentData] = useState<{
    paymentUrl: string;
    paymentParams: Record<string, string>;
  } | null>(null);

  /* ─── Delivery option ─── */
  const [deliveryMode, setDeliveryMode] = useState<'delivery' | 'pickup'>('delivery');
  const [pickupDate, setPickupDate] = useState<Date | null>(null);

  /* ─── Billing form ─── */
  const [form, setForm] = useState({
    twNumber: '',
    fullName: '', nric: '', email: '', phone: '',
    ...emptyAddr,
  });

  /* ─── Shipping address ─── */
  const [sameAsBilling, setSameAsBilling] = useState(true);
  const [shippingForm, setShippingForm] = useState({ ...emptyAddr });
  const shippingCityManual = useRef(false);

  /* ─── tone wow number verification ─── */
  const [twVerifying, setTwVerifying] = useState(false);
  const [twVerified, setTwVerified] = useState(false);
  const [twError, setTwError] = useState('');
  const twDebounce = useRef<NodeJS.Timeout | null>(null);
  const cityManual = useRef(false);

  const GKASH_PROXY = '/gkash/initiate';

  /* ─── Load device ─── */
  useEffect(() => {
    if (!productId) { setLoading(false); return; }
    (async () => {
      try {
        const data = await getBundleProductById(Number(productId));
        if (data && data.id) {
          if (data.images) data.images.sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
          setDevice(data);
        }
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, [productId]);

  /* ─── tone wow auto-verify ─── */
  const verifyTwNumber = async (msisdn: string) => {
    if (!msisdn || msisdn.length < 9) return;
    setTwVerifying(true); setTwVerified(false); setTwError('');
    try {
      const res = await fetch('https://qa.tonegroup.net/twbackend/api/member/v3/memberProfileDetail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msisdn }),
      });
      if (!res.ok) throw new Error('Not found');
      const data = await res.json();
      const updates: Partial<typeof form> = {};
      if (data.nameInfo?.fullName) updates.fullName = data.nameInfo.fullName;
      if (data.documentInfo?.documentID) updates.nric = data.documentInfo.documentID;
      if (data.email) updates.email = data.email;
      if (data.accountInfo?.simphoneNo) updates.phone = data.accountInfo.simphoneNo;
      if (data.accountInfo?.memberID) setMemberId(String(data.accountInfo.memberID));
      if (data.addressInfo) {
        const ai = data.addressInfo;
        if (ai.address1) updates.address1 = ai.address1;
        if (ai.address2) updates.address2 = ai.address2;
        if (ai.addPostCode) {
          updates.postcode = ai.addPostCode;
          const mapMatch = POSKOD_MAP[ai.addPostCode.slice(0, 2)];
          if (mapMatch) {
            updates.state = mapMatch[0];
            if (!cityManual.current) updates.city = mapMatch[1];
          } else {
            if (ai.addState) updates.state = normalizeState(ai.addState);
            if (ai.addCity && !cityManual.current) updates.city = ai.addCity;
          }
        }
      }
      setForm(p => ({ ...p, ...updates }));
      setTwVerified(true);
    } catch {
      setTwError('tone wow number not found or not a member');
    } finally {
      setTwVerifying(false);
    }
  };

  const handleTwNumberChange = (value: string) => {
    const clean = value.replace(/\D/g, '').slice(0, 11);
    setForm(p => ({ ...p, twNumber: clean }));
    setTwVerified(false); setTwError('');
    if (twDebounce.current) clearTimeout(twDebounce.current);
    if (clean.length >= 9) {
      twDebounce.current = setTimeout(() => verifyTwNumber(clean), 800);
    }
  };

  const applyPostcodeAutofill = (
    postcode: string,
    setter: React.Dispatch<React.SetStateAction<any>>,
    cityManualRef: React.MutableRefObject<boolean>
  ) => {
    if (postcode.length >= 2) {
      const match = POSKOD_MAP[postcode.slice(0, 2)];
      if (match) {
        setter((p: any) => ({ ...p, postcode, state: match[0], ...(!cityManualRef.current ? { city: match[1] } : {}) }));
        return;
      }
    }
    setter((p: any) => ({ ...p, postcode }));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'postcode') {
      const clean = value.replace(/\D/g, '').slice(0, 5);
      applyPostcodeAutofill(clean, setForm, cityManual);
    } else {
      setForm(p => ({ ...p, [name]: value }));
    }
    if (name === 'city') cityManual.current = true;
  };

  const handleShippingChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'postcode') {
      const clean = value.replace(/\D/g, '').slice(0, 5);
      applyPostcodeAutofill(clean, setShippingForm, shippingCityManual);
    } else {
      setShippingForm(p => ({ ...p, [name]: value }));
    }
    if (name === 'city') shippingCityManual.current = true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!device) return;

    if (!form.twNumber) {
      setError('Sila masukkan tone wow mobile number anda');
      return;
    }
    if (!form.fullName || !form.nric || !form.email || !form.phone) {
      setError('Sila isi semua ruangan yang diperlukan');
      return;
    }
    if (deliveryMode === 'delivery') {
      if (!form.address1 || !form.postcode || !form.city) {
        setError('Sila isi alamat penghantaran yang diperlukan');
        return;
      }
      if (!sameAsBilling && (!shippingForm.address1 || !shippingForm.postcode || !shippingForm.city)) {
        setError('Sila isi alamat penghantaran yang diperlukan');
        return;
      }
    }
    if (deliveryMode === 'pickup' && !pickupDate) {
      setError('Sila pilih tarikh pickup');
      return;
    }

    setSubmitting(true); setError('');
    try {
      const monthlyPrice = Math.round(device.price / 24);
      const [firstName, ...rest] = form.fullName.trim().split(' ');
      const lastName = rest.join(' ') || firstName;

      const resolvedVariantId = variantId
        ? Number(variantId)
        : device.productVariants?.[0]?.id ?? undefined;

      const buildAddr = (f: typeof emptyAddr) => ({
        firstName, lastName,
        email: form.email,
        phone: form.phone,
        address: [f.address1, f.address2].filter(Boolean).join(', '),
        city: f.city,
        state: f.state,
        country: 'Malaysia',
        postalCode: f.postcode,
      });

      const item: Record<string, unknown> = {
        productId: Number(productId),
        quantity: 1,
        price: monthlyPrice,
      };
      if (resolvedVariantId) item.variantId = resolvedVariantId;

      const checkoutData = {
        customerEmail: form.email,
        customerPhone: form.phone,
        customerType: 'existing',
        ...(memberId ? { customerID: memberId } : {}),
        deliveryOption: deliveryMode === 'delivery' ? 'DELIVERY' : 'PICKUP',
        ...(pickupDate ? { pickupDate: pickupDate.toISOString().split('T')[0] } : {}),
        billingAddress: buildAddr(form),
        shippingAddress: deliveryMode === 'pickup' ? buildAddr(form) : (sameAsBilling ? buildAddr(form) : buildAddr(shippingForm)),
        items: [item],
        shippingCost: 0,
        description: `Order for ${device.name}`,
      };
      const orderId = `DEV-${Date.now()}`;
      const paymentPayload = {
        orderId,
        amount: monthlyPrice,
        customerName: form.fullName,
        customerEmail: form.email,
        description: `tone wow Device Order ${orderId} - ${device.name}`,
      };

      localStorage.setItem('tw_pending_device_order', JSON.stringify({
        orderId,
        ...checkoutData,
      }));

      const res = await fetch(GKASH_PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paymentPayload),
      });
      const result = await res.json().catch(() => ({}));

      if (!res.ok || !result.success || !result.paymentUrl) {
        throw new Error(result.message || result.error || 'Gagal memulakan pembayaran GKash');
      }

      const paymentParams = result.paymentParams && typeof result.paymentParams === 'object'
        ? Object.fromEntries(Object.entries(result.paymentParams).map(([key, value]) => [key, String(value)]))
        : null;

      if (paymentParams && Object.keys(paymentParams).length > 0) {
        setPaymentData({
          paymentUrl: result.paymentUrl,
          paymentParams,
        });
        return;
      }

      window.location.href = result.paymentUrl;
    } catch (err: any) {
      setError(err.message || 'Sesuatu tidak kena. Sila cuba lagi.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="container" style={{ padding: '80px 20px', textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, border: '3px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
        <p style={{ color: '#64748b' }}>Loading checkout...</p>
      </div>
    );
  }

  if (paymentData) {
    return (
      <div className="container" style={{ padding: '80px 20px', textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, border: '3px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 24px' }} />
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

  if (!device) {
    return (
      <div className="container" style={{ padding: '80px 20px', textAlign: 'center' }}>
        <h3 style={{ marginBottom: 8 }}>Device not found</h3>
        <p style={{ color: '#64748b', marginBottom: 24 }}>Unable to load device for checkout.</p>
        <Link href="/" className="btn btn-primary">Browse Devices</Link>
      </div>
    );
  }

  const monthlyPrice = Math.round(device.price / 24);
  const benefits = INCLUSIVE[monthlyPrice] || [];
  const deviceImage = device.images?.[0]?.url;

  const OrderContent = () => (
    <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #e5e7eb' }}>
        {deviceImage && (
          <div style={{ width: 64, height: 64, borderRadius: 10, background: '#f8fafc', border: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <img src={deviceImage} alt={device.name} style={{ maxWidth: 48, maxHeight: 48, objectFit: 'contain' }} />
          </div>
        )}
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{device.name}</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>Mobile Device</div>
        </div>
      </div>
      {benefits.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          {benefits.map((b, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 12, color: '#1e293b', marginBottom: 4 }}>
              <CheckCircle />
              <span>{b}</span>
            </div>
          ))}
        </div>
      )}
      <div className="sidebar-order-row">
        <span>Monthly</span>
        <span style={{ fontWeight: 600 }}>{formatRM(monthlyPrice)}/month</span>
      </div>
      <div className="sidebar-order-row">
        <span>Shipping</span>
        <span style={{ fontWeight: 700, color: '#16a34a' }}>Free</span>
      </div>
    </>
  );

  const AddressFields = ({
    values,
    onChange,
    prefix = '',
  }: {
    values: typeof emptyAddr;
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
    prefix?: string;
  }) => (
    <>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Address <span style={{ color: '#ef4444' }}>*</span></label>
        <input name="address1" value={values.address1} onChange={onChange} required={!prefix} style={inputStyle} placeholder={prefix ? '' : ''} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Address 2</label>
        <input name="address2" value={values.address2} onChange={onChange} style={inputStyle} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Postcode <span style={{ color: '#ef4444' }}>*</span></label>
        <input name="postcode" value={values.postcode} onChange={onChange} placeholder="50000" inputMode="numeric" required={!prefix} style={inputStyle} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={labelStyle}>City <span style={{ color: '#ef4444' }}>*</span></label>
          <input name="city" value={values.city} onChange={onChange} required={!prefix} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>State</label>
          <select name="state" value={values.state} onChange={onChange} style={{ ...inputStyle, height: 46 }}>
            {MALAYSIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
    </>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      <div className="purchase-layout">

        {/* ── LEFT SIDEBAR: Stepper only ── */}
        <aside className="purchase-sidebar">
          <div style={{ marginBottom: 20 }}>
            <Link href={`/devices/${device.slug || `bundle-${device.id}`}`} style={{ color: '#2563eb', fontWeight: 500, fontSize: 14 }}>
              ← Back to Device
            </Link>
          </div>
          <div className="sidebar-stepper">
            {DEVICE_STEPS.map((s, i) => {
              const completed = i < CURRENT_STEP;
              const active = i === CURRENT_STEP;
              return (
                <div key={i} className="sidebar-step">
                  <div className="sidebar-step-row">
                    <div className={`sidebar-step-circle${completed ? ' completed' : active ? ' active' : ''}`}>
                      {completed ? '✓' : i + 1}
                    </div>
                    <span className={`sidebar-step-label${active ? ' active' : ''}`}>{s}</span>
                  </div>
                  {i < DEVICE_STEPS.length - 1 && (
                    <div className={`sidebar-step-connector${completed ? ' completed' : ''}`} />
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        {/* ── MAIN CONTENT ── */}
        <main className="purchase-main">
          <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Checkout</h2>
          <p style={{ color: '#64748b', marginBottom: 24, fontSize: 14 }}>
            Complete your purchase for <strong>{device.name}</strong>
          </p>
          <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 20 }}>* Required fields</p>

          <form onSubmit={handleSubmit}>
            <div className="purchase-grid-details-checkout">

              {/* ── LEFT: Form cards ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                {/* Identity */}
                <div style={cardStyle}>
                  <p style={sectionTitle}>Identity</p>

                  {/* tone wow Mobile Number */}
                  <div style={{ marginBottom: 16 }}>
                    <label style={labelStyle}>
                      tone wow Mobile Number <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        value={form.twNumber}
                        onChange={e => handleTwNumberChange(e.target.value)}
                        placeholder="e.g. 01169279769"
                        inputMode="numeric"
                        style={{
                          ...inputStyle,
                          borderColor: twVerified ? '#16a34a' : twError ? '#ef4444' : '#bae6fd',
                          paddingRight: 40,
                        }}
                      />
                      {twVerifying && (
                        <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, border: '2px solid #bae6fd', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                      )}
                      {twVerified && !twVerifying && (
                        <svg style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }} width="18" height="18" viewBox="0 0 24 24" fill="#16a34a">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                        </svg>
                      )}
                    </div>
                    {twVerified && <p style={{ fontSize: 12, color: '#16a34a', marginTop: 6 }}>✓ Details auto-filled</p>}
                    {twError && <p style={{ fontSize: 12, color: '#ef4444', marginTop: 6 }}>✗ {twError}</p>}
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <label style={labelStyle}>Full Name <span style={{ color: '#ef4444' }}>*</span></label>
                    <input name="fullName" value={form.fullName} onChange={handleChange} placeholder="Ahmad bin Abdullah" required style={inputStyle} />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={labelStyle}>NRIC / Passport <span style={{ color: '#ef4444' }}>*</span></label>
                    <input name="nric" value={form.nric} onChange={handleChange} placeholder="990101011234" required style={inputStyle} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={labelStyle}>Email <span style={{ color: '#ef4444' }}>*</span></label>
                      <input name="email" type="email" value={form.email} onChange={handleChange} required style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Phone <span style={{ color: '#ef4444' }}>*</span></label>
                      <input name="phone" type="tel" value={form.phone} onChange={handleChange} placeholder="0123456789" required style={inputStyle} />
                    </div>
                  </div>
                </div>

                {/* Delivery Option */}
                <div style={cardStyle}>
                  <p style={sectionTitle}>Delivery Option</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    {([
                      { key: 'delivery', icon: '🚚', label: 'Free Delivery', sub: 'Delivered to your door' },
                      { key: 'pickup',   icon: '🏪', label: 'Self Pickup',   sub: 'Pick up at our store' },
                    ] as const).map(opt => {
                      const active = deliveryMode === opt.key;
                      return (
                        <div
                          key={opt.key}
                          onClick={() => setDeliveryMode(opt.key)}
                          style={{
                            cursor: 'pointer', borderRadius: 12, padding: '14px 16px',
                            border: `2px solid ${active ? '#2563eb' : '#e5e7eb'}`,
                            background: active ? '#eff6ff' : '#fafafa',
                            display: 'flex', alignItems: 'center', gap: 12,
                            transition: 'all 0.2s',
                          }}
                        >
                          <div style={{
                            width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                            border: `2.5px solid ${active ? '#2563eb' : '#d1d5db'}`,
                            background: active ? '#2563eb' : '#fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {active && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff' }} />}
                          </div>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: active ? '#1a56db' : '#1e293b' }}>{opt.icon} {opt.label}</div>
                            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{opt.sub}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Billing + Shipping Address (delivery only) */}
                {deliveryMode === 'delivery' && (
                  <>
                    <div style={cardStyle}>
                      <p style={sectionTitle}>Billing Address</p>
                      <AddressFields values={form} onChange={handleChange} />
                    </div>

                    <div style={cardStyle}>
                      <p style={{ ...sectionTitle, marginBottom: 12 }}>Shipping Address</p>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: sameAsBilling ? 0 : 20 }}>
                        <input
                          type="checkbox"
                          checked={sameAsBilling}
                          onChange={e => setSameAsBilling(e.target.checked)}
                          style={{ width: 18, height: 18, accentColor: '#2563eb', cursor: 'pointer', flexShrink: 0 }}
                        />
                        <span style={{ fontSize: 14, fontWeight: 500, color: '#374151' }}>Same as billing address</span>
                      </label>
                      {!sameAsBilling && (
                        <AddressFields values={shippingForm} onChange={handleShippingChange} prefix="shipping" />
                      )}
                    </div>
                  </>
                )}

                {/* Pickup Date Calendar (self pickup only) */}
                {deliveryMode === 'pickup' && (
                  <div style={cardStyle}>
                    <p style={sectionTitle}>Pickup Date</p>
                    <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
                      Select a date — earliest available is 3 working days from today.
                    </p>
                    <PickupCalendar value={pickupDate} onChange={setPickupDate} />
                  </div>
                )}
              </div>

              {/* ── RIGHT: Order Summary + Payment ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                {/* Order Summary */}
                <div style={cardStyle}>
                  <p style={sectionTitle}>Order Summary</p>
                  <OrderContent />
                  <div className="sidebar-order-divider" />
                  <div className="sidebar-order-row sidebar-order-total">
                    <span>Total (monthly)</span>
                    <span>{formatRM(monthlyPrice)}/mo</span>
                  </div>
                </div>

                {/* Payment */}
                <div style={cardStyle}>
                  <p style={sectionTitle}>Payment Method</p>

                  {/* Credit Card — only option, shown as selected */}
                  <div style={{
                    padding: '12px 16px', borderRadius: 8,
                    border: '2px solid #2563eb', background: '#eff6ff',
                    display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, marginBottom: 16,
                  }}>
                    <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid #2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#2563eb' }} />
                    </div>
                    Credit / Debit Card
                  </div>

                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16, padding: 12, background: '#f8fafc', borderRadius: 8 }}>
                    By placing an order you agree to our <strong>Terms &amp; Conditions</strong> and <strong>Privacy Policy</strong>.
                  </div>

                  {error && <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 10 }}>{error}</p>}

                  <button
                    type="submit"
                    disabled={submitting}
                    style={{
                      width: '100%', padding: '14px 0', borderRadius: 50,
                      background: '#eab308', color: '#fff', border: 'none',
                      fontSize: 16, fontWeight: 700,
                      cursor: submitting ? 'not-allowed' : 'pointer',
                      opacity: submitting ? 0.7 : 1,
                    }}
                  >
                    {submitting ? 'Processing...' : 'Pay Now'}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </main>
      </div>

      {/* ── MOBILE ORDER BAR ── */}
      <div className={`purchase-mobile-order${mobileOrderOpen ? ' open' : ''}`}>
        <div className="mobile-order-bar" onClick={() => setMobileOrderOpen(!mobileOrderOpen)}>
          <div className="mobile-order-total">
            <span style={{ fontSize: 12, color: '#64748b' }}>Total (monthly)</span>
            <span style={{ fontSize: 18, fontWeight: 800, color: '#2563eb' }}>{formatRM(monthlyPrice)}/mo</span>
          </div>
          <button className="mobile-order-toggle" type="button">
            {mobileOrderOpen ? 'Hide' : 'View Details'}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: mobileOrderOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </button>
        </div>
        {mobileOrderOpen && (
          <div className="mobile-order-details">
            <OrderContent />
            <div className="sidebar-order-divider" />
            <div className="sidebar-order-row sidebar-order-total">
              <span>Total (monthly)</span>
              <span>{formatRM(monthlyPrice)}/mo</span>
            </div>
          </div>
        )}
      </div>

      <style>{`
        /* Stepper */
        .sidebar-stepper { display: flex; flex-direction: column; }
        .sidebar-step-row { display: flex; align-items: center; gap: 12px; }
        .sidebar-step-circle {
          width: 36px; height: 36px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 13px; font-weight: 700; flex-shrink: 0;
          background: #e5e7eb; color: #94a3b8; transition: all 0.2s;
        }
        .sidebar-step-circle.completed { background: #16a34a; color: #fff; }
        .sidebar-step-circle.active { background: #2563eb; color: #fff; }
        .sidebar-step-label { font-size: 14px; color: #94a3b8; }
        .sidebar-step-label.active { font-weight: 700; color: #1e293b; }
        .sidebar-step-connector { width: 2px; height: 24px; margin-left: 17px; background: #e5e7eb; }
        .sidebar-step-connector.completed { background: #16a34a; }

        .purchase-layout {
          display: flex; gap: 32px; max-width: 1200px;
          margin: 0 auto; padding: 32px 20px 40px; min-height: 100vh;
        }
        .purchase-sidebar {
          width: 280px; flex-shrink: 0; position: sticky;
          top: 20px; align-self: flex-start;
        }
        .purchase-main { flex: 1; min-width: 0; }
        .sidebar-order-row {
          display: flex; justify-content: space-between;
          font-size: 13px; padding: 4px 0; color: #374151;
        }
        .sidebar-order-divider { height: 1px; background: #e5e7eb; margin: 12px 0; }
        .sidebar-order-total { font-weight: 700; font-size: 15px; color: #2563eb; }
        .purchase-mobile-order { display: none; }
        .mobile-order-bar {
          display: flex; justify-content: space-between; align-items: center;
          padding: 12px 20px;
        }
        .mobile-order-total { display: flex; flex-direction: column; }
        .mobile-order-toggle {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 16px; border-radius: 20px;
          border: 1px solid #e5e7eb; background: #f8fafc;
          font-size: 13px; font-weight: 600; color: #2563eb; cursor: pointer;
        }
        .mobile-order-details { padding: 12px 20px 16px; border-top: 1px solid #e5e7eb; }
        .purchase-grid-details-checkout {
          display: grid; grid-template-columns: 1fr 360px; gap: 24px; align-items: start;
        }
        @media (max-width: 768px) {
          .purchase-sidebar { display: none; }
          .purchase-mobile-order {
            display: block; position: fixed; bottom: 0; left: 0; right: 0;
            z-index: 50; background: #fff;
            box-shadow: 0 -4px 20px rgba(0,0,0,0.1);
            border-radius: 16px 16px 0 0;
          }
          .purchase-layout { flex-direction: column; padding: 0; gap: 0; min-height: auto; }
          .purchase-main { padding: 24px 20px 120px; }
          .purchase-grid-details-checkout { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

export default function DeviceCheckoutPage() {
  return (
    <Suspense fallback={
      <div className="container" style={{ padding: '80px 20px', textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, border: '3px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
        <p style={{ color: '#64748b' }}>Loading checkout...</p>
      </div>
    }>
      <DeviceCheckoutInner />
    </Suspense>
  );
}
