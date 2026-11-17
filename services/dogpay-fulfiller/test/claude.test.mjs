import assert from 'node:assert/strict'
import { test } from 'node:test'

import { chromium } from 'playwright'

import { addCookies } from '../src/browser.mjs'
import { claudeCookies, claudePlanOf } from '../src/claude.mjs'

// The cookie names a signed-in claude.ai browser sends, values shortened.
const HEADER =
  'ajs_anonymous_id=a1; anthropic-device-id=d1; sessionKey=sk-ant-sid01-abc; sessionKeyLC=1; ' +
  'lastActiveOrg=org-1; __Host-chat-host=claude; sessionKeyV3=sk-ant-sid02-abc; ' +
  '__Host-sessionBinding=b1; __Host-sessionBindingGrace=b2; routingHint=r1; =skip; empty='

test('the saved Cookie header becomes claude.ai browser cookies', () => {
  const cookies = claudeCookies(HEADER)
  const byName = Object.fromEntries(cookies.map((cookie) => [cookie.name, cookie]))
  assert.equal(cookies.length, 10)
  assert.equal(byName.sessionKey.domain, '.claude.ai')
  assert.equal(byName.sessionKey.httpOnly, true)
  assert.equal(byName.lastActiveOrg.httpOnly, false)
  assert.equal(byName['__Host-sessionBinding'].domain, undefined, '__Host- cookies must not carry a domain')
  assert.equal(byName['__Host-sessionBinding'].url, 'https://claude.ai/')
})

test('Chromium accepts every cookie of a real claude.ai Cookie header', async () => {
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    assert.deepEqual(await addCookies(context, claudeCookies(HEADER), 'sessionKey'), [])
    const stored = await context.cookies('https://claude.ai/')
    assert.equal(stored.length, 10)
    assert.equal(stored.find((cookie) => cookie.name === '__Host-sessionBinding')?.domain, 'claude.ai')
  } finally {
    await browser.close()
  }
})

test('a cookie the browser refuses is left out, unless it is the one that signs in', async () => {
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    // A __Host- cookie with a domain: what made Chromium refuse the whole batch.
    const broken = { name: '__Host-broken', value: 'x', domain: '.claude.ai', path: '/', secure: true }
    const cookies = [...claudeCookies('sessionKey=sk-ant-sid01-abc'), broken]
    assert.deepEqual(await addCookies(context, cookies, 'sessionKey'), ['__Host-broken'])
    assert.equal((await context.cookies('https://claude.ai/')).length, 1)
    await assert.rejects(addCookies(await browser.newContext(), cookies, '__Host-broken'), /refused the __Host-broken cookie/)
  } finally {
    await browser.close()
  }
})

test('the plan is read from the organization capabilities and rate limit tier', () => {
  assert.equal(claudePlanOf({ capabilities: ['chat'], rate_limit_tier: 'default_claude_ai' }), '')
  assert.equal(claudePlanOf({ capabilities: ['chat', 'claude_pro'] }), 'Pro')
  assert.equal(claudePlanOf({ capabilities: ['chat', 'claude_max'], rate_limit_tier: 'default_claude_max_5x' }), 'Max 5x')
  assert.equal(claudePlanOf({ capabilities: ['chat', 'claude_max'], rate_limit_tier: 'default_claude_max_20x' }), 'Max 20x')
  assert.equal(claudePlanOf(undefined), '')
})
