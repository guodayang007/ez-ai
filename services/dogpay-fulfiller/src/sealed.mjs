// Jobs from ez-ai are encrypted with AES-256-GCM under a key derived from the
// shared secret (service.SealProductFulfillerPayload in ez-ai), so the card
// never crosses the network in plain text. The body is
// {"sealed": base64(nonce || ciphertext || tag)}.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const PURPOSE = 'ez-ai-fulfiller-payload-v1'
const NONCE_BYTES = 12
const TAG_BYTES = 16

function deriveKey(secret) {
  return createHash('sha256').update(`${PURPOSE}:${secret}`).digest()
}

/** Returns the decrypted payload, or throws when it was not sealed with secret. */
export function openSealed(secret, body) {
  const envelope = JSON.parse(body.toString('utf8'))
  const sealed = Buffer.from(String(envelope.sealed ?? ''), 'base64')
  if (sealed.length < NONCE_BYTES + TAG_BYTES) {
    throw new Error('sealed payload is too short')
  }
  const nonce = sealed.subarray(0, NONCE_BYTES)
  const tag = sealed.subarray(sealed.length - TAG_BYTES)
  const ciphertext = sealed.subarray(NONCE_BYTES, sealed.length - TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

/** Seals a payload the way ez-ai does; used by the tests. */
export function seal(secret, plaintext) {
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return JSON.stringify({ sealed: Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString('base64') })
}
