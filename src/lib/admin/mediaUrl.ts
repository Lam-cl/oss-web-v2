const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function adminMediaUrl(url: string) {
  if (!url.startsWith('/catalogue-products-api?')) return url;
  const query = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  const catalogueId = query.get('catalogueId');
  const mediaId = query.get('mediaId');
  if (!catalogueId || !mediaId || !UUID.test(catalogueId) || !UUID.test(mediaId)) return url;
  return `/admin-api/catalogue-products/${encodeURIComponent(catalogueId)}/media/${encodeURIComponent(mediaId)}`;
}
