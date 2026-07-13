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
import { MALAYSIAN_STATES, getNestApiBaseUrl } from '@/lib/constants';
import { isEsimEnabled } from '@/lib/features';
import type { NumberResult } from '@/types';

/* ═══════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════ */
const STEPS = [
  'Choose SIM',
  'Choose Plan',
  'Insurance',
  'Complete Order',
];

const STAGING_MODE = false; // staging sends RM1 regardless of actual total — flip to true for testing
const DEFAULT_BASE_SIM_PRICE = 19.50;
const OSS_PAYMENT_URL = 'https://www.tonewow.net/gkashwebservice/osspay.jsp';
const ESIM_ORDER_STORAGE_KEY = 'tw_esim_order';
const ESIM_ORDER_COOKIE = 'tw_esim_refno';

const PAYMENT_METHODS = [
  { id: '16', label: 'Online Banking (FPX)' },
  { id: '2',  label: 'Credit / Debit Card' },
  { id: '3',  label: 'eWallet' },
] as const;

const ESIM_COMPATIBLE_DEVICES_URL = 'https://www.tonewow.com/esim-devices';
const NO_ADD_ON_TOOLTIP = 'FREE 2GB welcome data upon SIM activation. Subscribe to any FU plan within 7 days to get the 20GB bonus.';
const BASIC_TAKAFUL_TOOLTIP = 'Granted when you subscribe to any FU Data Plan within 7 days after activation.';
const SUPERLITE_BASIC_TOOLTIP = 'Minimum reload of RM30/month required.';

type PurchaseMode = 'lite' | 'superlite' | 'superliteplus';
type InsuranceTier = 'basic' | 'premium' | 'premiumPro' | 'premiumProMax';

type InsuranceOption = {
  id: InsuranceTier;
  apiValue: '0' | '1' | '2' | '3';
  name: string;
  tagline: string;
  price: number;
  badge?: string;
  benefits: string[];
};

const LITE_INSURANCE_OPTIONS: InsuranceOption[] = [
  {
    id: 'premiumProMax',
    apiValue: '3',
    name: 'Ultra',
    tagline: 'RM54,000 coverage',
    price: 25,
    badge: 'Best Value',
    benefits: ['PA Takaful RM50,000 (1 Year)', 'Life Insurance RM4,000 (1 Year)', 'FREE EXTRA 120GB for 1 year (10GB/month)'],
  },
  {
    id: 'premium',
    apiValue: '1',
    name: 'Premium',
    tagline: 'RM30,000 coverage',
    price: 0,
    benefits: ['PA Takaful RM30,000 (1 Year)'],
  },
];

const SUPERLITE_INSURANCE_OPTIONS: InsuranceOption[] = [
  {
    id: 'premiumProMax',
    apiValue: '3',
    name: 'Ultra',
    tagline: 'RM54,000 coverage',
    price: 20.90,
    badge: 'Best Value',
    benefits: ['PA Takaful RM50,000 (1 Year)', 'Life Insurance RM4,000 (1 Year)'],
  },
  {
    id: 'premiumPro',
    apiValue: '2',
    name: 'Premium +',
    tagline: 'RM34,000 coverage',
    price: 19.90,
    benefits: ['PA Takaful RM30,000 (1 Year)', 'Life Insurance RM4,000 (1 Year)'],
  },
  {
    id: 'premium',
    apiValue: '1',
    name: 'Premium',
    tagline: 'RM30,000 coverage',
    price: 9.90,
    benefits: ['PA Takaful RM30,000 (1 Year)'],
  },
  {
    id: 'basic',
    apiValue: '0',
    name: 'Basic',
    tagline: 'RM10,000 coverage',
    price: 0,
    benefits: ['PA Takaful RM10,000 (1 Year)'],
  },
];

const FU_PLAN_IDS: Record<string, { physical: number; esim: number }> = {
  fu10: { physical: 8, esim: 10 },
  fu20: { physical: 11, esim: 12 },
  'fu20+': { physical: 13, esim: 14 },
  fu20plus: { physical: 13, esim: 14 },
  fu35: { physical: 15, esim: 16 },
  fu50: { physical: 17, esim: 18 },
  fu60: { physical: 19, esim: 20 },
  fu80: { physical: 21, esim: 22 },
  fu120: { physical: 23, esim: 24 },
};

