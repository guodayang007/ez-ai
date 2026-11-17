import assert from 'node:assert/strict'
import { test } from 'node:test'

import { chromium } from 'playwright'

import { bitBrowserProxy, createBitBrowser } from '../src/bitbrowser.mjs'
import { isSecurityCheck } from '../src/browser.mjs'

test('the proxy URL saved in ez-ai becomes BitBrowser window proxy fields', () => {
  assert.deepEqual(bitBrowserProxy(''), { proxyMethod: 2, proxyType: 'noproxy' })
  assert.deepEqual(bitBrowserProxy('http://us%40er:p%3Ass@proxy.example:8080'), {
    proxyMethod: 2,
    proxyType: 'http',
    host: 'proxy.example',
    port: 8080,
    proxyUserName: 'us@er',
    proxyPassword: 'p:ss',
  })
  assert.deepEqual(bitBrowserProxy('socks5://user:pass@10.0.0.1:1080'), {
    proxyMethod: 2,
    proxyType: 'socks5',
    host: '10.0.0.1',
    port: 1080,
    proxyUserName: 'user',
    proxyPassword: 'pass',
  })
  assert.equal(bitBrowserProxy('https://proxy.example').port, 443, 'the default port is filled in')
})

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

test('a purchase window is created behind the proxy, opened, then closed and deleted', async () => {
  const { calls, bitBrowser } = fakeBitBrowser({
    '/browser/add': { success: true, data: { id: 'w1' } },
    '/browser/open': { success: true, data: { ws: 'ws://127.0.0.1:53325/devtools/browser/x', http: '127.0.0.1:53325' } },
  })
  const window = await bitBrowser.openWindow({ name: 'ez-ai PO1', proxyUrl: 'http://u:p@proxy.example:8080', headless: true })
  assert.deepEqual(window, { id: 'w1', ws: 'ws://127.0.0.1:53325/devtools/browser/x' })
  const add = calls[0].body
  assert.equal(add.proxyType, 'http')
  assert.equal(add.proxyUserName, 'u')
  assert.equal(add.syncCookies, false, "the buyer's cookies are not synced to BitBrowser's cloud")
  assert.equal(add.url, '', 'headless mode needs a window without start pages')
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
    bitBrowser.openWindow({ name: 'ez-ai PO2', proxyUrl: '', headless: false }),
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
