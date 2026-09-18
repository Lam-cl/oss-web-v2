import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const SIM_VALIDATE_BASE = 'https://www.tonewow.net/gwp/api/sim/x2/validate/productcode';
const TOKEN_TTL_MS = 30 * 60 * 1000;
const STEM_CONCURRENCY = 4;

export type SimProductCode = 'TWE' | 'TWP';

type ValidatedSim = {
  simSerial: string;
  puk: string;
  simCode: string;
  simType: string;
};

type AssignmentTokenPayload = {
  version: 1;
  orderId: number;
  orderItemId: number;
  productCode: SimProductCode;
  prefixId: string;
  simPrefix: string;
  expiresAt: number;
  serials: Array<{ simSerial: string; puk: string }>;
};

export class SimRangeError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function encryptionKey() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new SimRangeError('SIM validation encryption is not configured.', 500);
  return createHash('sha256').update(`tonewow-sim-range:${secret}`).digest();
}

function encrypt(payload: AssignmentTokenPayload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

export function decryptSimAssignmentToken(token: string): AssignmentTokenPayload {
  try {
    const packed = Buffer.from(token, 'base64url');
    if (packed.length < 29) throw new Error('short token');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), packed.subarray(0, 12));
    decipher.setAuthTag(packed.subarray(12, 28));
    const decoded = Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8');
    const payload = JSON.parse(decoded) as AssignmentTokenPayload;
    if (payload.version !== 1 || payload.expiresAt <= Date.now()) throw new Error('expired token');
    return payload;
  } catch {
    throw new SimRangeError('SIM validation has expired. Validate the ranges again.', 400);
  }
}

function digits(value: unknown) { return String(value ?? '').replace(/\D/g, ''); }

async function validateCandidate(productCode: SimProductCode, prefixId: string, simSerial: string) {
  const url = `${SIM_VALIDATE_BASE}/${productCode}/simprefixid/${encodeURIComponent(prefixId)}/simserial/${simSerial}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'ToneWow Merchandise Admin' },
      cache: 'no-store',
    });
  } catch {
    throw new SimRangeError('SIM validation service is unavailable.', 502);
  }
  const payload = await response.json().catch(() => null) as Record<string, any> | null;
  if (response.status === 422 && /sim serial not found/i.test(String(payload?.error?.userMessage || payload?.message || ''))) return null;
  if (!response.ok) throw new SimRangeError('SIM validation service returned an unexpected error.', 502);
  const puk = digits(payload?.simPUK);
  if (!/^\d{8}$/.test(puk) || !payload?.simCode) throw new SimRangeError('SIM validation returned incomplete SIM information.', 502);
  return {
    simSerial,
    puk,
    simCode: String(payload.simCode),
    simType: String(payload.simType || ''),
  } satisfies ValidatedSim;
}

async function findSerial(productCode: SimProductCode, prefixId: string, stem: string, preferredSerial = '') {
  const preferred = /^\d{11}$/.test(preferredSerial) && preferredSerial.startsWith(stem) ? preferredSerial : '';
  const candidates = [preferred, ...Array.from({ length: 10 }, (_, suffix) => `${stem}${suffix}`)].filter(
    (candidate, index, values) => candidate && values.indexOf(candidate) === index,
  );
  for (const candidate of candidates) {
    const result = await validateCandidate(productCode, prefixId, candidate);
    if (result) return result;
  }
  return null;
}

async function mapWithConcurrency<T, R>(values: T[], worker: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(STEM_CONCURRENCY, values.length) }, async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await worker(values[index]);
    }
  }));
  return results;
}

export async function validateSimRange(input: {
  orderId: number;
  orderItemId: number;
  productCode: SimProductCode;
  prefixId: string;
  fallbackPrefixIds?: string[];
  simPrefix: string;
  startSerial: string;
  endSerial: string;
}) {
  const productCode = input.productCode;
  const prefixId = digits(input.prefixId);
  const simPrefix = digits(input.simPrefix);
  const startSerial = digits(input.startSerial);
  const endSerial = digits(input.endSerial);
  if (!['TWE', 'TWP'].includes(productCode)) throw new SimRangeError('Select Tone Excel or Tone Plus.');
  if (!Number.isInteger(input.orderId) || input.orderId <= 0 || !Number.isInteger(input.orderItemId) || input.orderItemId <= 0) throw new SimRangeError('Invalid SIM order line.');
  if (!/^\d+$/.test(prefixId) || !/^\d{9}$/.test(simPrefix)) throw new SimRangeError('Select a valid SIM prefix.');
  if (!/^\d{10,11}$/.test(startSerial) || !/^\d{10,11}$/.test(endSerial)) throw new SimRangeError('Starting and Ending SN must contain 10 digits. An optional 11th digit is accepted.');

  const fallbackPrefixIds = Array.from(new Set((input.fallbackPrefixIds || []).map(digits).filter((value) => /^\d+$/.test(value) && value !== prefixId)));
  const firstStem = startSerial.slice(0, 10);
  const lastStem = endSerial.slice(0, 10);
  let resolvedPrefixId = prefixId;
  let firstSerial: ValidatedSim | null = null;
  for (const candidatePrefixId of [prefixId, ...fallbackPrefixIds]) {
    firstSerial = await findSerial(productCode, candidatePrefixId, firstStem, startSerial);
    if (firstSerial) { resolvedPrefixId = candidatePrefixId; break; }
  }
  if (!firstSerial) throw new SimRangeError('Starting SN was not found for any available SIM prefix ID.', 422);

  const firstStemNumber = Number(firstStem);
  const lastStemNumber = Number(lastStem);
  if (lastStemNumber < firstStemNumber) throw new SimRangeError('Ending SN must not be lower than Starting SN.');
  const count = lastStemNumber - firstStemNumber + 1;
  if (!Number.isSafeInteger(count)) throw new SimRangeError('SIM range is too large.');
  const stems = Array.from({ length: count }, (_, index) => String(firstStemNumber + index).padStart(10, '0'));
  const validated = await mapWithConcurrency(stems, async (stem) => {
    if (stem === firstStem) return firstSerial!;
    const preferred = stem === lastStem ? endSerial : '';
    const result = await findSerial(productCode, resolvedPrefixId, stem, preferred);
    if (!result) throw new SimRangeError(`No valid SIM serial was found for stem ${stem}.`, 422);
    return result;
  });

  return {
    quantity: validated.length,
    serials: validated.map(({ simSerial, simCode, simType }) => ({ simSerial, simCode, simType })),
    assignmentToken: encrypt({
      version: 1,
      orderId: input.orderId,
      orderItemId: input.orderItemId,
      productCode,
      prefixId: resolvedPrefixId,
      simPrefix,
      expiresAt: Date.now() + TOKEN_TTL_MS,
      serials: validated.map(({ simSerial, puk }) => ({ simSerial, puk })),
    }),
  };
}
