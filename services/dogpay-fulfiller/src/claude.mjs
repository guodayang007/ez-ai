// Buys a Claude plan on the buyer's account and pays with the DogPay card.
//
// The buyer gives their claude.ai Cookie; its sessionKey signs the browser in.
// Claude has no public API for this. The endpoints, upgrade pages and
// selectors below are what claude.ai and its embedded Stripe form use today;
// they change without notice, so every step fails with a readable message
// instead of guessing. Nothing here solves captchas or 3-D Secure: when
// either appears, the purchase stops and the admin finishes it by hand.
import {
  PurchaseError,
  clickFirst,
  fillCardAndAddress,
  findVisible,
  runPurchase,
  waitForCardForm,
  waitForPaymentResult,
} from './browser.mjs'

const CLAUDE_ORIGIN = 'https://claude.ai'
const CLAUDE_HOST = 'claude.ai'
const ORGANIZATIONS_PATH = '/api/organizations'

/**
 * The plans ez-ai offers for Claude orders (service.ProductFulfillerClaudePlans),
 * with the upgrade page that sells each and, for Max, the usage tier to pick.
 */
export const CLAUDE_PLANS = {
  claude_pro: { label: 'Pro', path: '/upgrade/pro', tier: null },
  claude_max_5x: { label: 'Max 5x', path: '/upgrade/max', tier: /5x/i },
  claude_max_20x: { label: 'Max 20x', path: '/upgrade/max', tier: /20x/i },
}

const TIER_ROLES = ['radio', 'tab', 'option', 'button']
const MONTHLY_SELECTORS = ['role=radio[name=/monthly/i]', 'role=tab[name=/monthly/i]', 'role=button[name=/^monthly/i]']
const CONTINUE_SELECTORS = ['role=button[name=/^(continue|upgrade|get (claude )?(pro|max))/i]']
const SUBMIT_SELECTORS = ['role=button[name=/^(subscribe|upgrade|pay|confirm)/i]', 'button[type="submit"]']

/**
 * Turns the Cookie header saved by ez-ai ("name=value; ...") into browser
 * cookies for claude.ai. A "__Host-" cookie must not carry a domain, so it is
 * set for the claude.ai URL instead; the rest are shared with subdomains.
 * @param {string} header
 */
export function claudeCookies(header) {
  const cookies = []
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    const name = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (!name || !value) continue
    const cookie = { name, value, secure: true, httpOnly: name.startsWith('sessionKey'), sameSite: 'Lax' }
    if (name.startsWith('__Host-')) {
      cookies.push({ ...cookie, url: `${CLAUDE_ORIGIN}/` })
    } else {
      cookies.push({ ...cookie, domain: `.${CLAUDE_HOST}`, path: '/' })
    }
  }
  return cookies
}

/**
 * @param {ReturnType<import('./config.mjs').loadConfig>} config
 */
export function createClaudePurchaser(config) {
  /**
   * @param {import('./app.mjs').PurchaseJob} job
   * @param {import('./app.mjs').ReportStep} report
   * @returns {Promise<import('./app.mjs').PurchaseResult>}
   */
  return function purchase(job, report) {
    const cookies = claudeCookies(job.cookie)
    return runPurchase(
      job,
      report,
      {
        headless: config.headless,
        bitBrowserUrl: config.bitBrowserUrl,
        bitBrowserProxy: config.bitBrowserProxy,
        origin: CLAUDE_ORIGIN,
        cookies,
        requiredCookie: 'sessionKey',
      },
      (apiPage, page, steps) => buy(apiPage, page, job, cookies, steps)
    )
  }
}

