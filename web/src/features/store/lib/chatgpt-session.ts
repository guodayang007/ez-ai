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

/** The page a signed-in buyer opens to copy their ChatGPT session JSON. */
export const CHATGPT_SESSION_URL = 'https://chatgpt.com/api/auth/session'
export const CHATGPT_HOME_URL = 'https://chatgpt.com'

// A ChatGPT access token is a JWT: three base64url segments.
const ACCESS_TOKEN_PATTERN = /^[\w-]+\.[\w-]+\.[\w-]+$/

// The English messages double as i18n keys and match the server's.
export const CHATGPT_SESSION_ERRORS = {
  notJson:
    'The session must be the full JSON copied from the ChatGPT session page',
  noAccessToken:
    'The session has no access token, please sign in to ChatGPT and copy it again',
  expired:
    'The session has expired, please refresh the ChatGPT session page and copy it again',
} as const

export type ChatGPTSessionResult =
  | { ok: true; email: string; plan: string; expiresAt: Date | null }
  | { ok: false; errorKey: string }

function readString(source: unknown, key: string): string {
  if (typeof source !== 'object' || source === null) return ''
  const value = (source as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Checks the JSON copied from chatgpt.com/api/auth/session and extracts the
 * account it belongs to. It mirrors validateChatGPTSession in
 * controller/product.go; the server validates again on order creation.
 */
export function parseChatGPTSession(
  raw: string,
  now: Date = new Date()
): ChatGPTSessionResult {
  const value = raw.trim()
  let session: unknown
  try {
    session = value.startsWith('{') ? JSON.parse(value) : null
  } catch {
    session = null
  }
  if (typeof session !== 'object' || session === null) {
    return { ok: false, errorKey: CHATGPT_SESSION_ERRORS.notJson }
  }
  if (!ACCESS_TOKEN_PATTERN.test(readString(session, 'accessToken'))) {
    return { ok: false, errorKey: CHATGPT_SESSION_ERRORS.noAccessToken }
  }
  const expiresRaw = readString(session, 'expires')
  const expires = expiresRaw ? new Date(expiresRaw) : null
  const expiresAt = expires && !Number.isNaN(expires.getTime()) ? expires : null
  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    return { ok: false, errorKey: CHATGPT_SESSION_ERRORS.expired }
  }
  const record = session as Record<string, unknown>
  return {
    ok: true,
    email: readString(record.user, 'email'),
    plan: readString(record.account, 'planType'),
    expiresAt,
  }
}
