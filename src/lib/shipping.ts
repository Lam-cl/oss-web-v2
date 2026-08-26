import type { CartItem } from '@/types';

export type CourierGroup = 'sim' | 'small' | 'shirt' | 'bulky' | 'flyers';
export type CourierZone = 'peninsular' | 'east-malaysia';
export type CourierTier = { minimum: number; peninsular: number; eastMalaysia: number };
export type CourierGroupSettings = { label: string; tiers: CourierTier[] };
export type ShippingSettings = { priority: CourierGroup[]; groups: Record<CourierGroup, CourierGroupSettings>; productGroups: Record<string, CourierGroup> };
export type CourierLine = { type?: CartItem['type']; catalogueId?: string; bundleProductId?: number; productId?: string; slug?: string; name?: string; category?: string; quantity: number };
export type CourierCharge = { amount: number; zone: CourierZone; quantities: Record<CourierGroup, number>; unclassified: string[] };

const EAST_MALAYSIA_STATES = new Set(['sabah', 'sarawak', 'labuan', 'w.p. labuan']);
export const COURIER_GROUPS: CourierGroup[] = ['shirt', 'bulky', 'small', 'flyers', 'sim'];
export const DEFAULT_SHIPPING_SETTINGS: ShippingSettings = {
  priority: COURIER_GROUPS,
  groups: {
    sim: { label: 'SIM card', tiers: [{ minimum: 1, peninsular: 10, eastMalaysia: 20 }, { minimum: 30, peninsular: 0, eastMalaysia: 0 }] },
    small: { label: 'Badge, lanyard, pen, cap & non woven bag', tiers: [{ minimum: 1, peninsular: 10, eastMalaysia: 20 }, { minimum: 30, peninsular: 20, eastMalaysia: 30 }] },
    shirt: { label: 'T-shirt', tiers: [{ minimum: 1, peninsular: 20, eastMalaysia: 30 }, { minimum: 21, peninsular: 30, eastMalaysia: 40 }] },
    bulky: { label: 'Water bottle, tumbler & bunting', tiers: [{ minimum: 1, peninsular: 10, eastMalaysia: 20 }, { minimum: 6, peninsular: 20, eastMalaysia: 30 }, { minimum: 11, peninsular: 30, eastMalaysia: 40 }, { minimum: 21, peninsular: 40, eastMalaysia: 50 }] },
    flyers: { label: 'Flyers', tiers: [{ minimum: 1, peninsular: 10, eastMalaysia: 20 }, { minimum: 2, peninsular: 20, eastMalaysia: 30 }, { minimum: 3, peninsular: 30, eastMalaysia: 40 }] },
  },
  productGroups: {
    'superlite-sim': 'sim', 'biz-sim': 'sim', 'tone-wow-button-badge': 'small', 'tone-wow-lanyard': 'small', 'tone-wow-yellow-pen': 'small', 'tone-wow-ball-pen': 'small', 'tone-wow-cap': 'small', 'tone-wow-non-woven-bag': 'small', 'tone-wow-comix-shirt': 'shirt', 'comix-shirt': 'shirt', 'tone-wow-shirt': 'shirt', tshirt: 'shirt', 'water-bottle-500ml': 'bulky', 'water-bottle-975ml': 'bulky', 'tumbler-1180ml': 'bulky', 'tone-wow-bunting': 'bulky', 'tone-wow-flyers': 'flyers', 'tone-wow-flyers-50pcs': 'flyers',
  },
};

function normalise(value: unknown) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
export function courierZoneForState(state: string): CourierZone { return EAST_MALAYSIA_STATES.has(normalise(state)) ? 'east-malaysia' : 'peninsular'; }
export function classifyCourierLine(line: CourierLine, settings: ShippingSettings = DEFAULT_SHIPPING_SETTINGS): CourierGroup | null {
  const productKeys = [line.catalogueId, line.productId, line.bundleProductId ? String(line.bundleProductId) : '']
    .map(normalise).filter(Boolean);
  for (const productKey of productKeys) if (settings.productGroups[productKey]) return settings.productGroups[productKey];
  const slug = normalise(line.slug);
  if (settings.productGroups[slug]) return settings.productGroups[slug];
  if (line.type === 'sim') return 'sim';
  const category = normalise(line.category); const name = normalise(line.name);
  if (category === 'sim card' || category === 'sim cards' || /\bsim\b/.test(name)) return 'sim';
  if (/t[ -]?shirt|\bshirt\b/.test(name)) return 'shirt';
  if (/water bottle|\btumbler\b|\bbunting\b/.test(name)) return 'bulky';
  if (/\bflyer/.test(name)) return 'flyers';
  if (/button badge|\blanyard\b|\bpen\b|\bcap\b|non[ -]?woven bag/.test(name)) return 'small';
  return null;
}
function groupCharge(group: CourierGroup, quantity: number, zone: CourierZone, settings: ShippingSettings) {
  const tiers = settings.groups[group].tiers.filter((tier) => quantity >= tier.minimum).sort((a, b) => b.minimum - a.minimum);
  const tier = tiers[0]; return tier ? (zone === 'east-malaysia' ? tier.eastMalaysia : tier.peninsular) : 0;
}
export function calculateCourierCharge(lines: CourierLine[], state: string, settings: ShippingSettings = DEFAULT_SHIPPING_SETTINGS): CourierCharge {
  const zone = courierZoneForState(state); const quantities: Record<CourierGroup, number> = { sim: 0, small: 0, shirt: 0, bulky: 0, flyers: 0 }; const unclassified: string[] = [];
  for (const line of lines) { const quantity = Math.max(0, Math.floor(Number(line.quantity) || 0)); if (!quantity) continue; const group = classifyCourierLine(line, settings); if (!group) { unclassified.push(line.name || line.slug || 'Unknown merchandise'); continue; } quantities[group] += quantity; }
  const heaviestGroup = settings.priority.find((group) => quantities[group] > 0);
  return { amount: heaviestGroup ? groupCharge(heaviestGroup, quantities[heaviestGroup], zone, settings) : 0, zone, quantities, unclassified: Array.from(new Set(unclassified)) };
}
export function calculateMerchandiseCourierCharge(items: CartItem[], state: string, settings?: ShippingSettings) { return calculateCourierCharge(items, state, settings); }
// Preserve the legacy cart calculation for non-merchandise SIM checkout.
export function calculateDeliveryShipping(items: CartItem[]) { let shippingTotal = 0; let hasMerchandise = false; for (const item of items) { if (item.type === 'merchandise') { hasMerchandise = true; continue; } if (item.type === 'sim') { const category = (item.category || item.numberType || '').toUpperCase(); if (!['PREMIUM', 'VIP', 'VVIP'].includes(category)) shippingTotal += 10 * item.quantity; } } return shippingTotal + (hasMerchandise ? 10 : 0); }
