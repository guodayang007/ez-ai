// HTTP handling and the purchase queue. Purchases run one at a time because
// they all charge the same DogPay card.
import { formatMessage } from './message.mjs'
import { openSealed } from './sealed.mjs'
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, sign, verify } from './signature.mjs'

const MAX_BODY_BYTES = 64 * 1024
const TRADE_NO_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
// A Cookie header with the claude.ai sessionKey, as ez-ai normalizes it.
const CLAUDE_COOKIE_PATTERN = /(?:^|;\s*)sessionKey=sk-ant-sid[A-Za-z0-9]*-[A-Za-z0-9_-]{20,}(?:;|$)/
const PROVIDERS = ['chatgpt', 'claude']
const CARD_NUMBER_PATTERN = /^\d{12,19}$/
const CARD_EXPIRY_PATTERN = /^(0[1-9]|1[0-2])\/\d{2}$/
const CARD_CVC_PATTERN = /^\d{3,4}$/
const CALLBACK_RETRY_DELAYS_MS = [0, 2_000, 10_000, 30_000, 60_000, 300_000]
// Progress only explains the purchase, so it is tried twice and then dropped
// rather than holding up the result.
const PROGRESS_RETRY_DELAYS_MS = [0, 1_000]
const PROGRESS_TIMEOUT_MS = 5_000

/**
 * @typedef {object} PurchaseJob
 * @property {string} tradeNo
 * @property {'chatgpt' | 'claude'} provider
 * @property {string} plan
 * @property {string} accessToken ChatGPT only
 * @property {string} cookie Claude only: a Cookie header with the sessionKey
 * @property {{number: string, expiry: string, cvc: string, holder: string}} card
 * @property {{country: string, currency: string, line1: string, city: string, state: string, postalCode: string}} billing
 * @property {string} browserProxy
 */

/**
 * A step report names one of ez-ai's payment steps (model.ProductFulfillmentSteps),
 * its state (running, succeeded, failed, or info for a detail) and an English
 * message key with {{name}} placeholders filled from params.
 * @typedef {(step: string, status: string, messageKey: string, params?: Record<string, string>) => void} ReportStep
 *
 * @typedef {object} PurchaseResult
 * @property {boolean} success
 * @property {string} messageKey
 * @property {Record<string, string>} [params]
 * @property {string} [step] the step that failed
 * @property {string} [deliveryNote]
 */

/**
 * @param {object} deps
 * @param {ReturnType<import('./config.mjs').loadConfig>} deps.config
 * @param {(job: PurchaseJob, report: ReportStep) => Promise<PurchaseResult>} deps.purchase
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 * @param {(line: string) => void} [deps.log]
 */
