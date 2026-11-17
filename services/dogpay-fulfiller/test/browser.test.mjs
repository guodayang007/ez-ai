import assert from 'node:assert/strict'
import { test } from 'node:test'

import { chromium } from 'playwright'

import { browserProxyOptions, isSecurityCheck } from '../src/browser.mjs'

test('the browser proxy passes its username and password apart from the server', () => {
  assert.equal(browserProxyOptions(''), undefined)
  assert.deepEqual(browserProxyOptions('http://proxy.example:8080'), { server: 'http://proxy.example:8080' })
  assert.deepEqual(browserProxyOptions('http://us%40er:p%3Ass@proxy.example:8080'), {
    server: 'http://proxy.example:8080',
    username: 'us@er',
    password: 'p:ss',
  })
  assert.deepEqual(browserProxyOptions('socks5://proxy.example:1080'), { server: 'socks5://proxy.example:1080' })
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
