// HTTP handling and the purchase queue. Purchases run one at a time because
// they all charge the same DogPay card.
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, sign, verify } from './signature.mjs'

const MAX_BODY_BYTES = 64 * 1024
const TRADE_NO_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const CALLBACK_RETRY_DELAYS_MS = [0, 2_000, 10_000, 30_000, 60_000, 300_000]

/**
 * @param {object} deps
 * @param {ReturnType<import('./config.mjs').loadConfig>} deps.config
 * @param {(job: {plan: string, accessToken: string}) => Promise<{success: boolean, message: string, deliveryNote?: string}>} deps.purchase
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

  async function deliver(job, result) {
    const body = JSON.stringify({
      trade_no: job.tradeNo,
      success: result.success,
      message: result.message,
      delivery_note: result.deliveryNote ?? '',
    })
    for (const delay of CALLBACK_RETRY_DELAYS_MS) {
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
        })
        if (response.ok) return true
        log(`callback for ${job.tradeNo} returned HTTP ${response.status}`)
      } catch (error) {
        log(`callback for ${job.tradeNo} failed: ${error.message}`)
      }
    }
    log(`gave up delivering the result of ${job.tradeNo}: success=${result.success} ${result.message}`)
    return false
  }

  async function run(job) {
    active.set(job.tradeNo, 'running')
    log(`purchasing ${job.plan} for ${job.tradeNo}`)
    let result
    try {
      result = await deps.purchase({ plan: job.plan, accessToken: job.accessToken })
    } catch (error) {
      result = { success: false, message: `Fulfiller error: ${error.message}` }
    }
    log(`finished ${job.tradeNo}: success=${result.success} ${result.message}`)
    try {
      await deliver(job, result)
    } finally {
      active.delete(job.tradeNo)
    }
  }

  function enqueue(job) {
    active.set(job.tradeNo, 'queued')
    queue = queue.then(() => run(job)).catch((error) => log(`job ${job.tradeNo} crashed: ${error.message}`))
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
      payload = JSON.parse(body.toString('utf8'))
    } catch {
      reply(400, { error: 'invalid json' })
      return
    }
    const job = {
      tradeNo: String(payload.trade_no ?? ''),
      plan: String(payload.plan ?? ''),
      accessToken: String(payload.access_token ?? ''),
      callbackUrl: String(payload.callback_url ?? ''),
    }
    if (!TRADE_NO_PATTERN.test(job.tradeNo) || !ACCESS_TOKEN_PATTERN.test(job.accessToken) || !/^https?:\/\//.test(job.callbackUrl)) {
      reply(400, { error: 'invalid job' })
      return
    }
    if (!deps.config.allowedPlans.has(job.plan)) {
      reply(422, { error: `plan ${job.plan} is not in ALLOWED_PLANS` })
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
    /** Resolves once every queued purchase and its callback has finished. */
    idle: () => queue,
  }
}
