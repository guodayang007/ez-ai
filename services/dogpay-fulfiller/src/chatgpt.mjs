// Buys a ChatGPT plan on the buyer's account and pays with the DogPay card.
//
// ChatGPT has no public API for this. The endpoints and page selectors below
// are what chatgpt.com and its Stripe checkout use today; they change without
// notice, so every step fails with a readable message instead of guessing.
// Nothing here solves captchas or 3-D Secure: when either appears, the
// purchase stops and the admin finishes it by hand.
import {
  PurchaseError,
  clickFirst,
  fillCardAndAddress,
  findVisible,
  runPurchase,
  waitForCardForm,
  waitForPaymentResult,
} from './browser.mjs'

const CHATGPT_ORIGIN = 'https://chatgpt.com'
const ACCOUNT_CHECK_PATH = '/backend-api/accounts/check/v4-2023-04-27'
const CHECKOUT_PATH = '/backend-api/payments/checkout'

const EMAIL_SELECTORS = ['#email']
const SUBMIT_SELECTORS = ['[data-testid="hosted-payment-submit-button"]', '.SubmitButton', 'button[type="submit"]']

/**
 * The card, billing address and browser proxy come with each job from ez-ai,
 * which stores them encrypted; only browser options are local.
 * @param {ReturnType<import('./config.mjs').loadConfig>} config
 */
export function createChatGPTPurchaser(config) {
  /**
   * @param {import('./app.mjs').PurchaseJob} job
   * @param {import('./app.mjs').ReportStep} report
   * @returns {Promise<import('./app.mjs').PurchaseResult>}
   */
  return function purchase(job, report) {
    return runPurchase(job, report, { headless: config.headless, origin: CHATGPT_ORIGIN }, (apiPage, page, steps) =>
      buy(apiPage, page, job, steps)
    )
  }
}

async function buy(apiPage, page, job, steps) {
  steps.start('subscription', 'Checking the subscription of the ChatGPT account')
  const before = await getSubscription(apiPage, job.accessToken)
  if (before.active) {
    throw new PurchaseError(
      'The ChatGPT account already has an active {{plan}} subscription; nothing was charged. ' +
        'If an earlier attempt succeeded, mark the order completed by hand.',
      { plan: before.plan || 'paid' }
    )
  }
  steps.done('The account has no active subscription (current plan: {{plan}})', { plan: before.plan || 'free' })

  steps.start('checkout', 'Creating a checkout for plan {{plan}}', { plan: job.plan })
  const checkoutUrl = await createCheckout(apiPage, job)
  steps.done('Checkout created: {{url}}', { url: checkoutUrl })

  steps.start('fill_payment', 'Opening the checkout page and waiting for the card form')
  await page.goto(checkoutUrl, { waitUntil: 'domcontentloaded' })
  await steps.securityCheck(page)
  await waitForCardForm(page)
  const email = await findVisible(page, EMAIL_SELECTORS, 0)
  if (email && !(await email.inputValue().catch(() => 'x'))) {
    throw new PurchaseError('Checkout asks for an email, which means the session is not attached to the checkout.')
  }
  await fillCardAndAddress(page, job)
  steps.done('Filled in the card ending in {{last4}}, the holder and the billing address ({{country}})', {
    last4: job.card.number.slice(-4),
    country: job.billing.country,
  })

  steps.start('submit_payment', 'Clicking the pay button')
  if (!(await clickFirst(page, SUBMIT_SELECTORS))) {
    throw new PurchaseError('The checkout page has no pay button.')
  }
  steps.done('Clicked the pay button')

  const plan = await waitForPaymentResult(page, steps, {
    site: 'chatgpt.com',
    checkoutUrl,
    isCheckoutUrl: (url) => /\/checkout\/|checkout\.stripe\.com|pay\.openai\.com/.test(url),
    paidPlan: async () => {
      const after = await getSubscription(apiPage, job.accessToken)
      return after.active ? after.plan || job.plan : ''
    },
  })
  return {
    success: true,
    messageKey: 'Paid with DogPay, account plan is now {{plan}}',
    params: { plan },
    deliveryNote: `ChatGPT ${plan} 订阅已开通`,
  }
}

async function chatgptFetch(page, accessToken, path, init = {}) {
  const response = await page.evaluate(
    async ({ path, accessToken, init }) => {
      const res = await fetch(path, {
        ...init,
        headers: { ...(init.headers ?? {}), authorization: `Bearer ${accessToken}` },
      })
      return { status: res.status, text: await res.text() }
    },
    { path, accessToken, init }
  )
  if (response.status === 401) {
    throw new PurchaseError('The ChatGPT session has expired or was signed out; ask the buyer for a new session.')
  }
  if (response.status === 403 && /<html/i.test(response.text)) {
    throw new PurchaseError('chatgpt.com blocked the request with a browser check; set another browser proxy in the ez-ai Product Fulfillment settings or retry later.')
  }
  let data
  try {
    data = JSON.parse(response.text)
  } catch {
    throw new PurchaseError('chatgpt.com {{path}} returned HTTP {{status}} without JSON.', {
      path,
      status: String(response.status),
    })
  }
  if (response.status >= 400) {
    const detail = typeof data?.detail === 'string' ? data.detail : JSON.stringify(data?.detail ?? data).slice(0, 300)
    throw new PurchaseError('chatgpt.com {{path}} returned HTTP {{status}}: {{detail}}', {
      path,
      status: String(response.status),
      detail,
    })
  }
  return data
}

async function getSubscription(page, accessToken) {
  const data = await chatgptFetch(page, accessToken, ACCOUNT_CHECK_PATH)
  const accounts = Object.values(data?.accounts ?? {})
  const personal =
    accounts.find((entry) => entry?.account?.structure === 'personal') ?? data?.accounts?.default ?? accounts[0]
  const entitlement = personal?.entitlement ?? {}
  return {
    active: entitlement.has_active_subscription === true,
    plan: String(entitlement.subscription_plan ?? ''),
  }
}

async function createCheckout(page, job) {
  const data = await chatgptFetch(page, job.accessToken, CHECKOUT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      plan_name: job.plan,
      billing_details: { country: job.billing.country, currency: job.billing.currency },
      checkout_ui_mode: 'redirect',
    }),
  })
  if (typeof data?.url === 'string' && data.url.startsWith('https://')) {
    return data.url
  }
  if (typeof data?.checkout_session_id === 'string') {
    const entity = typeof data.processor_entity === 'string' ? data.processor_entity : 'openai_llc'
    return `${CHATGPT_ORIGIN}/checkout/${entity}/${data.checkout_session_id}`
  }
  throw new PurchaseError(
    'chatgpt.com did not return a checkout link (fields: {{fields}}). Check that "{{plan}}" is a valid plan code.',
    { fields: Object.keys(data ?? {}).join(', ') || 'none', plan: job.plan }
  )
}
