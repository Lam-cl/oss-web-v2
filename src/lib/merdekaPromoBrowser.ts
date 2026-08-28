type MerdekaEmbedConfig = {
  apiBase?: string;
  assetBase?: string;
  publicPage?: string;
};

declare global {
  interface Window { __TW_MERDEKA_EMBED__?: MerdekaEmbedConfig; }
}
function base(name: keyof MerdekaEmbedConfig) {
  if (typeof window === 'undefined') return '';
  return window.__TW_MERDEKA_EMBED__?.[name]?.replace(/\/$/, '') || '';
}

export function merdekaApiUrl(path: string) {
  return `${base('apiBase')}${path}`;
}

export function merdekaAssetUrl(path: string) {
  return `${base('assetBase')}${path}`;
}

export function merdekaPublicPageUrl(query = '') {
  const page = base('publicPage') || '/merdeka-promo';
  return `${page}${query}`;
}
