const PRODUCT_DETAILS_MARKER = '\n\nProduct details:\n';

export function parseProductDescription(value = '') {
  const normalized = value.replace(/\r\n/g, '\n').trim();
  const markerIndex = normalized.indexOf(PRODUCT_DETAILS_MARKER);
  if (markerIndex < 0) return { description: normalized, details: [] as string[] };

  return {
    description: normalized.slice(0, markerIndex).trim(),
    details: normalized.slice(markerIndex + PRODUCT_DETAILS_MARKER.length)
      .split('\n')
      .map((line) => line.replace(/^\s*[-•]\s*/, '').trim())
      .filter(Boolean),
  };
}

export function formatProductDescription(description: string, productDetails: string) {
  const details = productDetails.replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\s*[-•]\s*/, '').trim())
    .filter(Boolean);
  const cleanDescription = description.trim();
  return details.length
    ? `${cleanDescription}${PRODUCT_DETAILS_MARKER}${details.map((detail) => `- ${detail}`).join('\n')}`
    : cleanDescription;
}
