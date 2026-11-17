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

/** Where the buyer signs in before copying the cookie. */
export const CLAUDE_HOME_URL = 'https://claude.ai'

const SESSION_KEY_PATTERN = /^sk-ant-sid[A-Za-z0-9]*-[\w-]{20,}$/
const COOKIE_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const COOKIE_VALUE_FORBIDDEN = /[\s,;"\\]/
// Cloudflare cookies are bound to the buyer's browser, so they are dropped.
const DROPPED_COOKIES = new Set([
  'cf_clearance',
  '__cf_bm',
  '_cfuvid',
  '__cflb',
])

// The English message doubles as an i18n key and matches the server's.
export const CLAUDE_COOKIE_ERROR =
  'The cookie must contain the sessionKey copied from claude.ai'

export type ClaudeCookieResult =
  | {
      ok: true
      /** "name=value; ..." as the server stores it. */
      cookie: string
      sessionKey: string
      /** The organization the buyer last used, when the cookie names one. */
      organization: string
    }
  | { ok: false; errorKey: string }

/**
 * Checks what a buyer copied from claude.ai: the bare sessionKey value or a
 * Cookie header. It mirrors model.NormalizeClaudeCookie on the server, which
 * validates again on order creation.
 */
export function parseClaudeCookie(raw: string): ClaudeCookieResult {
  let value = raw.trim()
  const prefix = /^cookie\s*:/i.exec(value)
  if (prefix) value = value.slice(prefix[0].length).trim()

  if (!value.includes('=')) {
    return SESSION_KEY_PATTERN.test(value)
      ? {
          ok: true,
          cookie: `sessionKey=${value}`,
          sessionKey: value,
          organization: '',
        }
      : { ok: false, errorKey: CLAUDE_COOKIE_ERROR }
  }

  const pairs: string[] = []
  let sessionKey = ''
  let organization = ''
  for (const part of value.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const name = part.slice(0, index).trim()
    const cookieValue = part.slice(index + 1).trim()
    if (!COOKIE_NAME_PATTERN.test(name)) continue
    if (COOKIE_VALUE_FORBIDDEN.test(cookieValue)) continue
    if (DROPPED_COOKIES.has(name)) continue
    if (name === 'sessionKey') {
      if (sessionKey || !SESSION_KEY_PATTERN.test(cookieValue)) continue
      sessionKey = cookieValue
    }
    if (name === 'lastActiveOrg') organization = cookieValue
    pairs.push(`${name}=${cookieValue}`)
  }
  if (!sessionKey) return { ok: false, errorKey: CLAUDE_COOKIE_ERROR }
  return { ok: true, cookie: pairs.join('; '), sessionKey, organization }
}

/** Shows the start and end of a session key, as on a masked order. */
export function maskSessionKey(sessionKey: string): string {
  if (sessionKey.length <= 24) return sessionKey
  return `${sessionKey.slice(0, 16)}…${sessionKey.slice(-4)}`
}
