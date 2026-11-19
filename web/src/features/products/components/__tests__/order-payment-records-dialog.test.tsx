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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'

import * as api from '../../api'
import type {
  ProductFulfillmentAttempt,
  ProductFulfillmentStepKey,
  ProductFulfillmentStepState,
  ProductOrder,
} from '../../types'
import { OrderPaymentRecordsDialog } from '../order-payment-records-dialog'

const order: ProductOrder = {
  id: 3,
  user_id: 7,
  trade_no: 'PO123',
  product_id: 1,
  sku_id: 1,
  product_title: 'ChatGPT',
  sku_name: 'Plus',
  price_amount: 20,
  currency: 'USD',
  input_fields: [],
  inputs: {},
  status: 'processing',
  remark: '',
  delivery_note: '',
  created_at: 0,
  updated_at: 0,
  completed_at: 0,
}

const STEP_KEYS: ProductFulfillmentStepKey[] = [
  'prepare',
  'submit',
  'queue',
  'browser',
  'subscription',
  'checkout',
  'fill_payment',
  'submit_payment',
  'confirm_payment',
  'complete',
]

function attempt(
  seq: number,
  status: ProductFulfillmentAttempt['status'],
  reached: Partial<
    Record<ProductFulfillmentStepKey, Partial<ProductFulfillmentStepState>>
  >
): ProductFulfillmentAttempt {
  const steps = STEP_KEYS.map((key): ProductFulfillmentStepState => ({
    key,
    status: 'pending',
    started_at: 0,
    finished_at: 0,
    message: '',
    ...reached[key],
  }))
  const current = [...steps].reverse().find((step) => step.status !== 'pending')
  return {
    id: seq * 10,
    seq,
    order_id: order.id,
    trade_no: order.trade_no,
    plan: 'chatgptplusplan',
    status,
    current_step: current?.key ?? '',
    card_id: 1,
    card_label: 'DogPay #1 •••• 4242',
    operator_id: 1,
    operator_name: 'root',
    started_at: 1_800_000_000,
    finished_at: status === 'running' ? 0 : 1_800_000_060,
    updated_at: 1_800_000_060,
    steps,
    events: [],
  }
}

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <OrderPaymentRecordsDialog order={order} onOpenChange={vi.fn()} />
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('order payment records dialog', () => {
  test('with several attempts, the newest is open and shows where it stands', async () => {
    vi.spyOn(api, 'getProductOrderFulfillments').mockResolvedValue({
      success: true,
      data: [
        attempt(2, 'running', {
          prepare: { status: 'succeeded' },
          submit: { status: 'succeeded' },
          queue: { status: 'succeeded' },
          browser: { status: 'succeeded' },
          subscription: { status: 'succeeded' },
          checkout: {
            status: 'running',
            message: 'Creating a checkout for plan {{plan}}',
            params: { plan: 'chatgptplusplan' },
          },
        }),
        attempt(1, 'failed', {
          prepare: {
            status: 'failed',
            message: 'This order has no ChatGPT session',
          },
        }),
      ],
    })
    renderDialog()

    const newest = await screen.findByRole('button', { name: /Attempt 2/ })
    expect(newest).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Attempt 1/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    const steps = screen.getByRole('list', { name: 'Payment steps' })
    expect(within(steps).getAllByRole('listitem')).toHaveLength(10)
    expect(
      within(steps).getByText('Creating a checkout for plan chatgptplusplan')
    ).toBeInTheDocument()
    expect(screen.getByText('Current step').nextSibling).toHaveTextContent(
      'Create checkout'
    )
    expect(screen.getByText('Next step').nextSibling).toHaveTextContent(
      'Fill in card and billing address'
    )
  })

  test('opening an earlier failed attempt shows the failed step and its reason', async () => {
    vi.spyOn(api, 'getProductOrderFulfillments').mockResolvedValue({
      success: true,
      data: [
        attempt(1, 'failed', {
          prepare: { status: 'succeeded' },
          submit: {
            status: 'failed',
            message:
              'The fulfillment service did not accept the job: {{error}}',
            params: { error: 'HTTP 503' },
          },
        }),
      ],
    })
    renderDialog()

    expect(
      await screen.findByText(
        'The fulfillment service did not accept the job: HTTP 503'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Next step').nextSibling).toHaveTextContent(
      'None, the attempt stopped'
    )
  })

  test('without attempts, the dialog says nothing was recorded yet', async () => {
    vi.spyOn(api, 'getProductOrderFulfillments').mockResolvedValue({
      success: true,
      data: [],
    })
    renderDialog()

    expect(
      await screen.findByText('No payment records yet')
    ).toBeInTheDocument()
  })

  test('when loading fails, retrying loads the records', async () => {
    const spy = vi
      .spyOn(api, 'getProductOrderFulfillments')
      .mockResolvedValueOnce({ success: false, message: 'Order not found' })
      .mockResolvedValueOnce({ success: true, data: [] })
    renderDialog()

    expect(await screen.findByText('Order not found')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(
      await screen.findByText('No payment records yet')
    ).toBeInTheDocument()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  test('while an attempt runs, the records refresh until it ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const spy = vi
      .spyOn(api, 'getProductOrderFulfillments')
      .mockResolvedValueOnce({
        success: true,
        data: [attempt(1, 'running', { prepare: { status: 'running' } })],
      })
      .mockResolvedValue({
        success: true,
        data: [
          attempt(1, 'succeeded', {
            complete: {
              status: 'succeeded',
              message: 'Order completed and the delivery note saved',
            },
          }),
        ],
      })
    renderDialog()

    await screen.findByRole('button', { name: /Attempt 1/ })
    await vi.advanceTimersByTimeAsync(3000)

    expect(
      await screen.findByText('Order completed and the delivery note saved')
    ).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(10_000)
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
  })
})
