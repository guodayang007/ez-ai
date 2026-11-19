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
import type { StatusBadgeProps } from '@/components/status-badge'

import type {
  ProductFulfillmentCardProvider,
  ProductFulfillmentCardStatus,
  ProductFulfillmentStatus,
  ProductFulfillmentStepKey,
  ProductFulfillmentStepStatus,
  ProductInputType,
  ProductOrderStatus,
} from './types'

export const PRODUCT_QUERY_KEYS = {
  adminProducts: ['admin-products'] as const,
  adminOrders: ['admin-product-orders'] as const,
  storeProducts: ['store-products'] as const,
  selfOrders: ['self-product-orders'] as const,
  fulfillerHealth: ['product-fulfiller-health'] as const,
  fulfillerConfig: ['product-fulfiller-config'] as const,
  fulfillmentCards: ['product-fulfillment-cards'] as const,
  fulfillmentAttempts: ['product-fulfillment-attempts'] as const,
}

// labelKey values are i18n keys; render them with t(config.labelKey).
export const PRODUCT_INPUT_TYPES: Array<{
  value: ProductInputType
  labelKey: string
}> = [
  { value: 'text', labelKey: 'Single-line text' },
  { value: 'textarea', labelKey: 'Multi-line text' },
  { value: 'secret', labelKey: 'Secret (masked)' },
  { value: 'json', labelKey: 'JSON' },
  { value: 'base64', labelKey: 'Base64' },
  { value: 'chatgpt_session', labelKey: 'ChatGPT Session' },
  { value: 'claude_cookie', labelKey: 'Claude Cookie' },
]

// Input types whose values the server masks before showing them to the buyer.
export const PRODUCT_MASKED_INPUT_TYPES: ReadonlySet<ProductInputType> =
  new Set(['secret', 'chatgpt_session', 'claude_cookie'])

export const PRODUCT_ORDER_STATUSES: Record<
  ProductOrderStatus,
  Pick<StatusBadgeProps, 'variant'> & { labelKey: string }
> = {
  pending: { labelKey: 'Pending payment', variant: 'warning' },
  paid: { labelKey: 'Paid', variant: 'info' },
  processing: { labelKey: 'Processing', variant: 'blue' },
  completed: { labelKey: 'Completed', variant: 'success' },
  cancelled: { labelKey: 'Cancelled', variant: 'neutral' },
  refunded: { labelKey: 'Refunded', variant: 'danger' },
}

export const PRODUCT_FULFILLMENT_STATUSES: Record<
  ProductFulfillmentStatus,
  Pick<StatusBadgeProps, 'variant'> & { labelKey: string }
> = {
  running: { labelKey: 'Paying', variant: 'blue' },
  succeeded: { labelKey: 'Paid automatically', variant: 'success' },
  failed: { labelKey: 'Payment failed', variant: 'danger' },
}

// labelKey values are i18n keys; render them with t(config.labelKey).
export const PRODUCT_FULFILLMENT_CARD_PROVIDERS: Array<{
  value: ProductFulfillmentCardProvider
  labelKey: string
}> = [
  { value: 'dogpay', labelKey: 'DogPay virtual card' },
  { value: 'virtual', labelKey: 'Other virtual card' },
  { value: 'physical', labelKey: 'Physical card' },
  { value: 'other', labelKey: 'Other' },
]

export const PRODUCT_FULFILLMENT_CARD_STATUSES: Record<
  ProductFulfillmentCardStatus,
  Pick<StatusBadgeProps, 'variant'> & { labelKey: string }
> = {
  ready: { labelKey: 'Ready', variant: 'success' },
  in_use: { labelKey: 'In use', variant: 'blue' },
  disabled: { labelKey: 'Disabled', variant: 'neutral' },
  expired: { labelKey: 'Expired', variant: 'danger' },
}

// Mirrors ProductFulfillmentSteps in model/product_fulfillment_attempt.go.
export const PRODUCT_FULFILLMENT_STEPS: Record<
  ProductFulfillmentStepKey,
  { labelKey: string }
> = {
  prepare: { labelKey: 'Check order and settings' },
  submit: { labelKey: 'Send to fulfillment service' },
  queue: { labelKey: 'Wait in queue' },
  browser: { labelKey: 'Open browser' },
  subscription: { labelKey: 'Check existing subscription' },
  checkout: { labelKey: 'Create checkout' },
  fill_payment: { labelKey: 'Fill in card and billing address' },
  submit_payment: { labelKey: 'Submit payment' },
  confirm_payment: { labelKey: 'Wait for payment result' },
  complete: { labelKey: 'Complete order' },
}

export const PRODUCT_FULFILLMENT_STEP_STATUSES: Record<
  ProductFulfillmentStepStatus,
  Pick<StatusBadgeProps, 'variant'> & { labelKey: string }
> = {
  pending: { labelKey: 'Not run', variant: 'neutral' },
  running: { labelKey: 'In progress', variant: 'blue' },
  succeeded: { labelKey: 'Done', variant: 'success' },
  failed: { labelKey: 'Failed', variant: 'danger' },
}

// How often the payment records refresh while an attempt is running.
export const PRODUCT_FULFILLMENT_POLL_MS = 3000

export const PRODUCT_ORDER_STATUS_VALUES = Object.keys(
  PRODUCT_ORDER_STATUSES
) as ProductOrderStatus[]

// Mirrors productOrderTransitions in model/product.go.
export const PRODUCT_ORDER_TRANSITIONS: Record<
  ProductOrderStatus,
  ProductOrderStatus[]
> = {
  pending: ['paid', 'processing', 'completed', 'cancelled'],
  paid: ['processing', 'completed', 'refunded'],
  processing: ['completed', 'refunded'],
  completed: [],
  cancelled: [],
  refunded: [],
}

export const PRODUCT_INPUT_MAX_LENGTH_DEFAULT = 65536
