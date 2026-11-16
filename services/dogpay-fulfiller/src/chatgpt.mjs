// Buys a ChatGPT plan on the buyer's account and pays with the DogPay card.
//
// ChatGPT has no public API for this. The endpoints and page selectors below
// are what chatgpt.com and its Stripe checkout use today; they change without
// notice, so every step fails with a readable message instead of guessing.
// Nothing here solves captchas or 3-D Secure: when either appears, the
// purchase stops and the admin finishes it by hand.
import { chromium } from 'playwright'

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

class PurchaseError extends Error {}

/**
 * @param {ReturnType<import('./config.mjs').loadConfig>} config
 */
export function createChatGPTPurchaser(config) {
  return async function purchase(job) {
    const browser = await chromium.launch({
      headless: config.headless,
      proxy: config.browserProxy ? { server: config.browserProxy } : undefined,
    })
    try {
      const context = await browser.newContext({ locale: 'en-US' })
      // ChatGPT API calls run from a tab that stays on chatgpt.com so they
      // carry its cookies; the checkout may be on another origin.
      const apiPage = await context.newPage()
      const page = await context.newPage()
      return await buy(apiPage, page, config, job)
    } catch (error) {
      if (error instanceof PurchaseError) {
        return { success: false, message: error.message }
      }
      return { success: false, message: `Unexpected error: ${error.message}` }
    } finally {
      await browser.close()
    }
  }
}

async function buy(apiPage, page, config, job) {
  await apiPage.goto(CHATGPT_ORIGIN, { waitUntil: 'domcontentloaded' })

  const before = await getSubscription(apiPage, job.accessToken)
  if (before.active) {
    throw new PurchaseError(
      `The ChatGPT account already has an active ${before.plan || 'paid'} subscription; nothing was charged. ` +
        'If an earlier attempt succeeded, mark the order completed by hand.'
    )
  }

  const checkoutUrl = await createCheckout(apiPage, config, job)
  await page.goto(checkoutUrl, { waitUntil: 'domcontentloaded' })
  await fillPayment(page, config)
  await clickFirst(page, SUBMIT_SELECTORS, 'the pay button')

  const deadline = Date.now() + PAYMENT_TIMEOUT_MS
  let polls = 0
  while (Date.now() < deadline) {
    await page.waitForTimeout(POLL_INTERVAL_MS)
    polls++

    const verificationFrame = page.frames().find((frame) => VERIFICATION_FRAME_PATTERN.test(frame.url()))
    if (verificationFrame && (await isFrameShown(page, verificationFrame))) {
      throw new PurchaseError(
        `Checkout asked for a captcha or 3-D Secure verification, so the payment was not finished. ` +
          `Complete it by hand: ${checkoutUrl}`
      )
    }
    const errorText = await findErrorText(page)
    if (errorText) {
      throw new PurchaseError(`Checkout rejected the payment: ${errorText}`)
    }
    // Check the account every few polls; this also covers the embedded
    // checkout, which may not navigate after paying.
    if (polls % 3 === 0 || !isCheckoutUrl(page.url())) {
      const after = await getSubscription(apiPage, job.accessToken).catch(() => null)
      if (after?.active) {
        return {
          success: true,
          message: `Paid with DogPay, account plan is now ${after.plan || job.plan}`,
          deliveryNote: `ChatGPT ${after.plan || job.plan} 订阅已开通`,
        }
      }
    }
  }
  throw new PurchaseError(
    `No payment result within ${PAYMENT_TIMEOUT_MS / 1000}s. The card may have been charged: ` +
      `check the ChatGPT account and DogPay records before retrying. Checkout: ${checkoutUrl}`
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
    throw new PurchaseError('chatgpt.com blocked the request with a browser check; try another BROWSER_PROXY or retry later.')
  }
  let data
  try {
    data = JSON.parse(response.text)
  } catch {
    throw new PurchaseError(`chatgpt.com ${path} returned HTTP ${response.status} without JSON.`)
  }
  if (response.status >= 400) {
    const detail = typeof data?.detail === 'string' ? data.detail : JSON.stringify(data?.detail ?? data).slice(0, 300)
    throw new PurchaseError(`chatgpt.com ${path} returned HTTP ${response.status}: ${detail}`)
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

async function createCheckout(page, config, job) {
  const data = await chatgptFetch(page, job.accessToken, CHECKOUT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      plan_name: job.plan,
      billing_details: { country: config.billing.country, currency: config.billing.currency },
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
    `chatgpt.com did not return a checkout link (fields: ${Object.keys(data ?? {}).join(', ') || 'none'}). ` +
      `Check that "${job.plan}" is a valid plan code.`
  )
}

function isCheckoutUrl(url) {
  return /\/checkout\/|checkout\.stripe\.com|pay\.openai\.com/.test(url)
}

async function fillPayment(page, config) {
  // The form renders after Stripe loads; wait for the card number anywhere.
  await clickFirst(page, CARD_TAB_SELECTORS, null, 15_000)
  if (!(await findVisible(page, FIELDS.cardNumber, 60_000))) {
    throw new PurchaseError(`The checkout page did not show a card form (${page.url()}).`)
  }

  const email = await findVisible(page, FIELDS.email, 0)
  if (email && !(await email.inputValue().catch(() => 'x'))) {
    throw new PurchaseError('Checkout asks for an email, which means the session is not attached to the checkout.')
  }

  await typeInto(page, FIELDS.cardNumber, config.card.number, true)
  await typeInto(page, FIELDS.cardExpiry, config.card.expiry.replace('/', ''), true)
  await typeInto(page, FIELDS.cardCvc, config.card.cvc, true)
  await typeInto(page, FIELDS.holder, config.card.holder, false)

  const country = await findVisible(page, FIELDS.country, 0)
  if (country) await country.selectOption(config.billing.country)
  await clickFirst(page, MANUAL_ADDRESS_SELECTORS, null, 0)
  await typeInto(page, FIELDS.line1, config.billing.line1, false)
  await typeInto(page, FIELDS.city, config.billing.city, false)
  await typeInto(page, FIELDS.postalCode, config.billing.postalCode, false)
  const state = await findVisible(page, FIELDS.state, 0)
  if (state && config.billing.state) {
    const tag = await state.evaluate((el) => el.tagName)
    if (tag === 'SELECT') await state.selectOption(config.billing.state)
    else await state.fill(config.billing.state)
  }

  const terms = await findVisible(page, TERMS_SELECTORS, 0)
  if (terms && !(await terms.isChecked())) await terms.check()
}

async function typeInto(page, selectors, value, required) {
  if (!value) return
  const field = await findVisible(page, selectors, required ? 10_000 : 0)
  if (!field) {
    if (required) throw new PurchaseError(`The checkout page has no ${selectors[0]} field.`)
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

async function clickFirst(page, selectors, label, timeoutMs = 10_000) {
  const target = await findVisible(page, selectors, timeoutMs)
  if (!target) {
    if (label) throw new PurchaseError(`The checkout page has no ${label}.`)
    return
  }
  await target.click()
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
