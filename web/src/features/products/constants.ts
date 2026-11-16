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

import type { ProductInputType, ProductOrderStatus } from './types'

export const PRODUCT_QUERY_KEYS = {
  adminProducts: ['admin-products'] as const,
  adminOrders: ['admin-product-orders'] as const,
  storeProducts: ['store-products'] as const,
  selfOrders: ['self-product-orders'] as const,
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
]

// Input types whose values the server masks before showing them to the buyer.
export const PRODUCT_MASKED_INPUT_TYPES: ReadonlySet<ProductInputType> =
  new Set(['secret', 'chatgpt_session'])

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
