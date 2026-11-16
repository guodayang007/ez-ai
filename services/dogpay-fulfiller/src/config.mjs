// Reads and validates the fulfiller configuration from the environment.
// Card details only ever live here, never in ez-ai's database.

const CARD_NUMBER_PATTERN = /^\d{12,19}$/
const CARD_EXPIRY_PATTERN = /^(0[1-9]|1[0-2])\/\d{2}$/
const CARD_CVC_PATTERN = /^\d{3,4}$/

export function loadConfig(env) {
  const problems = []
  const read = (key, fallback = '') => (env[key] ?? fallback).trim()

  const secret = read('FULFILLER_SECRET')
  if (secret.length < 32) {
    problems.push('FULFILLER_SECRET must be at least 32 characters')
  }

  const allowedPlans = new Set(
    read('ALLOWED_PLANS')
      .split(',')
      .map((plan) => plan.trim())
      .filter(Boolean)
  )
  if (allowedPlans.size === 0) {
    problems.push('ALLOWED_PLANS must list at least one plan code')
  }

  const card = {
    number: read('DOGPAY_CARD_NUMBER').replace(/[\s-]/g, ''),
    expiry: read('DOGPAY_CARD_EXPIRY'),
    cvc: read('DOGPAY_CARD_CVC'),
    holder: read('DOGPAY_CARDHOLDER_NAME'),
  }
  if (!CARD_NUMBER_PATTERN.test(card.number)) {
    problems.push('DOGPAY_CARD_NUMBER must be 12-19 digits')
  }
  if (!CARD_EXPIRY_PATTERN.test(card.expiry)) {
    problems.push('DOGPAY_CARD_EXPIRY must look like MM/YY')
  }
  if (!CARD_CVC_PATTERN.test(card.cvc)) {
    problems.push('DOGPAY_CARD_CVC must be 3-4 digits')
  }
  if (!card.holder) {
    problems.push('DOGPAY_CARDHOLDER_NAME is required')
  }

  const billing = {
    country: read('BILLING_COUNTRY', 'US').toUpperCase(),
    currency: read('BILLING_CURRENCY', 'USD').toUpperCase(),
    line1: read('BILLING_ADDRESS_LINE1'),
    city: read('BILLING_CITY'),
    state: read('BILLING_STATE'),
    postalCode: read('BILLING_POSTAL_CODE'),
  }

  const port = Number.parseInt(read('PORT', '3100'), 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    problems.push('PORT must be a valid port number')
  }

  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`)
  }

  return {
    host: read('HOST', '127.0.0.1'),
    port,
    secret,
    allowedPlans,
    card,
    billing,
    headless: read('HEADLESS', 'true').toLowerCase() !== 'false',
    browserProxy: read('BROWSER_PROXY'),
  }
}
