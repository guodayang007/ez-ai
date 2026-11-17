// Buys a ChatGPT plan on the buyer's account and pays with the DogPay card.
//
// ChatGPT has no public API for this. The endpoints and page selectors below
// are what chatgpt.com and its Stripe checkout use today; they change without
// notice, so every step fails with a readable message instead of guessing.
// Nothing here solves captchas or 3-D Secure: when either appears, the
// purchase stops and the admin finishes it by hand.
import { chromium } from 'playwright'

import { formatMessage } from './message.mjs'

const CHATGPT_ORIGIN = 'https://chatgpt.com'
const ACCOUNT_CHECK_PATH = '/backend-api/accounts/check/v4-2023-04-27'
const CHECKOUT_PATH = '/backend-api/payments/checkout'
const PAYMENT_TIMEOUT_MS = 180_000
const POLL_INTERVAL_MS = 2_000

// Each field lists the hosted Stripe Checkout id first, then the Stripe
// Elements name used by the checkout embedded on chatgpt.com.
const FIELDS = {
  email: ['#email'],
  cardNumber: ['#cardNumber', 'input[name="number"]'],
  cardExpiry: ['#cardExpiry', 'input[name="expiry"]'],
  cardCvc: ['#cardCvc', 'input[name="cvc"]'],
  holder: ['#billingName', 'input[name="name"]'],
  country: ['select#billingCountry', 'select[name="country"]'],
  line1: ['#billingAddressLine1', 'input[name="addressLine1"]'],
  city: ['#billingLocality', 'input[name="locality"]'],
  postalCode: ['#billingPostalCode', 'input[name="postalCode"]'],
  state: ['#billingAdministrativeArea', '[name="administrativeArea"]'],
}
const CARD_TAB_SELECTORS = ['[data-testid="card-accordion-item-button"]', 'button[value="card"]']
const MANUAL_ADDRESS_SELECTORS = ['button.AddressAutocomplete-manual-entry', 'text=/enter address manually/i']
const TERMS_SELECTORS = ['#termsOfServiceConsentCheckbox', 'input[name="termsOfServiceConsentCheckbox"]']
const SUBMIT_SELECTORS = ['[data-testid="hosted-payment-submit-button"]', '.SubmitButton', 'button[type="submit"]']
const ERROR_SELECTORS = ['.FieldError', '.Notice--red', '.p-FieldError', '[role="alert"]']
const VERIFICATION_FRAME_PATTERN = /hcaptcha|recaptcha|3ds|three-d-secure|challenge|authenticate/i

const PROGRESS_INTERVAL_POLLS = 15

/**
 * A failure the admin can act on. The message is an English key with
 * {{name}} placeholders, translated on the ez-ai payment records page.
 */
