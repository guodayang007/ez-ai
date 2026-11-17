// Browser plumbing shared by the ChatGPT and Claude purchasers: launching
// Chromium behind the configured proxy, reporting steps, filling the Stripe
// card form and waiting for the payment result.
import { chromium } from 'playwright'

import { formatMessage } from './message.mjs'

const PAYMENT_TIMEOUT_MS = 180_000
const POLL_INTERVAL_MS = 2_000
const PROGRESS_INTERVAL_POLLS = 15

// Each field lists the hosted Stripe Checkout id first, then the Stripe
// Elements name used by checkouts embedded on the provider's site.
const FIELDS = {
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
const ERROR_SELECTORS = ['.FieldError', '.Notice--red', '.p-FieldError', '[role="alert"]']
const SECURITY_CHECK_TITLE_PATTERN = /just a moment|attention required|security verification/i
const SECURITY_CHECK_TEXT_PATTERN = /performing security verification|verify you are human|checking your browser/i
const SECURITY_CHECK_TIMEOUT_MS = 180_000
const VERIFICATION_FRAME_PATTERN = /hcaptcha|recaptcha|3ds|three-d-secure|challenge|authenticate/i

/**
 * A failure the admin can act on. The message is an English key with
 * {{name}} placeholders, translated on the ez-ai payment records page.
 */
export class PurchaseError extends Error {
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

/**
 * @typedef {object} Steps
 * @property {(step: string, messageKey: string, params?: Record<string, string>) => void} start
 * @property {(messageKey: string, params?: Record<string, string>) => void} done
 * @property {(messageKey: string, params?: Record<string, string>) => void} info
 * @property {(page: import('playwright').Page) => Promise<void>} securityCheck waits for a person to pass a security check shown on the page
 */

/**
 * Runs one purchase in a fresh browser: opens `origin` (through the proxy
 * when one is set), records the exit address, then hands over to `buy`. Any
 * failure is returned as a result recorded against the step that was running.
 *
 * @param {import('./app.mjs').PurchaseJob} job
 * @param {import('./app.mjs').ReportStep} report
 * @param {object} options
 * @param {boolean} options.headless
 * @param {string} options.origin such as https://chatgpt.com
 * @param {Array<object>} [options.cookies] added to the context before the first page loads
 * @param {string} [options.requiredCookie] the cookie that signs in; the purchase stops when the browser refuses it
 * @param {(apiPage: import('playwright').Page, page: import('playwright').Page, steps: Steps) => Promise<import('./app.mjs').PurchaseResult>} buy
 *   calls `steps.securityCheck(page)` after each navigation
 * @returns {Promise<import('./app.mjs').PurchaseResult>}
 */
export async function runPurchase(job, report, options, buy) {
  const site = new URL(options.origin).host
  // The step that is running, so a failure is recorded against it.
  let current = 'browser'
  /** @type {Steps} */
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
    securityCheck(page) {
      return waitForSecurityCheck(page, steps, { headless: options.headless, site })
    },
  }
  let browser
  try {
    steps.start('browser', 'Launching the browser')
    const proxy = browserProxyOptions(job.browserProxy)
    browser = await chromium.launch({ headless: options.headless, proxy })
    const context = await browser.newContext({ locale: 'en-US' })
    const refused = await addCookies(context, options.cookies ?? [], options.requiredCookie)
    // API calls run from a tab that stays on the provider's site so they
    // carry its cookies; the checkout may be on another origin.
    const apiPage = await context.newPage()
    const page = await context.newPage()
    try {
      await apiPage.goto(options.origin, { waitUntil: 'domcontentloaded' })
    } catch (error) {
      // A wrong proxy password shows up only as a timeout, so any failure
      // here with a proxy points at the proxy.
      if (proxy) {
        throw new PurchaseError(
          'Could not reach {{site}} through the browser proxy {{proxy}}: {{error}}. ' +
            'Check the proxy address, username and password in the ez-ai Product Fulfillment settings.',
          { site, proxy: proxy.server, error: error.message.split('\n')[0] }
        )
      }
      throw error
    }
    await steps.securityCheck(apiPage)
    // Cloudflare in front of the site reports the address it sees, so the
    // record shows whether the proxy is used and where it exits.
    const trace = await apiPage
      .evaluate(async () => {
        const response = await fetch('/cdn-cgi/trace')
        return response.ok ? response.text() : ''
      })
      .catch(() => '')
    const exit = {
      site,
      ip: /^ip=(.+)$/m.exec(trace)?.[1] ?? 'unknown',
      country: /^loc=(.+)$/m.exec(trace)?.[1] ?? 'unknown',
    }
    steps.done(
      proxy
        ? 'Opened {{site}} through the browser proxy; exit IP {{ip}} ({{country}})'
        : 'Opened {{site}} without a browser proxy; exit IP {{ip}} ({{country}})',
      exit
    )
    if (refused.length > 0) {
      steps.info('The browser refused these cookies, so they were left out: {{names}}', { names: refused.join(', ') })
    }
    if (exit.country !== 'unknown' && job.billing.country && exit.country !== job.billing.country) {
      steps.info(
        'The browser exits in {{country}} but the billing country is {{billing}}; {{site}} may refuse the checkout. ' +
          'Set a browser proxy in {{billing}}.',
        { site, country: exit.country, billing: job.billing.country }
      )
    }
    return await buy(apiPage, page, steps)
  } catch (error) {
    const failure =
      error instanceof PurchaseError ? error : new PurchaseError('Unexpected error: {{error}}', { error: error.message })
    return { success: false, step: current, messageKey: failure.key, params: failure.params }
  } finally {
    await browser?.close()
  }
}

/**
 * Adds the cookies to the browser context. Chromium refuses a whole batch
 * over one malformed cookie, so on failure they are added one by one and the
 * names of the refused ones are returned. Losing the required cookie stops
 * the purchase, since the account cannot be signed in without it.
 * @returns {Promise<string[]>} the names of the refused cookies
 */
export async function addCookies(context, cookies, requiredCookie) {
  if (cookies.length === 0) return []
  try {
    await context.addCookies(cookies)
    return []
  } catch {
    // Find out which ones the browser refuses.
  }
  const refused = []
  for (const cookie of cookies) {
    try {
      await context.addCookies([cookie])
    } catch (error) {
      if (cookie.name === requiredCookie) {
        throw new PurchaseError('The browser refused the {{name}} cookie, so the account cannot be signed in: {{error}}', {
          name: cookie.name,
          error: error.message.split('\n')[0],
        })
      }
      refused.push(cookie.name)
    }
  }
  return refused
}

/**
 * Whether the page is a bot check (such as Cloudflare's "Performing security
 * verification") instead of the site.
 * @param {import('playwright').Page} page
 */
export async function isSecurityCheck(page) {
  const title = await page.title().catch(() => '')
  if (SECURITY_CHECK_TITLE_PATTERN.test(title)) return true
  const text = await page
    .locator('body')
    .innerText({ timeout: 1_000 })
    .catch(() => '')
  return SECURITY_CHECK_TEXT_PATTERN.test(text.slice(0, 2_000))
}

/**
 * Hands a security check to a person. The fulfiller does not try to pass it
 * itself: with a visible browser (HEADLESS=false) it brings the page to the
 * front and waits for the admin to complete it; headless, it stops.
 */
async function waitForSecurityCheck(page, steps, options) {
  if (!(await isSecurityCheck(page))) return
  if (options.headless) {
    throw new PurchaseError(
      '{{site}} showed a security check that needs a person. Run the fulfiller with HEADLESS=false and complete the check in its browser window, or retry later.',
      { site: options.site }
    )
  }
  const seconds = String(SECURITY_CHECK_TIMEOUT_MS / 1000)
  await page.bringToFront().catch(() => {})
  steps.info("{{site}} is showing a security check. Complete it in the fulfiller's browser window within {{seconds}}s.", {
    site: options.site,
    seconds,
  })
  const deadline = Date.now() + SECURITY_CHECK_TIMEOUT_MS
  while (Date.now() < deadline) {
    await page.waitForTimeout(2_000)
    if (!(await isSecurityCheck(page))) {
      steps.info('The security check was completed; continuing')
      // The site loads behind the check; let it settle before using it.
      await page.waitForLoadState('domcontentloaded').catch(() => {})
      return
    }
  }
  throw new PurchaseError(
    "The security check on {{site}} was not completed within {{seconds}}s. Retry and complete it in the fulfiller's browser window.",
    { site: options.site, seconds }
  )
}

/** Waits until the Stripe card form shows, opening the card tab if needed. */
export async function waitForCardForm(page) {
  await clickFirst(page, CARD_TAB_SELECTORS, 15_000)
  if (!(await findVisible(page, FIELDS.cardNumber, 60_000))) {
    throw new PurchaseError('The checkout page did not show a card form ({{url}}).', { url: page.url() })
  }
}

/** Fills the card, the holder and the billing address into the Stripe form. */
export async function fillCardAndAddress(page, job) {
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

/**
 * Polls after the pay button was clicked until the account shows the new
 * plan. Stops on a captcha or 3-D Secure frame, on an error shown by the
 * checkout, or after the timeout.
 *
 * @param {import('playwright').Page} page the checkout page
 * @param {Steps} steps
 * @param {object} options
 * @param {string} options.site the provider's host, for messages
 * @param {string} options.checkoutUrl
 * @param {(url: string) => boolean} options.isCheckoutUrl true while the page is still on the checkout
 * @param {() => Promise<string>} options.paidPlan the account's new plan, or '' while not paid yet
 * @returns {Promise<string>} the plan the account has now
 */
export async function waitForPaymentResult(page, steps, options) {
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
    if (verificationFrame && (await isFrameShown(verificationFrame))) {
      throw new PurchaseError(
        'Checkout asked for a captcha or 3-D Secure verification, so the payment was not finished. ' +
          'Complete it by hand: {{url}}',
        { url: options.checkoutUrl }
      )
    }
    const errorText = await findErrorText(page)
    if (errorText) {
      throw new PurchaseError('Checkout rejected the payment: {{reason}}', { reason: errorText })
    }
    // Check the account every few polls; this also covers embedded
    // checkouts, which may not navigate after paying.
    if (polls % 3 === 0 || !options.isCheckoutUrl(page.url())) {
      const plan = await options.paidPlan().catch(() => '')
      if (plan) {
        steps.done('Payment went through, the account plan is now {{plan}}', { plan })
        return plan
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
      'check the {{site}} account and DogPay records before retrying. Checkout: {{url}}',
    { seconds: String(PAYMENT_TIMEOUT_MS / 1000), site: options.site, url: options.checkoutUrl }
  )
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
export async function findVisible(page, selectors, timeoutMs) {
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
export async function clickFirst(page, selectors, timeoutMs = 10_000) {
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

async function isFrameShown(frame) {
  const element = await frame.frameElement().catch(() => null)
  if (!element) return false
  const box = await element.boundingBox().catch(() => null)
  return Boolean(box && box.width > 50 && box.height > 50)
}
