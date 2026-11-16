// HMAC-SHA256 over "<unix seconds>.<raw body>", shared with ez-ai
// (service/product_fulfiller.go). Both directions use the same scheme.
import { createHmac, timingSafeEqual } from 'node:crypto'

export const TIMESTAMP_HEADER = 'x-fulfiller-timestamp'
export const SIGNATURE_HEADER = 'x-fulfiller-signature'
const MAX_CLOCK_SKEW_SECONDS = 5 * 60

export function sign(secret, timestamp, body) {
  return createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(body)
    .digest('hex')
}

export function verify(secret, timestampHeader, signatureHeader, body, nowSeconds) {
  if (!secret || !signatureHeader || !/^\d+$/.test(timestampHeader ?? '')) {
    return false
  }
  const timestamp = Number(timestampHeader)
  if (Math.abs(nowSeconds - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
    return false
  }
  const expected = Buffer.from(sign(secret, timestamp, body), 'utf8')
  const actual = Buffer.from(signatureHeader.toLowerCase(), 'utf8')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