export function createApp(deps) {
  const fetchImpl = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const log = deps.log ?? ((line) => console.log(`${new Date().toISOString()} ${line}`))
  /** trade_no -> 'queued' | 'running' */
  const active = new Map()
  let queue = Promise.resolve()
  // Progress callbacks go out one at a time, in the order they happened,
  // without holding up the purchase.
  let progress = Promise.resolve()

  async function post(job, payload, delays, timeoutMs) {
    const body = JSON.stringify(payload)
    for (const delay of delays) {
      await sleep(delay)
      const timestamp = Math.floor(Date.now() / 1000)
      try {
        const response = await fetchImpl(job.callbackUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [TIMESTAMP_HEADER]: String(timestamp),
            [SIGNATURE_HEADER]: sign(deps.config.secret, timestamp, body),
          },
          body,
          signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
        })
        if (response.ok) return true
        log(`callback for ${job.tradeNo} returned HTTP ${response.status}`)
      } catch (error) {
        log(`callback for ${job.tradeNo} failed: ${error.message}`)
      }
    }
    return false
  }

  /** @returns {ReportStep} */
  function reporter(job) {
    return (step, status, messageKey, params = {}) => {
      const message = formatMessage(messageKey, params)
      log(`${job.tradeNo} ${step} ${status}: ${message}`)
      const payload = {
        type: 'progress',
        trade_no: job.tradeNo,
        attempt_id: job.attemptId,
        step,
        status,
        message,
        message_key: messageKey,
        params,
      }
      progress = progress.then(() => post(job, payload, PROGRESS_RETRY_DELAYS_MS, PROGRESS_TIMEOUT_MS)).catch(() => false)
    }
  }

  async function deliver(job, result) {
    // The result goes after every progress event, so it closes the record.
    await progress
    const message = formatMessage(result.messageKey, result.params)
    const delivered = await post(
      job,
      {
        trade_no: job.tradeNo,
        attempt_id: job.attemptId,
        success: result.success,
        step: result.step ?? '',
        message,
        message_key: result.messageKey,
        params: result.params ?? {},
        delivery_note: result.deliveryNote ?? '',
      },
      CALLBACK_RETRY_DELAYS_MS
    )
    if (!delivered) {
      log(`gave up delivering the result of ${job.tradeNo}: success=${result.success} ${message}`)
    }
    return delivered
  }

  async function run(job, queuedAt) {
    active.set(job.tradeNo, 'running')
    const report = reporter(job)
    report('queue', 'succeeded', 'Started after waiting {{seconds}}s in the queue', {
      seconds: String(Math.round((Date.now() - queuedAt) / 1000)),
    })
    log(`purchasing ${job.provider} ${job.plan} for ${job.tradeNo}`)
    /** @type {PurchaseResult} */
    let result
    try {
      result = await deps.purchase(
        {
          tradeNo: job.tradeNo,
          provider: job.provider,
          plan: job.plan,
          accessToken: job.accessToken,
          cookie: job.cookie,
          card: job.card,
          billing: job.billing,
          browserProxy: job.browserProxy,
        },
        report
      )
    } catch (error) {
      result = { success: false, messageKey: 'Fulfiller error: {{error}}', params: { error: error.message } }
    }
    log(`finished ${job.tradeNo}: success=${result.success} ${formatMessage(result.messageKey, result.params)}`)
    try {
      await deliver(job, result)
    } finally {
      active.delete(job.tradeNo)
    }
  }

  function enqueue(job) {
    const ahead = active.size
    active.set(job.tradeNo, 'queued')
    const report = reporter(job)
    if (ahead > 0) {
      report('queue', 'running', 'Waiting for {{count}} earlier purchases to finish', { count: String(ahead) })
    } else {
      report('queue', 'running', 'Queued, starting now')
    }
    const queuedAt = Date.now()
    queue = queue.then(() => run(job, queuedAt)).catch((error) => log(`job ${job.tradeNo} crashed: ${error.message}`))
    return queue
  }

  async function handle(req, res) {
    const reply = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (req.method === 'GET' && url.pathname === '/healthz') {
      reply(200, { ok: true, active: active.size })
      return
    }
    if (req.method === 'GET' && url.pathname === '/v1/ping') {
      // Signed like a job, over an empty body. ez-ai uses it to check that
      // the service runs and shares the secret.
      const nowSeconds = Math.floor(Date.now() / 1000)
      if (!verify(deps.config.secret, req.headers[TIMESTAMP_HEADER], req.headers[SIGNATURE_HEADER], Buffer.alloc(0), nowSeconds)) {
        reply(401, { error: 'bad signature' })
        return
      }
      reply(200, { ok: true })
      return
    }
    if (req.method !== 'POST' || url.pathname !== '/v1/fulfillments') {
      reply(404, { error: 'not found' })
      return
    }

    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reply(413, { error: 'body too large' })
        return
      }
      chunks.push(chunk)
    }
    const body = Buffer.concat(chunks)
    const nowSeconds = Math.floor(Date.now() / 1000)
    if (!verify(deps.config.secret, req.headers[TIMESTAMP_HEADER], req.headers[SIGNATURE_HEADER], body, nowSeconds)) {
      reply(401, { error: 'bad signature' })
      return
    }

    let payload
    try {
      payload = JSON.parse(openSealed(deps.config.secret, body))
    } catch {
      reply(400, { error: 'job is not sealed with the shared secret' })
      return
    }
    const card = payload.card ?? {}
    const billing = payload.billing ?? {}
    const job = {
      tradeNo: String(payload.trade_no ?? ''),
      // Older ez-ai versions send no attempt id; 0 makes ez-ai match the
      // result to the order's running attempt.
      attemptId: Number.isSafeInteger(payload.attempt_id) && payload.attempt_id > 0 ? payload.attempt_id : 0,
      // Older ez-ai versions send no provider; they only sell ChatGPT.
      provider: String(payload.provider || 'chatgpt'),
      plan: String(payload.plan ?? ''),
      accessToken: String(payload.access_token ?? ''),
      cookie: String(payload.cookie ?? ''),
      callbackUrl: String(payload.callback_url ?? ''),
      card: {
        number: String(card.number ?? ''),
        expiry: String(card.expiry ?? ''),
        cvc: String(card.cvc ?? ''),
        holder: String(card.holder ?? ''),
      },
      billing: {
        country: String(billing.country || 'US'),
        currency: String(billing.currency || 'USD'),
        line1: String(billing.line1 ?? ''),
        city: String(billing.city ?? ''),
        state: String(billing.state ?? ''),
        postalCode: String(billing.postal_code ?? ''),
      },
      browserProxy: String(payload.browser_proxy ?? ''),
    }
    const signedIn =
      job.provider === 'claude' ? CLAUDE_COOKIE_PATTERN.test(job.cookie) : ACCESS_TOKEN_PATTERN.test(job.accessToken)
    if (
      !TRADE_NO_PATTERN.test(job.tradeNo) ||
      !PROVIDERS.includes(job.provider) ||
      !job.plan ||
      !signedIn ||
      !/^https?:\/\//.test(job.callbackUrl)
    ) {
      reply(400, { error: 'invalid job' })
      return
    }
    if (
      !CARD_NUMBER_PATTERN.test(job.card.number) ||
      !CARD_EXPIRY_PATTERN.test(job.card.expiry) ||
      !CARD_CVC_PATTERN.test(job.card.cvc) ||
      !job.card.holder
    ) {
      reply(422, { error: 'the card in ez-ai settings is incomplete' })
      return
    }
    if (active.has(job.tradeNo)) {
      reply(409, { error: `order is already ${active.get(job.tradeNo)}` })
      return
    }
    void enqueue(job)
    reply(202, { accepted: true })
  }

  return {
    handle,
    /** Resolves once every queued purchase and its callbacks have finished. */
    idle: () => queue.then(() => progress),
  }
}
