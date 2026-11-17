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
