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
import { formatNumber } from '@/lib/format'

import type { ProductSku } from '../types'

/**
 * Formats a price in the SKU's own currency. Product prices are entered in a
 * fixed currency and are not converted to the site display currency, so the
 * quota-based formatters in @/lib/currency do not apply. Non-ISO codes such as
 * USDT fall back to "amount CODE".
 */
export function formatProductPrice(
  amount: number,
  currency: string,
  locale?: string
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${formatNumber(amount, locale)} ${currency}`
  }
}

/** Returns the SKU with the lowest price, used as the "from" price. */
export function getLowestPricedSku(skus: ProductSku[]): ProductSku | null {
  let lowest: ProductSku | null = null
  for (const sku of skus) {
    if (!lowest || sku.price_amount < lowest.price_amount) lowest = sku
  }
  return lowest
}

/** The amount saved against the original price, or 0 when there is none. */
export function getSkuSaving(sku: ProductSku): number {
  if (sku.original_price <= sku.price_amount) return 0
  return Math.round((sku.original_price - sku.price_amount) * 100) / 100
}