class PurchaseError extends Error {
  /**
   * @param {string} key
   * @param {Record<string, string>} [params]
   */
  constructor(key, params = {}) {
    super(formatMessage(key, params))
    this.key = key
    this.params = params
  }
}

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
  return async function purchase(job, report) {
    // The step that is running, so a failure is recorded against it.
    let current = 'browser'
    const steps = {
      start(step, messageKey, params) {
        current = step
        report(step, 'running', messageKey, params)
      },
      done(messageKey, params) {
        report(current, 'succeeded', messageKey, params)
      },
      info(messageKey, params) {
        report(current, 'info', messageKey, params)
      },
    }
    let browser
    try {
      steps.start('browser', 'Launching the browser')
      const proxy = browserProxyOptions(job.browserProxy)
      browser = await chromium.launch({ headless: config.headless, proxy })
      const context = await browser.newContext({ locale: 'en-US' })
      // ChatGPT API calls run from a tab that stays on chatgpt.com so they
      // carry its cookies; the checkout may be on another origin.
      const apiPage = await context.newPage()
      const page = await context.newPage()
      try {
        await apiPage.goto(CHATGPT_ORIGIN, { waitUntil: 'domcontentloaded' })
      } catch (error) {
        // A wrong proxy password shows up only as a timeout, so any failure
        // here with a proxy points at the proxy.
        if (proxy) {
          throw new PurchaseError(
            'Could not reach chatgpt.com through the browser proxy {{proxy}}: {{error}}. ' +
              'Check the proxy address, username and password in the ez-ai Product Fulfillment settings.',
            { proxy: proxy.server, error: error.message.split('\n')[0] }
          )
        }
        throw error
      }
      // Cloudflare in front of chatgpt.com reports the address it sees, so
      // the record shows whether the proxy is used and where it exits.
      const trace = await apiPage
        .evaluate(async () => {
          const response = await fetch('/cdn-cgi/trace')
          return response.ok ? response.text() : ''
        })
        .catch(() => '')
      const exit = {
        ip: /^ip=(.+)$/m.exec(trace)?.[1] ?? 'unknown',
        country: /^loc=(.+)$/m.exec(trace)?.[1] ?? 'unknown',
      }
      steps.done(
        proxy
          ? 'Opened chatgpt.com through the browser proxy; exit IP {{ip}} ({{country}})'
          : 'Opened chatgpt.com without a browser proxy; exit IP {{ip}} ({{country}})',
        exit
      )
      if (exit.country !== 'unknown' && job.billing.country && exit.country !== job.billing.country) {
        steps.info(
          'The browser exits in {{country}} but the billing country is {{billing}}; ChatGPT may refuse the checkout. ' +
            'Set a browser proxy in {{billing}}.',
          { country: exit.country, billing: job.billing.country }
        )
      }
      return await buy(apiPage, page, job, steps)
    } catch (error) {
      const failure =
        error instanceof PurchaseError ? error : new PurchaseError('Unexpected error: {{error}}', { error: error.message })
      return { success: false, step: current, messageKey: failure.key, params: failure.params }
    } finally {
      await browser?.close()
    }
  }
}

/**
 * Playwright launch options for the proxy URL saved in ez-ai. Playwright keeps
 * only the scheme and host of `server` and drops any user:pass in it, so the
 * credentials are passed on their own.
 * @param {string} proxyUrl such as http://user:pass@host:port
 */
