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
import * as z from 'zod'

import type {
  ProductFulfillmentCard,
  ProductFulfillmentCardInput,
  ProductFulfillmentCardProvider,
} from '../types'

const PROVIDERS: ProductFulfillmentCardProvider[] = [
  'dogpay',
  'virtual',
  'physical',
  'other',
]

/** Strips the spaces and dashes a card number may be typed with. */
export function normalizeCardNumber(value: string): string {
  return value.replaceAll(/[\s-]/g, '')
}

/**
 * Validation for the add and edit card dialog. When editing, the number and
 * CVC may be left empty to keep the saved values; when adding, they are
 * required.
 */
export function createCardFormSchema(
  t: (key: string) => string,
  options: { editing: boolean }
) {
  const cardNumberPattern = /^\d{12,19}$/
  const cvcPattern = /^\d{3,4}$/
  const expiryPattern = /^(0[1-9]|1[0-2])\/\d{2}$/
  const requiredText = t('This field is required')

  return z.object({
    label: z
      .string()
      .trim()
      .min(1, requiredText)
      .max(64, t('Use at most 64 characters')),
    provider: z.enum(PROVIDERS as [string, ...string[]]),
    number: z
      .string()
      .refine(
        (value) =>
          (options.editing && !value.trim()) ||
          cardNumberPattern.test(normalizeCardNumber(value)),
        t('The card number must be 12-19 digits')
      ),
    expiry: z
      .string()
      .trim()
      .refine(
        (value) => expiryPattern.test(value),
        t('The card expiry must look like MM/YY')
      ),
    cvc: z
      .string()
      .refine(
        (value) =>
          (options.editing && !value.trim()) || cvcPattern.test(value.trim()),
        t('The CVC must be 3-4 digits')
      ),
    holder: z.string().trim().min(1, requiredText),
    priority: z
      .number({ error: t('Enter a whole number') })
      .int(t('Enter a whole number'))
      .min(0, t('The priority must be 0 or more'))
      .max(9999, t('The priority must be 9999 or less')),
    enabled: z.boolean(),
  })
}

export type CardFormValues = z.infer<ReturnType<typeof createCardFormSchema>>

export function emptyCardFormValues(): CardFormValues {
  return {
    label: '',
    provider: 'dogpay',
    number: '',
    expiry: '',
    cvc: '',
    holder: '',
    priority: 100,
    enabled: true,
  }
}

/** The values the edit dialog starts from; secrets are never returned. */
export function cardToFormValues(card: ProductFulfillmentCard): CardFormValues {
  return {
    label: card.label,
    provider: card.provider,
    number: '',
    expiry: `${String(card.expiry_month).padStart(2, '0')}/${String(card.expiry_year % 100).padStart(2, '0')}`,
    cvc: '',
    holder: card.holder,
    priority: card.priority,
    enabled: card.enabled,
  }
}

/**
 * The request body for a save. Empty number and CVC are left out on edit so
 * the server keeps the saved values.
 */
export function cardFormToInput(
  values: CardFormValues,
  options: { editing: boolean }
): ProductFulfillmentCardInput {
  const input: ProductFulfillmentCardInput = {
    label: values.label.trim(),
    provider: values.provider as ProductFulfillmentCardProvider,
    expiry: values.expiry.trim(),
    holder: values.holder.trim(),
    priority: values.priority,
    enabled: values.enabled,
  }
  const number = normalizeCardNumber(values.number)
  if (number) input.number = number
  if (!options.editing || values.cvc.trim()) input.cvc = values.cvc.trim()
  return input
}
