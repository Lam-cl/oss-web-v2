type CatalogueRowSource = {
  currentBundleProductId: number | null;
  pendingBundleProductIds?: readonly number[];
};

export type CatalogueProviderRow<C, P> =
  | { kind: 'catalogue'; catalogue: C; product: P }
  | { kind: 'legacy'; product: P };

export function catalogueProviderRows<C extends CatalogueRowSource, P extends { id: number }>(
  catalogue: readonly C[],
  products: readonly P[],
): Array<CatalogueProviderRow<C, P>> {
  const published = new Map(catalogue.flatMap((product) => product.currentBundleProductId === null
    ? [] : [[product.currentBundleProductId, product] as const]));
  const pending = new Set(catalogue.flatMap((product) => product.pendingBundleProductIds ?? []));
  return products.filter((product) => !pending.has(product.id) || published.has(product.id))
    .map((product) => {
      const source = published.get(product.id);
      return source
        ? { kind: 'catalogue', catalogue: source, product }
        : { kind: 'legacy', product };
    });
}
