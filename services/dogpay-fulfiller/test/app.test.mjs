import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'

import { createApp } from '../src/app.mjs'
import { loadConfig } from '../src/config.mjs'
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, sign, verify } from '../src/signature.mjs'

const SECRET = '0123456789abcdef0123456789abcdef'
const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl'
const config = loadConfig({
  FULFILLER_SECRET: SECRET,
  ALLOWED_PLANS: 'chatgptplusplan, chatgptproplan',
  DOGPAY_CARD_NUMBER: '4242 4242 4242 4242',
  DOGPAY_CARD_EXPIRY: '12/30',
  DOGPAY_CARD_CVC: '123',
  DOGPAY_CARDHOLDER_NAME: 'Test Holder',
})

let server
let baseUrl
let purchases
let purchaseResult
let releasePurchase
let callbacks
let app

before(async () => {
  app = createApp({
    config,
    purchase: async (job) => {
      purchases.push(job)
      await new Promise((resolve) => {
        releasePurchase = resolve
      })
      return purchaseResult
    },
    fetchImpl: async (url, init) => {
      callbacks.push({ url, init })
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

function postJob(payload, secret = SECRET) {
  const body = JSON.stringify(payload)
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
  plan: 'chatgptplusplan',
  access_token: TOKEN,
  callback_url: 'http://ez-ai.test/api/product/fulfillment/callback',
  ...overrides,
})

test('job signed with another secret is rejected without purchasing', async () => {
  purchases = []
  const res = await postJob(job(), 'another-secret-another-secret-xx')
  assert.equal(res.status, 401)
  assert.equal(purchases.length, 0)
})

test('plan outside ALLOWED_PLANS is refused', async () => {
  purchases = []
  const res = await postJob(job({ plan: 'chatgptteamplan' }))
  assert.equal(res.status, 422)
  assert.equal(purchases.length, 0)
})

test('accepted job is purchased once and its signed result is posted back', async () => {
  purchases = []
  callbacks = []
  purchaseResult = { success: true, message: 'ok', deliveryNote: 'activated' }

  assert.equal((await postJob(job())).status, 202)
  assert.equal((await postJob(job())).status, 409, 'a running order is not purchased twice')

  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(purchases, [{ plan: 'chatgptplusplan', accessToken: TOKEN }])
  releasePurchase()
  await app.idle()

  assert.equal(callbacks.length, 1)
  const { url, init } = callbacks[0]
  assert.equal(url, 'http://ez-ai.test/api/product/fulfillment/callback')
  assert.ok(verify(SECRET, init.headers[TIMESTAMP_HEADER], init.headers[SIGNATURE_HEADER], init.body, Math.floor(Date.now() / 1000)))
  assert.deepEqual(JSON.parse(init.body), { trade_no: 'PO1', success: true, message: 'ok', delivery_note: 'activated' })

  assert.equal((await postJob(job())).status, 202, 'a finished order can be retried')
  releasePurchase()
  await app.idle()
})

test('config refuses a malformed card', () => {
  assert.throws(
    () => loadConfig({ FULFILLER_SECRET: SECRET, ALLOWED_PLANS: 'x', DOGPAY_CARD_NUMBER: '1234', DOGPAY_CARD_EXPIRY: '13/30', DOGPAY_CARD_CVC: '1', DOGPAY_CARDHOLDER_NAME: 'A' }),
    /DOGPAY_CARD_NUMBER[\s\S]*DOGPAY_CARD_EXPIRY[\s\S]*DOGPAY_CARD_CVC/
  )
})

test('signature matches the ez-ai scheme', () => {
  // Same vector as TestVerifyProductFulfillerSignature in ez-ai: HMAC over "<ts>.<body>".
  const body = Buffer.from('{"trade_no":"PO1"}')
  const signature = sign(SECRET, 1800000000, body)
  assert.equal(signature, '4b15c0aca50b26446c081d40c59fed570b2fc8641345102bd26210eb6577b459')
  assert.ok(verify(SECRET, '1800000000', signature, body, 1800000000))
  assert.ok(!verify(SECRET, '1800000000', signature, body, 1800000000 + 6 * 60), 'stale timestamps are rejected')
})
