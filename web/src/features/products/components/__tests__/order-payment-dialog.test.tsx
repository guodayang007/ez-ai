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
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'

import * as api from '../../api'
import type { ProductFulfillerHealth, ProductOrder } from '../../types'
import { OrderPaymentDialog } from '../order-payment-dialog'

const paidOrder: ProductOrder = {
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
  status: 'paid',
  remark: '',
  delivery_note: '',
  created_at: 0,
  updated_at: 0,
  completed_at: 0,
}

function health(
  overrides: Partial<ProductFulfillerHealth>
): ProductFulfillerHealth {
  return {
    status: 'ok',
    plans: ['chatgptplusplan'],
    claude_plans: ['claude_pro', 'claude_max_5x', 'claude_max_20x'],
    service_url: 'http://127.0.0.1:3100',
    missing: [],
    ...overrides,
  }
}

function mockHealth(...responses: ProductFulfillerHealth[]) {
  const spy = vi.spyOn(api, 'getProductFulfillerHealth')
  for (const data of responses) {
    spy.mockResolvedValueOnce({ success: true, data })
  }
  return spy
}

function renderDialog() {
  const onOpenChange = vi.fn()
  const onStarted = vi.fn()
  const root = createRootRoute()
  const orders = createRoute({
    getParentRoute: () => root,
    path: '/product-orders',
    component: () => (
      <OrderPaymentDialog
        order={paidOrder}
        onOpenChange={onOpenChange}
        onStarted={onStarted}
      />
    ),
  })
  const settings = createRoute({
    getParentRoute: () => root,
    path: '/system-settings/billing/$section',
    component: () => <h1>Billing settings</h1>,
  })
  const router = createRouter({
    routeTree: root.addChildren([orders, settings]),
    history: createMemoryHistory({ initialEntries: ['/product-orders'] }),
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { router, onOpenChange, onStarted }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('order payment dialog', () => {
  test('when the fulfiller is not configured, the main button opens its settings', async () => {
    mockHealth(
      health({
        status: 'not_configured',
        plans: [],
        service_url: '',
        missing: ['url', 'card_number'],
      })
    )
    const { router, onOpenChange } = renderDialog()

    expect(
      await screen.findByText('DogPay auto-fulfillment is not set up')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Fill in: Fulfillment service URL, Card number')
    ).toBeInTheDocument()
    const main = screen.getByRole('button', {
      name: 'Open fulfillment settings',
    })
    expect(main).toBeEnabled()

    await userEvent.click(main)

    expect(onOpenChange).toHaveBeenCalledWith(false)
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        '/system-settings/billing/product-fulfillment'
      )
    )
  })

  test('when the fulfiller is not running, checking again after starting it enables payment', async () => {
    const spy = mockHealth(
      health({ status: 'unreachable', plans: [] }),
      health({})
    )
    renderDialog()

    expect(
      await screen.findByText('The fulfillment service is not running')
    ).toBeInTheDocument()
    expect(
      screen.getByText('cd services/dogpay-fulfiller && node src/server.mjs')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Pay with DogPay' })
    ).not.toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: 'Open fulfillment settings' })
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))

    expect(
      await screen.findByRole('button', { name: 'Pay with DogPay' })
    ).toBeEnabled()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  test('when the fulfiller is ready, paying sends the offered plan and hands the order over to follow', async () => {
    mockHealth(health({}))
    const pay = vi
      .spyOn(api, 'executeProductOrderPayment')
      .mockResolvedValue({ success: true })
    const { onStarted } = renderDialog()

    await userEvent.click(
      await screen.findByRole('button', { name: 'Pay with DogPay' })
    )

    expect(pay).toHaveBeenCalledWith(3, 'chatgptplusplan')
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(paidOrder))
  })

  test('when the fulfiller refuses the payment, the order is not handed over', async () => {
    mockHealth(health({}))
    vi.spyOn(api, 'executeProductOrderPayment').mockResolvedValue({
      success: false,
      message: 'This order has no ChatGPT session',
    })
    const { onStarted, onOpenChange } = renderDialog()

    await userEvent.click(
      await screen.findByRole('button', { name: 'Pay with DogPay' })
    )

    await waitFor(() =>
      expect(api.executeProductOrderPayment).toHaveBeenCalled()
    )
    expect(onStarted).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
