/**
 * Message for a failed admin API request.
 *
 * Prefers the server's own message. When there is none (for example Vercel
 * rejecting an oversized body with a non-JSON page before the route runs),
 * the HTTP status is turned into a clear message instead of being dropped.
 */
export function httpFailureMessage(status: number, payloadMessage?: string): string {
  if (typeof payloadMessage === 'string' && payloadMessage.trim()) return payloadMessage;
  if (status === 413) return 'Photo is too large (max 4 MB). It was not saved.';
  if (status === 504 || status === 408) return 'The server timed out. Reload and check before retrying.';
  return `Save failed (HTTP ${status}).`;
}
