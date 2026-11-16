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
import { api } from '@/lib/api'

import type {
  ApiResponse,
  PageData,
  Product,
  ProductOrder,
  ProductOrderListParams,
  ProductPayload,
} from './types'

function toQuery(params: ProductOrderListParams): string {
  const query = new URLSearchParams()
  query.set('p', String(params.p))
  query.set('page_size', String(params.page_size))
  if (params.status) query.set('status', params.status)
  if (params.keyword) query.set('keyword', params.keyword)
  return query.toString()
}

// Storefront

export async function getProducts(): Promise<ApiResponse<Product[]>> {
  const res = await api.get('/api/product/')
  return res.data
}

export async function createProductOrder(payload: {
  sku_id: number
  inputs: Record<string, string>
  remark: string
}): Promise<ApiResponse<ProductOrder>> {
  const res = await api.post('/api/product/order', payload)
  return res.data
}

export async function getSelfProductOrders(
  params: ProductOrderListParams
): Promise<ApiResponse<PageData<ProductOrder>>> {
  const res = await api.get(`/api/product/order/self?${toQuery(params)}`)
  return res.data
}

export async function cancelProductOrder(id: number): Promise<ApiResponse> {
  const res = await api.post(`/api/product/order/${id}/cancel`)
  return res.data
}

// Admin

export async function getAdminProducts(): Promise<ApiResponse<Product[]>> {
  const res = await api.get('/api/product/admin/products')
  return res.data
}

export async function createProduct(
  payload: ProductPayload
): Promise<ApiResponse<Product>> {
  const res = await api.post('/api/product/admin/products', payload)
  return res.data
}

export async function updateProduct(
  id: number,
  payload: ProductPayload
): Promise<ApiResponse<Product>> {
  const res = await api.put(`/api/product/admin/products/${id}`, payload)
  return res.data
}

export async function updateProductStatus(
  id: number,
  enabled: boolean
): Promise<ApiResponse> {
  const res = await api.patch(`/api/product/admin/products/${id}`, { enabled })
  return res.data
}

export async function deleteProduct(id: number): Promise<ApiResponse> {
  const res = await api.delete(`/api/product/admin/products/${id}`)
  return res.data
}

export async function getAdminProductOrders(
  params: ProductOrderListParams
): Promise<ApiResponse<PageData<ProductOrder>>> {
  const res = await api.get(`/api/product/admin/orders?${toQuery(params)}`)
  return res.data
}

export async function updateProductOrder(
  id: number,
  payload: { status?: string; delivery_note?: string }
): Promise<ApiResponse<ProductOrder>> {
  const res = await api.put(`/api/product/admin/orders/${id}`, payload)
  return res.data
}
