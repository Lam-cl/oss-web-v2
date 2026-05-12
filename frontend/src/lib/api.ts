import { getApiBaseUrl } from './constants';
import type { DeviceResponse, Device, Brand, Banner, Plan, NumberResult } from '@/types';

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  return res.json();
}

// Devices
export async function getDevices(params?: {
  brand?: string;
  page?: number;
  limit?: number;
  search?: string;
}): Promise<DeviceResponse> {
  const searchParams = new URLSearchParams();
  if (params?.brand && params.brand !== 'all') searchParams.set('brand', params.brand);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.search) searchParams.set('search', params.search);
  const qs = searchParams.toString();
  return fetchApi<DeviceResponse>(`/devices${qs ? `?${qs}` : ''}`);
}

export async function getDevice(idOrSlug: string): Promise<Device> {
  return fetchApi<Device>(`/devices/${idOrSlug}`);
}

// Brands
export async function getBrands(): Promise<Brand[]> {
  return fetchApi<Brand[]>('/brands');
}

// Banners
export async function getBanners(): Promise<Banner[]> {
  return fetchApi<Banner[]>('/banners');
}

// Settings
export interface AppSettings {
  showDevices: boolean;
  showMerchandise: boolean;
  simBasePrice: number;
}

export async function getSettings(): Promise<AppSettings> {
  return fetchApi<AppSettings>('/settings');
}

// Plans
export async function getPlans(): Promise<Plan[]> {
  return fetchApi<Plan[]>('/plans');
}

export async function getPlan(slug: string): Promise<Plan> {
  return fetchApi<Plan>(`/plans/${slug}`);
}

// Numbers
export async function searchNumbers(digits: string): Promise<{ data: NumberResult[]; total: number }> {
  return fetchApi(`/numbers/search?digits=${encodeURIComponent(digits)}`);
}

// Orders
export async function createOrder(orderData: any): Promise<any> {
  return fetchApi('/orders', {
    method: 'POST',
    body: JSON.stringify(orderData),
  });
}

export async function getOrder(id: string): Promise<any> {
  return fetchApi(`/orders/${id}`);
}

// Payment
export async function initiatePayment(data: {
  orderId: string;
  amount: number;
  customerName: string;
  customerEmail: string;
  description?: string;
}): Promise<{
  success: boolean;
  paymentUrl?: string;
  paymentParams?: Record<string, string>;
  cartId?: string;
  error?: string;
}> {
  return fetchApi('/payment/initiate', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Proxy (for external ToneWow API calls)
export async function proxyGet(url: string): Promise<any> {
  return fetchApi(`/proxy?url=${encodeURIComponent(url)}`);
}

export async function proxyPost(url: string, body: any): Promise<any> {
  return fetchApi(`/proxy?url=${encodeURIComponent(url)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// Bundle API - fetch live products (itel devices)
const BUNDLE_API = 'https://bundleapi.tonewow.com/api';

export async function getBundleProducts(limit = 20): Promise<any[]> {
  try {
    const bundleUrl = `${BUNDLE_API}/products?limit=${limit}`;
    return await proxyGet(bundleUrl).then((data) => data.data || []);
  } catch {
    return [];
  }
}

export async function getBundleProductBySlug(slug: string): Promise<any | null> {
  try {
    const products = await getBundleProducts(50);
    return products.find((p: any) => p.slug === slug) || null;
  } catch {
    return null;
  }
}

export async function getBundleProductById(id: number): Promise<any | null> {
  try {
    const bundleUrl = `${BUNDLE_API}/products/${id}`;
    return await proxyGet(bundleUrl);
  } catch {
    return null;
  }
}

// ToneWow GWP API
const GWP_API = 'https://www.tonewow.net/gwp/api';

// Random number list by digits
export async function getRandomNumbers(digits: string): Promise<string[]> {
  try {
    const url = `${GWP_API}/msisdn/x3/list/number/${digits}`;
    const res = await proxyGet(url);
    const records = res.msisdnrecord || [];
    return records.map((r: any) => r.msisdn as string);
  } catch {
    return [];
  }
}

// Verify existing member

export async function checkExistingMember(
  msisdn: string,
): Promise<{ valid: boolean; name?: string; memberID?: string; memberType?: string; error?: string }> {
  const url = `${GWP_API}/member/x2/memberProfileDetail`;
  // Try TWE first, then TWP
  for (const code of ['TWE', 'TWP']) {
    try {
      const res = await proxyPost(url, {
        productCode: code,
        memberIDDesc: '',
        msisdn,
      });
      if (res.error) continue; // try next code
      const fullName = res.nameInfo?.fullName || '';
      const memberID = res.accountInfo?.memberID || '';
      if (fullName) {
        return { valid: true, name: fullName, memberID, memberType: code };
      }
    } catch {
      continue;
    }
  }
  return { valid: false, error: 'Nombor tidak dijumpai dalam sistem' };
}

// ToneWow Legacy API - verify promoter ID
const LEGACY_API = 'https://www.tonewow.net/tgpayment';

export async function verifyPromoter(memberID: string): Promise<{ valid: boolean; name?: string; error?: string }> {
  try {
    const url = `${LEGACY_API}/verifyPromoter?memberID=${encodeURIComponent(memberID)}`;
    const res = await proxyGet(url);
    if (res.systemCode === '0' && res.data && res.data.length > 0) {
      return { valid: true, name: res.data[0].fullName };
    }
    return { valid: false, error: 'ID Penaja tidak dijumpai' };
  } catch {
    return { valid: false, error: 'Gagal mengesahkan. Cuba lagi.' };
  }
}

/** TWP flow — generate referenceID after verification */
export async function saveRefAllocation(memberID: string): Promise<{ referenceID?: string }> {
  try {
    const url = `${LEGACY_API}/saveRefAllocation?productCode=TWP&promoterID=${encodeURIComponent(memberID)}`;
    const data = await proxyPost(url, {});
    if (data.systemCode === '1' && data.data?.length > 0) {
      return { referenceID: data.data[0].referenceID };
    }
    return {};
  } catch {
    return {};
  }
}

// New Plans API — dynamic data bundles
export interface ApiPlanItem {
  codeKey: string;
  codeDesc: string;
  codeData1: string;   // planID for OSS payment
  codeData2: string;   // price or extra info
  codeData3: string;   // validity or extra info
  codeAction: string;
  codeLang: string;
  codeSeq: string;
  remark: string;
}

export interface ApiPlanGroup {
  planName: string;
  codeNo: string;
  planList: ApiPlanItem[];
}

const DATABUNDLE_API = 'https://www.tonewow.net/gw/api/v4/databundle/';

export async function getDataPlans(productcode: string, documentID: string): Promise<ApiPlanItem[]> {
  try {
    const url = `${DATABUNDLE_API}?productcode=${encodeURIComponent(productcode)}&documentID=${encodeURIComponent(documentID || '')}`;
    const data = await proxyGet(url);
    // Collect all plans from mainPlan + additionalPlan
    const allPlans: ApiPlanItem[] = [];
    for (const group of [...(data.mainPlan || []), ...(data.additionalPlan || [])]) {
      if (group.planList && Array.isArray(group.planList)) {
        allPlans.push(...group.planList);
      }
    }
    return allPlans;
  } catch {
    return [];
  }
}
