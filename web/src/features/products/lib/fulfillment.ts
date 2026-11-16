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
import type { ProductOrder } from '../types'

/**
 * Whether "Execute payment" may buy the order's plan with the DogPay card.
 * Mirrors CanStartProductFulfillment in model/product.go: the buyer has paid,
 * or an earlier automatic attempt failed.
 */
export function canExecutePayment(order: ProductOrder): boolean {
  if (!order.fulfillment_plan) return false
  const fulfillment = order.fulfillment_status ?? ''
  if (order.status === 'paid') {
    return fulfillment === '' || fulfillment === 'failed'
  }
  if (order.status === 'processing') {
    return fulfillment === 'failed'
  }
  return false
}
