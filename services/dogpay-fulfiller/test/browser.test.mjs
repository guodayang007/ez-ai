import assert from 'node:assert/strict'
import { test } from 'node:test'

import { chromium } from 'playwright'

import { createBitBrowser } from '../src/bitbrowser.mjs'
import { isSecurityCheck } from '../src/browser.mjs'

/** A BitBrowser Local API that records the calls and answers from `replies`. */
function fakeBitBrowser(replies) {
  const calls = []
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname
    calls.push({ path, body: JSON.parse(init.body) })
    const reply = replies[path] ?? { success: true }
    return { json: async () => reply }
  }
  return { calls, bitBrowser: createBitBrowser('http://127.0.0.1:54345', { fetchImpl, sleep: async () => {} }) }
}

test('a purchase window is created without a proxy, opened, then closed and deleted', async () => {
  const { calls, bitBrowser } = fakeBitBrowser({
    '/browser/add': { success: true, data: { id: 'w1' } },
    '/browser/open': { success: true, data: { ws: 'ws://127.0.0.1:53325/devtools/browser/x', http: '127.0.0.1:53325' } },
  })
  const window = await bitBrowser.openWindow({ name: 'ez-ai PO1', headless: true })
  assert.deepEqual(window, { id: 'w1', ws: 'ws://127.0.0.1:53325/devtools/browser/x' })
  const add = calls[0].body
  assert.equal(add.proxyType, 'noproxy')
  assert.equal(add.syncCookies, false, "the buyer's cookies are not synced to BitBrowser's cloud")
  assert.equal(add.url, '', 'headless mode needs a window without start pages')
  assert.equal(add.browserFingerPrint.isIpCreateTimeZone, true, 'the time zone follows the connection IP')
  assert.equal(add.browserFingerPrint.webRTC, '0', "WebRTC hides this machine's local address")
  assert.deepEqual(calls[1], {
    path: '/browser/open',
    body: { id: 'w1', args: ['--headless'], queue: true, ignoreDefaultUrls: true },
  })

  await bitBrowser.discardWindow('w1')
  assert.deepEqual(
    calls.slice(2).map((call) => [call.path, call.body.id]),
    [
      ['/browser/close', 'w1'],
      ['/browser/delete', 'w1'],
    ]
  )
})

test('a window BitBrowser cannot open is deleted and the reason is reported', async () => {
  const { calls, bitBrowser } = fakeBitBrowser({
    '/browser/add': { success: true, data: { id: 'w2' } },
    '/browser/open': { success: false, msg: '代理检测失败' },
  })
  await assert.rejects(
    bitBrowser.openWindow({ name: 'ez-ai PO2', headless: false }),
    (error) => error.key === 'BitBrowser {{path}} failed: {{error}}' && error.params.error === '代理检测失败'
  )
  assert.deepEqual(calls.map((call) => call.path), ['/browser/add', '/browser/open', '/browser/delete'])
})

test('an unreachable BitBrowser is reported with the Local API address', async () => {
  const bitBrowser = createBitBrowser('http://127.0.0.1:1', {
    fetchImpl: async () => {
      throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:1') })
    },
  })
  await assert.rejects(bitBrowser.health(), (error) => {
    assert.equal(error.params.url, 'http://127.0.0.1:1')
    assert.equal(error.params.error, 'connect ECONNREFUSED 127.0.0.1:1')
    return true
  })
})

test('a Cloudflare security check page is told apart from the site', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(
      '<title>Just a moment...</title><h1>claude.ai</h1><p>Performing security verification</p>' +
        '<p>This website uses a security service to protect against malicious bots.</p>'
    )
    assert.equal(await isSecurityCheck(page), true)
    await page.setContent('<title>Claude</title><p>Performing security verification</p>')
    assert.equal(await isSecurityCheck(page), true, 'the text alone is enough')
    await page.setContent('<title>Upgrade to Claude Pro</title><form><input name="number"></form>')
    assert.equal(await isSecurityCheck(page), false)
  } finally {
    await browser.close()
  }
})

