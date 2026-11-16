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
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  formatProductPrice,
  getLowestPricedSku,
} from '@/features/products/lib/format'
import type { Product } from '@/features/products/types'
import { toIntlLocale } from '@/i18n/languages'
import { getLobeIcon } from '@/lib/lobe-icon'

const VISIBLE_PLAN_CHIPS = 4

type ProductShowcaseCardProps = {
  product: Product
  onSelect: () => void
}

/** A storefront card; the whole card opens the product's checkout. */
export function ProductShowcaseCard(props: ProductShowcaseCardProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const lowest = getLowestPricedSku(props.product.skus)
  const chips = props.product.skus.slice(0, VISIBLE_PLAN_CHIPS)
  const hiddenCount = props.product.skus.length - chips.length

  return (
    <button
      type='button'
      onClick={props.onSelect}
      className='group bg-card hover:border-primary/40 focus-visible:ring-ring flex h-full flex-col rounded-2xl border p-6 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:outline-none'
    >
      <div className='flex items-center gap-4'>
        <span className='bg-muted flex size-14 shrink-0 items-center justify-center rounded-2xl'>
          {getLobeIcon(props.product.icon, 36)}
        </span>
        <div className='min-w-0'>
          <p className='truncate text-lg font-semibold'>
            {props.product.title}
          </p>
          {props.product.subtitle && (
            <p className='text-muted-foreground truncate text-sm'>
              {props.product.subtitle}
            </p>
          )}
        </div>
      </div>

      {props.product.description && (
        <p className='text-muted-foreground mt-4 line-clamp-3 text-sm leading-relaxed'>
          {props.product.description}
        </p>
      )}

      <ul className='mt-4 flex flex-wrap gap-1.5'>
        {chips.map((sku) => (
          <li
            key={sku.id}
            className='bg-muted/60 rounded-full px-2.5 py-0.5 text-xs font-medium'
          >
            {sku.name}
          </li>
        ))}
        {hiddenCount > 0 && (
          <li className='text-muted-foreground rounded-full px-1 py-0.5 text-xs'>
            +{hiddenCount}
          </li>
        )}
      </ul>

      <div className='min-h-5 flex-1' aria-hidden='true' />
      <div className='flex items-end justify-between gap-3 border-t pt-4'>
        {lowest && (
          <div>
            <p className='text-muted-foreground text-xs'>{t('Starting at')}</p>
            <p className='text-2xl font-bold tracking-tight'>
              {formatProductPrice(lowest.price_amount, lowest.currency, locale)}
            </p>
          </div>
        )}
        <span className='bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-full px-4 py-2 text-sm font-medium transition-transform group-hover:translate-x-0.5'>
          {t('Subscribe')}
          <ArrowRight className='size-4' aria-hidden='true' />
        </span>
      </div>
    </button>
  )
}
