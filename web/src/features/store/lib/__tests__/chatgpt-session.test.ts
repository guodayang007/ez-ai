/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { describe, expect, test } from 'vitest'

import {
  CHATGPT_SESSION_ERRORS,
  parseChatGPTSession,
} from '../chatgpt-session'

const NOW = new Date('2026-11-16T00:00:00Z')
const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl'

describe('parseChatGPTSession', () => {
  test('full session page JSON returns the account email, plan and expiry', () => {
    const raw = JSON.stringify({
      user: { email: 'buyer@example.com' },
      account: { planType: 'free' },
      expires: '2026-12-01T00:00:00.000Z',
      accessToken: TOKEN,
    })

    expect(parseChatGPTSession(`  ${raw}\n`, NOW)).toEqual({
      ok: true,
      email: 'buyer@example.com',
      plan: 'free',
      expiresAt: new Date('2026-12-01T00:00:00.000Z'),
    })
  })

  test('session without user or expires is accepted with empty details', () => {
    expect(
      parseChatGPTSession(JSON.stringify({ accessToken: TOKEN }), NOW)
    ).toEqual({ ok: true, email: '', plan: '', expiresAt: null })
  })

  test.each([
    ['a bare access token', TOKEN],
    ['truncated JSON', '{"accessToken":'],
    ['a JSON array', '[]'],
  ])('%s is rejected as not the session JSON', (_, raw) => {
    expect(parseChatGPTSession(raw, NOW)).toEqual({
      ok: false,
      errorKey: CHATGPT_SESSION_ERRORS.notJson,
    })
  })

  test.each([
    ['signed-out empty object', '{}'],
    ['non-JWT token', '{"accessToken":"abc"}'],
  ])('%s is rejected for missing access token', (_, raw) => {
    expect(parseChatGPTSession(raw, NOW)).toEqual({
      ok: false,
      errorKey: CHATGPT_SESSION_ERRORS.noAccessToken,
    })
  })

  test('session whose expires is in the past is rejected as expired', () => {
    const raw = JSON.stringify({
      expires: '2026-11-01T00:00:00Z',
      accessToken: TOKEN,
    })

    expect(parseChatGPTSession(raw, NOW)).toEqual({
      ok: false,
      errorKey: CHATGPT_SESSION_ERRORS.expired,
    })
  })
})
