/**
 * Message shown when saving a product to the server fails.
 *
 * Save-path errors (revision conflicts, media changes, timeouts, admin API
 * responses) are already written for admins, so they are shown as-is. They must
 * not go through friendlySpecError(): its generic fallback ("Some product
 * details are not valid yet…") is meant for local validation and hid the real
 * reason a save failed.
 */
export function saveFailureMessage(problem: unknown): string {
  const message = problem instanceof Error ? problem.message.trim() : '';
  if (!message) return 'Save failed. Please try again.';
  // Already a complete save message; prefixing again would read "Save failed: Save failed …".
  if (/^(?:Save failed|The product was created)/.test(message)) return message;
  return `Save failed: ${message}`;
}
