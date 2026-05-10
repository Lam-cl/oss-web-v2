'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { AnimatePresence, motion, type Variants } from 'framer-motion';

const stepVariants: Variants = {
  initial: (dir: number) => ({ y: dir * 60, opacity: 0 }),
  animate: { y: 0, opacity: 1, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as [number,number,number,number] } },
  exit: (dir: number) => ({ y: dir * -30, opacity: 0, transition: { duration: 0.25, ease: [0.4, 0, 1, 1] as [number,number,number,number] } }),
};
import { useRouter, useSearchParams } from 'next/navigation';
import { getBundleProducts, verifyPromoter, getSettings, getDataPlans, saveRefAllocation, type ApiPlanItem } from '@/lib/api';
import { formatRM } from '@/lib/utils';
import { MALAYSIAN_STATES } from '@/lib/constants';
import type { NumberResult } from '@/types';

/* ═══════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════ */
const STEPS = [
  'Choose SIM',
  'Choose Plan',
  'Insurance',
  'Details & Checkout',
];

const STAGING_MODE = false; // staging sends RM1 regardless of actual total — flip to true for testing
const DEFAULT_BASE_SIM_PRICE = 19.50;
const OSS_PAYMENT_URL = 'https://qa.tonegroup.net/gkashwebservice/osspay.jsp';

const PAYMENT_METHODS = [
  { id: '16', label: 'Online Banking (FPX)' },
  { id: '2',  label: 'Credit / Debit Card' },
  { id: '3',  label: 'eWallet' },
] as const;

const INSURANCE_ADDON = {
  id: 'addon-54k',
  price: 25,
  pa: 50000,
  life: 4000,
};

/** Generate 20-char refNo: twoss + 5 random digits + YYMMDDHHmmss */
const generateRefNo = (): string => {
  const rand = String(Math.floor(10000 + Math.random() * 90000));
  const now = new Date();
  const dt = [
    String(now.getFullYear()).slice(2),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  return ('twoss' + rand + dt).slice(0, 20);
};

/* Malaysian postcode prefix (2 digits) → [state, city] */
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

const PLAN_DISCOUNT = 5;

const SPECIAL_NUMBER_BENEFITS: Record<string, { plan: string; freeMonths: number; benefits: string[] }> = {
  PREMIUM: {
    plan: 'FU35 plan every month',
    freeMonths: 18,
    benefits: ['PA Takaful @ RM50,000', 'Life Insurance @ RM4,000'],
  },
  VIP: {
    plan: 'FU50 plan every month',
    freeMonths: 36,
    benefits: ['PA Takaful @ RM50,000', 'Life Insurance @ RM4,000'],
  },
  VVIP: {
    plan: 'FU60 plan every month',
    freeMonths: 36,
    benefits: ['PA Takaful @ RM50,000', 'Life Insurance @ RM4,000'],
  },
};

/* FU Data Plans — FU35 and above only */
interface DataPlan {
  id: string;
  name: string;
  price: number;
  discountedAddon: number;
  data: string;
  validity: string;
  calls: string;
  badge5g: boolean;
  popular?: boolean;
}


/* Shared inline styles */
const cardStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 14, padding: '24px 28px',
  border: '1px solid #e5e7eb',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 14px', border: '1.5px solid #d1d5db',
  borderRadius: 8, fontSize: 14, outline: 'none', background: '#fff',
};

/* Check icon SVG */
const CheckSVG = () => (
  <svg fill="none" stroke="#fff" viewBox="0 0 24 24" width="14" height="14">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
  </svg>
);

