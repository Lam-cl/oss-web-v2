import { createHash, randomBytes } from 'crypto';
import { readTokenRecord, writeTokenRecord } from '@/lib/tokenStore';

export const MERDEKA_PLAN_NAMES = ['FU35', 'FU50', 'FU60', 'FU80', 'FU120'] as const;

export const MERDEKA_DURATIONS = [6, 12] as const;

export type MerdekaDuration = (typeof MERDEKA_DURATIONS)[number];

export type MerdekaPlan = {
  id: string;
  name: (typeof MERDEKA_PLAN_NAMES)[number];
  displayName: string;
  monthlyPrice: number;
  benefits: string[];
};

export type MerdekaMember = {
  msisdn: string;
  memberId: string;
  fullName: string;
  documentId: string;
  email: string;
  phone: string;
  address1: string;
  address2: string;
  address3: string;
  postcode: string;
  city: string;
  state: string;
  currentPlan: string | null;
  offeringID: string; 
  idType: 'MyKad' | 'Army ID' | 'Passport No' | 'Police ID' | '';
  
};

export type MerdekaPaymentRecord = {
  refNo: string;
  paymentRefNo: string;
  memberId: string;
  msisdn: string;
  customerName: string;
  email: string;
  planId: string;
  planName: string;
  duration: MerdekaDuration;
  monthlyPrice: number;
  amount: number;
  gatewayStatus?: string;
  gatewayDescription?: string;
  createdAt: string;
};

const SST_MONTHLY_PRICE: Record<string, number> = {
  FU35: 37.30,
  FU50: 53.00,
  FU60: 63.93,
  FU80: 84.80,
  FU120: 127.20,
};

const PLAN_API = 'https://qa.tonegroup.net/twbackend/api/v4/databundle/list?productcode=TWE&documentID=';
// const MEMBER_API = 'https://qa.tonegroup.net/twbackend/api/member/v3/memberProfileDetail';

const MEMBER_API= 'https://www.tonewow.net/gwp/api/member/x3/memberProfileDetail';
const STORE_TYPE = 'merdeka-promo-payment';
const STORE_TTL_SECONDS = 7 * 24 * 60 * 60;

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeMsisdn(value: unknown) {
  let msisdn = clean(value).replace(/[^\d+]/g, '');
  if (msisdn.startsWith('+60')) msisdn = `0${msisdn.slice(3)}`;
  else if (msisdn.startsWith('60')) msisdn = `0${msisdn.slice(2)}`;
  return /^01\d{8,9}$/.test(msisdn) ? msisdn : '';
}

function normalizePlanName(value: unknown) {
  return clean(value).replace(/\s+/g, '').toUpperCase();
}

export function isMerdekaDuration(value: unknown): value is MerdekaDuration {
  return value === 6 || value === 12;
}

// export function calculateMerdekaPrice(monthlyPrice: number, duration: MerdekaDuration) {
//   const multiplier = duration === 6 ? 5 : 10;
//   return Math.round(monthlyPrice * multiplier * 100) / 100;
// }

export function calculateMerdekaPrice(
  plan: MerdekaPlan,
  duration: MerdekaDuration,
  idType: MerdekaMember['idType'],
) {
  const isPassport = idType === 'Passport No';
  const unitPrice = isPassport
    ? (SST_MONTHLY_PRICE[plan.name] ?? plan.monthlyPrice)
    : plan.monthlyPrice;
  const multiplier = duration === 6 ? 5 : 10;
  return Math.round(unitPrice * multiplier * 100) / 100;
}

export async function fetchMerdekaPlans(): Promise<MerdekaPlan[]> {
  const response = await fetch(PLAN_API, {
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error('The plan service is temporarily unavailable.');

  const data = await response.json() as {
    mainPlan?: Array<{ planList?: Array<Record<string, unknown>> }>;
    additionalPlan?: Array<{ planList?: Array<Record<string, unknown>> }>;
  };
  const rawPlans = [...(data.mainPlan || []), ...(data.additionalPlan || [])]
    .flatMap((group) => Array.isArray(group.planList) ? group.planList : []);

  const plans = rawPlans.flatMap((item): MerdekaPlan[] => {
    const name = normalizePlanName(item.codeData2);
    if (!MERDEKA_PLAN_NAMES.includes(name as MerdekaPlan['name'])) return [];
    const monthlyPrice = Number(item.codeData3);
    const id = clean(item.codeData1) || clean(item.codeKey);
    if (!id || !Number.isFinite(monthlyPrice) || monthlyPrice <= 0) return [];
    const benefits = clean(item.codeDesc)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !/^1GB Basic Internet$/i.test(line))
      .map((line) => /^3,?000 Mins All-Net Voice$/i.test(line) ? 'Unlimited Calls*' : line);
    return [{
      id,
      name: name as MerdekaPlan['name'],
      displayName: `${name} plan`,
      monthlyPrice,
      benefits,
    }];
  });

  const rank = new Map(MERDEKA_PLAN_NAMES.map((name, index) => [name, index]));
  return plans.sort((a, b) => (rank.get(a.name) || 0) - (rank.get(b.name) || 0));
}

export async function fetchMerdekaMember(value: unknown): Promise<MerdekaMember> {
  const msisdn = normalizeMsisdn(value);
  if (!msisdn) throw new Error('Enter a valid Malaysian mobile number.');

  const response = await fetch(MEMBER_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msisdn }),
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error('We could not verify this number. Please check it and try again.');
  const data = await response.json() as Record<string, any>;
  const memberId = clean(data.accountInfo?.memberID);
  const fullName = clean(data.nameInfo?.fullName);
  if (!memberId || !fullName) throw new Error('No active tone wow member was found for this number.');

  return {
    msisdn,
    memberId,
    fullName,
    documentId: clean(data.documentInfo?.documentID),
    idType: clean(data.documentInfo?.documentType) as MerdekaMember['idType'],
    email: clean(data.email),
    phone: clean(data.accountInfo?.simphoneNo) || msisdn,
    address1: clean(data.addressInfo?.address1),
    address2: clean(data.addressInfo?.address2),
    address3: clean(data.addressInfo?.address3),
    postcode: clean(data.addressInfo?.addPostCode),
    city: clean(data.addressInfo?.addCity),
    state: clean(data.addressInfo?.addState),
    currentPlan: clean(data.mainPlanName) || null,
    offeringID: clean(data.offeringID),
  };
}

export function createMerdekaReference() {
  const date = new Date();
  const stamp = [
    String(date.getFullYear()).slice(2),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join('');
  return `twmp${randomBytes(2).toString('hex')}${stamp}`.slice(0, 20);
}

function recordId(refNo: string) {
  const cleaned = clean(refNo);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(cleaned)) return '';
  return createHash('sha256').update(cleaned).digest('base64url');
}

export async function writeMerdekaPayment(record: MerdekaPaymentRecord) {
  const id = recordId(record.paymentRefNo);
  if (!id) throw new Error('Invalid payment reference.');
  await writeTokenRecord(STORE_TYPE, id, record, STORE_TTL_SECONDS);
}

export async function readMerdekaPayment(refNo: string) {
  const id = recordId(refNo);
  if (!id) return null;
  return readTokenRecord<MerdekaPaymentRecord>(STORE_TYPE, id);
}
