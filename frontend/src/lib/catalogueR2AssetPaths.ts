export type CatalogueAssetVariant = 'card' | 'gallery';

const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PUBLIC_ORIGIN = 'https://tonewow-assets.xifuhalim.com';

export function catalogueR2AssetKey(catalogueId: string, sha256: string, variant: CatalogueAssetVariant) {
  if (!UUID.test(catalogueId) || !SHA.test(sha256)) throw new Error('Invalid catalogue asset identity.');
  // Source hash plus a fixed transform version keeps each URL immutable.
  return `catalogue/v1/${catalogueId}/${sha256}/${variant}.webp`;
}

export function catalogueR2AssetUrl(catalogueId: string, sha256: string, variant: CatalogueAssetVariant) {
  return `${PUBLIC_ORIGIN}/${catalogueR2AssetKey(catalogueId, sha256, variant)}`;
}
