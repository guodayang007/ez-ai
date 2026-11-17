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
import type { TFunction } from 'i18next'
import { z } from 'zod'

import { PRODUCT_INPUT_MAX_LENGTH_DEFAULT } from '@/features/products/constants'
import type { ProductInputField } from '@/features/products/types'

import { parseChatGPTSession } from './chatgpt-session'
import { parseClaudeCookie } from './claude-cookie'

const BASE64_PATTERN = /^[A-Za-z0-9+/_-]*={0,2}$/

function isValidJson(value: string): boolean {
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

/**
 * Builds the validation schema for the order fields of one SKU. It mirrors
 * validateProductOrderInputs in controller/product.go so buyers see errors
 * before submitting; the server still validates every value.
 */
export function buildOrderInputsSchema(
  fields: ProductInputField[],
  t: TFunction
) {
  const shape: Record<string, z.ZodType<string>> = {}
  for (const field of fields) {
    const maxLength =
      field.max_length > 0 ? field.max_length : PRODUCT_INPUT_MAX_LENGTH_DEFAULT
    shape[field.key] = z.string().superRefine((raw, ctx) => {
      const value = raw.trim()
      if (value === '') {
        if (field.required) {
          ctx.addIssue({
            code: 'custom',
            message: t('{{field}} is required', { field: field.label }),
          })
        }
        return
      }
      if (value.length > maxLength) {
        ctx.addIssue({
          code: 'custom',
          message: t('{{field}} cannot exceed {{max}} characters', {
            field: field.label,
            max: maxLength,
          }),
        })
        return
      }
      if (field.type === 'json' && !isValidJson(value)) {
        ctx.addIssue({
          code: 'custom',
          message: t('{{field}} must be valid JSON', { field: field.label }),
        })
      }
      if (
        field.type === 'base64' &&
        !BASE64_PATTERN.test(value.replaceAll(/\s+/g, ''))
      ) {
        ctx.addIssue({
          code: 'custom',
          message: t('{{field}} must be valid Base64', { field: field.label }),
        })
      }
      if (field.type === 'chatgpt_session') {
        const session = parseChatGPTSession(value)
        if (!session.ok) {
          ctx.addIssue({ code: 'custom', message: t(session.errorKey) })
        }
      }
      if (field.type === 'claude_cookie') {
        const cookie = parseClaudeCookie(value)
        if (!cookie.ok) {
          ctx.addIssue({ code: 'custom', message: t(cookie.errorKey) })
        }
      }
    })
  }
  return z.object({
    inputs: z.object(shape),
    remark: z.string().max(500, t('Remark cannot exceed 500 characters')),
  })
}

export type OrderFormValues = {
  inputs: Record<string, string>
  remark: string
}

export function getOrderFormDefaults(
  fields: ProductInputField[]
): OrderFormValues {
  const inputs: Record<string, string> = {}
  for (const field of fields) inputs[field.key] = ''
  return { inputs, remark: '' }
}
