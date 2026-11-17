import assert from 'node:assert/strict'
import { test } from 'node:test'

import { browserProxyOptions } from '../src/chatgpt.mjs'

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
