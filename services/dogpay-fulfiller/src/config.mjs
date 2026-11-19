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

  const bitBrowserUrl = read('BITBROWSER_URL', 'http://127.0.0.1:54345')
  if (!URL.canParse(bitBrowserUrl) || !/^https?:$/.test(new URL(bitBrowserUrl).protocol)) {
    problems.push('BITBROWSER_URL must be the BitBrowser Local API address, such as http://127.0.0.1:54345')
  }

  // Optional proxy for the purchase windows. Its exit must be in the billing
  // country, so the browser can check out from there.
  const proxyType = read('BITBROWSER_PROXY_TYPE').toLowerCase()
  let bitBrowserProxy = null
  if (proxyType) {
    const proxyPort = Number.parseInt(read('BITBROWSER_PROXY_PORT'), 10)
    if (!BITBROWSER_PROXY_TYPES.includes(proxyType)) {
      problems.push(`BITBROWSER_PROXY_TYPE must be one of ${BITBROWSER_PROXY_TYPES.join(', ')}`)
    }
    if (!read('BITBROWSER_PROXY_HOST')) {
      problems.push('BITBROWSER_PROXY_HOST is required when BITBROWSER_PROXY_TYPE is set')
    }
    if (!Number.isInteger(proxyPort) || proxyPort <= 0 || proxyPort > 65535) {
      problems.push('BITBROWSER_PROXY_PORT must be a valid port number when BITBROWSER_PROXY_TYPE is set')
    }
    bitBrowserProxy = {
      proxyType,
      host: read('BITBROWSER_PROXY_HOST'),
      port: proxyPort,
      proxyUserName: read('BITBROWSER_PROXY_USERNAME'),
      proxyPassword: read('BITBROWSER_PROXY_PASSWORD'),
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`)
  }

  return {
    host: read('HOST', '127.0.0.1'),
    port,
    secret,
    headless: read('HEADLESS', 'true').toLowerCase() !== 'false',
    bitBrowserUrl,
    bitBrowserProxy,
  }
}

// Proxy types BitBrowser accepts for a window (its "proxyType" field).
export const BITBROWSER_PROXY_TYPES = ['http', 'https', 'socks5', 'ssh']
