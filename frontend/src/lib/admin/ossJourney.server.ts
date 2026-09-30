import { createRemoteDocument, remoteDocument, replaceRemoteDocument, withRemoteLease } from '@/lib/dataApiClient.server';

export type OssCode = 'TWE' | 'TWP';
export type OssRequest = {
  requestId: number; productCode: OssCode; requestDate: string; reference: string;
  purchaserName: string; purchaserEmail: string; contactNo: string; planName: string;
  referralCode: string; adxStatus: string; simPrefixId: string; simSerial: string;
  trackingNo: string; courierType: string; expectedDeliveryDate: string; status: string;
};
export type OssCheck = {
  status: 'confirmed' | 'processing' | 'unknown'; checkedAt: string;
  simSerial?: string; simPrefixId?: string;
  msisdn?: string; memberId?: string; currentPlan?: string | null; planCheckedAt?: string;
  error?: string;
};
type Snapshot = { rows: OssRequest[]; refreshedAt: string; checks: Record<string, OssCheck> };
// Existing private order-metadata namespace avoids a data-service rollout.
const NAMESPACE = 'order-metadata';
const SNAPSHOT_KEY = 'oss-journey-snapshot-v1';
const BASE = 'https://www.tonewow.net/gwp/api';
const clean = (value: unknown) => typeof value === 'string' ? value.trim() : String(value ?? '').trim();
const normalPhone = (value: unknown) => {
  const digits = clean(value).replace(/\D/g, '');
  return digits.startsWith('60') ? `0${digits.slice(2)}` : digits;
};
const timeout = () => AbortSignal.timeout(15_000);

async function json(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, { ...init, cache: 'no-store', signal: timeout(), headers: { accept: 'application/json', ...init?.headers } });
  if (!response.ok) throw new Error(`HQ request failed (${response.status}).`);
  const value = await response.json();
  if (!value || typeof value !== 'object' || value.error) throw new Error('HQ returned invalid data.');
  return value;
}

function parseRows(payload: any, productCode: OssCode): OssRequest[] {
  if (String(payload?.systemCode) !== '1' || !Array.isArray(payload.data)) throw new Error('OSS list returned invalid data.');
  return payload.data.flatMap((item: any) => {
    const requestId = Number(item?.requestId);
    if (!Number.isSafeInteger(requestId) || requestId <= 0) return [];
    return [{ requestId, productCode, requestDate: clean(item.requestDate), reference: clean(item.reference),
      purchaserName: clean(item.purchaserName), purchaserEmail: clean(item.purchaserEmail), contactNo: clean(item.contactNo),
      planName: clean(item.planName), referralCode: clean(item.referralCode), adxStatus: clean(item.adxStatus),
      simPrefixId: clean(item.simPrefixId), simSerial: clean(item.simSerial), trackingNo: clean(item.trackingNo),
      courierType: clean(item.courierType), expectedDeliveryDate: clean(item.expectedDeliveryDate), status: clean(item.status) }];
  });
}

export function ossKey(row: OssRequest) { return `${row.productCode}:${row.requestId}`; }
function checkMatches(row: OssRequest, check?: OssCheck) {
  return check?.simSerial === row.simSerial && check?.simPrefixId === row.simPrefixId;
}
export function planLabel(row: OssRequest, check?: OssCheck): string {
  const name = row.planName.toUpperCase();
  if (/\bBIZ\b/.test(name)) return 'Preload BIZ';
  if (/\bPRO\b/.test(name)) return 'Preload PRO';
  const withFu = name.match(/\bWITH\s+(FU\s*\d+)\b/);
  if (withFu) return `Preload ${withFu[1].replace(/\s+/g, '')}`;
  if (check?.status !== 'confirmed') return 'Belum dapat disahkan';
  return check.currentPlan ? `Pelan aktif: ${check.currentPlan}` : 'Tiada pelan aktif disahkan';
}

export async function readOssSnapshot(): Promise<Snapshot> {
  const value = await remoteDocument<Snapshot>(NAMESPACE, SNAPSHOT_KEY);
  return value?.value || { rows: [], refreshedAt: '', checks: {} };
}

