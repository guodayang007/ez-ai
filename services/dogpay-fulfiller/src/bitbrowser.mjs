// Client for the BitBrowser (比特浏览器) Local API, which runs inside the
// signed-in BitBrowser desktop app. Every purchase gets a fresh window that
// is deleted afterwards, so no buyer's session stays behind.
//
// API reference: https://doc2.bitbrowser.cn/jiekou/liu-lan-qi-jie-kou.html
// Every call is a POST with a JSON body; the reply is
// { success: true, data } or { success: false, msg }.
import { PurchaseError } from './message.mjs'

const REQUEST_TIMEOUT_MS = 30_000
// Opening may wait in BitBrowser's open queue.
const OPEN_TIMEOUT_MS = 120_000
// The docs ask to wait 5 seconds after closing, until the browser process has
// exited, before deleting or reopening the window.
const CLOSE_SETTLE_MS = 5_000
// Windows connect directly, from this machine's own network, unless a proxy is configured.
const DIRECT_CONNECTION = { proxyMethod: 2, proxyType: 'noproxy' }

/**
 * @param {string} baseUrl such as http://127.0.0.1:54345
 * @param {object} [deps]
 * @param {{proxyType: string, host: string, port: number, proxyUserName: string, proxyPassword: string} | null} [deps.proxy]
 *   the proxy every purchase window uses; null connects directly
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 */
export function createBitBrowser(baseUrl, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const connection = deps.proxy ? { proxyMethod: 2, ...deps.proxy } : DIRECT_CONNECTION

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
     * Asks BitBrowser where the configured proxy exits, before any window is
     * opened. Without a proxy the windows use this machine's network, so this
     * returns null.
     * @returns {Promise<{ip: string, countryCode: string} | null>}
     */
    async checkProxy() {
      if (!deps.proxy) return null
      const reply = await call('/checkagent', {
        ...deps.proxy,
        ipCheckService: 'ip123in',
        checkExists: 0,
      })
      // The docs nest the result one level deeper than the other replies.
      const info = reply?.data ?? reply
      if (info?.success === false) {
        throw new PurchaseError('BitBrowser {{path}} failed: {{error}}', {
          path: '/checkagent',
          error: String(info.msg ?? 'proxy check failed').slice(0, 300),
        })
      }
      return { ip: String(info?.ip ?? ''), countryCode: String(info?.countryCode ?? '').toUpperCase() }
    },

    /**
     * Creates a window with a random Windows fingerprint and opens it. The
     * window is deleted again when it cannot be opened.
     * @param {object} options
     * @param {string} options.name
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
        ...connection,
        browserFingerPrint: {
          ostype: 'PC',
          os: 'Win32',
          osVersion: '11,10',
          // Time zone and location follow the connection's IP, and WebRTC
          // hides this machine's local address, so the site sees one place.
          isIpCreateTimeZone: true,
          isIpCreatePosition: true,
          webRTC: '0',
          // Pages in English, so the selectors and messages match wherever the browser exits.
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
