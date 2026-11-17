// Client for the BitBrowser (比特浏览器) Local API, which runs inside the
// signed-in BitBrowser desktop app. Every purchase gets a fresh window that
// is deleted afterwards, so no buyer's session stays behind.
//
// API reference: https://doc2.bitbrowser.cn/jiekou/liu-lan-qi-jie-kou.html
// Every call is a POST with a JSON body; the reply is
// { success: true, data } or { success: false, msg }.
import { PurchaseError } from './message.mjs'

const REQUEST_TIMEOUT_MS = 30_000
// Opening checks the proxy and may wait in BitBrowser's open queue.
const OPEN_TIMEOUT_MS = 120_000
// The docs ask to wait 5 seconds after closing, until the browser process has
// exited, before deleting or reopening the window.
const CLOSE_SETTLE_MS = 5_000
const DEFAULT_PORTS = { 'http:': 80, 'https:': 443, 'socks5:': 1080 }

/**
 * The proxy fields of a BitBrowser window for the proxy URL saved in ez-ai.
 * BitBrowser signs in to HTTP, HTTPS and SOCKS5 proxies alike.
 * @param {string} proxyUrl such as http://user:pass@host:port, or '' for none
 */
export function bitBrowserProxy(proxyUrl) {
  if (!proxyUrl) return { proxyMethod: 2, proxyType: 'noproxy' }
  const url = new URL(proxyUrl)
  return {
    proxyMethod: 2,
    proxyType: url.protocol.slice(0, -1),
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: url.port ? Number(url.port) : DEFAULT_PORTS[url.protocol],
    proxyUserName: decodeURIComponent(url.username),
    proxyPassword: decodeURIComponent(url.password),
  }
}

/**
 * @param {string} baseUrl such as http://127.0.0.1:54345
 * @param {object} [deps]
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 */
export function createBitBrowser(baseUrl, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))

  async function call(path, body = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    let reply
    try {
      const response = await fetchImpl(new URL(path, baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
      reply = await response.json()
    } catch (error) {
      throw new PurchaseError(
        'Could not reach the BitBrowser Local API at {{url}}: {{error}}. ' +
          'Start BitBrowser and sign in on the fulfiller machine, and check BITBROWSER_URL in the fulfiller .env.',
        { url: baseUrl, error: error.cause?.message ?? error.message }
      )
    }
    if (reply?.success !== true) {
      throw new PurchaseError('BitBrowser {{path}} failed: {{error}}', {
        path,
        error: String(reply?.msg ?? JSON.stringify(reply)).slice(0, 300),
      })
    }
    return reply.data
  }

  return {
    /** Resolves when the Local API answers. */
    health: () => call('/health'),

    /**
     * Creates a window with a random Windows fingerprint behind the proxy and
     * opens it. The window is deleted again when it cannot be opened.
     * @param {object} options
     * @param {string} options.name
     * @param {string} options.proxyUrl
     * @param {boolean} options.headless
     * @returns {Promise<{id: string, ws: string}>} ws is the CDP endpoint of the opened browser
     */
    async openWindow(options) {
      const created = await call('/browser/add', {
        name: options.name,
        remark: 'Created by dogpay-fulfiller; deleted after the purchase',
        // No start pages: headless mode opens at most one page.
        url: '',
        workbench: 'disable',
        // Keep the buyer's session out of BitBrowser's cloud sync.
        syncTabs: false,
        syncCookies: false,
        ...bitBrowserProxy(options.proxyUrl),
        browserFingerPrint: {
          ostype: 'PC',
          os: 'Win32',
          osVersion: '11,10',
          // Pages in English, so the selectors and messages match wherever the proxy exits.
          isIpCreateLanguage: false,
          languages: 'en-US',
          isIpCreateDisplayLanguage: false,
          displayLanguages: 'en-US',
        },
      })
      const id = String(created?.id ?? '')
      if (!id) {
        throw new PurchaseError('BitBrowser {{path}} failed: {{error}}', { path: '/browser/add', error: 'no window id returned' })
      }
      try {
        const opened = await call(
          '/browser/open',
          { id, args: options.headless ? ['--headless'] : [], queue: true, ignoreDefaultUrls: true },
          OPEN_TIMEOUT_MS
        )
        if (!opened?.ws) {
          throw new PurchaseError('BitBrowser {{path}} failed: {{error}}', { path: '/browser/open', error: 'no ws address returned' })
        }
        return { id, ws: opened.ws }
      } catch (error) {
        await call('/browser/delete', { id }).catch(() => {})
        throw error
      }
    },

    /** Closes the window and deletes it for good, cookies and cache included. */
    async discardWindow(id) {
      await call('/browser/close', { id }).catch(() => {})
      await sleep(CLOSE_SETTLE_MS)
      await call('/browser/delete', { id })
    },
  }
}
