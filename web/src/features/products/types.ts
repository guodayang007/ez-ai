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
  /** Upstream plan code bought automatically; empty means manual delivery. */
  fulfillment_plan: string
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
