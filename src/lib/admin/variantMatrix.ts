type MatrixOption = {
  name: string;
  values: Array<{ value: string }>;
};

type MatrixVariant = {
  id: number;
  sku?: string;
  inventory: number | '';
  selectedOptions?: unknown[];
};

const normalise = (value: unknown) => String(value || '').trim().toLowerCase();
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' ? value as Record<string, any> : {};
const sortedVariants = (variants: MatrixVariant[]) => [...variants].sort((left, right) => left.id - right.id);

function selectedValues(variant: MatrixVariant) {
  const selected = new Map<string, string>();
  for (const raw of variant.selectedOptions || []) {
    const item = record(raw);
    const nested = record(item.productOptionValue);
    const name = item.optionName || record(nested.productOption).name;
    const value = item.optionValue || item.value || nested.value;
    if (name && value) selected.set(normalise(name), String(value));
  }
  return selected;
}

function variantList(variants: MatrixVariant[]) {
  const sorted = sortedVariants(variants);
  return {
    title: 'Inventory by variant',
    rowLabel: 'Variant',
    columnLabel: 'Stock',
    columns: ['Stock'],
    rows: sorted.map((variant) => ({
      label: variant.sku || `Variant #${variant.id}`,
      cells: [{ label: 'Stock', variant }],
    })),
    unmapped: [],
    showTotals: false,
  };
}

export function buildVariantMatrix(options: MatrixOption[], variants: MatrixVariant[]) {
  if (!variants.length) return null;
  if (options.length === 1 && options[0].values.length) {
    const option = options[0];
    const sorted = sortedVariants(variants);
    const mapped = new Map<string, MatrixVariant>();
    sorted.forEach((variant) => {
      const value = selectedValues(variant).get(normalise(option.name));
      if (value) mapped.set(normalise(value), variant);
    });
    const ordered = mapped.size === option.values.length
      ? option.values.map((value) => mapped.get(normalise(value.value))!)
      : sorted.length === option.values.length ? sorted : null;
    if (!ordered) return variantList(variants);
    const used = new Set(ordered.map((variant) => variant.id));
    return {
      title: `Inventory by ${option.name.toLowerCase()}`,
      rowLabel: option.name,
      columnLabel: 'Stock',
      columns: ['Stock'],
      rows: option.values.map((value, index) => ({
        label: value.value,
        cells: [{ label: 'Stock', variant: ordered[index] }],
      })),
      unmapped: sorted.filter((variant) => !used.has(variant.id)),
      showTotals: false,
    };
  }

  if (options.length !== 2 || options.some((option) => !option.values.length)) return variantList(variants);

  const colorOption = options.find((option) => /^colou?r$/i.test(option.name));
  const sizeOption = options.find((option) => /^size$/i.test(option.name));
  const [rowOption, columnOption] = colorOption && sizeOption ? [colorOption, sizeOption] : options;
  const combinations = rowOption.values.flatMap((row) => columnOption.values.map((column) => ({ row, column })));
  const sorted = sortedVariants(variants);
  const mapped = new Map<string, MatrixVariant>();

  for (const variant of sorted) {
    const selected = selectedValues(variant);
    const row = selected.get(normalise(rowOption.name));
    const column = selected.get(normalise(columnOption.name));
    if (row && column) mapped.set(`${normalise(row)}::${normalise(column)}`, variant);
  }

  let matrixVariants: MatrixVariant[];
  if (mapped.size === combinations.length) {
    matrixVariants = combinations.map(({ row, column }) => mapped.get(`${normalise(row.value)}::${normalise(column.value)}`)!);
  } else if (sorted.length === combinations.length) {
    matrixVariants = sorted;
  } else if (sorted.length === rowOption.values.length + combinations.length) {
    matrixVariants = sorted.slice(rowOption.values.length);
  } else return variantList(variants);

  const used = new Set(matrixVariants.map((variant) => variant.id));
  return {
    title: `Inventory by ${rowOption.name.toLowerCase()} & ${columnOption.name.toLowerCase()}`,
    rowLabel: rowOption.name,
    columnLabel: columnOption.name,
    columns: columnOption.values.map((value) => value.value),
    rows: rowOption.values.map((row, rowIndex) => ({
      label: row.value,
      cells: columnOption.values.map((column, columnIndex) => ({
        label: column.value,
        variant: matrixVariants[rowIndex * columnOption.values.length + columnIndex],
      })),
    })),
    unmapped: sorted.filter((variant) => !used.has(variant.id)),
    showTotals: true,
  };
}
