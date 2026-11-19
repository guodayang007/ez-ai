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
export type ProductInputType =
  | 'text'
  | 'textarea'
  | 'secret'
  | 'json'
  | 'base64'
  | 'chatgpt_session'
  | 'claude_cookie'

export type ProductInputField = {
  key: string
  label: string
  type: ProductInputType
  required: boolean
  placeholder: string
  description: string
  max_length: number
}

export type ProductSku = {
  id: number
  product_id: number
  name: string
  price_amount: number
  original_price: number
  currency: string
  tag: string
  enabled: boolean
  sort_order: number
}

export type Product = {
  id: number
  title: string
  subtitle: string
  icon: string
  description: string
  enabled: boolean
  sort_order: number
  input_fields: ProductInputField[]
  created_at: number
  updated_at: number
  skus: ProductSku[]
}

export type ProductOrderStatus =
  | 'pending'
  | 'paid'
  | 'processing'
  | 'completed'
  | 'cancelled'
  | 'refunded'

export type ProductFulfillmentStatus = 'running' | 'succeeded' | 'failed'

export type ProductOrder = {
  id: number
  user_id: number
  username?: string
  trade_no: string
  product_id: number
  sku_id: number
  product_title: string
  sku_name: string
  price_amount: number
  currency: string
  input_fields: ProductInputField[]
  inputs: Record<string, string>
  status: ProductOrderStatus
  remark: string
  delivery_note: string
  created_at: number
  updated_at: number
  completed_at: number
  // Admin-only automatic fulfillment details; omitted for buyers.
  fulfillment_plan?: string
  fulfillment_status?: ProductFulfillmentStatus
  fulfillment_message?: string
  fulfillment_started_at?: number
  fulfillment_attempt_id?: number
}

/** Steps of one payment attempt, in the order they run. */
export type ProductFulfillmentStepKey =
  | 'prepare'
  | 'submit'
  | 'queue'
  | 'browser'
  | 'subscription'
  | 'checkout'
  | 'fill_payment'
  | 'submit_payment'
  | 'confirm_payment'
  | 'complete'

export type ProductFulfillmentStepStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'

/**
 * message is an English i18n key whose {{name}} placeholders are filled from
 * params; older records hold plain English text.
 */
export type ProductFulfillmentStepState = {
  key: ProductFulfillmentStepKey
  status: ProductFulfillmentStepStatus
  started_at: number
  finished_at: number
  message: string
  params?: Record<string, string>
}

/** One line of an attempt's detailed log; info is a detail within a step. */
export type ProductFulfillmentEvent = {
  at: number
  step: string
  status: ProductFulfillmentStepStatus | 'info'
  message: string
  params?: Record<string, string>
}

/** One click on "Execute payment" and everything that happened after it. */
export type ProductFulfillmentAttempt = {
  id: number
  /** Numbers the order's attempts from 1, oldest first. */
  seq: number
  order_id: number
  trade_no: string
  plan: string
  status: ProductFulfillmentStatus
  current_step: ProductFulfillmentStepKey | ''
  /** The card of the pool that paid; 0 for attempts made before the pool. */
  card_id: number
  /** The card's label and last four digits, e.g. "DogPay #1 •••• 1234". */
  card_label: string
  operator_id: number
  operator_name: string
  started_at: number
  finished_at: number
  updated_at: number
  steps: ProductFulfillmentStepState[]
  events: ProductFulfillmentEvent[]
}

/**
 * Whether the fulfiller service is usable. A broken setup is reported as a
 * state, so the page can tell the admin what to fix.
 */
export type ProductFulfillerState =
  | 'ok'
  | 'key_missing'
  | 'config_unreadable'
  | 'not_configured'
  | 'unreachable'
  | 'unauthorized'
  | 'error'

/** A fulfiller setting that must be filled in before payments can run. */
export type ProductFulfillerField = 'url' | 'secret' | 'plans' | 'cards'

export type ProductFulfillerHealth = {
  status: ProductFulfillerState
  /** The ChatGPT plans the admin may buy; empty unless the status is ok. */
  plans: string[]
  /** The Claude plans the admin may buy; empty unless the status is ok. */
  claude_plans: string[]
  service_url: string
  missing: ProductFulfillerField[]
}

export type ProductFulfillerBilling = {
  country: string
  currency: string
  line1: string
  city: string
  state: string
  postal_code: string
}

/**
 * The saved fulfiller settings as the server returns them: secrets are only
 * reported as set, and only the last four card digits are included.
 */
export type ProductFulfillmentConfigView = {
  encryption_ready: boolean
  readable: boolean
  url: string
  callback_url: string
  default_callback_url: string
  plans: string[]
  has_secret: boolean
  billing: ProductFulfillerBilling
}

/** Secret fields left out keep the saved value; an empty string clears it. */
export type ProductFulfillmentConfigUpdate = {
  url: string
  callback_url: string
  plans: string[]
  billing: ProductFulfillerBilling
  secret?: string
}

export type ProductFulfillmentCardProvider =
  | 'dogpay'
  | 'virtual'
  | 'physical'
  | 'other'

/**
 * ready: can pay. in_use: a payment is charging it now. disabled: switched
 * off, or declined by the bank (see disabled_reason). expired: past its
 * expiry month.
 */
export type ProductFulfillmentCardStatus =
  | 'ready'
  | 'in_use'
  | 'disabled'
  | 'expired'

/** Why a card is disabled: switched off by an admin, or declined by the bank. */
export type ProductFulfillmentCardDisabledReason = '' | 'manual' | 'declined'

/**
 * A card in the payment pool as the server returns it. The number and CVC
 * are write-only: only the brand and last four digits are ever shown.
 */
export type ProductFulfillmentCard = {
  id: number
  label: string
  provider: ProductFulfillmentCardProvider
  brand: string
  last4: string
  expiry_month: number
  expiry_year: number
  holder: string
  enabled: boolean
  priority: number
  status: ProductFulfillmentCardStatus
  disabled_reason: ProductFulfillmentCardDisabledReason
  /** Unix seconds; 0 when the card has never paid. */
  last_used_at: number
  success_count: number
  fail_count: number
}

/**
 * Create and update payloads. On update number and cvc are only replaced
 * when sent non-empty.
 */
export type ProductFulfillmentCardInput = {
  label: string
  provider: ProductFulfillmentCardProvider
  number?: string
  expiry: string
  cvc?: string
  holder: string
  priority: number
  enabled: boolean
}

export type ApiResponse<T = unknown> = {
  success: boolean
  message?: string
  data?: T
}

export type PageData<T> = {
  items: T[]
  total: number
  page: number
  page_size: number
}

export type ProductPayload = Omit<
  Product,
  'id' | 'created_at' | 'updated_at' | 'skus'
> & {
  skus: Array<Omit<ProductSku, 'id' | 'product_id'> & { id?: number }>
}

export type ProductOrderListParams = {
  p: number
  page_size: number
  status?: string
  keyword?: string
}
