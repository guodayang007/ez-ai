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
import { Trash2 } from 'lucide-react'
import { type Control, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { toIntlLocale } from '@/i18n/languages'
import { cn } from '@/lib/utils'

import { formatProductPrice } from '../lib/format'
import type { ProductFormValues } from '../lib/product-form'

type SkuEditorProps = {
  control: Control<ProductFormValues>
  index: number
  canRemove: boolean
  onRemove: () => void
}

export function SkuEditor(props: SkuEditorProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const prefix = `skus.${props.index}` as const
  const sku = useWatch({ control: props.control, name: prefix })
  const name = sku?.name?.trim()
  const currency = sku?.currency?.trim().toUpperCase() || 'USD'

  return (
    <div
      className={cn(
        'bg-card overflow-hidden rounded-xl border',
        sku?.enabled === false && 'opacity-80'
      )}
    >
      <div className='bg-muted/40 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3'>
        <div className='flex min-w-0 items-center gap-3'>
          <span className='bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold tabular-nums'>
            {props.index + 1}
          </span>
          <div className='min-w-0'>
            <p className='truncate text-sm font-semibold'>
              {name || t('Specification {{index}}', { index: props.index + 1 })}
            </p>
            <p className='text-muted-foreground text-xs tabular-nums'>
              {formatProductPrice(sku?.price_amount ?? 0, currency, locale)}
            </p>
          </div>
        </div>
        <div className='flex items-center gap-2'>
          <FormField
            control={props.control}
            name={`${prefix}.enabled`}
            render={({ field }) => (
              <FormItem className='flex flex-row items-center gap-2'>
                <FormLabel className='!mt-0 text-xs'>{t('On sale')}</FormLabel>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            className='text-muted-foreground hover:text-destructive'
            disabled={!props.canRemove}
            onClick={props.onRemove}
            aria-label={t('Remove specification')}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      <div className='p-4'>
        <div className='grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-4'>
          <FormField
            control={props.control}
            name={`${prefix}.name`}
            render={({ field }) => (
              <FormItem className='sm:col-span-2 lg:col-span-3'>
                <FormLabel required>{t('Specification name')}</FormLabel>
                <FormControl>
                  <Input {...field} placeholder={t('e.g. Plus / 1 month')} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={props.control}
            name={`${prefix}.sort_order`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Sort order')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    value={field.value}
                    onChange={(e) =>
                      field.onChange(Number.parseInt(e.target.value, 10) || 0)
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={props.control}
            name={`${prefix}.price_amount`}
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t('Price')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={0}
                    step='0.01'
                    value={field.value}
                    onChange={(e) =>
                      field.onChange(Number.parseFloat(e.target.value) || 0)
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={props.control}
            name={`${prefix}.original_price`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Original price')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={0}
                    step='0.01'
                    value={field.value}
                    onChange={(e) =>
                      field.onChange(Number.parseFloat(e.target.value) || 0)
                    }
                  />
                </FormControl>
                <FormDescription className='text-xs'>
                  {t('Optional. Buyers see the difference as their saving')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={props.control}
            name={`${prefix}.currency`}
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t('Currency')}</FormLabel>
                <FormControl>
                  <Input {...field} placeholder='USD' />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={props.control}
            name={`${prefix}.tag`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Tag')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder={t('e.g. Monthly auto top-up')}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>
    </div>
  )
}
