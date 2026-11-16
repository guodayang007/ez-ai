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

import type { ProductSku } from '../../types'
import { formatProductPrice, getLowestPricedSku, getSkuSaving } from '../format'

function sku(id: number, price: number): ProductSku {
  return {
    id,
    product_id: 1,
    name: `sku-${id}`,
    price_amount: price,
    original_price: 0,
    tag: '',
    fulfillment_plan: '',
    currency: 'USD',
    enabled: true,
    sort_order: 0,
  }
}

describe('formatProductPrice', () => {
  test('ISO currency is formatted with its symbol', () => {
    expect(formatProductPrice(20, 'USD', 'en-US')).toBe('$20')
  })

  test('non-ISO code such as USDT falls back to amount and code', () => {
    expect(formatProductPrice(19.9, 'USDT', 'en-US')).toBe('19.9 USDT')
  })
})

describe('getLowestPricedSku', () => {
  test('returns the cheapest SKU, or null for an empty list', () => {
    expect(getLowestPricedSku([sku(1, 20), sku(2, 5), sku(3, 9)])?.id).toBe(2)
    expect(getLowestPricedSku([])).toBeNull()
  })
})

describe('getSkuSaving', () => {
  test('returns the rounded difference when original price is higher', () => {
    expect(getSkuSaving({ ...sku(1, 66.99), original_price: 85.98 })).toBe(
      18.99
    )
  })

  test('returns 0 when there is no original price', () => {
    expect(getSkuSaving(sku(1, 20))).toBe(0)
  })
})
