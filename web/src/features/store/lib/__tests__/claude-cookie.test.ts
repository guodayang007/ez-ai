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
  CLAUDE_COOKIE_ERROR,
  maskSessionKey,
  parseClaudeCookie,
} from '../claude-cookie'

const KEY = 'sk-ant-sid01-AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-xyzAA'

describe('parseClaudeCookie', () => {
  test('a bare session key becomes a sessionKey cookie', () => {
    expect(parseClaudeCookie(`  ${KEY}\n`)).toEqual({
      ok: true,
      cookie: `sessionKey=${KEY}`,
      sessionKey: KEY,
      organization: '',
    })
  })

  test('a Cookie header keeps other cookies and drops Cloudflare ones', () => {
    expect(
      parseClaudeCookie(
        `Cookie: lastActiveOrg=org-1; cf_clearance=abc; sessionKey=${KEY}; __cf_bm=x`
      )
    ).toEqual({
      ok: true,
      cookie: `lastActiveOrg=org-1; sessionKey=${KEY}`,
      sessionKey: KEY,
      organization: 'org-1',
    })
  })

  test.each([
    ['a header without a session key', 'lastActiveOrg=org-1; cf_clearance=abc'],
    ['a session key of another format', 'sessionKey=abc123'],
    ['text that is not a session key', 'hello'],
  ])('%s is rejected', (_, raw) => {
    expect(parseClaudeCookie(raw)).toEqual({
      ok: false,
      errorKey: CLAUDE_COOKIE_ERROR,
    })
  })
})

test('maskSessionKey keeps the start and the end of the key', () => {
  expect(maskSessionKey(KEY)).toBe('sk-ant-sid01-AbC…yzAA')
})