test('a configured proxy is used by the purchase window and checked before it opens', async () => {
  const proxy = { proxyType: 'socks5', host: 'us.proxy.test', port: 1080, proxyUserName: 'u', proxyPassword: 'p' }
  const calls = []
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname
    const body = JSON.parse(init.body)
    calls.push({ path, body })
    const replies = {
      '/checkagent': { success: true, data: { success: true, data: { ip: '203.0.113.7', countryCode: 'us' } } },
      '/browser/add': { success: true, data: { id: 'w3' } },
      '/browser/open': { success: true, data: { ws: 'ws://127.0.0.1:1/devtools/browser/y' } },
    }
    return { json: async () => replies[path] ?? { success: true } }
  }
  const bitBrowser = createBitBrowser('http://127.0.0.1:54345', { proxy, fetchImpl, sleep: async () => {} })

  assert.deepEqual(await bitBrowser.checkProxy(), { ip: '203.0.113.7', countryCode: 'US' })
  await bitBrowser.openWindow({ name: 'ez-ai PO3', headless: true })

  assert.equal(calls[0].path, '/checkagent')
  assert.equal(calls[0].body.host, 'us.proxy.test')
  assert.equal(calls[0].body.checkExists, 0)
  const add = calls[1].body
  assert.equal(add.proxyMethod, 2)
  assert.equal(add.proxyType, 'socks5')
  assert.equal(add.host, 'us.proxy.test')
  assert.equal(add.port, 1080)
  assert.equal(add.proxyUserName, 'u')
  assert.equal(add.proxyPassword, 'p')
})

test('without a proxy no proxy check is made and the window connects directly', async () => {
  const { calls, bitBrowser } = fakeBitBrowser({
    '/browser/add': { success: true, data: { id: 'w4' } },
    '/browser/open': { success: true, data: { ws: 'ws://127.0.0.1:2/devtools/browser/z' } },
  })
  assert.equal(await bitBrowser.checkProxy(), null)
  await bitBrowser.openWindow({ name: 'ez-ai PO4', headless: true })
  assert.equal(calls.some((call) => call.path === '/checkagent'), false)
  assert.equal(calls[0].body.proxyType, 'noproxy')
})

test('a BitBrowser proxy check that reports failure is surfaced', async () => {
  const bitBrowser = createBitBrowser('http://127.0.0.1:54345', {
    proxy: { proxyType: 'http', host: 'h', port: 8080, proxyUserName: '', proxyPassword: '' },
    fetchImpl: async () => ({ json: async () => ({ success: true, data: { success: false, msg: '代理连接失败' } }) }),
  })
  await assert.rejects(bitBrowser.checkProxy(), (error) => error.params.error === '代理连接失败')
})

test('the proxy settings are validated and read from the environment', async () => {
  const { loadConfig } = await import('../src/config.mjs')
  const base = { FULFILLER_SECRET: 'x'.repeat(32) }
  assert.equal(loadConfig(base).bitBrowserProxy, null)
  assert.deepEqual(
    loadConfig({ ...base, BITBROWSER_PROXY_TYPE: 'SOCKS5', BITBROWSER_PROXY_HOST: 'h', BITBROWSER_PROXY_PORT: '1080', BITBROWSER_PROXY_USERNAME: 'u', BITBROWSER_PROXY_PASSWORD: 'p' }).bitBrowserProxy,
    { proxyType: 'socks5', host: 'h', port: 1080, proxyUserName: 'u', proxyPassword: 'p' }
  )
  assert.throws(() => loadConfig({ ...base, BITBROWSER_PROXY_TYPE: 'vpn', BITBROWSER_PROXY_HOST: 'h', BITBROWSER_PROXY_PORT: '1080' }), /BITBROWSER_PROXY_TYPE/)
  assert.throws(() => loadConfig({ ...base, BITBROWSER_PROXY_TYPE: 'http', BITBROWSER_PROXY_PORT: '1080' }), /BITBROWSER_PROXY_HOST/)
})