/* ═══════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════ */
function SIMPurchaseWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [BASE_SIM_PRICE, setBasePrice] = useState(DEFAULT_BASE_SIM_PRICE);

  useEffect(() => {
    getSettings().then(s => setBasePrice(s.simBasePrice)).catch(() => {});
  }, []);

  /* ── Special Number (VIP flow) ── */
  const [selectedNumber, setSelectedNumber] = useState<NumberResult | null>(null);

  /* ── Step 0: SIM + Referral ── */
  const [hasReferral, setHasReferral] = useState(false);

  /* ── Step 1: Data Plan (optional) ── */
  const [apiPlans, setApiPlans] = useState<ApiPlanItem[]>([]);
  const [selectedDataPlan, setSelectedDataPlan] = useState<DataPlan | null>(null);

  // Fetch plans from new API when entering step 1
  const DYNAMIC_PLANS: DataPlan[] = apiPlans.map(p => {
    const nameRaw = (p.codeData2 || '').trim(); // "FU 35"
    const name = nameRaw.replace(/\s+/g, ''); // "FU35"
    const id = name.toLowerCase(); // "fu35"
    const price = parseFloat(p.codeData3) || 0;
    const descLines = (p.codeDesc || '').split(/[\r\n]+/).filter(Boolean);
    const dataLine = descLines[0] || '';
    const validityLine = descLines.find(l => /day/i.test(l)) || '30 Days Validity';
    const callsLine = descLines.find(l => /min/i.test(l)) || 'Unlimited Calls';
    return {
      id, name, price,
      discountedAddon: Math.max(0, price - 5),
      data: dataLine.replace('High Speed Data', 'GB').trim(),
      validity: validityLine.trim(),
      calls: callsLine.replace(/,/g, '').trim(),
      badge5g: true,
      popular: name === 'FU60',
    };
  }).filter(p => p.name.toUpperCase().startsWith('FU') && p.name !== 'FU20+');

  const FU_PLANS: DataPlan[] = DYNAMIC_PLANS.length > 0 ? DYNAMIC_PLANS : [
    { id: 'fu10',  name: 'FU10',  price: 10,  discountedAddon: 8,   data: '12 GB',  validity: '10 Days', calls: '100 Min',    badge5g: true },
    { id: 'fu20',  name: 'FU20',  price: 20,  discountedAddon: 17,  data: '35 GB',  validity: '20 Days', calls: 'Unlimited', badge5g: true },
    { id: 'fu35',  name: 'FU35',  price: 35,  discountedAddon: 30,  data: '150 GB', validity: '30 Days', calls: '*Unlimited', badge5g: true },
    { id: 'fu50',  name: 'FU50',  price: 50,  discountedAddon: 45,  data: '300 GB', validity: '30 Days', calls: '*Unlimited', badge5g: true },
    { id: 'fu60',  name: 'FU60',  price: 60,  discountedAddon: 55,  data: '500 GB', validity: '30 Days', calls: '*Unlimited', badge5g: true, popular: true },
    { id: 'fu80',  name: 'FU80',  price: 80,  discountedAddon: 75,  data: '650 GB', validity: '30 Days', calls: '*Unlimited', badge5g: true },
    { id: 'fu120', name: 'FU120', price: 120, discountedAddon: 115, data: '800 GB', validity: '30 Days', calls: '*Unlimited', badge5g: true },
  ];

  useEffect(() => {
    getDataPlans('TWE', '').then(p => setApiPlans(p.length > 0 ? p : [])).catch(() => {});
  }, []);

  /* ── Step 1: Plan expand state ── */
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);

  /* ── Step 2: Insurance expand state ── */
  const [expandedInsCard, setExpandedInsCard] = useState<'basic' | 'premium' | null>(null);

  /* ── Step 2: Insurance Add-on (optional) ── */
  const [insuranceAddon, setInsuranceAddon] = useState(false);

  /* ── Step 3: KYC + Shipping ── */
  const [form, setForm] = useState({
    fullName: '', nric: '', email: '', phone: '',
    address1: '', address2: '', city: '', state: 'W.P. Kuala Lumpur', postcode: '',
    promoterPrefix: 'TWE', promoterCode: '',
  });
  const [simType, setSimType] = useState<'physical' | 'esim'>('physical');
  const [showEsimSuccess, setShowEsimSuccess] = useState(false);
  const [directCheckout, setDirectCheckout] = useState(false);
  const [esimCompatible, setEsimCompatible] = useState<boolean | null>(null);

  useEffect(() => {
    if (simType !== 'esim' || esimCompatible !== null) return;
    const ua = navigator.userAgent;
    let compatible = false;
    if (/iPhone(?:1[2-9]|[2-9]\d)|iPhone\b/.test(ua) && /OS (1[6-9]|[2-9]\d)_/.test(ua)) compatible = true;
    if (/Pixel [3-9]|Pixel [1-9]\d/.test(ua)) compatible = true;
    if (/SM-S[2-9]\d|SM-G9[7-9]\d|SM-N9[7-9]\d/.test(ua)) compatible = true;
    if (/Android 1[3-9]|Android [2-9]\d/.test(ua) && /esim/i.test(ua)) compatible = true;
    setEsimCompatible(compatible);
  }, [simType, esimCompatible]);

  /* ── Direct checkout via ?dataPlanID= ── */
  useEffect(() => {
    const planId = searchParams.get('dataPlanID');
    if (!planId || apiPlans.length === 0) return;
    const match = apiPlans.find(p => p.codeData1 === planId);
    if (!match) return;
    const name = (match.codeData2 || '').trim().replace(/\s+/g, '').toLowerCase();
    const price = parseFloat(match.codeData3) || 0;
    const descLines = (match.codeDesc || '').split(/[\r\n]+/).filter(Boolean);
    setSelectedDataPlan({
      id: name, name: name.toUpperCase(), price,
      discountedAddon: Math.max(0, price - 5),
      data: (descLines[0] || '').replace('High Speed Data', 'GB').trim(),
      validity: (descLines.find(l => /day/i.test(l)) || '30 Days Validity').trim(),
      calls: (descLines.find(l => /min/i.test(l)) || 'Unlimited Calls').replace(/,/g, '').trim(),
      badge5g: true, popular: false,
    });
    setSimType('physical');
    setDirectCheckout(true);
    setStep(3);
    router.replace('/sim/purchase');
  }, [apiPlans, searchParams, router]);

  /* ── Checkout ── */
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('16');
  const [mobileOrderOpen, setMobileOrderOpen] = useState(false);

  /* ── Promoter verification ── */
  const [promoterName, setPromoterName] = useState('');
  const [promoterError, setPromoterError] = useState('');
  const [promoterVerifying, setPromoterVerifying] = useState(false);
  const [twpReferenceID, setTwpReferenceID] = useState('');
  const [alloReferenceID, setAlloReferenceID] = useState('');
  const promoterDebounce = useRef<NodeJS.Timeout | null>(null);

  const doVerifyPromoter = useCallback(async (prefix: string, code: string) => {
    if (!code.trim()) { setPromoterName(''); setPromoterError(''); setPromoterVerifying(false); setTwpReferenceID(''); setAlloReferenceID(''); return; }
    setPromoterVerifying(true); setPromoterName(''); setPromoterError('');
    const memberID = `${prefix}-${code.trim()}`;
    const result = await verifyPromoter(memberID);
    if (result.valid) {
      if (result.name) setPromoterName(result.name);
      else if (prefix === 'TWP') setPromoterName(memberID); // TWP might not return name
      // TWP: generate referenceID
      if (prefix === 'TWP') {
        const ref = await saveRefAllocation(memberID);
        if (ref.referenceID) { setTwpReferenceID(ref.referenceID); setAlloReferenceID(ref.referenceID); }
      }
    } else {
      setPromoterError(result.error || 'Not found');
    }
    setPromoterVerifying(false);
  }, []);

  /* ── Load pre-selected special number (VIP flow) — only when ?special=1 ── */
  useEffect(() => {
    if (searchParams.get('special') !== '1') return;
    const savedNumber = localStorage.getItem('tw_selected_number');
    if (savedNumber) {
      try {
        const num = JSON.parse(savedNumber) as NumberResult;
        setSelectedNumber(num);
        setStep(3);
      } catch { /* ignore */ }
    }
  }, [searchParams]);

  /* ── Scroll to top on step change ── */
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [step]);

  const cityManual = useRef(false);
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm(p => ({ ...p, [name]: value }));
    if (name === 'postcode') {
      const clean = value.replace(/\D/g, '').slice(0, 5);
      if (clean !== value) setForm(p => ({ ...p, postcode: clean }));
      if (clean.length >= 2) {
        const match = POSKOD_MAP[clean.slice(0, 2)];
        if (match) {
          const [state, city] = match;
          setForm(p => ({ ...p, postcode: clean, state, ...(!cityManual.current ? { city } : {}) }));
        }
      }
    }
    if (name === 'city') cityManual.current = true;
  };

  /* ── Price calculations ── */
  const planAddon = selectedDataPlan?.price || 0;
  const insurancePrice = insuranceAddon ? INSURANCE_ADDON.price : 0;
  const effectiveBasePrice = directCheckout ? 10 : BASE_SIM_PRICE;
  const hasPromoter = !!(form.promoterCode && form.promoterCode.trim());
  const isBareOrder = !hasPromoter && !selectedDataPlan && !insuranceAddon && !selectedNumber;
  const shippingFee = hasPromoter ? 10 : isBareOrder ? 5 : 0;

  const numberPrice = selectedNumber?.price || 0;

  const total = selectedNumber
    ? numberPrice + shippingFee
    : effectiveBasePrice + planAddon + insurancePrice + shippingFee;

  const currentRunningTotal = selectedNumber ? numberPrice : effectiveBasePrice + planAddon + insurancePrice;

  /* ── Determine planid for OSSPayment ── */
  const determinePlanId = (): number => {
    if (directCheckout) return 1;
    if (selectedNumber) {
      const cat = selectedNumber.category?.toUpperCase();
      if (cat === 'VVIP') return 7;
      if (cat === 'VIP') return 4;
      return 5;
    }
    return 1;
  };

  /* ── Navigation ── */
  const canGoNext = (): boolean => {
    if (step === 0) return !(hasReferral && !promoterName);
    if (step === 1) return true;
    if (step === 2) return true;
    if (step === 3) return simType === 'esim'
      ? !!(form.fullName && form.email && form.phone && form.nric)
      : !!(form.fullName && form.email && form.phone && form.nric && form.address1 && form.city && form.postcode);
    return true;
  };

  const goNext = () => {
    if (!canGoNext() || step >= 3) return;
    setDirection(1);
    setStep(step + 1);
  };

  const goBack = () => {
    if (directCheckout) return;
    if (searchParams.get('special') === '1') { router.push('/'); return; }
    if (step === 3 && selectedNumber) {
      setSelectedNumber(null);
      localStorage.removeItem('tw_selected_number');
    }
    if (step === 0) { router.back(); return; }
    setDirection(-1);
    setStep(step - 1);
  };

  /* ── Submit ── */
  const handleSubmit = async () => {
    if (!canGoNext()) { setError('Please fill in all required fields.'); return; }
    setSubmitting(true); setError('');
    try {
      const customerName = form.fullName.trim();
      const refNo = generateRefNo();

      const promoterId = hasPromoter ? `${form.promoterPrefix}-${form.promoterCode}` : '';
      const totalStr = STAGING_MODE ? '1.00' : String(total);
      const params = new URLSearchParams({
        transactionType: 'OSSPayment',
        documentID: form.nric,
        paymentId: paymentMethod,
        extraCharges: '0',
        refNo,
        prodDesc: 'OSSPayment',
        username: customerName,
        email: form.email,
        contact: form.phone,
        recurringType: '0',
        total: totalStr,
        address1: form.address1,
        address2: form.address2 || '',
        address3: '',
        postcode: form.postcode,
        city: form.city,
        state: form.state,
        planid: String(determinePlanId()),
        subTotal: totalStr,
        lang: 'EN',
        amount: totalStr,
        memberId: promoterId,
        shippingFee: String(shippingFee),
        selectedMsisdn: selectedNumber?.phoneNo || '',
        referralCode: promoterId ? `${promoterId}${twpReferenceID}` : '',
        dataPlanID: apiPlans.find(p => (p.codeData2 || '').trim().replace(/\s+/g, '').toLowerCase() === selectedDataPlan?.id)?.codeData1 || '',
        insurance: insuranceAddon ? '1' : '0',
        isEsim: simType === 'esim' ? '1' : '0',
        twpReferenceID,
        alloReferenceID,
      });

      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'https://tonewow-v2.xifuhalim.com/api';

      if (simType === 'esim') {
        const promoData = hasPromoter ? { prefix: form.promoterPrefix, code: form.promoterCode, email: form.email } : { prefix: '', code: '', email: form.email };
        localStorage.setItem('tw_esim_promoter', JSON.stringify(promoData));
        fetch(`${apiBase}/payment/poll/${paymentMethod}${refNo}`, { method: 'POST' }).catch(() => {});
        setShowEsimSuccess(true);
        setSubmitting(false);
        return;
      }

      fetch(`${apiBase}/payment/poll/${paymentMethod}${refNo}`, { method: 'POST' }).catch(() => {});
      window.location.href = `${OSS_PAYMENT_URL}?${params.toString()}`;
    } catch (err: any) { setError(err.message || 'Something went wrong. Please try again.'); setSubmitting(false); }
  };

  /* ── Stepper helpers ── */
  const isStepCompleted = (i: number) => !directCheckout && ((selectedNumber && i < 3) || i < step);
  const isStepActive = (i: number) => i === step;

  /* ══════════════════════════════════════════════════════
     SIDEBAR ORDER SUMMARY CONTENT
     ══════════════════════════════════════════════════════ */
  const SidebarOrderContent = () => {
    if (selectedNumber) {
      const nb = SPECIAL_NUMBER_BENEFITS[selectedNumber.category?.toUpperCase()];
      return (
        <>
          <div className="sidebar-order-row">
            <span>{selectedNumber.displayNo || selectedNumber.phoneNo} <span style={{ fontSize: 11, color: '#64748b' }}>({selectedNumber.category})</span></span>
            <span>{formatRM(selectedNumber.price)}</span>
          </div>
          {nb && (
            <div style={{ marginTop: 10, padding: '12px 14px', background: '#eff6ff', borderRadius: 10, border: '1px solid #bfdbfe' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="#2563eb"><path d="M12 2L4 6v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6l-8-4z"/></svg>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: '0.4px' }}>What's Included</span>
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#1d4ed8', marginBottom: 4 }}>FREE for {nb.freeMonths} months:</div>
              {[nb.plan, ...nb.benefits].map((b, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#1e40af', marginTop: 3 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="#2563eb"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
                  <span><strong style={{ color: '#1d4ed8' }}>FREE</strong> {b}</span>
                </div>
              ))}
            </div>
          )}
        </>
      );
    }
    return (
      <>
        <div className="sidebar-order-row">
          <span>Base SIM</span>
          <span>{formatRM(effectiveBasePrice)}</span>
        </div>
        {selectedDataPlan && (
          <div className="sidebar-order-row">
            <span>{selectedDataPlan.name}</span>
            <span>{formatRM(planAddon)}</span>
          </div>
        )}
        {insuranceAddon && (
          <div className="sidebar-order-row">
            <span>Insurance Add-on</span>
            <span>{formatRM(INSURANCE_ADDON.price)}</span>
          </div>
        )}
      </>
    );
  };

  /* ═══════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════ */
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      <div className="purchase-layout">

        {/* ── LEFT SIDEBAR (desktop only) ── */}
        <aside className="purchase-sidebar">
          <div className="sidebar-stepper">
            {STEPS.map((s, i) => (
              <div key={i} className="sidebar-step">
                <div className="sidebar-step-row">
                  <div
                    className={`sidebar-step-circle${isStepCompleted(i) ? ' completed' : isStepActive(i) ? ' active' : ''}`}
                    onClick={() => { if (!directCheckout && isStepCompleted(i) && !selectedNumber) { setDirection(i < step ? -1 : 1); setStep(i); } }}
                  >
                    {isStepCompleted(i) ? '✓' : i + 1}
                  </div>
                  <span className={`sidebar-step-label${isStepActive(i) ? ' active' : ''}`}>{s}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`sidebar-step-connector${isStepCompleted(i) ? ' completed' : ''}`} />
                )}
              </div>
            ))}
          </div>

          <div className="sidebar-order">
            <h4 className="sidebar-order-title">Order Details</h4>
            <SidebarOrderContent />
            {step === 3 && shippingFee > 0 && (
              <div className="sidebar-order-row" style={{ marginTop: 6 }}>
                <span>Shipping</span>
                <span style={{ color: '#1e293b' }}>
                  {formatRM(shippingFee)}
                </span>
              </div>
            )}
            <div className="sidebar-order-divider" />
            <div className="sidebar-order-row sidebar-order-total">
              <span>Total</span>
              <span>{formatRM(step === 3 ? total : currentRunningTotal)}</span>
            </div>
          </div>
        </aside>

        {/* ── MOBILE STEPPER (mobile only) ── */}
        <div className="purchase-mobile-stepper">
          <div className="mobile-stepper-row">
            {STEPS.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div
                  className={`mobile-step-circle${isStepCompleted(i) ? ' completed' : isStepActive(i) ? ' active' : ''}`}
                  onClick={() => { if (isStepCompleted(i) && !selectedNumber) { setDirection(i < step ? -1 : 1); setStep(i); } }}
                >
                  {isStepCompleted(i) ? '✓' : i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`mobile-step-connector${isStepCompleted(i) ? ' completed' : ''}`} />
                )}
              </div>
            ))}
          </div>
          <p className="mobile-stepper-title">{STEPS[step]}</p>
        </div>

        {/* ── MAIN CONTENT ── */}
        <main className="purchase-main">
        {showEsimSuccess ? (
          <div className="esim-success-page">
            <div className="esim-success-card">
              <div className="esim-success-check">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="#16a34a"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
              </div>
              <h2 className="esim-success-title">eSIM Activated</h2>
              <p className="esim-success-sub">Scan the QR code below to install your eSIM.</p>

              <div className="esim-qr-card">
                <div className="esim-qr-placeholder">
                  <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.2">
                    <rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/>
                    <rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="4" height="4"/><rect x="19" y="13" width="2" height="4"/><rect x="13" y="19" width="4" height="2"/><rect x="19" y="19" width="2" height="2"/>
                  </svg>
                  <span className="esim-qr-label">QR Code</span>
                </div>
                <div className="esim-barcode-placeholder">
                  <svg width="120" height="32" viewBox="0 0 120 32" fill="none" stroke="#1e293b" strokeWidth="2" strokeLinecap="round">
                    <line x1="2" y1="2" x2="2" y2="30"/><line x1="6" y1="2" x2="6" y2="30"/><line x1="10" y1="2" x2="10" y2="30"/>
                    <line x1="16" y1="2" x2="16" y2="30"/><line x1="22" y1="2" x2="22" y2="30"/>
                    <line x1="28" y1="2" x2="28" y2="30"/><line x1="32" y1="2" x2="32" y2="30"/><line x1="36" y1="2" x2="36" y2="30"/>
                    <line x1="42" y1="2" x2="42" y2="30"/><line x1="48" y1="2" x2="48" y2="30"/>
                    <line x1="54" y1="2" x2="54" y2="30"/><line x1="58" y1="2" x2="58" y2="30"/><line x1="62" y1="2" x2="62" y2="30"/>
                    <line x1="68" y1="2" x2="68" y2="30"/><line x1="74" y1="2" x2="74" y2="30"/>
                    <line x1="80" y1="2" x2="80" y2="30"/><line x1="84" y1="2" x2="84" y2="30"/><line x1="88" y1="2" x2="88" y2="30"/>
                    <line x1="94" y1="2" x2="94" y2="30"/><line x1="100" y1="2" x2="100" y2="30"/>
                    <line x1="106" y1="2" x2="106" y2="30"/><line x1="110" y1="2" x2="110" y2="30"/><line x1="114" y1="2" x2="114" y2="30"/>
                    <line x1="118" y1="2" x2="118" y2="30"/>
                  </svg>
                  <span className="esim-qr-label">EID: 8903 3010 2412 3456 7890</span>
                </div>
              </div>

              {/* How to Install */}
              <div className="esim-guide-section">
                <div className="esim-guide-header" onClick={() => { const el = document.getElementById('esim-install'); if (el) el.classList.toggle('open'); }}>
                  <h3>How to Install eSIM</h3>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
                </div>
                <div id="esim-install" className="esim-guide-body open">
                  <ol className="esim-steps">
                    <li>Go to <strong>Settings</strong> &gt; <strong>Cellular</strong> &gt; <strong>Add eSIM</strong></li>
                    <li>Tap <strong>"Use QR Code"</strong> and scan the QR code above</li>
                    <li>Label your eSIM (e.g. "tone wow")</li>
                    <li>Set as default line for data</li>
                    <li>Restart your phone — eSIM activates within 5 minutes</li>
                  </ol>
                </div>
              </div>

              {/* How to Register */}
              <div className="esim-guide-section">
                <div className="esim-guide-header" onClick={() => { const el = document.getElementById('esim-register'); if (el) el.classList.toggle('open'); }}>
                  <h3>How to Register</h3>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
                </div>
                <div id="esim-register" className="esim-guide-body open">
                  <ol className="esim-steps">
                    <li>After eSIM activates, open the <strong>tone wow 2.0</strong> app</li>
                    <li>Tap <strong>"Register SIM"</strong> on the home screen</li>
                    <li>Enter your <strong>NRIC/Passport number</strong> and the <strong>EID</strong> shown above</li>
                    <li>Submit — registration completes within 1 working day</li>
                  </ol>
                </div>
              </div>

              <button className="btn btn-blue" style={{ width: '100%', padding: '14px', fontSize: 16, fontWeight: 700, marginTop: 24 }} onClick={() => router.push('/')}>
                Back to Home
              </button>
            </div>
          </div>
        ) : (
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
        <motion.div
          key={step}
          custom={direction}
          variants={stepVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          style={{ overflow: 'hidden' }}
        >

          {/* ════════════ STEP 0: Choose SIM ════════════ */}
          {step === 0 && (
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Choose Your SIM</h2>
              <p style={{ color: '#64748b', marginBottom: 24, fontSize: 14 }}>Select SIM type and enter referral ID if you have one.</p>

              {/* SIM Type Cards */}
              <div className="sim-type-grid">
                {/* Physical SIM */}
                <div
                  className={`sim-type-card${simType === 'physical' ? ' sim-type-card--active' : ''}`}
                  onClick={() => setSimType('physical')}
                  style={{ cursor: 'pointer' }}
                >
                  <div className={`sim-type-radio${simType === 'physical' ? ' sim-type-radio--active' : ''}`} />
                  <div className={`sim-type-icon${simType === 'physical' ? ' sim-type-icon--active' : ''}`}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={simType === 'physical' ? '#2563eb' : '#94a3b8'} strokeWidth="1.8">
                      <rect x="5" y="2" width="14" height="20" rx="2" /><path d="M5 8h14M9 2v6" />
                    </svg>
                  </div>
                  <div className="sim-type-info">
                    <p className="sim-type-name">Physical SIM</p>
                    <p className="sim-type-desc">Delivered to your address</p>
                  </div>
                  <div className="sim-type-right">
                    <p className="sim-type-price">{formatRM(effectiveBasePrice)}</p>
                    {simType === 'physical' && <span className="sim-type-selected-badge">Selected</span>}
                  </div>
                </div>

                {/* eSIM — Coming Soon */}
                <div
                  className="sim-type-card sim-type-card--disabled"
                  style={{ cursor: 'not-allowed', opacity: 0.5 }}
                >
                  <div className="sim-type-radio" />
                  <div className="sim-type-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.8">
                      <rect x="7" y="3" width="10" height="16" rx="2" /><circle cx="12" cy="16" r="1" />
                    </svg>
                  </div>
                  <div className="sim-type-info">
                    <p className="sim-type-name">eSIM</p>
                    <p className="sim-type-desc">Digital SIM · No physical card</p>
                  </div>
                  <div className="sim-type-right">
                    <span className="sim-type-coming-soon">Coming Soon</span>
                  </div>
                </div>
              </div>

              {/* eSIM Compatibility Check */}
              {simType === 'esim' && (
                <div className="esim-compat-banner" style={{ marginTop: 16 }}>
                  {esimCompatible === null ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="esim-compat-spinner" />
                      <span style={{ fontSize: 13, color: '#64748b' }}>Checking device compatibility...</span>
                    </div>
                  ) : esimCompatible ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="#16a34a"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#16a34a' }}>Your device supports eSIM</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="#ea580c"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                      <span style={{ fontSize: 13, color: '#92400e' }}>Cannot verify compatibility — you can still proceed</span>
                    </div>
                  )}
                </div>
              )}

              {/* Referral ID Section */}
              <div style={{ ...cardStyle, marginTop: 24 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Do you have a Referral ID?</h3>
                <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>Agents and promoters have a referral ID.</p>

                {/* Yes / No toggle */}
                <div className="referral-toggle">
                  <button
                    className={`referral-toggle-btn${hasReferral ? ' active' : ''}`}
                    onClick={() => setHasReferral(true)}
                    type="button"
                  >Yes</button>
                  <button
                    className={`referral-toggle-btn${!hasReferral ? ' active' : ''}`}
                    onClick={() => {
                      setHasReferral(false);
                      setForm(p => ({ ...p, promoterCode: '' }));
                      setPromoterName(''); setPromoterError(''); setTwpReferenceID(''); setAlloReferenceID('');
                    }}
                    type="button"
                  >No</button>
                </div>

                {hasReferral && (
                  <div style={{ marginTop: 16 }}>
                    <label style={labelStyle}>Referral ID</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <select
                        name="promoterPrefix"
                        value={form.promoterPrefix}
                        onChange={e => {
                          setForm(p => ({ ...p, promoterPrefix: e.target.value }));
                          if (form.promoterCode.trim()) doVerifyPromoter(e.target.value, form.promoterCode);
                        }}
                        style={{ ...inputStyle, width: 90, height: 46 }}
                      >
                        <option value="TWE">TWE</option>
                        <option value="TWP">TWP</option>
                      </select>
                      <input
                        name="promoterCode"
                        placeholder="e.g. 909707"
                        value={form.promoterCode}
                        onChange={e => {
                          const v = e.target.value;
                          setForm(p => ({ ...p, promoterCode: v }));
                          setPromoterName(''); setPromoterError('');
                          if (promoterDebounce.current) clearTimeout(promoterDebounce.current);
                          if (v.trim()) promoterDebounce.current = setTimeout(() => doVerifyPromoter(form.promoterPrefix, v), 600);
                        }}
                        style={{ ...inputStyle, flex: 1, height: 46 }}
                      />
                    </div>
                    {promoterVerifying && <p style={{ fontSize: 12, color: '#2563eb', marginTop: 6 }}>Verifying...</p>}
                    {promoterName && <p style={{ fontSize: 13, color: '#16a34a', marginTop: 6, fontWeight: 600 }}>✓ {promoterName}</p>}
                    {promoterError && <p style={{ fontSize: 12, color: '#ef4444', marginTop: 6 }}>✗ {promoterError}</p>}
                    {!promoterName && !promoterVerifying && !promoterError && form.promoterCode === '' && (
                      <p style={{ fontSize: 12, color: '#f59e0b', marginTop: 8, fontWeight: 500 }}>⚠ Referral ID required to proceed.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ════════════ STEP 1: Choose Plan ════════════ */}
          {step === 1 && (
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Choose Data Plan</h2>
              <p style={{ color: '#64748b', marginBottom: 24, fontSize: 14 }}>All plans include RM30,000 Takaful protection. Skip if not needed.</p>

              <div className="plans-grid-fu">
                {FU_PLANS.map(plan => {
                  const active = selectedDataPlan?.id === plan.id;
                  const expanded = expandedPlanId === plan.id;
                  return (
                    <div key={plan.id} className={`fu-plan-card${active ? ' fu-plan-card--active' : ''}${plan.popular ? ' fu-plan-card--popular' : ''}`}>
                      {/* Header — collapsed state, always visible */}
                      <div
                        className="fu-plan-header"
                        onClick={() => { setSelectedDataPlan(active ? null : plan); setExpandedPlanId(expanded ? null : plan.id); }}
                        style={{ cursor: 'pointer', borderRadius: expanded ? '14px 14px 0 0' : 14 }}
                      >
                        {plan.popular && <span className="fu-plan-popular-badge">Most Popular</span>}
                        {active && <div className="fu-plan-check"><CheckSVG /></div>}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 8 }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                              <h3 className="fu-plan-name">Prepaid {plan.name}</h3>
                              {plan.badge5g && <span className="fu-plan-5g-inline">5G</span>}
                            </div>
                            <p className="fu-plan-data">{plan.data}</p>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <p className="fu-plan-price-col">{formatRM(plan.price)}</p>
                            <p className="fu-plan-validity-col">{plan.validity}</p>
                          </div>
                        </div>
                        <div className="fu-plan-chevron" style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 9l6 6 6-6" />
                          </svg>
                        </div>
                      </div>

                      {/* Body — only when expanded */}
                      {expanded && (
                        <div className="fu-plan-body" style={{ border: `1.5px solid ${active ? '#0074be' : '#e2e8f0'}`, borderTop: 'none', borderRadius: '0 0 14px 14px' }}>
                          <div className="fu-plan-features">
                            <div className="fu-plan-feature">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="#0074be"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>
                              <span>Data 5G/4G <strong>{plan.data}</strong></span>
                            </div>
                            <div className="fu-plan-feature">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="#0074be"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>
                              <span><strong>{plan.calls}</strong> Calls</span>
                            </div>
                            <div className="fu-plan-feature">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="#0d9488"><path d="M12 2L4 6v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6l-8-4z"/></svg>
                              <span><strong>RM30,000</strong> Takaful included</span>
                            </div>
                          </div>
                          <div className="fu-plan-total">Total: <strong>{formatRM(effectiveBasePrice + plan.price)}</strong></div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* No Data Plan card */}
                <div
                  className="sim-type-card"
                  style={{
                    border: !selectedDataPlan ? '2px solid #2563eb' : '1.5px solid #e5e7eb',
                    cursor: 'pointer',
                    boxShadow: !selectedDataPlan ? '0 0 0 3px rgba(37,99,235,0.1)' : 'none',
                  }}
                  onClick={() => { setSelectedDataPlan(null); setExpandedPlanId(null); }}
                >
                  <div className={`sim-type-radio${!selectedDataPlan ? ' sim-type-radio--active' : ''}`} />
                  <div className={`sim-type-icon${!selectedDataPlan ? ' sim-type-icon--active' : ''}`}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={!selectedDataPlan ? '#2563eb' : '#94a3b8'} strokeWidth="1.8">
                      <path d="M18.364 5.636a9 9 0 11-12.728 0" strokeLinecap="round"/><path d="M12 2v7" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <div className="sim-type-info">
                    <p className="sim-type-name">No Data Plan</p>
                    <p className="sim-type-desc">Continue without a data plan</p>
                  </div>
                  {!selectedDataPlan && (
                    <div className="sim-type-right">
                      <span className="sim-type-selected-badge">Selected</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ════════════ STEP 2: Insurance Add-on ════════════ */}
          {step === 2 && (
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Insurance Coverage</h2>
              <p style={{ color: '#64748b', marginBottom: selectedDataPlan ? 8 : 24, fontSize: 14 }}>
                Upgrade your protection with RM54,000 coverage.
              </p>

              <div className="purchase-grid-insurance">
                {/* Premium — Add-on 54K */}
                <div className={`ins-card ins-card--premium${insuranceAddon ? ' ins-card--active' : ''}`}>
                  <div
                    className="ins-card-header ins-card-header--premium"
                    onClick={() => { setInsuranceAddon(true); setExpandedInsCard(expandedInsCard === 'premium' ? null : 'premium'); }}
                    style={{ cursor: 'pointer', borderRadius: expandedInsCard === 'premium' ? '12px 12px 0 0' : 12 }}
                  >
                    <span className="ins-card-badge">Best Value</span>
                    {insuranceAddon && <div className="ins-card-check"><CheckSVG /></div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div>
                        <h3 className="ins-card-name">Premium</h3>
                        {expandedInsCard !== 'premium' && (
                          <p style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.75)', marginTop: 2 }}>RM54,000 coverage</p>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <p className="ins-card-price">{formatRM(INSURANCE_ADDON.price)}</p>
                        <div className="ins-card-chevron" style={{ transform: expandedInsCard === 'premium' ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                        </div>
                      </div>
                    </div>
                  </div>
                  {expandedInsCard === 'premium' && (
                    <div className="ins-card-body" style={{ border: `1.5px solid ${insuranceAddon ? '#115e59' : '#e2e8f0'}`, borderTop: 'none', borderRadius: '0 0 12px 12px' }}>
                      <p className="ins-card-total">Total: {formatRM(effectiveBasePrice + planAddon + INSURANCE_ADDON.price)}</p>
                      <div className="ins-card-divider" />
                      <p className="ins-card-label">Coverage:</p>
                      <ul className="ins-card-benefits">
                        <li className="ins-card-benefit">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="#0d9488"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                          <span>PA Takaful <strong>RM50,000</strong> — Zurich</span>
                        </li>
                        <li className="ins-card-benefit">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="#0d9488"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                          <span>Life Insurance <strong>RM4,000</strong> — Ammet</span>
                        </li>
                      </ul>
                      <div className="fu-extra-banner" style={{ marginTop: 10, borderRadius: 8 }}>
                        <span className="fu-extra-icon">&#127873;</span>
                        <span>FREE EXTRA <strong>120GB</strong> for 1 year</span>
                        <span className="fu-extra-sub">(10GB/month)</span>
                      </div>
                      <div style={{ marginTop: 10, background: '#dcfce7', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, color: '#166534', textAlign: 'center' }}>
                        Total RM54,000 Protection
                      </div>
                    </div>
                  )}
                </div>

                {/* Basic — No Add-on */}
                <div className={`ins-card${!insuranceAddon ? ' ins-card--active' : ''}`}>
                  <div
                    className="ins-card-header ins-card-header--basic"
                    onClick={() => { setInsuranceAddon(false); setExpandedInsCard(expandedInsCard === 'basic' ? null : 'basic'); }}
                    style={{ cursor: 'pointer', borderRadius: expandedInsCard === 'basic' ? '12px 12px 0 0' : 12 }}
                  >
                    {!insuranceAddon && <div className="ins-card-check"><CheckSVG /></div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div>
                        <h3 className="ins-card-name">Basic</h3>
                        {expandedInsCard !== 'basic' && (
                          <p style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
                            {selectedDataPlan ? 'RM30,000 coverage' : 'No coverage'}
                          </p>
                        )}
                      </div>
                      <div className="ins-card-chevron" style={{ transform: expandedInsCard === 'basic' ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                      </div>
                    </div>
                  </div>
                  {expandedInsCard === 'basic' && (
                    <div className="ins-card-body" style={{ border: `1.5px solid ${!insuranceAddon ? '#0074be' : '#e2e8f0'}`, borderTop: 'none', borderRadius: '0 0 12px 12px' }}>
                      <p className="ins-card-label">Coverage:</p>
                      <ul className="ins-card-benefits">
                        {selectedDataPlan ? (
                          <li className="ins-card-benefit">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="#0d9488"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                            <span>PA Takaful <strong>RM30,000</strong> (included with plan)</span>
                          </li>
                        ) : (
                          <li className="ins-card-benefit" style={{ color: '#94a3b8' }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="#cbd5e1"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 13H7v-2h10v2z"/></svg>
                            <span>No coverage</span>
                          </li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ════════════ STEP 3: Details & Checkout ════════════ */}
          {step === 3 && (
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Details & Checkout</h2>
              <p style={{ color: '#64748b', marginBottom: 24, fontSize: 14 }}>Fill in your details and complete payment.</p>

              <div className="purchase-grid-details-checkout">
                {/* ── LEFT: Customer + Shipping ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {/* Identity */}
                  <div style={cardStyle}>
                    <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 0.5 }}>Identity</h3>
                    <div style={{ marginBottom: 12 }}>
                      <label style={labelStyle}>Full Name *</label>
                      <input name="fullName" value={form.fullName} onChange={handleChange} placeholder="Ahmad bin Abdullah" style={inputStyle} />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={labelStyle}>NRIC / Passport *</label>
                      <input name="nric" value={form.nric} onChange={handleChange} placeholder="990101011234" style={inputStyle} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div><label style={labelStyle}>Email *</label><input name="email" type="email" value={form.email} onChange={handleChange} style={inputStyle} /></div>
                      <div><label style={labelStyle}>Phone *</label><input name="phone" type="tel" value={form.phone} onChange={handleChange} style={inputStyle} /></div>
                    </div>
                  </div>

                  {/* Shipping — only for Physical SIM */}
                  {simType === 'physical' && (
                    <div style={cardStyle}>
                      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 0.5 }}>Shipping Address</h3>
                      <div style={{ marginBottom: 12 }}>
                        <label style={labelStyle}>Address *</label>
                        <input name="address1" value={form.address1} onChange={handleChange} style={inputStyle} />
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <label style={labelStyle}>Address 2</label>
                        <input name="address2" value={form.address2} onChange={handleChange} style={inputStyle} />
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <label style={labelStyle}>Postcode *</label>
                        <input name="postcode" value={form.postcode} onChange={handleChange} placeholder="50000" inputMode="numeric" style={inputStyle} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div><label style={labelStyle}>City *</label><input name="city" value={form.city} onChange={handleChange} style={inputStyle} /></div>
                        <div>
                          <label style={labelStyle}>State</label>
                          <select name="state" value={form.state} onChange={handleChange} style={{ ...inputStyle, height: 46 }}>
                            {MALAYSIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                  {simType === 'esim' && (
                    <div style={cardStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0' }}>
                        <div style={{ width: 44, height: 44, borderRadius: 12, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="1.8"><rect x="7" y="3" width="10" height="16" rx="2"/><circle cx="12" cy="16" r="1"/></svg>
                        </div>
                        <div>
                          <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>eSIM — Instant Delivery</p>
                          <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>QR code & activation details will be shown after payment.</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── RIGHT: Order Summary + Payment ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {/* Order Summary */}
                  <div style={cardStyle}>
                    <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 0.5 }}>Order Summary</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {selectedNumber ? (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                          <span>{selectedNumber.displayNo || selectedNumber.phoneNo} <span style={{ fontSize: 11, background: '#eff6ff', color: '#1d4ed8', padding: '1px 6px', borderRadius: 4 }}>{selectedNumber.category}</span></span>
                          <span style={{ fontWeight: 600 }}>{formatRM(selectedNumber.price)}</span>
                        </div>
                      ) : (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                            <span>Base SIM</span>
                            <span style={{ fontWeight: 600 }}>{formatRM(effectiveBasePrice)}</span>
                          </div>
                          {selectedDataPlan && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                              <span>{selectedDataPlan.name}</span>
                              <span style={{ fontWeight: 600 }}>{formatRM(planAddon)}</span>
                            </div>
                          )}
                          {insuranceAddon && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                              <span>Insurance Add-on</span>
                              <span style={{ fontWeight: 600 }}>{formatRM(INSURANCE_ADDON.price)}</span>
                            </div>
                          )}
                        </>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                        <span>Shipping</span>
                        <span style={{ fontWeight: 600, color: shippingFee > 0 ? '#1e293b' : '#16a34a' }}>
                          {shippingFee > 0 ? formatRM(shippingFee) : 'Free'}
                        </span>
                      </div>
                    </div>
                    <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '14px 0' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 800, color: '#2563eb' }}>
                      <span>Total</span>
                      <span>{formatRM(total)}</span>
                    </div>
                    {form.fullName && (
                      <>
                        <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '14px 0' }} />
                        <div style={{ fontSize: 13, color: '#64748b' }}>
                          <p style={{ margin: '2px 0' }}><strong>{form.fullName}</strong></p>
                          {form.email && <p style={{ margin: '2px 0' }}>{form.email} | {form.phone}</p>}
                          {form.address1 && <p style={{ margin: '2px 0' }}>{form.address1}{form.address2 ? `, ${form.address2}` : ''}</p>}
                          {form.postcode && <p style={{ margin: '2px 0' }}>{form.postcode} {form.city}, {form.state}</p>}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Payment */}
                  <div style={cardStyle}>
                    <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, textTransform: 'uppercase', letterSpacing: 0.5 }}>Payment Method</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                      {PAYMENT_METHODS.map(m => {
                        const active = paymentMethod === m.id;
                        return (
                          <div key={m.id} onClick={() => setPaymentMethod(m.id)} style={{
                            padding: '12px 16px', borderRadius: 8, cursor: 'pointer',
                            border: active ? '2px solid #2563eb' : '1px solid #e5e7eb',
                            background: active ? '#eff6ff' : '#fff',
                            display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, transition: 'all 0.15s',
                          }}>
                            <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid #2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              {active && <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#2563eb' }} />}
                            </div>
                            {m.label}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14, padding: 12, background: '#f8fafc', borderRadius: 8 }}>
                      By placing an order you agree to our <strong>Terms & Conditions</strong> and <strong>Privacy Policy</strong>.
                    </div>
                    {error && <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 10 }}>{error}</p>}
                    <button
                      onClick={handleSubmit}
                      disabled={submitting}
                      style={{
                        width: '100%', padding: '14px 0', borderRadius: 50,
                        background: '#eab308', color: '#fff', border: 'none',
                        fontSize: 16, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer',
                        opacity: submitting ? 0.7 : 1,
                      }}
                    >
                      {submitting ? 'Processing...' : 'Pay Now'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Bottom nav ── */}
          {step < 3 && (
            <div className="step-nav" style={{ marginBottom: 32 }}>
              <button className="btn btn-blue" onClick={goBack}>Back</button>
              <button className="btn btn-blue" onClick={goNext}>Next</button>
            </div>
          )}
          {step === 3 && (
            <div className="step-nav" style={{ marginBottom: 32 }}>
              <button className="btn btn-blue" onClick={goBack}>Back</button>
            </div>
          )}
        </motion.div>
        </AnimatePresence>
        )}
        </main>
      </div>

      {/* ── MOBILE ORDER BAR (mobile only) ── */}
      <div className={`purchase-mobile-order${mobileOrderOpen ? ' open' : ''}`}>
        <div className="mobile-order-bar" onClick={() => setMobileOrderOpen(!mobileOrderOpen)}>
          <div className="mobile-order-total">
            <span style={{ fontSize: 12, color: '#64748b' }}>Total</span>
            <span style={{ fontSize: 18, fontWeight: 800, color: '#2563eb' }}>{formatRM(currentRunningTotal)}</span>
          </div>
          <button className="mobile-order-toggle">
            {mobileOrderOpen ? 'Hide' : 'View Details'}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: mobileOrderOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </button>
        </div>
        {mobileOrderOpen && (
          <div className="mobile-order-details">
            <SidebarOrderContent />
            <div className="sidebar-order-divider" />
            <div className="sidebar-order-row sidebar-order-total">
              <span>Total</span>
              <span>{formatRM(currentRunningTotal)}</span>
            </div>
          </div>
        )}
      </div>

      <style>{`
        /* ── Purchase Layout ── */
        .purchase-layout {
          display: flex; gap: 32px; max-width: 1200px;
          margin: 0 auto; padding: 32px 20px 40px;
          min-height: 100vh;
        }
        .purchase-sidebar {
          width: 280px; flex-shrink: 0; position: sticky;
          top: 20px; align-self: flex-start;
        }
        .purchase-main { flex: 1; min-width: 0; }

        /* Vertical Stepper */
        .sidebar-step-row { display: flex; align-items: center; gap: 12px; }
        .sidebar-step-circle {
          width: 36px; height: 36px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 13px; font-weight: 700;
          background: #e5e7eb; color: #94a3b8;
          transition: all 0.2s; flex-shrink: 0;
        }
        .sidebar-step-circle.completed { background: #16a34a; color: #fff; cursor: pointer; }
        .sidebar-step-circle.active { background: #2563eb; color: #fff; }
        .sidebar-step-label { font-size: 14px; color: #94a3b8; }
        .sidebar-step-label.active { font-weight: 700; color: #1e293b; }
        .sidebar-step-connector {
          width: 2px; height: 24px; margin-left: 17px;
          background: #e5e7eb; transition: background 0.2s;
        }
        .sidebar-step-connector.completed { background: #16a34a; }

        /* Order Summary */
        .sidebar-order {
          background: #fff; border: 1px solid #e5e7eb;
          border-radius: 14px; padding: 20px; margin-top: 24px;
        }
        .sidebar-order-title {
          font-size: 14px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.5px; color: #1e293b; margin: 0 0 16px;
        }
        .sidebar-order-row {
          display: flex; justify-content: space-between;
          font-size: 13px; padding: 4px 0; color: #374151;
        }
        .sidebar-order-divider { height: 1px; background: #e5e7eb; margin: 12px 0; }
        .sidebar-order-total { font-weight: 700; font-size: 16px; color: #2563eb; }

        /* Mobile Stepper */
        .purchase-mobile-stepper { display: none; }
        .mobile-stepper-row {
          display: flex; align-items: center; gap: 4px; justify-content: center;
        }
        .mobile-step-circle {
          width: 32px; height: 32px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 13px; font-weight: 700;
          background: #e5e7eb; color: #94a3b8; transition: all 0.2s;
        }
        .mobile-step-circle.completed { background: #16a34a; color: #fff; cursor: pointer; }
        .mobile-step-circle.active { background: #2563eb; color: #fff; }
        .mobile-step-connector { width: 24px; height: 2px; background: #e5e7eb; border-radius: 1px; }
        .mobile-step-connector.completed { background: #16a34a; }
        .mobile-stepper-title {
          text-align: center; font-size: 14px; font-weight: 600;
          color: #1e293b; margin: 8px 0 0;
        }

        /* Mobile Order Bar */
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
        .mobile-order-details {
          padding: 12px 20px 16px; border-top: 1px solid #e5e7eb;
        }

        /* SIM Type Cards */
        .sim-type-grid { display: flex; flex-direction: column; gap: 10px; }
        .sim-type-card {
          display: flex; align-items: center; gap: 14px;
          background: #fff; border: 1.5px solid #e5e7eb; border-radius: 14px;
          padding: 16px 18px; transition: all 0.2s;
        }
        .sim-type-card--active {
          border-color: #2563eb; background: #fff;
          box-shadow: 0 0 0 3px rgba(37,99,235,0.1);
        }
        .sim-type-card--disabled { opacity: 0.5; cursor: not-allowed; }

        .sim-type-radio {
          width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0;
          border: 2px solid #d1d5db; background: #fff; transition: all 0.15s;
        }
        .sim-type-radio--active {
          border-color: #2563eb; background: #2563eb;
          box-shadow: inset 0 0 0 3px #fff;
        }
        .sim-type-icon {
          width: 44px; height: 44px; border-radius: 10px;
          background: #f1f5f9; display: flex; align-items: center;
          justify-content: center; flex-shrink: 0;
        }
        .sim-type-icon--active { background: #dbeafe; }
        .sim-type-info { flex: 1; min-width: 0; }
        .sim-type-name { font-size: 15px; font-weight: 700; color: #1e293b; margin: 0 0 2px; }
        .sim-type-desc { font-size: 12px; color: #64748b; margin: 0; }
        .sim-type-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }
        .sim-type-price { font-size: 16px; font-weight: 800; color: #2563eb; margin: 0; }
        .sim-type-selected-badge {
          font-size: 11px; font-weight: 700; color: #2563eb;
          background: #dbeafe; padding: 2px 8px; border-radius: 20px;
        }
        .sim-type-soon-badge {
          font-size: 11px; font-weight: 700; color: #92400e;
          background: #fef3c7; padding: 2px 8px; border-radius: 20px;
        }

        /* Referral Toggle */
        .referral-toggle {
          display: flex; gap: 0; border: 1.5px solid #d1d5db; border-radius: 8px;
          overflow: hidden; width: fit-content;
        }
        .referral-toggle-btn {
          padding: 8px 24px; border: none; font-size: 14px; font-weight: 600;
          cursor: pointer; background: #fff; color: #64748b; transition: all 0.15s;
        }
        .referral-toggle-btn.active { background: #2563eb; color: #fff; }
        .referral-toggle-btn:first-child { border-right: 1.5px solid #d1d5db; }

        /* FU Plan Cards */
        .plans-grid-fu { display: flex; flex-direction: column; gap: 12px; }
        .fu-plan-card {
          position: relative; background: transparent; border: none;
          text-align: left;
        }

        /* Chevron */
        .fu-plan-chevron {
          position: absolute; bottom: 10px; right: 12px;
          transition: transform 0.2s;
        }

        /* Inline 5G badge */
        .fu-plan-5g-inline {
          display: inline-block; background: #ffe000; color: #273a89;
          font-size: 10px; font-weight: 800; padding: 2px 6px;
          border-radius: 4px; line-height: 1.4; flex-shrink: 0;
        }

        /* Collapsed price + validity in header */
        .fu-plan-price-col { font-size: 20px; font-weight: 800; color: #ffe000; margin: 0; line-height: 1.1; }
        .fu-plan-validity-col { font-size: 11px; color: rgba(255,255,255,0.7); margin: 3px 0 0; }

        .fu-plan-header {
          position: relative; background: #0074be; color: #fff;
          padding: 16px; border-radius: 16px; text-align: left;
        }
        .fu-plan-card--popular .fu-plan-header { background: #273a89; }
        .fu-plan-popular-badge {
          position: absolute; top: 0; right: 0; background: #ff0077; color: #fff;
          font-size: 10px; font-weight: 800; padding: 4px 10px;
          border-radius: 0 16px; line-height: 1;
        }
        .fu-plan-5g-badge {
          position: absolute; top: 0; right: 0; background: #ffe000; color: #273a89;
          font-size: 10px; font-weight: 800; padding: 4px 10px;
          border-radius: 0 16px; line-height: 1;
        }
        .fu-plan-check {
          position: absolute; top: 12px; right: 40px; width: 26px; height: 26px;
          border-radius: 50%; background: #fff; display: flex;
          align-items: center; justify-content: center;
        }
        .fu-plan-check svg { stroke: #0074be; }
        .fu-plan-name { font-size: 14px; font-weight: 500; color: #fff; margin: 0 0 2px; }
        .fu-plan-data { font-size: 28px; font-weight: 700; color: #ffe000; margin: 0; line-height: 1.1; }
        .fu-plan-body { padding: 14px 8px 8px; text-align: left; }
        .fu-plan-pricing { display: flex; align-items: baseline; gap: 6px; margin-bottom: 4px; }
        .fu-plan-original { font-size: 13px; color: #94a3b8; text-decoration: line-through; }
        .fu-plan-price { font-size: 28px; font-weight: 700; color: #273a89; }
        .fu-plan-save {
          display: inline-block; background: #fef3c7; color: #92400e;
          font-size: 11px; font-weight: 700; padding: 3px 10px;
          border-radius: 20px; margin-bottom: 4px;
        }
        .fu-plan-validity { font-size: 13px; color: #333; margin: 2px 0 0; }
        .fu-plan-divider { width: 100%; height: 1px; background: #e5e7eb; margin: 10px 0; }
        .fu-plan-features-label { font-size: 13px; color: #333; margin: 0 0 6px; }
        .fu-plan-features { display: flex; flex-direction: column; gap: 4px; }
        .fu-plan-feature { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #333; }
        .fu-plan-feature svg { flex-shrink: 0; }
        .fu-plan-total {
          margin-top: 10px; padding: 8px 0 0; border-top: 1px solid #e5e7eb;
          font-size: 12px; color: #64748b;
        }
        .fu-plan-total strong { color: #1e293b; }

        /* Insurance Cards */
        .ins-card {
          position: relative; background: transparent; border: none;
          text-align: left;
        }
        .ins-card-header {
          position: relative; color: #fff;
          padding: 16px; border-radius: 12px; text-align: left;
        }
        .ins-card-header--basic { background: #0074be; }
        .ins-card-header--premium { background: #115e59; }
        .ins-card-badge {
          position: absolute; top: 0; right: 0; background: #ff0077; color: #fff;
          font-size: 10px; font-weight: 800; padding: 4px 10px;
          border-radius: 0 12px; line-height: 1;
        }
        .ins-card-check {
          position: absolute; top: 12px; right: 12px; width: 26px; height: 26px;
          border-radius: 50%; background: rgba(255,255,255,0.2);
          display: flex; align-items: center; justify-content: center;
        }
        .ins-card-name { font-size: 14px; font-weight: 500; color: #fff; margin: 0 0 4px; }
        .ins-card-price { font-size: 24px; font-weight: 700; color: #a3e635; margin: 0; line-height: 1.1; }
        .ins-card-body { padding: 14px 8px 8px; }
        .ins-card-total { font-size: 12px; color: #64748b; margin: 0 0 6px; }
        .ins-card-divider { width: 100%; height: 1px; background: #e5e7eb; margin: 10px 0; }
        .ins-card-label { font-size: 13px; color: #333; margin: 0 0 6px; }
        .ins-card-benefits { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
        .ins-card-benefit { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; color: #333; }
        .ins-card-benefit svg { flex-shrink: 0; margin-top: 1px; }
        .ins-card-chevron { transition: transform 0.2s; flex-shrink: 0; }

        /* Grids */
        .purchase-grid-insurance { display: flex; flex-direction: column; gap: 12px; }
        .purchase-grid-details-checkout { display: grid; grid-template-columns: 1fr 380px; gap: 24px; align-items: start; }

        @media (max-width: 768px) {
          .purchase-sidebar { display: none; }
          .purchase-mobile-stepper {
            display: block; background: #fff;
            border-bottom: 1px solid #e5e7eb; padding: 16px 20px;
          }
          .purchase-mobile-order {
            display: block; position: fixed; bottom: 0; left: 0; right: 0;
            z-index: 50; background: #fff;
            box-shadow: 0 -4px 20px rgba(0,0,0,0.1);
            border-radius: 16px 16px 0 0;
          }
          .purchase-layout { flex-direction: column; padding: 0; gap: 0; min-height: auto; }
          .purchase-main { padding: 24px 20px 100px; }
          .plans-grid-fu { gap: 8px; }
          .purchase-grid-details-checkout { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 480px) {
        }
      `}</style>
    </div>
  );
}

export default function SIMPurchasePage() {
  return (
    <Suspense fallback={<div className="container" style={{ padding: '80px 20px', textAlign: 'center' }}><p style={{ color: '#64748b' }}>Loading...</p></div>}>
      <SIMPurchaseWizard />
    </Suspense>
  );
}
