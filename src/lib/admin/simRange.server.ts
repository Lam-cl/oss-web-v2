import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const SIM_VALIDATE_BASE = 'https://www.tonewow.net/gwp/api/sim/x2/validate/productcode';
const TOKEN_TTL_MS = 30 * 60 * 1000;
const STEM_CONCURRENCY = 4;
const CANDIDATE_CONCURRENCY = 5;
const VALIDATION_CONCURRENCY = 8;
const UPSTREAM_TIMEOUT_MS = 5_000;
const VALIDATION_DEADLINE_MS = 15_000;
let activeValidations = 0;
const validationWaiters: Array<() => void> = [];

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

async function withValidationSlot<T>(run: () => Promise<T>) {
  if (activeValidations >= VALIDATION_CONCURRENCY) {
    await new Promise<void>((resolve) => validationWaiters.push(resolve));
  }
  activeValidations += 1;
  try { return await run(); }
  finally {
    activeValidations -= 1;
    validationWaiters.shift()?.();
  }
}

async function validateCandidate(productCode: SimProductCode, prefixId: string, simSerial: string, deadline: number) {
  const url = `${SIM_VALIDATE_BASE}/${productCode}/simprefixid/${encodeURIComponent(prefixId)}/simserial/${simSerial}`;
  let response: Response;
  try {
    response = await withValidationSlot(async () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new SimRangeError('SIM validation timed out. Please try again.', 504);
      return fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'ToneWow Merchandise Admin' },
        cache: 'no-store',
        signal: AbortSignal.timeout(Math.min(UPSTREAM_TIMEOUT_MS, remaining)),
      });
    });
  } catch (reason) {
    if (reason instanceof SimRangeError) throw reason;
    if (reason instanceof Error && ['AbortError', 'TimeoutError'].includes(reason.name)) {
      throw new SimRangeError('SIM validation timed out. Please try again.', 504);
    }
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

async function findSerial(productCode: SimProductCode, prefixId: string, stem: string, deadline: number, preferredSerial = '') {
  const preferred = /^\d{11}$/.test(preferredSerial) && preferredSerial.startsWith(stem) ? preferredSerial : '';
  const candidates = [preferred, ...Array.from({ length: 10 }, (_, suffix) => `${stem}${suffix}`)].filter(
    (candidate, index, values) => candidate && values.indexOf(candidate) === index,
  );
  const results = await mapWithConcurrency(candidates, (candidate) => validateCandidate(productCode, prefixId, candidate, deadline), CANDIDATE_CONCURRENCY);
  return results.find((result) => result !== null) || null;
}

async function mapWithConcurrency<T, R>(values: T[], worker: (value: T) => Promise<R>, concurrency = STEM_CONCURRENCY) {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
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

  const deadline = Date.now() + VALIDATION_DEADLINE_MS;
  const firstStem = startSerial.slice(0, 10);
  const lastStem = endSerial.slice(0, 10);
  const firstSerial = await findSerial(productCode, prefixId, firstStem, deadline, startSerial);
  if (!firstSerial) throw new SimRangeError('Starting SN was not found for the selected SIM prefix.', 422);

  const firstStemNumber = Number(firstStem);
  const lastStemNumber = Number(lastStem);
  if (lastStemNumber < firstStemNumber) throw new SimRangeError('Ending SN must not be lower than Starting SN.');
  const count = lastStemNumber - firstStemNumber + 1;
  if (!Number.isSafeInteger(count)) throw new SimRangeError('SIM range is too large.');
  const stems = Array.from({ length: count }, (_, index) => String(firstStemNumber + index).padStart(10, '0'));
  const validated = await mapWithConcurrency(stems, async (stem) => {
    if (stem === firstStem) return firstSerial!;
    const preferred = stem === lastStem ? endSerial : '';
    const result = await findSerial(productCode, prefixId, stem, deadline, preferred);
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
      prefixId,
      simPrefix,
      expiresAt: Date.now() + TOKEN_TTL_MS,
      serials: validated.map(({ simSerial, puk }) => ({ simSerial, puk })),
    }),
  };
}
