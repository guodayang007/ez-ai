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

import type { ProductOrder } from '../../types'
import { canExecutePayment } from '../fulfillment'

function order(overrides: Partial<ProductOrder>): ProductOrder {
  return {
    id: 1,
    user_id: 7,
    trade_no: 'PO1',
    product_id: 1,
    sku_id: 1,
    product_title: 'ChatGPT',
    sku_name: 'Plus · 1 month',
    price_amount: 42.99,
    currency: 'USD',
    input_fields: [],
    inputs: {},
    status: 'paid',
    remark: '',
    delivery_note: '',
    created_at: 0,
    updated_at: 0,
    completed_at: 0,
    ...overrides,
  }
}

describe('canExecutePayment', () => {
  test('paid order with no attempt can be paid', () => {
    expect(canExecutePayment(order({}))).toBe(true)
  })

  test('pending order cannot be paid before the buyer pays', () => {
    expect(canExecutePayment(order({ status: 'pending' }))).toBe(false)
  })

  test('running purchase cannot be started again', () => {
    expect(
      canExecutePayment(
        order({ status: 'processing', fulfillment_status: 'running' })
      )
    ).toBe(false)
  })

  test('failed attempt can be retried', () => {
    expect(
      canExecutePayment(
        order({ status: 'processing', fulfillment_status: 'failed' })
      )
    ).toBe(true)
  })

  test('processing order handled by hand cannot be paid automatically', () => {
    expect(canExecutePayment(order({ status: 'processing' }))).toBe(false)
  })

  test('completed order cannot be paid again', () => {
    expect(
      canExecutePayment(
        order({ status: 'completed', fulfillment_status: 'succeeded' })
      )
    ).toBe(false)
  })
})
