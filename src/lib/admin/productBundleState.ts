import { createHash } from 'crypto';

export type NormalizedBundleProduct = Record<string, unknown>;
type RecordValue = Record<string, unknown>;

const PRODUCT_FIELDS = ['id', 'title', 'description', 'price', 'shippingCost', 'weight', 'categories', 'tags', 'images', 'options', 'productVariants'] as const;
const IMAGE_FIELDS = ['id', 'order', 'url', 'imageUrl', 'sha256'] as const;
const OPTION_FIELDS = ['id', 'name', 'order', 'values'] as const;
const VALUE_FIELDS = ['id', 'value', 'order', 'imageUrl'] as const;
const VARIANT_FIELDS = ['id', 'sku', 'price', 'inventory', 'selectedOptions'] as const;
const SELECTION_FIELDS = ['optionName', 'optionValue', 'value', 'productOptionValue'] as const;
const OPTION_VALUE_FIELDS = ['id', 'value', 'productOption'] as const;
const OPTION_REFERENCE_FIELDS = ['id', 'name'] as const;
const NUMERIC_FIELDS = new Set(['id', 'order', 'price', 'shippingCost', 'weight', 'inventory']);
const object = (value: unknown): value is RecordValue => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

function canonicalDecimal(value: string): string | null {
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(value);
  if (!match) return null;
  const integer = (match[2] || '0').replace(/^0+(?=\d)/, '');
  const fraction = (match[3] || '').replace(/0+$/, '');
  const magnitude = fraction ? `${integer}.${fraction}` : integer;
  return match[1] && magnitude !== '0' ? `-${magnitude}` : magnitude;
}

function numericString(value: string): number | string {
  const trimmed = value.trim();
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return value;
  const number = Number(trimmed);
  if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER) return value;
  if (canonicalDecimal(trimmed) !== canonicalDecimal(String(number))) return value;
  return Object.is(number, -0) ? 0 : number;
}

