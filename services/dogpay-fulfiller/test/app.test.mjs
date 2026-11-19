import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'

import { createApp, readProxy } from '../src/app.mjs'
import { loadConfig } from '../src/config.mjs'
import { openSealed, seal } from '../src/sealed.mjs'
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, sign, verify } from '../src/signature.mjs'

const SECRET = '0123456789abcdef0123456789abcdef'
const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl'
const config = loadConfig({ FULFILLER_SECRET: SECRET })

let server
let baseUrl
let purchases
let purchaseResult
let releasePurchase
let callbacks
let failProgress = false
let app

before(async () => {
  app = createApp({
    config,
    purchase: async (job, report) => {
      purchases.push(job)
      report('checkout', 'running', 'Creating a checkout for plan {{plan}}', { plan: job.plan })
      await new Promise((resolve) => {
        releasePurchase = resolve
      })
      return purchaseResult
    },
    fetchImpl: async (url, init) => {
      callbacks.push({ url, init })
      const payload = JSON.parse(init.body)
      if (failProgress && payload.type === 'progress') throw new Error('connection refused')
      return { ok: true, status: 200 }
    },
    sleep: async () => {},
    log: () => {},
  })
  server = createServer((req, res) => void app.handle(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(() => server.close())

function postJob(payload, secret = SECRET, sealSecret = secret) {
  const body = seal(sealSecret, JSON.stringify(payload))
  const timestamp = Math.floor(Date.now() / 1000)
  return fetch(`${baseUrl}/v1/fulfillments`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [TIMESTAMP_HEADER]: String(timestamp),
      [SIGNATURE_HEADER]: sign(secret, timestamp, body),
    },
    body,
  })
}

const job = (overrides = {}) => ({
  trade_no: 'PO1',
  attempt_id: 42,
  plan: 'chatgptplusplan',
  access_token: TOKEN,
  callback_url: 'http://ez-ai.test/api/product/fulfillment/callback',
  card: { number: '4242424242424242', expiry: '12/30', cvc: '123', holder: 'Test Holder' },
  billing: { country: 'US', currency: 'USD', city: 'Austin', postal_code: '73301' },
  ...overrides,
})

test('job signed with another secret is rejected without purchasing', async () => {
  purchases = []
  const res = await postJob(job(), 'another-secret-another-secret-xx')
  assert.equal(res.status, 401)
  assert.equal(purchases.length, 0)
})

test('job not sealed with the shared secret is rejected without purchasing', async () => {
  purchases = []
  const res = await postJob(job(), SECRET, 'another-secret-another-secret-xx')
  assert.equal(res.status, 400)
  assert.equal(purchases.length, 0)
})

test('job with an incomplete card is refused', async () => {
  purchases = []
  const res = await postJob(job({ card: { number: '1234', expiry: '12/30', cvc: '123', holder: 'A' } }))
  assert.equal(res.status, 422)
  assert.equal(purchases.length, 0)
})

test('a Claude job needs the sessionKey cookie instead of an access token', async () => {
  purchases = []
  callbacks = []
  const claudeJob = (cookie) =>
    job({ trade_no: 'PO3', provider: 'claude', plan: 'claude_max_5x', access_token: '', cookie })
  assert.equal((await postJob(claudeJob('lastActiveOrg=org-1'))).status, 400)
  assert.equal((await postJob(job({ provider: 'gemini' }))).status, 400, 'unknown providers are refused')
  assert.equal(purchases.length, 0)

  purchaseResult = { success: true, messageKey: 'Paid', deliveryNote: '' }
  const cookie = 'sessionKey=sk-ant-sid01-AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-xyzAA; lastActiveOrg=org-1'
  assert.equal((await postJob(claudeJob(cookie))).status, 202)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(purchases.length, 1)
  assert.equal(purchases[0].provider, 'claude')
  assert.equal(purchases[0].cookie, cookie)
  assert.equal(purchases[0].accessToken, '')
  releasePurchase()
  await app.idle()
})

test('ping is signed', async () => {
  const ping = (secret) => {
    const timestamp = Math.floor(Date.now() / 1000)
    return fetch(`${baseUrl}/v1/ping`, {
      headers: { [TIMESTAMP_HEADER]: String(timestamp), [SIGNATURE_HEADER]: sign(secret, timestamp, '') },
    })
  }
  assert.equal((await ping('another-secret-another-secret-xx')).status, 401)
  const res = await ping(SECRET)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
})

test('accepted job reports each step and then posts its signed result', async () => {
  purchases = []
  callbacks = []
  purchaseResult = { success: true, messageKey: 'Paid, plan is now {{plan}}', params: { plan: 'plus' }, deliveryNote: 'activated' }

  assert.equal((await postJob(job())).status, 202)
  assert.equal((await postJob(job())).status, 409, 'a running order is not purchased twice')

  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(purchases, [
    {
      tradeNo: 'PO1',
      provider: 'chatgpt',
      plan: 'chatgptplusplan',
      accessToken: TOKEN,
      cookie: '',
      card: { number: '4242424242424242', expiry: '12/30', cvc: '123', holder: 'Test Holder' },
      billing: { country: 'US', currency: 'USD', line1: '', city: 'Austin', state: '', postalCode: '73301' },
    },
  ])
  releasePurchase()
  await app.idle()

  for (const { url, init } of callbacks) {
    assert.equal(url, 'http://ez-ai.test/api/product/fulfillment/callback')
    assert.ok(verify(SECRET, init.headers[TIMESTAMP_HEADER], init.headers[SIGNATURE_HEADER], init.body, Math.floor(Date.now() / 1000)))
  }
  const payloads = callbacks.map(({ init }) => JSON.parse(init.body))
  assert.deepEqual(
    payloads.map((payload) => [payload.type ?? 'result', payload.step, payload.status ?? '']),
    [
      ['progress', 'queue', 'running'],
      ['progress', 'queue', 'succeeded'],
      ['progress', 'checkout', 'running'],
      ['result', '', ''],
    ],
    'progress arrives in order and the result comes last'
  )
  assert.deepEqual(payloads[2], {
    type: 'progress',
    trade_no: 'PO1',
    attempt_id: 42,
    step: 'checkout',
    status: 'running',
    message: 'Creating a checkout for plan chatgptplusplan',
    message_key: 'Creating a checkout for plan {{plan}}',
    params: { plan: 'chatgptplusplan' },
  })
  assert.deepEqual(payloads[3], {
    trade_no: 'PO1',
    attempt_id: 42,
    success: true,
    step: '',
    card_outcome: 'success',
    message: 'Paid, plan is now plus',
    message_key: 'Paid, plan is now {{plan}}',
    params: { plan: 'plus' },
    delivery_note: 'activated',
  })

  assert.equal((await postJob(job())).status, 202, 'a finished order can be retried')
  releasePurchase()
  await app.idle()
})

test('undelivered progress does not hold back the failed result', async () => {
  purchases = []
  callbacks = []
  failProgress = true
  purchaseResult = {
    success: false,
    step: 'checkout',
    messageKey: 'Checkout rejected the payment: {{reason}}',
    params: { reason: 'declined' },
    cardOutcome: 'declined',
  }
  try {
    assert.equal((await postJob(job({ trade_no: 'PO2' }))).status, 202)
    await new Promise((resolve) => setImmediate(resolve))
    releasePurchase()
    await app.idle()
  } finally {
    failProgress = false
  }

  const result = JSON.parse(callbacks.at(-1).init.body)
  assert.equal(result.type, undefined)
  assert.equal(result.success, false)
  assert.equal(result.step, 'checkout', 'the result names the step that failed')
  assert.equal(result.message, 'Checkout rejected the payment: declined')
  assert.equal(result.card_outcome, 'declined', 'ez-ai disables the card that was declined')
})

test('config requires the shared secret', () => {
  assert.throws(() => loadConfig({ FULFILLER_SECRET: 'short' }), /FULFILLER_SECRET/)
})

test('sealed payload matches the ez-ai scheme', () => {
  // Sealed by ez-ai; TestProductFulfillerPayloadMatchesTheFulfiller opens the same body.
  const body = Buffer.from('{"sealed":"mLmL6sgh1/dWVrXMLNoh8hp0ZVolvIggRGD2zWRkEN4bIiH5H4W0gdpO8crxNg=="}')
  assert.equal(openSealed(SECRET, body), '{"trade_no":"PO1"}')
  assert.throws(() => openSealed('another-secret-another-secret-xx', body))
})

test('signature matches the ez-ai scheme', () => {
  // Same vector as TestVerifyProductFulfillerSignature in ez-ai: HMAC over "<ts>.<body>".
  const body = Buffer.from('{"trade_no":"PO1"}')
  const signature = sign(SECRET, 1800000000, body)
  assert.equal(signature, '4b15c0aca50b26446c081d40c59fed570b2fc8641345102bd26210eb6577b459')
  assert.ok(verify(SECRET, '1800000000', signature, body, 1800000000))
  assert.ok(!verify(SECRET, '1800000000', signature, body, 1800000000 + 6 * 60), 'stale timestamps are rejected')
})

test('a job proxy is read only when its type, host and port are valid', () => {
  assert.deepEqual(readProxy({ type: 'SOCKS5', host: ' us.proxy.test ', port: 1080, username: 'u', password: 'p' }), {
    proxyType: 'socks5',
    host: 'us.proxy.test',
    port: 1080,
    proxyUserName: 'u',
    proxyPassword: 'p',
  })
  assert.equal(readProxy({ type: 'vpn', host: 'h', port: 1080 }), null)
  assert.equal(readProxy({ type: 'http', host: '', port: 1080 }), null)
  assert.equal(readProxy({ type: 'http', host: 'h', port: 70000 }), null, 'a bad port must not fall back to a direct connection')
})
