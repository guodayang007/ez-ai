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
import { describe, expect, test } from 'vitest'

import type { ProductInputField } from '@/features/products/types'

import { buildOrderInputsSchema, getOrderFormDefaults } from '../order-form'

// Returns the key so assertions do not depend on a locale.
const t = ((key: string) => key) as unknown as TFunction

function field(overrides: Partial<ProductInputField>): ProductInputField {
  return {
    key: 'redeem_code',
    label: 'Session Key',
    type: 'text',
    required: true,
    placeholder: '',
    description: '',
    max_length: 0,
    ...overrides,
  }
}

function firstError(
  fields: ProductInputField[],
  inputs: Record<string, string>
) {
  const result = buildOrderInputsSchema(fields, t).safeParse({
    inputs,
    remark: '',
  })
  return result.success ? null : result.error.issues[0]?.message
}

describe('buildOrderInputsSchema', () => {
  test('blank required field is rejected', () => {
    expect(firstError([field({})], { redeem_code: '   ' })).toBe(
      '{{field}} is required'
    )
  })

  test('blank optional field is accepted', () => {
    expect(
      firstError([field({ required: false })], { redeem_code: '' })
    ).toBeNull()
  })

  test('value longer than max_length is rejected', () => {
    expect(
      firstError([field({ max_length: 4 })], { redeem_code: 'abcde' })
    ).toBe('{{field}} cannot exceed {{max}} characters')
  })

  test('invalid JSON is rejected and valid JSON accepted', () => {
    const json = [field({ type: 'json' })]
    expect(firstError(json, { redeem_code: '{bad' })).toBe(
      '{{field}} must be valid JSON'
    )
    expect(firstError(json, { redeem_code: '{"a":1}' })).toBeNull()
  })

  test('Base64 with line breaks is accepted and non-Base64 rejected', () => {
    const base64 = [field({ type: 'base64' })]
    expect(firstError(base64, { redeem_code: 'aGVs\nbG8=' })).toBeNull()
    expect(firstError(base64, { redeem_code: '***' })).toBe(
      '{{field}} must be valid Base64'
    )
  })
})

describe('getOrderFormDefaults', () => {
  test('every declared field starts as an empty string', () => {
    expect(getOrderFormDefaults([field({}), field({ key: 'email' })])).toEqual({
      inputs: { redeem_code: '', email: '' },
      remark: '',
    })
  })
})
