import type { SimPrefixOption } from './simAssignments';

const SIM_PREFIX_BASE_URL = 'https://www.tonewow.net/gwp/api/register/x1/getsimprefix/productcode';

export class SimPrefixError extends Error {}

export async function getSimPrefixOptions(productCode: 'TWE' | 'TWP' = 'TWE'): Promise<SimPrefixOption[]> {
  let response: Response;
  try {
    response = await fetch(`${SIM_PREFIX_BASE_URL}/${productCode}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'ToneWow Merchandise Admin' },
      cache: 'no-store',
    });
  } catch {
    throw new SimPrefixError('SIM prefix service is unavailable.');
  }
  if (!response.ok) throw new SimPrefixError('SIM prefix service is unavailable.');
  const payload: unknown = await response.json().catch(() => null);
  if (!Array.isArray(payload)) throw new SimPrefixError('SIM prefix service returned invalid data.');

  const options = payload.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return [];
    const value = entry as Record<string, unknown>;
    const id = String(value.id ?? '').trim();
    const rawLabel = String(value.prefix ?? '').trim();
    const prefix = rawLabel.match(/^\d{9}/)?.[0] || '';
    const telcoId = Number(value.telcoID ?? value.telcoId);
    if (!id || !prefix || telcoId !== 1) return [];
    return [{ id, prefix, label: rawLabel || prefix, telcoId }];
  });
  if (!options.length) throw new SimPrefixError(`No valid ${productCode} SIM prefixes are available.`);
  return options;
}