async function saveSnapshot(value: Snapshot) {
  const previous = await remoteDocument<Snapshot>(NAMESPACE, SNAPSHOT_KEY);
  const now = new Date().toISOString();
  if (previous) await replaceRemoteDocument(NAMESPACE, SNAPSHOT_KEY, previous.revision, value,
    { revision: previous.revision + 1, createdAt: previous.createdAt, updatedAt: now });
  else await createRemoteDocument(NAMESPACE, SNAPSHOT_KEY, value, { revision: 1, createdAt: now, updatedAt: now });
}

export async function listOssRequests(query: { productCode?: string; search?: string; page?: number; limit?: number }) {
  const snapshot = await readOssSnapshot();
  const code = query.productCode === 'TWE' || query.productCode === 'TWP' ? query.productCode : '';
  const term = clean(query.search).toLowerCase().slice(0, 100);
  const page = Math.max(1, Math.min(10000, Number(query.page) || 1));
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 25));
  const rows = snapshot.rows.filter(row => (!code || row.productCode === code)
    && (!term || [row.requestId, row.reference, row.purchaserName, row.purchaserEmail, row.contactNo, row.simSerial, row.referralCode]
      .some(value => String(value).toLowerCase().includes(term))));
  rows.sort((a, b) => b.requestDate.localeCompare(a.requestDate) || b.requestId - a.requestId);
  return { data: rows.slice((page - 1) * limit, page * limit).map(row => ({ ...row,
    check: checkMatches(row, snapshot.checks[ossKey(row)]) ? snapshot.checks[ossKey(row)] : null })),
    meta: { page, limit, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / limit)), refreshedAt: snapshot.refreshedAt } };
}

async function prefixes(code: OssCode): Promise<Map<string, string>> {
  const data = await json(`${BASE}/register/x1/getsimprefix/productcode/${code}`);
  if (!Array.isArray(data)) throw new Error('SIM prefixes unavailable.');
  return new Map<string, string>(data.map((item: any): [string, string] => [clean(item.prefix).slice(0, 9), clean(item.id)])
    .filter(([prefix, id]: [string, string]) => /^\d{9}$/.test(prefix) && Boolean(id)));
}

export async function inspectOssRow(row: OssRequest, prefixIds: Map<string, string>): Promise<OssCheck> {
  const checkedAt = new Date().toISOString();
  const serial = row.simSerial.replace(/\D/g, '');
  const prefixId = row.simPrefixId;
  const prefix = Array.from(prefixIds).find(([, id]) => id === prefixId)?.[0] || '';
  if (!/^\d{8,16}$/.test(serial) || !prefix || !/^\d+$/.test(prefixId)) return { status: 'unknown', checkedAt, simSerial: row.simSerial, simPrefixId: row.simPrefixId, error: 'SIM serial or prefix unavailable.' };
  try {
    const data = await json(`${BASE}/register/x1/checksimtype/productcode/${row.productCode}/simprefixid/${encodeURIComponent(prefixId)}/simserial/${encodeURIComponent(serial)}`);
    if (typeof data.simStatus !== 'string') throw new Error('Invalid SIM status.');
    const state = data.simStatus.trim().toUpperCase();
    if (state !== 'COMPLETED') return { status: /PENDING|IN PROGRESS/.test(state) ? 'processing' : 'unknown', checkedAt, simSerial: row.simSerial, simPrefixId: row.simPrefixId };
    const msisdn = normalPhone(data.msisdn);
    if (!/^01\d{8,9}$/.test(msisdn)) throw new Error('Registered number missing.');
    const member = await json(`${BASE}/member/x3/memberProfileDetail`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ msisdn }),
    });
    const account = member.accountInfo || {};
    const memberPrefix = clean(account.simprefix);
    const memberSuffix = clean(account.simserial).replace(/\D/g, '');
    if (![prefix, prefixId].includes(memberPrefix) || memberSuffix !== serial || !clean(account.memberID))
      throw new Error('Member identity did not match this SIM serial.');
    return { status: 'confirmed', checkedAt, simSerial: row.simSerial, simPrefixId: row.simPrefixId, msisdn, memberId: clean(account.memberID),
      currentPlan: clean(member.mainPlanName) || null, planCheckedAt: checkedAt };
  } catch (error) { return { status: 'unknown', checkedAt, simSerial: row.simSerial, simPrefixId: row.simPrefixId, error: error instanceof Error ? error.message : 'HQ unavailable.' }; }
}