async function buy(apiPage, page, job, cookies, steps) {
  const lastActiveOrg = cookies.find((cookie) => cookie.name === 'lastActiveOrg')?.value ?? ''

  steps.start('subscription', 'Checking the subscription of the Claude account')
  const before = await getClaudePlan(apiPage, lastActiveOrg)
  if (before) {
    throw new PurchaseError(
      'The Claude account already has an active {{plan}} subscription; nothing was charged. ' +
        'If an earlier attempt succeeded, mark the order completed by hand.',
      { plan: before }
    )
  }
  steps.done('The account has no active subscription (current plan: {{plan}})', { plan: 'free' })

  steps.start('checkout', 'Opening the upgrade page for plan {{plan}}', { plan: job.plan })
  const plan = CLAUDE_PLANS[job.plan]
  if (!plan) {
    throw new PurchaseError('Unknown Claude plan {{plan}}.', { plan: job.plan })
  }
  const checkoutUrl = `${CLAUDE_ORIGIN}${plan.path}`
  await page.goto(checkoutUrl, { waitUntil: 'domcontentloaded' })
  await steps.securityCheck(page)
  if (/\/login\b/.test(page.url())) {
    throw new PurchaseError('The Claude cookie has expired or was signed out; ask the buyer for a new cookie.')
  }
  if (plan.tier && !(await clickFirst(page, TIER_ROLES.map((role) => `role=${role}[name=${plan.tier}]`), 20_000))) {
    throw new PurchaseError('The upgrade page did not offer {{tier}} ({{url}}).', { tier: plan.label, url: page.url() })
  }
  // The order is for one month; pick monthly billing when the page offers a choice.
  await clickFirst(page, MONTHLY_SELECTORS, 0)
  steps.done('Upgrade page ready: {{url}}', { url: page.url() })

  steps.start('fill_payment', 'Waiting for the card form on the upgrade page')
  // Some upgrade pages show the plan first and the card form after Continue.
  if (!(await findVisible(page, ['input[name="number"]', '#cardNumber'], 5_000))) {
    await clickFirst(page, CONTINUE_SELECTORS, 0)
  }
  await waitForCardForm(page)
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

  const paid = await waitForPaymentResult(page, steps, {
    site: CLAUDE_HOST,
    checkoutUrl,
    isCheckoutUrl: (url) => url.includes('/upgrade'),
    paidPlan: () => getClaudePlan(apiPage, lastActiveOrg),
  })
  return {
    success: true,
    messageKey: 'Paid with DogPay, account plan is now {{plan}}',
    params: { plan: paid },
    deliveryNote: `Claude ${paid} 订阅已开通`,
  }
}

async function claudeFetch(page, path) {
  const response = await page.evaluate(async (path) => {
    const res = await fetch(path, { credentials: 'include', headers: { accept: 'application/json' } })
    return { status: res.status, text: await res.text() }
  }, path)
  if (response.status === 403 && /<html/i.test(response.text)) {
    throw new PurchaseError('claude.ai blocked the request with a browser check; retry later.')
  }
  if (response.status === 401 || response.status === 403) {
    throw new PurchaseError('The Claude cookie has expired or was signed out; ask the buyer for a new cookie.')
  }
  let data
  try {
    data = JSON.parse(response.text)
  } catch {
    throw new PurchaseError('claude.ai {{path}} returned HTTP {{status}} without JSON.', {
      path,
      status: String(response.status),
    })
  }
  if (response.status >= 400) {
    const detail = typeof data?.error?.message === 'string' ? data.error.message : JSON.stringify(data).slice(0, 300)
    throw new PurchaseError('claude.ai {{path}} returned HTTP {{status}}: {{detail}}', {
      path,
      status: String(response.status),
      detail,
    })
  }
  return data
}

/**
 * The paid plan of the buyer's organization ('Pro', 'Max 5x', 'Max 20x'), or
 * '' while it is on the free plan.
 */
async function getClaudePlan(page, lastActiveOrg) {
  const organizations = await claudeFetch(page, ORGANIZATIONS_PATH)
  if (!Array.isArray(organizations) || organizations.length === 0) {
    throw new PurchaseError('The Claude cookie is not signed in to any organization.')
  }
  const organization =
    organizations.find((org) => org?.uuid === lastActiveOrg) ??
    organizations.find((org) => Array.isArray(org?.capabilities) && org.capabilities.includes('chat')) ??
    organizations[0]
  return claudePlanOf(organization)
}

/**
 * Reads the plan from an organization of GET /api/organizations.
 * @param {{capabilities?: string[], rate_limit_tier?: string}} organization
 */
export function claudePlanOf(organization) {
  const capabilities = Array.isArray(organization?.capabilities) ? organization.capabilities : []
  if (capabilities.includes('claude_max')) {
    return /20x/.test(String(organization.rate_limit_tier ?? '')) ? 'Max 20x' : 'Max 5x'
  }
  if (capabilities.includes('claude_pro')) return 'Pro'
  return ''
}