export function browserProxyOptions(proxyUrl) {
  if (!proxyUrl) return undefined
  const url = new URL(proxyUrl)
  const options = { server: `${url.protocol}//${url.host}` }
  if (url.username) options.username = decodeURIComponent(url.username)
  if (url.password) options.password = decodeURIComponent(url.password)
  return options
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
  await fillPayment(page, job)
  steps.done('Filled in the card ending in {{last4}}, the holder and the billing address ({{country}})', {
    last4: job.card.number.slice(-4),
    country: job.billing.country,
  })

  steps.start('submit_payment', 'Clicking the pay button')
  if (!(await clickFirst(page, SUBMIT_SELECTORS))) {
    throw new PurchaseError('The checkout page has no pay button.')
  }
  steps.done('Clicked the pay button')

  steps.start('confirm_payment', 'Waiting up to {{seconds}}s for the payment result', {
    seconds: String(PAYMENT_TIMEOUT_MS / 1000),
  })
  const startedAt = Date.now()
  const deadline = startedAt + PAYMENT_TIMEOUT_MS
  let polls = 0
  while (Date.now() < deadline) {
    await page.waitForTimeout(POLL_INTERVAL_MS)
    polls++

    const verificationFrame = page.frames().find((frame) => VERIFICATION_FRAME_PATTERN.test(frame.url()))
    if (verificationFrame && (await isFrameShown(page, verificationFrame))) {
      throw new PurchaseError(
        'Checkout asked for a captcha or 3-D Secure verification, so the payment was not finished. ' +
          'Complete it by hand: {{url}}',
        { url: checkoutUrl }
      )
    }
    const errorText = await findErrorText(page)
    if (errorText) {
      throw new PurchaseError('Checkout rejected the payment: {{reason}}', { reason: errorText })
    }
    // Check the account every few polls; this also covers the embedded
    // checkout, which may not navigate after paying.
    if (polls % 3 === 0 || !isCheckoutUrl(page.url())) {
      const after = await getSubscription(apiPage, job.accessToken).catch(() => null)
      if (after?.active) {
        const plan = after.plan || job.plan
        steps.done('Payment went through, the account plan is now {{plan}}', { plan })
        return {
          success: true,
          messageKey: 'Paid with DogPay, account plan is now {{plan}}',
          params: { plan },
          deliveryNote: `ChatGPT ${plan} 订阅已开通`,
        }
      }
    }
    if (polls % PROGRESS_INTERVAL_POLLS === 0) {
      steps.info('Still waiting for the payment result after {{seconds}}s (page: {{url}})', {
        seconds: String(Math.round((Date.now() - startedAt) / 1000)),
        url: page.url(),
      })
    }
  }
  throw new PurchaseError(
    'No payment result within {{seconds}}s. The card may have been charged: ' +
      'check the ChatGPT account and DogPay records before retrying. Checkout: {{url}}',
    { seconds: String(PAYMENT_TIMEOUT_MS / 1000), url: checkoutUrl }
  )
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

function isCheckoutUrl(url) {
  return /\/checkout\/|checkout\.stripe\.com|pay\.openai\.com/.test(url)
}

async function fillPayment(page, job) {
  // The form renders after Stripe loads; wait for the card number anywhere.
  await clickFirst(page, CARD_TAB_SELECTORS, 15_000)
  if (!(await findVisible(page, FIELDS.cardNumber, 60_000))) {
    throw new PurchaseError('The checkout page did not show a card form ({{url}}).', { url: page.url() })
  }

  const email = await findVisible(page, FIELDS.email, 0)
  if (email && !(await email.inputValue().catch(() => 'x'))) {
    throw new PurchaseError('Checkout asks for an email, which means the session is not attached to the checkout.')
  }

  await typeInto(page, FIELDS.cardNumber, job.card.number, true)
  await typeInto(page, FIELDS.cardExpiry, job.card.expiry.replace('/', ''), true)
  await typeInto(page, FIELDS.cardCvc, job.card.cvc, true)
  await typeInto(page, FIELDS.holder, job.card.holder, false)

  const country = await findVisible(page, FIELDS.country, 0)
  if (country) await country.selectOption(job.billing.country)
  await clickFirst(page, MANUAL_ADDRESS_SELECTORS, 0)
  await typeInto(page, FIELDS.line1, job.billing.line1, false)
  await typeInto(page, FIELDS.city, job.billing.city, false)
  await typeInto(page, FIELDS.postalCode, job.billing.postalCode, false)
  const state = await findVisible(page, FIELDS.state, 0)
  if (state && job.billing.state) {
    const tag = await state.evaluate((el) => el.tagName)
    if (tag === 'SELECT') await state.selectOption(job.billing.state)
    else await state.fill(job.billing.state)
  }

  const terms = await findVisible(page, TERMS_SELECTORS, 0)
  if (terms && !(await terms.isChecked())) await terms.check()
}

async function typeInto(page, selectors, value, required) {
  if (!value) return
  const field = await findVisible(page, selectors, required ? 10_000 : 0)
  if (!field) {
    if (required) throw new PurchaseError('The checkout page has no {{field}} field.', { field: selectors[0] })
    return
  }
  await field.fill('')
  // Stripe formats card inputs per keystroke, so type rather than set.
  await field.pressSequentially(value, { delay: 40 })
}

/** Looks for the first visible match in the page and every Stripe iframe. */
async function findVisible(page, selectors, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  do {
    for (const frame of page.frames()) {
      for (const selector of selectors) {
        const locator = frame.locator(selector).first()
        if (await locator.isVisible().catch(() => false)) return locator
      }
    }
    if (Date.now() >= deadline) break
    await page.waitForTimeout(500)
  } while (Date.now() < deadline)
  return null
}

/** Clicks the first visible match; false when none appeared in time. */
async function clickFirst(page, selectors, timeoutMs = 10_000) {
  const target = await findVisible(page, selectors, timeoutMs)
  if (!target) return false
  await target.click()
  return true
}

async function findErrorText(page) {
  for (const frame of page.frames()) {
    for (const selector of ERROR_SELECTORS) {
      const locator = frame.locator(selector)
      const count = await locator.count().catch(() => 0)
      for (let i = 0; i < count; i++) {
        const item = locator.nth(i)
        if (!(await item.isVisible().catch(() => false))) continue
        const text = (await item.innerText().catch(() => '')).trim()
        if (text) return text.slice(0, 300)
      }
    }
  }
  return ''
}

async function isFrameShown(page, frame) {
  const element = await frame.frameElement().catch(() => null)
  if (!element) return false
  const box = await element.boundingBox().catch(() => null)
  return Boolean(box && box.width > 50 && box.height > 50)
}
