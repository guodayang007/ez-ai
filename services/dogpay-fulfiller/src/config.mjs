// Reads the fulfiller's own settings from the environment. The plans, the
// DogPay card and the billing address are not here: ez-ai stores them
// encrypted and sends them, encrypted with the shared secret, with each job.

export function loadConfig(env) {
  const problems = []
  const read = (key, fallback = '') => (env[key] ?? fallback).trim()

  const secret = read('FULFILLER_SECRET')
  if (secret.length < 32) {
    problems.push('FULFILLER_SECRET must be at least 32 characters and equal the shared secret in ez-ai')
  }

  const port = Number.parseInt(read('PORT', '3100'), 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    problems.push('PORT must be a valid port number')
  }

  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`)
  }

  return {
    host: read('HOST', '127.0.0.1'),
    port,
    secret,
    headless: read('HEADLESS', 'true').toLowerCase() !== 'false',
  }
}