async function refreshConfirmedPlan(row: OssRequest, previous: OssCheck, prefixIds: Map<string, string>): Promise<OssCheck> {
  const checkedAt = new Date().toISOString();
  if (!previous.msisdn) return { status: 'unknown', checkedAt, simSerial: row.simSerial, simPrefixId: row.simPrefixId, error: 'Registered number unavailable.' };
  try {
    const member = await json(`${BASE}/member/x3/memberProfileDetail`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ msisdn: previous.msisdn }),
    });
    const account = member.accountInfo || {};
    const prefix = Array.from(prefixIds).find(([, id]) => id === row.simPrefixId)?.[0] || '';
    if (![prefix, row.simPrefixId].includes(clean(account.simprefix)) ||
      clean(account.simserial).replace(/\D/g, '') !== row.simSerial.replace(/\D/g, '') ||
      clean(account.memberID) !== previous.memberId)
      return { status: 'unknown', checkedAt, simSerial: row.simSerial, simPrefixId: row.simPrefixId,
        error: 'Member identity no longer matches this SIM serial.' };
    return { ...previous, checkedAt, currentPlan: clean(member.mainPlanName) || null, planCheckedAt: checkedAt, error: undefined };
  } catch (error) {
    return { ...previous, checkedAt, error: error instanceof Error ? error.message : 'Plan service unavailable.' };
  }
}

export async function refreshOssJourney() {
  return withRemoteLease('oss-journey-refresh', async () => {
    const [twe, twp] = await Promise.all((['TWE', 'TWP'] as const).map(async code =>
      parseRows(await json(`${BASE}/oss/x1/list/retrieve?productCode=${code}`), code)));
    const rows = [...twe, ...twp];
    const current = await readOssSnapshot();
    const checks = current.checks;
    const refreshedAt = new Date().toISOString();
    await saveSnapshot({ rows, refreshedAt, checks });
    const due = rows.filter(row => row.simSerial && (!checkMatches(row, checks[ossKey(row)]) ||
      (checks[ossKey(row)].status !== 'confirmed' && Date.now() - Date.parse(checks[ossKey(row)].checkedAt) >= 24 * 60 * 60 * 1000) ||
      (checks[ossKey(row)].status === 'confirmed' && Date.now() - Date.parse(checks[ossKey(row)].planCheckedAt || '') >= 24 * 60 * 60 * 1000)));
    due.sort((a, b) => (Date.parse(checks[ossKey(a)]?.checkedAt || '') || 0) - (Date.parse(checks[ossKey(b)]?.checkedAt || '') || 0));
    const batch = due.slice(0, 8);
    const prefixCache = new Map<OssCode, Promise<Map<string, string>>>();
    await Promise.all(batch.map(async row => {
      try {
        if (!prefixCache.has(row.productCode)) prefixCache.set(row.productCode, prefixes(row.productCode));
        const prefixIds = await prefixCache.get(row.productCode)!;
        const next = checkMatches(row, checks[ossKey(row)]) && checks[ossKey(row)]?.status === 'confirmed'
          ? await refreshConfirmedPlan(row, checks[ossKey(row)], prefixIds)
          : await inspectOssRow(row, prefixIds);
        if (checkMatches(row, checks[ossKey(row)]) && checks[ossKey(row)]?.status === 'confirmed' && next.status === 'unknown') {
          checks[ossKey(row)] = { ...checks[ossKey(row)], checkedAt: next.checkedAt, error: next.error };
        } else checks[ossKey(row)] = next;
      } catch (error) { checks[ossKey(row)] = { status: 'unknown', checkedAt: new Date().toISOString(), simSerial: row.simSerial, simPrefixId: row.simPrefixId, error: error instanceof Error ? error.message : 'HQ unavailable.' }; }
    }));
    // This key is private to OSS; other order metadata keys are untouched.
    await saveSnapshot({ rows, refreshedAt, checks });
    return { total: rows.length, checked: batch.length, remaining: Math.max(0, due.length - batch.length) };
  }, 300);
}
