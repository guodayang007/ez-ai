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
import { Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import {
  formatProductPrice,
  getSkuSaving,
} from '@/features/products/lib/format'
import type { Product, ProductSku } from '@/features/products/types'
import { toIntlLocale } from '@/i18n/languages'
import { getLobeIcon } from '@/lib/lobe-icon'

type OrderSummaryProps = {
  product: Product
  sku: ProductSku
  /** Verified account email, shown once the session passes. */
  accountEmail?: string
  actionLabel: string
  actionDisabled?: boolean
  actionPending?: boolean
  /** Explains why the action is disabled, or what happens next. */
  hint?: string
  onAction: () => void
  onChangePlan?: () => void
}

/** Sticky checkout summary with the price breakdown and primary action. */
export function OrderSummary(props: OrderSummaryProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const saving = getSkuSaving(props.sku)
  const format = (amount: number) =>
    formatProductPrice(amount, props.sku.currency, locale)

  const actionButton = (className: string) => (
    <Button
      size='lg'
      className={className}
      disabled={props.actionDisabled || props.actionPending}
      onClick={props.onAction}
    >
      {props.actionPending && <Spinner />}
      {props.actionLabel}
    </Button>
  )

  return (
    <>
    <aside className='bg-card rounded-2xl border p-5 shadow-sm lg:sticky lg:top-20 sm:p-6'>
      <h2 className='text-base font-semibold'>{t('Order summary')}</h2>

      <div className='mt-4 flex items-center gap-3'>
        <span className='bg-muted flex size-11 shrink-0 items-center justify-center rounded-xl'>
          {getLobeIcon(props.product.icon, 26)}
        </span>
        <div className='min-w-0 flex-1'>
          <p className='truncate text-sm font-medium'>{props.product.title}</p>
          <p className='text-muted-foreground truncate text-xs'>
            {props.sku.name}
          </p>
        </div>
        {props.onChangePlan && (
          <Button variant='link' size='sm' onClick={props.onChangePlan}>
            {t('Change')}
          </Button>
        )}
      </div>

      {props.accountEmail && (
        <p className='bg-muted/50 mt-3 truncate rounded-lg px-3 py-2 text-xs'>
          <span className='text-muted-foreground'>{t('Account')}: </span>
          <span className='font-medium'>{props.accountEmail}</span>
        </p>
      )}

      <Separator className='my-4' />

      <dl className='space-y-2 text-sm'>
        {saving > 0 && (
          <>
            <div className='flex justify-between'>
              <dt className='text-muted-foreground'>{t('Original price')}</dt>
              <dd className='text-muted-foreground line-through'>
                {format(props.sku.original_price)}
              </dd>
            </div>
            <div className='flex justify-between'>
              <dt className='text-muted-foreground'>{t('Discount')}</dt>
              <dd className='text-success'>-{format(saving)}</dd>
            </div>
          </>
        )}
        <div className='flex items-baseline justify-between pt-1'>
          <dt className='font-medium'>{t('Total')}</dt>
          <dd className='text-2xl font-bold tracking-tight'>
            {format(props.sku.price_amount)}
          </dd>
        </div>
      </dl>

      {actionButton('mt-5 hidden w-full rounded-xl lg:inline-flex')}
      {props.hint && (
        <p className='text-muted-foreground mt-3 hidden text-center text-xs lg:block'>
          {props.hint}
        </p>
      )}
      <p className='text-muted-foreground mt-4 flex items-center justify-center gap-1.5 text-xs'>
        <Lock className='size-3.5' aria-hidden='true' />
        {t('Secure checkout')}
      </p>
    </aside>

    {/* On small screens the action stays reachable in a bottom bar. */}
    <div className='bg-background/95 supports-[backdrop-filter]:bg-background/80 fixed inset-x-0 bottom-0 z-40 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden'>
      <div className='mx-auto flex max-w-6xl items-center gap-4'>
        <div className='min-w-0 flex-1'>
          <p className='text-muted-foreground truncate text-xs'>
            {props.hint ?? props.sku.name}
          </p>
          <p className='text-xl font-bold tracking-tight'>
            {format(props.sku.price_amount)}
          </p>
        </div>
        {actionButton('shrink-0 rounded-xl px-6')}
      </div>
    </div>
    </>
  )
}
