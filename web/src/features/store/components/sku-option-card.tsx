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
import { useTranslation } from 'react-i18next'

import { Label } from '@/components/ui/label'
import { RadioGroupItem } from '@/components/ui/radio-group'
import {
  formatProductPrice,
  getSkuSaving,
} from '@/features/products/lib/format'
import type { ProductSku } from '@/features/products/types'
import { toIntlLocale } from '@/i18n/languages'
import { getLobeIcon } from '@/lib/lobe-icon'

type SkuOptionCardProps = {
  sku: ProductSku
  icon: string
}

/** A selectable specification card: name, price, saving and tag. */
export function SkuOptionCard(props: SkuOptionCardProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const saving = getSkuSaving(props.sku)
  const id = `sku-${props.sku.id}`

  return (
    <Label
      htmlFor={id}
      className='relative has-[[data-checked]]:border-primary has-[[data-checked]]:ring-primary/30 has-[:focus-visible]:ring-ring flex cursor-pointer flex-col items-stretch gap-6 rounded-xl border p-4 font-normal transition-colors has-[[data-checked]]:ring-2'
    >
      <RadioGroupItem
        id={id}
        value={String(props.sku.id)}
        // RadioGroupItem sets position: relative, which defeats sr-only and
        // leaves an empty row in the card; keep it out of the flow instead.
        className='pointer-events-none absolute top-0 left-0 opacity-0'
      />
      <div className='flex items-start justify-between gap-2'>
        <span className='text-base font-semibold'>{props.sku.name}</span>
        <span className='shrink-0' aria-hidden='true'>
          {getLobeIcon(props.icon, 24)}
        </span>
      </div>
      <div className='space-y-1'>
        <p className='text-xl font-semibold'>
          {formatProductPrice(
            props.sku.price_amount,
            props.sku.currency,
            locale
          )}
        </p>
        {(saving > 0 || props.sku.tag) && (
          <p className='flex flex-wrap items-center gap-x-2 text-xs'>
            {saving > 0 && (
              <span className='text-success'>
                {t('Save {{amount}}', {
                  amount: formatProductPrice(
                    saving,
                    props.sku.currency,
                    locale
                  ),
                })}
              </span>
            )}
            {saving > 0 && props.sku.tag && (
              <span className='text-border' aria-hidden='true'>
                |
              </span>
            )}
            {props.sku.tag && (
              <span className='text-muted-foreground'>{props.sku.tag}</span>
            )}
          </p>
        )}
      </div>
    </Label>
  )
}