function scalar(value: unknown, field: string): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${field} must be finite.`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'string') return NUMERIC_FIELDS.has(field) ? numericString(value) : value;
  return null;
}

function taxonomy(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const raw = value.map((item) => typeof item === 'string' ? item : object(item) ? String(item.name || item.title || '') : '').filter(Boolean);
  let labels = raw;
  const joined = raw.join(',');
  if (joined.trim().startsWith('[') && joined.trim().endsWith(']')) {
    try { const parsed = JSON.parse(joined); if (Array.isArray(parsed)) labels = parsed.map(String); } catch { /* clean fragments below */ }
  }
  const unique = new Map<string, string>();
  for (const rawLabel of labels) {
    const label = rawLabel.replace(/^\s*[\["']+|[\]"']+\s*$/g, '').trim();
    const key = label.toLowerCase();
    const current = unique.get(key);
    if (label && (current === undefined || compareText(label, current) < 0)) unique.set(key, label);
  }
  return Array.from(unique.values()).sort(compareText);
}

function pick(input: RecordValue, fields: readonly string[], nested: (key: string, value: unknown) => unknown): RecordValue {
  const output: RecordValue = {};
  for (const key of fields) {
    if (!(key in input) || input[key] === undefined) continue;
    output[key] = nested(key, input[key]);
  }
  return output;
}

function entityKey(value: unknown) { return JSON.stringify(value); }
function entityOrder(left: unknown, right: unknown) {
  const a = object(left) ? left : {}, b = object(right) ? right : {};
  const ao = typeof a.order === 'number' && Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
  const bo = typeof b.order === 'number' && Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
  return ao - bo || compareText(entityKey(a.id), entityKey(b.id)) || compareText(entityKey(left), entityKey(right));
}
function rejectDuplicateIds(items: RecordValue[], label: string) {
  const seen = new Set<string>();
  for (const item of items) {
    const key = entityKey(item.id);
    if (seen.has(key)) throw new Error(`Duplicate ${label} ID.`);
    seen.add(key);
  }
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function entity(value: unknown, label: string, fields: readonly string[], nested: (key: string, value: unknown) => unknown): RecordValue {
  if (!object(value)) throw new Error(`${label} must be an object.`);
  const normalized = pick(value, fields, nested);
  if (typeof normalized.id !== 'number' || !Number.isSafeInteger(normalized.id) || normalized.id <= 0) {
    throw new Error(`${label} must have a positive safe integer ID.`);
  }
  return normalized;
}

type OptionAlias = {
  relationship: string;
  name?: string;
  valueNames: Map<string, string>;
};
type OptionAliases = {
  ids: Map<string, OptionAlias>;
  names: Map<string, OptionAlias>;
  valueIds: Map<string, { option: OptionAlias; value: string }>;
};

function normalizeSelection(value: unknown, aliases: OptionAliases): RecordValue {
  if (!object(value)) throw new Error('Selected option must be an object.');
  const selection = pick(value, SELECTION_FIELDS, (key, child) => {
    if (key !== 'productOptionValue') return scalar(child, key);
    return entity(child, 'Selected option value', OPTION_VALUE_FIELDS, (valueKey, nested) => {
      if (valueKey !== 'productOption') return scalar(nested, valueKey);
      return entity(nested, 'Selected product option', OPTION_REFERENCE_FIELDS, (field, item) => scalar(item, field));
    });
  });
  const nestedValue = object(selection.productOptionValue) ? selection.productOptionValue : {};
  const nestedOption = object(nestedValue.productOption) ? nestedValue.productOption : {};
  const options = new Set<OptionAlias>();
  const relationships = new Set<string>();
  const addOptionName = (candidate: unknown) => {
    if (typeof candidate === 'string' && candidate.trim()) {
      const name = candidate.trim().toLowerCase();
      const option = aliases.names.get(name);
      relationships.add(option?.relationship || `name:${name}`);
      if (option) options.add(option);
    }
  };
  addOptionName(selection.optionName);
  addOptionName(nestedOption.name);
  if ('id' in nestedOption) {
    const key = entityKey(nestedOption.id), option = aliases.ids.get(key);
    relationships.add(option?.relationship || `id:${key}`);
    if (option) options.add(option);
  }
  const valueById = 'id' in nestedValue ? aliases.valueIds.get(entityKey(nestedValue.id)) : undefined;
  if (valueById) { relationships.add(valueById.option.relationship); options.add(valueById.option); }
  if (relationships.size > 1) throw new Error('Conflicting selected option aliases.');

  const option = options.values().next().value as OptionAlias | undefined;
  const values = new Set<string>();
  const addValue = (candidate: unknown) => {
    if (typeof candidate !== 'string') return;
    const canonical = option?.valueNames.get(candidate.trim().toLowerCase());
    values.add(canonical || candidate);
  };
  addValue(selection.optionValue);
  addValue(selection.value);
  addValue(nestedValue.value);
  if (valueById) values.add(valueById.value);
  if (values.size > 1) throw new Error('Conflicting selected option aliases.');

  const canonical: RecordValue = {};
  const optionName = option?.name || (typeof selection.optionName === 'string' ? selection.optionName : nestedOption.name);
  const optionValue = values.values().next().value;
  if (optionName !== undefined) canonical.optionName = optionName;
  if (optionValue !== undefined) canonical.optionValue = optionValue;
  return canonical;
}

function selectionRelationship(selection: RecordValue, aliases: OptionAliases): string {
  if (typeof selection.optionName !== 'string' || !selection.optionName.trim()) return `selection:${entityKey(selection)}`;
  const name = selection.optionName.trim().toLowerCase();
  return aliases.names.get(name)?.relationship || `name:${name}`;
}

function normalizeProduct(input: RecordValue): NormalizedBundleProduct {
  for (const [field, label] of [['images', 'Images'], ['options', 'Options'], ['productVariants', 'Product variants']] as const) {
    if (field in input && !Array.isArray(input[field])) throw new Error(`${label} must be an array.`);
  }
  const aliases: OptionAliases = { ids: new Map(), names: new Map(), valueIds: new Map() };
  return pick(input, PRODUCT_FIELDS, (key, value) => {
    if (key === 'categories' || key === 'tags') return taxonomy(value);
    if (key === 'images') {
      const items = array(value, 'Images').map((item) => entity(item, 'Image', IMAGE_FIELDS, (field, child) => scalar(child, field)));
      rejectDuplicateIds(items, 'image'); return items.sort(entityOrder);
    }
    if (key === 'options') {
      const options = array(value, 'Options').map((item) => {
        if (object(item) && 'values' in item && !Array.isArray(item.values)) throw new Error('Option values must be an array.');
        return entity(item, 'Option', OPTION_FIELDS, (field, child) => {
          if (field !== 'values') return scalar(child, field);
          const values = array(child, 'Option values').map((raw) => entity(raw, 'Option value', VALUE_FIELDS, (valueField, nested) => scalar(nested, valueField)));
          rejectDuplicateIds(values, 'value'); return values.sort(entityOrder);
        });
      });
      rejectDuplicateIds(options, 'option');
      rejectDuplicateIds(options.flatMap((option) => Array.isArray(option.values) ? option.values as RecordValue[] : []), 'value');
      for (const option of options) {
        const relationship = `id:${entityKey(option.id)}`;
        const alias: OptionAlias = { relationship, valueNames: new Map() };
        aliases.ids.set(entityKey(option.id), alias);
        if (typeof option.name === 'string' && option.name.trim()) {
          const name = option.name.trim().toLowerCase(), existing = aliases.names.get(name);
          if (existing && existing.relationship !== relationship) throw new Error('Conflicting product option alias.');
          alias.name = option.name;
          aliases.names.set(name, alias);
        }
        for (const value of Array.isArray(option.values) ? option.values as RecordValue[] : []) {
          if (typeof value.value !== 'string') continue;
          alias.valueNames.set(value.value.trim().toLowerCase(), value.value);
          aliases.valueIds.set(entityKey(value.id), { option: alias, value: value.value });
        }
      }
      return options.sort(entityOrder);
    }
    if (key === 'productVariants') {
      const variants = array(value, 'Product variants').map((item) => {
        if (object(item) && 'selectedOptions' in item && !Array.isArray(item.selectedOptions)) throw new Error('Selected options must be an array.');
        return entity(item, 'Variant', VARIANT_FIELDS, (field, child) => {
          if (field !== 'selectedOptions') return scalar(child, field);
          const selections = array(child, 'Selected options').map((selection) => normalizeSelection(selection, aliases));
          const seen = new Set<string>();
          for (const selection of selections) { const relationship = selectionRelationship(selection, aliases); if (seen.has(relationship)) throw new Error('Duplicate selected option relationship.'); seen.add(relationship); }
          return selections.sort((a, b) => compareText(entityKey(a), entityKey(b)));
        });
      });
      rejectDuplicateIds(variants, 'variant'); return variants.sort(entityOrder);
    }
    return scalar(value, key);
  });
}

export function normalizeBundleProduct(payload: unknown): NormalizedBundleProduct {
  const candidate = object(payload) && 'data' in payload ? payload.data : payload;
  if (!object(candidate)) throw new Error('A valid Bundle product is required.');
  return normalizeProduct(candidate);
}

export function fingerprintBundleProduct(payload: unknown) {
  return createHash('sha256').update(JSON.stringify(normalizeBundleProduct(payload))).digest('hex');
}
