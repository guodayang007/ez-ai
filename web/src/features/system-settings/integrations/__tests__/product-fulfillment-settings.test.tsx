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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import * as productsApi from '@/features/products/api'
import type {
  ProductFulfillerHealth,
  ProductFulfillmentConfigView,
} from '@/features/products/types'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { ProductFulfillmentSettingsSection } from '../product-fulfillment-settings-section'

const savedView: ProductFulfillmentConfigView = {
  encryption_ready: true,
  readable: true,
  url: 'http://127.0.0.1:3100',
  callback_url: '',
  default_callback_url:
    'http://127.0.0.1:3000/api/product/fulfillment/callback',
  plans: ['chatgptplusplan'],
  has_secret: true,
  billing: {
    country: 'US',
    currency: 'USD',
    line1: '',
    city: 'Austin',
    state: '',
    postal_code: '',
  },
}

function mockServer(
  view: ProductFulfillmentConfigView,
  health: ProductFulfillerHealth
) {
  vi.spyOn(productsApi, 'getProductFulfillmentConfig').mockResolvedValue({
    success: true,
    data: view,
  })
  vi.spyOn(productsApi, 'getProductFulfillerHealth').mockResolvedValue({
    success: true,
    data: health,
  })
  vi.spyOn(productsApi, 'getProductFulfillmentCards').mockResolvedValue({
    success: true,
    data: [],
  })
  return vi
    .spyOn(productsApi, 'updateProductFulfillmentConfig')
    .mockResolvedValue({ success: true, data: view })
}

function Fixture() {
  const [actions, setActions] = useState<HTMLDivElement | null>(null)
  return (
    <SettingsPageProvider actionsContainer={actions}>
      <div ref={setActions} />
      <ProductFulfillmentSettingsSection />
    </SettingsPageProvider>
  )
}

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <Fixture />
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('product fulfillment settings', () => {
  test('saving with the secret fields left empty keeps the saved secrets and sends what was typed', async () => {
    const update = mockServer(savedView, {
      status: 'ok',
      plans: ['chatgptplusplan'],
      claude_plans: ['claude_pro'],
      service_url: savedView.url,
      missing: [],
    })
    renderSection()

    const city = await screen.findByLabelText('City')
    expect(city).toHaveValue('Austin')
    await userEvent.clear(city)
    await userEvent.type(city, 'Dallas')
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    const payload = update.mock.calls[0][0]
    expect(payload).not.toHaveProperty('secret')
    expect(payload).not.toHaveProperty('card_number')
    expect(payload).not.toHaveProperty('card_cvc')
    expect(payload.plans).toEqual(['chatgptplusplan'])
    expect(payload.billing.city).toBe('Dallas')
  })

  test('without an encryption key the fields are disabled and the key setup is explained', async () => {
    mockServer(
      {
        ...savedView,
        encryption_ready: false,
        readable: false,
        has_secret: false,
      },
      {
        status: 'key_missing',
        plans: [],
        claude_plans: [],
        service_url: '',
        missing: [],
      }
    )
    renderSection()

    expect(
      await screen.findByText('The settings encryption key is not set')
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Add card' })
    ).toBeDisabled()
  })

  test('clicking the help button beside a field shows what the field is', async () => {
    mockServer(savedView, {
      status: 'ok',
      plans: ['chatgptplusplan'],
      claude_plans: ['claude_pro'],
      service_url: savedView.url,
      missing: [],
    })
    renderSection()

    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Learn more about Callback URL',
      })
    )

    expect(
      await screen.findByText(
        'What it is: the address the fulfillment service uses to report progress and results back to ez-ai.'
      )
    ).toBeVisible()
  })

  test.each([
    'Fulfillment service URL',
    'Shared secret',
    'Callback URL',
    'Plans to buy',
    'Country code',
    'Currency code',
    'Address line',
    'City',
    'State / province',
    'Postal code',
  ])('the %s input has a help button', async (label) => {
    mockServer(savedView, {
      status: 'ok',
      plans: ['chatgptplusplan'],
      claude_plans: ['claude_pro'],
      service_url: savedView.url,
      missing: [],
    })
    renderSection()

    expect(
      await screen.findByRole('button', { name: `Learn more about ${label}` })
    ).toBeInTheDocument()
  })
})
