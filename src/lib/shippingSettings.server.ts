import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import path from 'path';
import { COURIER_GROUPS, DEFAULT_SHIPPING_SETTINGS, type CourierGroup, type ShippingSettings } from './shipping';
const file = path.join(process.cwd(), '.data', 'shipping-settings.json');
const clone = () => JSON.parse(JSON.stringify(DEFAULT_SHIPPING_SETTINGS)) as ShippingSettings;
export function validateShippingSettings(value: unknown): ShippingSettings {
  if (!value || typeof value !== 'object') throw new Error('Shipping settings are required.');
  const input = value as Partial<ShippingSettings>; const groups = {} as ShippingSettings['groups'];
  if (!Array.isArray(input.priority) || input.priority.length !== COURIER_GROUPS.length || new Set(input.priority).size !== COURIER_GROUPS.length || !input.priority.every((group) => COURIER_GROUPS.includes(group))) throw new Error('Priority must include every courier category once.');
  for (const group of COURIER_GROUPS) { const item = input.groups?.[group]; if (!item || typeof item.label !== 'string' || !item.label.trim() || !Array.isArray(item.tiers) || !item.tiers.length) throw new Error(`${group} needs a label and at least one tier.`); const tiers = item.tiers.map((tier) => ({ minimum: Number(tier.minimum), peninsular: Number(tier.peninsular), eastMalaysia: Number(tier.eastMalaysia) })).sort((a,b) => a.minimum - b.minimum); if (tiers[0].minimum !== 1 || tiers.some((tier, index) => !Number.isInteger(tier.minimum) || tier.minimum < 1 || tier.peninsular < 0 || tier.eastMalaysia < 0 || (index && tier.minimum === tiers[index - 1].minimum))) throw new Error(`${item.label} has an invalid tier.`); groups[group] = { label: item.label.trim(), tiers }; }
  const productGroups: Record<string, CourierGroup> = {}; for (const [slug, group] of Object.entries(input.productGroups || {})) { const key = slug.trim().toLowerCase(); if (!key || !COURIER_GROUPS.includes(group)) throw new Error('Each product mapping needs a valid product slug and category.'); productGroups[key] = group; }
  return { priority: input.priority as CourierGroup[], groups, productGroups };
}
export async function readShippingSettings() { try { return validateShippingSettings(JSON.parse(await readFile(file, 'utf8'))); } catch { return clone(); } }
export async function saveShippingSettings(value: unknown) { const settings = validateShippingSettings(value); await mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.tmp`; await writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8'); await rename(temp, file); return settings; }
