// Messages sent to ez-ai are English keys with {{name}} placeholders, so the
// payment records page can translate them; ez-ai also stores the filled-in
// English text on the order.

/**
 * @param {string} key
 * @param {Record<string, string>} [params]
 */
export function formatMessage(key, params = {}) {
  return key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(params[name] ?? ''))
}

/**
 * A failure the admin can act on. The message is an English key with
 * {{name}} placeholders, translated on the ez-ai payment records page.
 */
export class PurchaseError extends Error {
  /**
   * @param {string} key
   * @param {Record<string, string>} [params]
   * @param {{ cardOutcome?: string }} [options] cardOutcome tells ez-ai what
   *   the failure says about the card: 'declined' or 'needs_verification'.
   *   Leave it unset when the card is not at fault.
   */
  constructor(key, params = {}, options = {}) {
    super(formatMessage(key, params))
    this.key = key
    this.params = params
    this.cardOutcome = options.cardOutcome ?? ''
  }
}
