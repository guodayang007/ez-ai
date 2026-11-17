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

import type {
  ProductFulfillmentAttempt,
  ProductFulfillmentStepKey,
  ProductFulfillmentStepStatus,
  ProductOrder,
} from '../../types'
import { canExecutePayment, getAttemptProgress } from '../fulfillment'

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
  test.each([
    ['pending', undefined],
    ['paid', undefined],
    ['processing', undefined],
    ['processing', 'failed'],
    ['completed', 'succeeded'],
    ['cancelled', undefined],
    ['refunded', undefined],
  ] as const)('%s order (%s attempt) can be paid', (status, fulfillment) => {
    expect(
      canExecutePayment(order({ status, fulfillment_status: fulfillment }))
    ).toBe(true)
  })

  test('running purchase cannot be started again', () => {
    expect(
      canExecutePayment(
        order({ status: 'processing', fulfillment_status: 'running' })
      )
    ).toBe(false)
  })
})

function attempt(
  status: ProductFulfillmentAttempt['status'],
  currentStep: ProductFulfillmentAttempt['current_step'],
  steps: Array<[ProductFulfillmentStepKey, ProductFulfillmentStepStatus]>
): ProductFulfillmentAttempt {
  return {
    id: 1,
    seq: 1,
    order_id: 1,
    trade_no: 'PO1',
    plan: 'chatgptplusplan',
    status,
    current_step: currentStep,
    operator_id: 1,
    operator_name: 'root',
    started_at: 1,
    finished_at: 0,
    updated_at: 1,
    steps: steps.map(([key, stepStatus]) => ({
      key,
      status: stepStatus,
      started_at: 0,
      finished_at: 0,
      message: '',
    })),
    events: [],
  }
}

describe('getAttemptProgress', () => {
  test('running attempt names the current step and the one after it', () => {
    const progress = getAttemptProgress(
      attempt('running', 'checkout', [
        ['subscription', 'succeeded'],
        ['checkout', 'running'],
        ['fill_payment', 'pending'],
      ])
    )

    expect(progress.current?.key).toBe('checkout')
    expect(progress.next?.key).toBe('fill_payment')
  })

  test('running attempt on its last step has no next step', () => {
    const progress = getAttemptProgress(
      attempt('running', 'complete', [
        ['confirm_payment', 'succeeded'],
        ['complete', 'running'],
      ])
    )

    expect(progress.current?.key).toBe('complete')
    expect(progress.next).toBeNull()
  })

  test('failed attempt stops at the failed step with nothing next', () => {
    const progress = getAttemptProgress(
      attempt('failed', 'checkout', [
        ['checkout', 'failed'],
        ['fill_payment', 'pending'],
      ])
    )

    expect(progress.current).toMatchObject({
      key: 'checkout',
      status: 'failed',
    })
    expect(progress.next).toBeNull()
  })

  test('attempt before any step ran starts with the first step', () => {
    const progress = getAttemptProgress(
      attempt('running', '', [
        ['prepare', 'pending'],
        ['submit', 'pending'],
      ])
    )

    expect(progress.current).toBeNull()
    expect(progress.next?.key).toBe('prepare')
  })
})