const SUPERLITE_FU_PLAN_IDS: Record<string, number> = {
  fu10: 25,
  fu20: 26,
  'fu20+': 27,
  fu20plus: 27,
  fu35: 28,
  fu50: 29,
  fu60: 30,
  fu80: 31,
  fu120: 32,
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

const rememberEsimOrder = (refNo: string, paymentRefNo: string, email: string) => {
  const payload = JSON.stringify({ refNo, paymentRefNo, email });
  localStorage.setItem(ESIM_ORDER_STORAGE_KEY, payload);
  sessionStorage.setItem(ESIM_ORDER_STORAGE_KEY, payload);
  document.cookie = `${ESIM_ORDER_COOKIE}=${encodeURIComponent(paymentRefNo)}; Max-Age=86400; Path=/; SameSite=Lax`;
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

function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="info-tooltip-wrap">
      <button
        type="button"
        className="info-tooltip-button"
        aria-label={text}
        title={text}
        onClick={(event) => event.stopPropagation()}
      >
        i
      </button>
      <span className="info-tooltip-bubble" role="tooltip">{text}</span>
    </span>
  );
}

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

/* ═══════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════ */
function SIMPurchaseWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const esimEnabled = isEsimEnabled();
  const simID = searchParams.get('simID');
  const purchaseMode: PurchaseMode = simID === 'superlite' || simID === 'superliteplus' ? simID : 'lite';
  const isSuperliteMode = purchaseMode === 'superlite' || purchaseMode === 'superliteplus';
  const isSuperlitePlusMode = purchaseMode === 'superliteplus';
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
  const [promoterLocked, setPromoterLocked] = useState(false);

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
    const totalGB = descLines
      .filter(l => /GB/i.test(l) && !/basic/i.test(l))
      .reduce((sum, l) => { const m = l.match(/([\d,]+)\s*GB/i); return sum + (m ? parseInt(m[1].replace(/,/g, '')) : 0); }, 0);
    const dataDisplay = `${totalGB.toLocaleString()} GB`;
    const validityLine = descLines.find(l => /day/i.test(l)) || '30 Days Validity';
    const callsLine = descLines.find(l => /min/i.test(l)) || 'Unlimited Calls';
    return {
      id, name, price,
      discountedAddon: Math.max(0, price - 5),
      data: dataDisplay,
      validity: validityLine.trim(),
      calls: callsLine.replace(/,/g, '').trim(),
      badge5g: true,
      popular: name === 'FU60',
    };
  });

  const FU_PLANS: DataPlan[] = DYNAMIC_PLANS.length > 0 ? DYNAMIC_PLANS : [
    { id: 'fu10',  name: 'FU10',  price: 10,  discountedAddon: 8,   data: '12 GB',  validity: '10 Days', calls: '100 Min',    badge5g: true },
    { id: 'fu20',  name: 'FU20',  price: 20,  discountedAddon: 17,  data: '35 GB',  validity: '20 Days', calls: 'Unlimited', badge5g: true },
    { id: 'fu35',  name: 'FU35',  price: 35,  discountedAddon: 30,  data: '150 GB', validity: '30 Days', calls: '*Unlimited', badge5g: true },
    { id: 'fu50',  name: 'FU50',  price: 50,  discountedAddon: 45,  data: '300 GB', validity: '30 Days', calls: '*Unlimited', badge5g: true },
    { id: 'fu60',  name: 'FU60',  price: 60,  discountedAddon: 55,  data: '500 GB', validity: '30 Days', calls: '*Unlimited', badge5g: true, popular: true },
    { id: 'fu80',  name: 'FU80',  price: 80,  discountedAddon: 75,  data: '650 GB', validity: '30 Days', calls: '*Unlimited', badge5g: true },
    { id: 'fu120', name: 'FU120', price: 120, discountedAddon: 115, data: '800 GB', validity: '30 Days', calls: '*Unlimited', badge5g: true },
  ];
  const insuranceOptions = isSuperliteMode ? SUPERLITE_INSURANCE_OPTIONS : LITE_INSURANCE_OPTIONS;
  const insuranceById = Object.fromEntries(insuranceOptions.map(option => [option.id, option])) as Partial<Record<InsuranceTier, InsuranceOption>>;

  useEffect(() => {
    getDataPlans('TWE', '').then(p => setApiPlans(p.length > 0 ? p : [])).catch(() => {});
  }, []);

  /* ── Step 1: Plan expand state ── */
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);

  /* ── Step 2: Insurance selection ── */
  const [selectedInsurance, setSelectedInsurance] = useState<InsuranceTier>('basic');
  const [expandedInsCard, setExpandedInsCard] = useState<InsuranceTier | null>(null);

  /* ── Step 3: KYC + Shipping ── */
  const [form, setForm] = useState({
    fullName: '', nric: '', email: '', phone: '',
    address1: '', address2: '', city: '', state: 'W.P. Kuala Lumpur', postcode: '',
    promoterPrefix: 'TWE', promoterCode: '',
  });
  const [simType, setSimType] = useState<'physical' | 'esim'>('physical');
  const [showEsimSuccess, setShowEsimSuccess] = useState(false);
  const [directCheckout, setDirectCheckout] = useState(false);
  const planAutoSelected = useRef(false);
  const [esimConfirmed, setEsimConfirmed] = useState(false);

  /* ── Direct checkout via ?dataPlanID= ── */
  useEffect(() => {
    const planId = searchParams.get('dataPlanID');
    if (!planId || apiPlans.length === 0) return;
    const match = apiPlans.find(p => p.codeData1 === planId);
    if (!match) return;
    const name = (match.codeData2 || '').trim().replace(/\s+/g, '').toLowerCase();
    const price = parseFloat(match.codeData3) || 0;
    const descLines = (match.codeDesc || '').split(/[\r\n]+/).filter(Boolean);
    const totalGB = descLines
      .filter(l => /GB/i.test(l) && !/basic/i.test(l))
      .reduce((sum, l) => { const m = l.match(/([\d,]+)\s*GB/i); return sum + (m ? parseInt(m[1].replace(/,/g, '')) : 0); }, 0);
    setSelectedDataPlan({
      id: name, name: name.toUpperCase(), price,
      discountedAddon: Math.max(0, price - 5),
      data: `${totalGB.toLocaleString()} GB`,
      validity: (descLines.find(l => /day/i.test(l)) || '30 Days Validity').trim(),
      calls: (descLines.find(l => /min/i.test(l)) || 'Unlimited Calls').replace(/,/g, '').trim(),
      badge5g: true, popular: false,
    });
    setSimType('physical');
    setDirectCheckout(true);
    setStep(3);
    router.replace('/sim/purchase');
  }, [apiPlans, searchParams, router]);

  /* ── Superlite / Superlite+ gated modes via ?simID= ── */
  useEffect(() => {
    if (!isSuperliteMode) return;
    setSimType('physical');

    if (isSuperlitePlusMode) {
      const fu35 = FU_PLANS.find(p => p.id.replace(/\s+/g, '').toLowerCase() === 'fu35');
      if (fu35 && (selectedDataPlan?.id !== fu35.id || selectedDataPlan?.price !== fu35.price || selectedDataPlan?.data !== fu35.data)) {
        setSelectedDataPlan(fu35);
        setExpandedPlanId(fu35.id);
      }
      if (step !== 3) setStep(3);
      return;
    }

    if (step === 0) setStep(1);
  }, [isSuperliteMode, isSuperlitePlusMode, FU_PLANS, selectedDataPlan?.id, selectedDataPlan?.price, selectedDataPlan?.data, step]);

  useEffect(() => {
    if (isSuperliteMode) return;
    setSelectedInsurance(prev => prev === 'basic' ? 'premium' : prev);
  }, [isSuperliteMode]);

  /* ── Default select + expand FU60 on step 1 (once only) ── */
  useEffect(() => {
    if (step === 1 && !selectedDataPlan && !planAutoSelected.current && FU_PLANS.length > 0 && !isSuperlitePlusMode) {
      const fu60 = FU_PLANS.find(p => p.popular);
      if (fu60) { setSelectedDataPlan(fu60); setExpandedPlanId(fu60.id); planAutoSelected.current = true; }
    }
  }, [step, FU_PLANS, selectedDataPlan, isSuperlitePlusMode]);

  /* ── Default expand Basic insurance on step 2 ── */
  useEffect(() => {
    if (step === 2 && expandedInsCard === null) {
      setExpandedInsCard(isSuperliteMode ? 'basic' : 'premium');
    }
  }, [step, expandedInsCard, isSuperliteMode]);

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
      if (prefix === 'TWP') {
        const ref = await saveRefAllocation(memberID);
        if (ref.referenceID) {
          setTwpReferenceID(ref.referenceID);
          setAlloReferenceID(ref.referenceID);
          setPromoterName(result.name || memberID);
        } else {
          setPromoterError(ref.error || 'Unable to generate TWP reference ID. Please try again.');
        }
      } else {
        if (result.name) setPromoterName(result.name);
      }
    } else {
      setPromoterError(result.error || 'Not found');
    }
    setPromoterVerifying(false);
  }, []);

  /* Auto-fill promoter from ?promoter= & ?code= params */
  useEffect(() => {
    const p = searchParams.get('promoter');
    const c = searchParams.get('code');
    const referenceID = searchParams.get('referenceID');
    if (referenceID) {
      setTwpReferenceID(referenceID);
      setAlloReferenceID(referenceID);
      return;
    }
    if (!p || !c) return;
    setForm(f => ({ ...f, promoterPrefix: p.toUpperCase(), promoterCode: c }));
    setHasReferral(true);
    setPromoterLocked(true);
    doVerifyPromoter(p.toUpperCase(), c);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


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
  const selectedInsuranceOption = insuranceById[selectedInsurance] || insuranceOptions[0];
  const insurancePrice = selectedInsuranceOption.price;
  const effectiveBasePrice = directCheckout || purchaseMode === 'superlite' ? 10 : isSuperlitePlusMode ? 0 : BASE_SIM_PRICE;
  const hasPromoter = !!(form.promoterCode && form.promoterCode.trim());
  const isBareOrder = !hasPromoter && !selectedDataPlan && insurancePrice === 0 && !selectedNumber;
  const shippingFee = simType === 'esim' ? 0 : hasPromoter ? 10 : isBareOrder ? 5 : 0;

  const numberPrice = selectedNumber?.price || 0;

  const total = selectedNumber
    ? numberPrice + shippingFee
    : effectiveBasePrice + planAddon + insurancePrice + shippingFee;

  const selectedNumberCategory = selectedNumber?.category?.toUpperCase() || '';
  const insuranceApiValue = ['PREMIUM', 'VIP', 'VVIP'].includes(selectedNumberCategory)
    ? '3'
    : selectedInsuranceOption.apiValue;

  const currentRunningTotal = selectedNumber ? numberPrice : effectiveBasePrice + planAddon + insurancePrice;
  const baseSimDisplay = isSuperlitePlusMode && effectiveBasePrice === 0 ? 'FREE' : formatRM(effectiveBasePrice);
  const simOrderLabel = simType === 'esim'
    ? 'eSIM'
    : purchaseMode === 'superliteplus'
      ? 'SIM (SuperLITE+)'
      : purchaseMode === 'superlite'
        ? 'SIM (SuperLITE)'
        : 'SIM';

  /* ── Determine planid for OSSPayment ── */
  const determinePlanId = (): number => {
    if (selectedNumber) {
      const cat = selectedNumber.category?.toUpperCase();
      if (cat === 'VVIP') return 7;
      if (cat === 'VIP') return 4;
      if (cat === 'NORMAL') return 6;
      return 5;
    }
    if (selectedDataPlan) {
      const key = selectedDataPlan.id.replace(/\s+/g, '').toLowerCase();
      if (isSuperlitePlusMode) return 33;
      if (purchaseMode === 'superlite') return SUPERLITE_FU_PLAN_IDS[key] || 28;
      const ids = FU_PLAN_IDS[key];
      if (ids) return simType === 'esim' ? ids.esim : ids.physical;
    }
    if (purchaseMode === 'superlite') return 34;
    if (simType === 'esim') return 9;
    return 1;
  };

  /* ── Navigation ── */
  const canGoNext = (): boolean => {
    if (step === 0) return !(hasReferral && !promoterName) && (simType !== 'esim' || esimConfirmed);
    if (step === 1) return true;
    if (step === 2) return true;
    if (step === 3) return !!(form.fullName && form.email && form.phone && form.nric && form.address1 && form.city && form.postcode);
    return true;
  };

  const goNext = () => {
    if (step === 0 && simType === 'esim' && !esimConfirmed) {
      setError('Please confirm that your device supports e-SIM before proceeding.');
      return;
    }
    if (step === 0 && hasReferral && !promoterName) {
      setError('Please enter a valid Referral ID before proceeding.');
      return;
    }
    if (!canGoNext() || step >= 3) return;
    setError('');
    setDirection(1);
    setStep(step + 1);
  };

  const goBack = () => {
    if (directCheckout || isSuperlitePlusMode) return;
    if (searchParams.get('special') === '1') { router.push('/'); return; }
    if (step === 3 && selectedNumber) {
      setSelectedNumber(null);
      localStorage.removeItem('tw_selected_number');
    }
    if (isSuperliteMode && step === 1) return;
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
        referralCode: promoterId ? `${promoterId}${twpReferenceID}` : twpReferenceID,
        dataPlanID: '0',
        insurance: insuranceApiValue,
        isEsim: simType === 'esim' ? '1' : '0',
        twpReferenceID,
        alloReferenceID,
      });

      const apiBase = getNestApiBaseUrl();

      if (simType === 'esim') {
        const paymentRefNo = `${paymentMethod}${refNo}`;
        const confirmationUrl = `${window.location.origin}/confirmation?esim=1&refno=${encodeURIComponent(paymentRefNo)}`;
        params.set('returnurl', confirmationUrl);
        params.set('callbackurl', confirmationUrl);
        params.set('failureurl', confirmationUrl);

        const promoData = {
          prefix: hasPromoter ? form.promoterPrefix : '',
          code: hasPromoter ? form.promoterCode : '',
          name: hasPromoter ? promoterName : '',
          email: form.email,
          twpReferenceID,
          alloReferenceID,
        };
        localStorage.setItem('tw_esim_promoter', JSON.stringify(promoData));
        rememberEsimOrder(refNo, paymentRefNo, form.email);
        fetch(`${apiBase}/payment/poll/${paymentMethod}${refNo}`, { method: 'POST' }).catch(() => {});
      }

      fetch(`${apiBase}/payment/poll/${paymentMethod}${refNo}`, { method: 'POST' }).catch(() => {});
      window.location.href = `${OSS_PAYMENT_URL}?${params.toString()}`;
    } catch (err: any) { setError(err.message || 'Something went wrong. Please try again.'); setSubmitting(false); }
  };

  /* ── Stepper helpers ── */
  const isStepCompleted = (i: number) => !directCheckout && ((selectedNumber && i < 3) || i < step);
  const isStepActive = (i: number) => i === step;
  const showOrderDetailsShipping = step === 3 && simType !== 'esim';

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
              <div style={{ fontSize: 11, fontWeight: 600, color: '#1d4ed8', marginBottom: 4 }}>Included for {nb.freeMonths} months:</div>
              {[nb.plan, ...nb.benefits].map((b, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#1e40af', marginTop: 3 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="#2563eb"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
                  <span>{b}</span>
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
          <span>{simOrderLabel}</span>
          <span style={isSuperlitePlusMode ? { color: '#16a34a', fontWeight: 700 } : undefined}>{baseSimDisplay}</span>
        </div>
        {selectedDataPlan && (
          <div className="sidebar-order-row">
            <span>{selectedDataPlan.name}</span>
            <span>{formatRM(planAddon)}</span>
          </div>
        )}
        {insurancePrice > 0 && (
          <div className="sidebar-order-row">
            <span>{selectedInsuranceOption.name}</span>
            <span>{formatRM(insurancePrice)}</span>
          </div>
        )}
        {showOrderDetailsShipping && (
          <div className="sidebar-order-row" style={{ marginTop: 6 }}>
            <span>Shipping</span>
            <span style={{ color: shippingFee > 0 ? '#1e293b' : '#16a34a' }}>
              {shippingFee > 0 ? formatRM(shippingFee) : 'Free'}
            </span>
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
                    onClick={() => { if (!directCheckout && !(isSuperliteMode && i === 0) && isStepCompleted(i) && !selectedNumber) { setDirection(i < step ? -1 : 1); setStep(i); } }}
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
                  onClick={() => { if (!directCheckout && !(isSuperliteMode && i === 0) && isStepCompleted(i) && !selectedNumber) { setDirection(i < step ? -1 : 1); setStep(i); } }}
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
                    <p className="sim-type-price">{baseSimDisplay}</p>
                    {simType === 'physical' && <span className="sim-type-selected-badge">Selected</span>}
                  </div>
                </div>

                {/* eSIM */}
                <div
                  className={`sim-type-card${esimEnabled && simType === 'esim' ? ' sim-type-card--active' : ''}${!esimEnabled ? ' sim-type-card--disabled' : ''}`}
                  onClick={() => {
                    if (esimEnabled) setSimType('esim');
                  }}
                  style={{ cursor: esimEnabled ? 'pointer' : 'not-allowed', opacity: esimEnabled ? 1 : 0.5 }}
                >
                  <div className={`sim-type-radio${esimEnabled && simType === 'esim' ? ' sim-type-radio--active' : ''}`} />
                  <div className={`sim-type-icon${esimEnabled && simType === 'esim' ? ' sim-type-icon--active' : ''}`}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={esimEnabled && simType === 'esim' ? '#2563eb' : '#94a3b8'} strokeWidth="1.8">
                      <rect x="7" y="3" width="10" height="16" rx="2" /><circle cx="12" cy="16" r="1" />
                    </svg>
                  </div>
                  <div className="sim-type-info">
                    <p className="sim-type-name">eSIM</p>
                    <p className="sim-type-desc">Digital SIM · No physical card</p>
                  </div>
                  <div className="sim-type-right">
                    {esimEnabled ? (
                      <>
                        <p className="sim-type-price">{baseSimDisplay}</p>
                        {simType === 'esim' && <span className="sim-type-selected-badge">Selected</span>}
                      </>
                    ) : (
                      <span className="sim-type-coming-soon">Coming Soon</span>
                    )}
                  </div>
                </div>
              </div>

              {/* eSIM Compatibility Check */}
              {esimEnabled && simType === 'esim' && (
                <div className="esim-compat-banner" style={{ marginTop: 16 }}>
                  <div style={{ display: 'grid', gap: 12 }}>
                    <div>
                      <h3 style={{ fontSize: 15, fontWeight: 800, color: '#1e293b', margin: '0 0 8px' }}>
                        Check if your phone supports e-SIM
                      </h3>
                      <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.55, margin: 0 }}>
                        Dial <strong>*#06#</strong> on your device and look for an <strong>EID number</strong>.
                        <br />
                        If your phone displays an EID, it supports e-SIM.
                      </p>
                    </div>
                    <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.55, margin: 0 }}>
                      <a
                        href={ESIM_COMPATIBLE_DEVICES_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#2563eb', fontWeight: 700, textDecoration: 'underline' }}
                      >
                        Click here
                      </a>{' '}
                      to check compatible devices list.
                    </p>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: '#334155', lineHeight: 1.45, cursor: 'pointer' }}>
                      <input
                        id="esim-confirm"
                        type="checkbox"
                        checked={esimConfirmed}
                        onChange={e => {
                          setEsimConfirmed(e.target.checked);
                          if (e.target.checked) setError('');
                        }}
                        style={{ marginTop: 2, accentColor: '#2563eb' }}
                      />
                      <span>I confirm that my device supports e-SIM and I would like to proceed.</span>
                    </label>
                  </div>
                </div>
              )}
              {error && <p style={{ color: '#ef4444', fontSize: 13, marginTop: 12 }}>{error}</p>}

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
                    disabled={promoterLocked}
                  >Yes</button>
                  <button
                    className={`referral-toggle-btn${!hasReferral ? ' active' : ''}`}
                    onClick={() => {
                      setHasReferral(false);
                      setForm(p => ({ ...p, promoterCode: '' }));
                      setPromoterName(''); setPromoterError(''); setTwpReferenceID(''); setAlloReferenceID('');
                    }}
                    type="button"
                    disabled={promoterLocked}
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
                        disabled={promoterLocked}
                      >
                        <option value="TWE">TWE</option>
                        <option value="TWP">TWP</option>
                      </select>
                      <input
                        name="promoterCode"
                        placeholder="e.g. 1234567"
                        value={form.promoterCode}
                        onChange={e => {
                          const v = e.target.value;
                          setForm(p => ({ ...p, promoterCode: v }));
                          setPromoterName(''); setPromoterError('');
                          if (promoterDebounce.current) clearTimeout(promoterDebounce.current);
                          if (v.trim()) promoterDebounce.current = setTimeout(() => doVerifyPromoter(form.promoterPrefix, v), 600);
                        }}
                        style={{ ...inputStyle, flex: 1, height: 46 }}
                        disabled={promoterLocked}
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
              <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Pick Your Data Plan</h2>
              {!isSuperliteMode && (
                <p style={{ color: '#64748b', marginBottom: 24, fontSize: 14 }}>Enjoy RM30,000 Insurance Included</p>
              )}

              <div className="plans-grid-fu">
                {FU_PLANS.map(plan => {
                  const active = selectedDataPlan?.id === plan.id;
                  const expanded = expandedPlanId === plan.id;
                  return (
                    <div key={plan.id} className={`fu-plan-card${active ? ' fu-plan-card--selected' : ''}${plan.popular ? ' fu-plan-card--popular' : ''}`}>
                      {/* Header — collapsed state, always visible */}
                      <div
                        className="fu-plan-header"
                        onClick={() => { setSelectedDataPlan(isSuperliteMode ? plan : active ? null : plan); setExpandedPlanId(expanded ? null : plan.id); }}
                        style={{ cursor: 'pointer', borderRadius: expanded ? '14px 14px 0 0' : 14 }}
                      >
                        {plan.popular && <span className="fu-plan-popular-badge">Most Popular</span>}
                        <div className="ins-card-radio-wrap" style={{ alignSelf: 'center' }}>
                          <div className={`sim-type-radio${active ? ' sim-type-radio--active' : ''}`} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
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
                        <div className="fu-plan-chevron" style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 9l6 6 6-6" />
                          </svg>
                        </div>
                      </div>

                      {/* Body — only when expanded */}
                      {expanded && (
                        <div className="fu-plan-body" style={{ border: `1.5px solid ${active ? '#334EFF' : '#e2e8f0'}`, borderTop: 'none', borderRadius: '0 0 14px 14px' }}>
                          <div className="fu-plan-features">
                            <div className="fu-plan-feature">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="#334EFF"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>
                              <span>Data 5G/4G <strong>{plan.data}</strong></span>
                            </div>
                            <div className="fu-plan-feature">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="#334EFF"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>
                              <span><strong>{plan.calls}</strong> Calls</span>
                            </div>
                            <div className="fu-plan-feature">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="#334EFF"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>
                              <span>Free 2GB Welcome Data</span>
                            </div>
                            <div className="fu-plan-feature">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="#334EFF"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>
                              <span>FREE 20GB Bonus Data</span>
                            </div>
                            {!isSuperliteMode && (
                              <div className="fu-plan-feature">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="#0d9488"><path d="M12 2L4 6v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6l-8-4z"/></svg>
                                <span><strong>RM30,000</strong> PA Takaful Included (1 Year)</span>
                              </div>
                            )}
                          </div>
                          <div className="fu-plan-total">Total: <strong>{formatRM(effectiveBasePrice + plan.price)}</strong></div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {!isSuperlitePlusMode && (
                  <div
                    className="sim-type-card"
                    style={{
                      border: !selectedDataPlan ? '2px solid #fce003' : '1.5px solid #e5e7eb',
                      cursor: 'pointer',
                      alignItems: 'flex-start',
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
                      <div className="inline-title-with-info">
                        <p className="sim-type-name">No Add On</p>
                        <InfoTooltip text={NO_ADD_ON_TOOLTIP} />
                      </div>
                    </div>
                    {!selectedDataPlan && (
                      <div className="sim-type-right">
                        <span className="sim-type-selected-badge">Selected</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ════════════ STEP 2: Insurance Add-on ════════════ */}
          {step === 2 && (
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Enhanced Protection</h2>
              <p style={{ color: '#64748b', marginBottom: selectedDataPlan ? 8 : 24, fontSize: 14 }}>
                Get greater peace of mind with RM54,000 coverage.
              </p>

              <div className="purchase-grid-insurance">
                {insuranceOptions.map(option => {
                  const active = selectedInsurance === option.id;
                  const expanded = expandedInsCard === option.id;
                  const selectInsuranceOption = () => {
                    setSelectedInsurance(option.id);
                    setExpandedInsCard(option.id);
                  };
                  return (
                    <div
                      key={option.id}
                      className={`ins-card${active ? ' ins-card--active' : ''}`}
                      onClick={selectInsuranceOption}
                      style={{ cursor: 'pointer' }}
                    >
                      <div
                        className={`ins-card-header ${option.id === 'basic' ? 'ins-card-header--basic' : 'ins-card-header--premium'}`}
                        style={{ borderRadius: expanded ? '12px 12px 0 0' : 12 }}
                      >
                        {option.badge && <span className="ins-card-badge">{option.badge}</span>}
                        <div className="ins-card-radio-wrap">
                          <div className={`sim-type-radio${active ? ' sim-type-radio--active' : ''}`} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <h3 className="ins-card-name">{option.name}</h3>
                          <p style={{ fontSize: 15, fontWeight: 700, color: '#ffe000', marginTop: 2 }}>{option.tagline}</p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                          <p className="ins-card-price">{option.price > 0 ? formatRM(option.price) : 'FREE'}</p>
                          <div className="ins-card-chevron" style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                          </div>
                        </div>
                      </div>
                      {expanded && (
                        <div className="ins-card-body" style={{ border: `1.5px solid ${active ? '#334EFF' : '#e2e8f0'}`, borderTop: 'none', borderRadius: '0 0 12px 12px' }}>
                          <div className="fu-plan-features">
                            {option.benefits.map(benefit => (
                              <div key={benefit} className="fu-plan-feature">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="#334EFF"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                                <span>{benefit}</span>
                                {!isSuperliteMode && option.id === 'premium' && option.price === 0 && <InfoTooltip text={BASIC_TAKAFUL_TOOLTIP} />}
                                {isSuperliteMode && option.id === 'basic' && <InfoTooltip text={SUPERLITE_BASIC_TOOLTIP} />}
                              </div>
                            ))}
                          </div>
                          <div className="fu-plan-total">Total: <strong>{formatRM(effectiveBasePrice + planAddon + option.price)}</strong></div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ════════════ STEP 3: Complete Your Order ════════════ */}
          {step === 3 && (
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Complete Your Order</h2>
              <p style={{ color: '#64748b', marginBottom: 24, fontSize: 14 }}>Fill in your details and checkout securely.</p>

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

                  {/* Address — required for both Physical SIM and eSIM */}
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
                            <span>{simOrderLabel}</span>
                            <span style={{ fontWeight: 600, color: isSuperlitePlusMode ? '#16a34a' : undefined }}>{baseSimDisplay}</span>
                          </div>
                          {selectedDataPlan && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                              <span>{selectedDataPlan.name}</span>
                              <span style={{ fontWeight: 600 }}>{formatRM(planAddon)}</span>
                            </div>
                          )}
                          {insurancePrice > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                              <span>{selectedInsuranceOption.name}</span>
                              <span style={{ fontWeight: 600 }}>{formatRM(insurancePrice)}</span>
                            </div>
                          )}
                        </>
                      )}
                      {simType !== 'esim' && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                          <span>Shipping</span>
                          <span style={{ fontWeight: 600, color: shippingFee > 0 ? '#1e293b' : '#16a34a' }}>
                            {shippingFee > 0 ? formatRM(shippingFee) : 'Free'}
                          </span>
                        </div>
                      )}
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
            <span style={{ fontSize: 18, fontWeight: 800, color: '#2563eb' }}>{formatRM(step === 3 ? total : currentRunningTotal)}</span>
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
              <span>{formatRM(step === 3 ? total : currentRunningTotal)}</span>
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
        .inline-title-with-info {
          display: flex; align-items: center; gap: 6px; min-width: 0;
        }
        .info-tooltip-wrap {
          position: relative; display: inline-flex; align-items: center; flex-shrink: 0;
        }
        .info-tooltip-button {
          width: 18px; height: 18px; border-radius: 50%;
          border: 1px solid #bfdbfe; background: #eff6ff; color: #2563eb;
          display: inline-flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 800; line-height: 1; cursor: help;
          padding: 0;
        }
        .info-tooltip-bubble {
          position: absolute; left: 50%; bottom: calc(100% + 8px);
          transform: translateX(-50%) translateY(4px);
          width: max-content; max-width: 220px; padding: 8px 10px;
          border-radius: 8px; background: #0f172a; color: #fff;
          font-size: 11px; line-height: 1.35; font-weight: 500;
          opacity: 0; pointer-events: none; transition: opacity 0.15s, transform 0.15s;
          box-shadow: 0 10px 30px rgba(15,23,42,0.18); z-index: 20;
          white-space: normal;
        }
        .info-tooltip-bubble::after {
          content: ''; position: absolute; top: 100%; left: 50%;
          transform: translateX(-50%); border-width: 5px; border-style: solid;
          border-color: #0f172a transparent transparent transparent;
        }
        .info-tooltip-wrap:hover .info-tooltip-bubble,
        .info-tooltip-wrap:focus-within .info-tooltip-bubble {
          opacity: 1; transform: translateX(-50%) translateY(0);
        }
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
          position: relative; background: #fff; border: 2px solid #e2e8f0;
          border-radius: 16px; text-align: left; transition: border-color 0.2s;
        }
        .fu-plan-card.fu-plan-card--selected {
          border-color: #fce003;
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
          position: relative; background: #334EFF; color: #fff;
          padding: 16px; border-radius: 16px; text-align: left;
          display: flex; align-items: center; gap: 12px;
        }
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
        .fu-plan-card--popular .fu-plan-header { background: #1a2744; }
        .fu-plan-check {
          position: absolute; top: 12px; right: 40px; width: 26px; height: 26px;
          border-radius: 50%; background: #fff; display: flex;
          align-items: center; justify-content: center;
        }
        .fu-plan-check svg { stroke: #334EFF; }
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
          position: relative; background: #fff; border: 2px solid #e2e8f0;
          border-radius: 14px; text-align: left; transition: border-color 0.2s;
        }
        .ins-card--active {
          border-color: #fce003;
        }
        .ins-card-header {
          position: relative; color: #fff;
          padding: 16px; border-radius: 12px; text-align: left;
          display: flex; align-items: center; gap: 12px;
        }
        .ins-card-radio-wrap { flex-shrink: 0; }
        .ins-card-header--basic { background: #334EFF; }
        .ins-card-header--premium { background: #334EFF; }
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
        .ins-card-price { font-size: 24px; font-weight: 700; color: #ffe000; margin: 0; line-height: 1.1; }
        .ins-card-body { padding: 14px 8px 8px; text-align: left; }
        .ins-card-divider { width: 100%; height: 1px; background: #e5e7eb; margin: 10px 0; }
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
