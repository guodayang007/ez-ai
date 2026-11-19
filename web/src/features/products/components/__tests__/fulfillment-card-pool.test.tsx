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
import { afterEach, describe, expect, test, vi } from 'vitest'

import * as api from '../../api'
import type { ProductFulfillmentCard } from '../../types'
import { FulfillmentCardPool } from '../fulfillment-card-pool'

const cards: ProductFulfillmentCard[] = [
  {
    id: 1,
    label: 'DogPay #1',
    provider: 'dogpay',
    brand: 'Visa',
    last4: '4242',
    expiry_month: 12,
    expiry_year: 2030,
    holder: 'Test Holder',
    enabled: true,
    priority: 10,
    status: 'ready',
    disabled_reason: '',
    last_used_at: 0,
    success_count: 2,
    fail_count: 1,
  },
  {
    id: 2,
    label: 'Backup',
    provider: 'physical',
    brand: 'Mastercard',
    last4: '5555',
    expiry_month: 1,
    expiry_year: 2031,
    holder: 'Test Holder',
    enabled: false,
    priority: 20,
    status: 'disabled',
    disabled_reason: 'declined',
    last_used_at: 0,
    success_count: 0,
    fail_count: 1,
  },
]

function renderPool() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <FulfillmentCardPool />
    </QueryClientProvider>
  )
}

function mockCards() {
  return vi
    .spyOn(api, 'getProductFulfillmentCards')
    .mockResolvedValue({ success: true, data: cards })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fulfillment card pool', () => {
  test('lists each card by brand and last four digits, with why a card is disabled', async () => {
    mockCards()
    renderPool()

    expect(await screen.findByText('Visa •••• 4242')).toBeInTheDocument()
    expect(screen.getByText('Mastercard •••• 5555')).toBeInTheDocument()
    expect(screen.getByText('Declined by the bank')).toBeInTheDocument()
  })

  test('rejects a malformed card number and expiry before anything is saved', async () => {
    mockCards()
    const create = vi.spyOn(api, 'createProductFulfillmentCard')
    renderPool()

    await userEvent.click(
      await screen.findByRole('button', { name: 'Add card' })
    )
    await userEvent.type(screen.getByLabelText('Label'), 'New card')
    await userEvent.type(screen.getByLabelText('Card number'), '1234')
    await userEvent.type(screen.getByLabelText('Expiry (MM/YY)'), '13/30')
    await userEvent.type(screen.getByLabelText('CVC'), '123')
    await userEvent.type(screen.getByLabelText('Cardholder name'), 'Holder')
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(
      await screen.findByText('The card number must be 12-19 digits')
    ).toBeInTheDocument()
    expect(
      screen.getByText('The card expiry must look like MM/YY')
    ).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })

  test('adding a card sends the number without spaces and the MM/YY expiry', async () => {
    mockCards()
    const create = vi
      .spyOn(api, 'createProductFulfillmentCard')
      .mockResolvedValue({ success: true, data: cards[0] })
    renderPool()

    await userEvent.click(
      await screen.findByRole('button', { name: 'Add card' })
    )
    await userEvent.type(screen.getByLabelText('Label'), 'DogPay #3')
    await userEvent.type(
      screen.getByLabelText('Card number'),
      '4242 4242 4242 4242'
    )
    await userEvent.type(screen.getByLabelText('Expiry (MM/YY)'), '12/30')
    await userEvent.type(screen.getByLabelText('CVC'), '123')
    await userEvent.type(screen.getByLabelText('Cardholder name'), 'Holder')
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith({
      label: 'DogPay #3',
      provider: 'dogpay',
      number: '4242424242424242',
      expiry: '12/30',
      cvc: '123',
      holder: 'Holder',
      priority: 100,
      enabled: true,
    })
  })

  test('editing a card without typing a number or CVC keeps the saved ones', async () => {
    mockCards()
    const update = vi
      .spyOn(api, 'updateProductFulfillmentCard')
      .mockResolvedValue({ success: true, data: cards[0] })
    renderPool()

    await userEvent.click(
      await screen.findByRole('button', { name: 'Edit DogPay #1' })
    )
    expect(screen.getByLabelText('Card number')).toHaveValue('')
    expect(screen.getByLabelText('Expiry (MM/YY)')).toHaveValue('12/30')
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    const [id, payload] = update.mock.calls[0]
    expect(id).toBe(1)
    expect(payload).not.toHaveProperty('number')
    expect(payload).not.toHaveProperty('cvc')
    expect(payload.expiry).toBe('12/30')
  })

  test('deleting a card waits for confirmation', async () => {
    mockCards()
    const remove = vi
      .spyOn(api, 'deleteProductFulfillmentCard')
      .mockResolvedValue({ success: true })
    renderPool()

    await userEvent.click(
      await screen.findByRole('button', { name: 'More actions for DogPay #1' })
    )
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete card' }))

    expect(
      await screen.findByText(
        'Delete DogPay #1 (•••• 4242)? Past payment records keep their card label, and the card is no longer used for new payments.'
      )
    ).toBeInTheDocument()
    expect(remove).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(remove).toHaveBeenCalledWith(1))
  })
})
