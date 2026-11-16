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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toIntlLocale } from '@/i18n/languages'
import { handleServerError } from '@/lib/handle-server-error'
import {
  createServerError,
  getServerErrorMessage,
} from '@/lib/server-error-message'

import { executeProductOrderPayment, getProductFulfillmentPlans } from '../api'
import { PRODUCT_QUERY_KEYS } from '../constants'
import { formatProductPrice } from '../lib/format'
import type { ProductOrder } from '../types'

type OrderPaymentDialogProps = {
  order: ProductOrder | null
  onOpenChange: (open: boolean) => void
}

/** Confirms "Execute payment" and lets the admin pick the plan to buy. */
export function OrderPaymentDialog(props: OrderPaymentDialogProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const queryClient = useQueryClient()
  const order = props.order
  const [plan, setPlan] = useState('')

  const plansQuery = useQuery({
    queryKey: PRODUCT_QUERY_KEYS.fulfillmentPlans,
    queryFn: async () => {
      const result = await getProductFulfillmentPlans()
      if (!result.success || !result.data) throw createServerError(result)
      return result.data.plans
    },
    enabled: order !== null,
  })
  const plans = plansQuery.data ?? []

  // A retry starts from the plan of the failed attempt; a single offered plan
  // is chosen for the admin.
  useEffect(() => {
    const offered = plansQuery.data ?? []
    if (order?.fulfillment_plan && offered.includes(order.fulfillment_plan)) {
      setPlan(order.fulfillment_plan)
    } else if (offered.length === 1) {
      setPlan(offered[0])
    } else {
      setPlan('')
    }
  }, [order, plansQuery.data])

  const mutation = useMutation({
    mutationFn: async () => {
      if (!order || !plan) return
      const result = await executeProductOrderPayment(order.id, plan)
      if (!result.success) throw createServerError(result)
    },
    onSuccess: () => {
      toast.success(
        t('Payment started. The order completes automatically once DogPay pays')
      )
      props.onOpenChange(false)
    },
    onError: (error) => handleServerError(error),
    // A rejected attempt is also recorded on the order, so refresh either way.
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: PRODUCT_QUERY_KEYS.adminOrders,
      }),
  })

  const planItems = plans.map((value) => ({ value, label: value }))
  let planHint = ''
  if (plansQuery.isPending) {
    planHint = t('Loading plans...')
  } else if (plansQuery.isError) {
    planHint = getServerErrorMessage(
      plansQuery.error,
      t('The fulfillment service is unavailable')
    )
  } else if (plans.length === 0) {
    planHint = t(
      'The fulfillment service offers no plans. Add plan codes to its ALLOWED_PLANS'
    )
  }

  return (
    <ConfirmDialog
      open={order !== null}
      onOpenChange={props.onOpenChange}
      title={t('Execute payment')}
      desc={
        order
          ? t(
              'Pay for order {{tradeNo}} ({{product}}, buyer paid {{price}}) with the DogPay card. The card is charged as soon as you confirm',
              {
                tradeNo: order.trade_no,
                product: `${order.product_title} · ${order.sku_name}`,
                price: formatProductPrice(
                  order.price_amount,
                  order.currency,
                  locale
                ),
              }
            )
          : ''
      }
      confirmText={t('Pay with DogPay')}
      disabled={!plan}
      isLoading={mutation.isPending}
      handleConfirm={() => mutation.mutate()}
    >
      <div className='space-y-2'>
        <Label htmlFor='order-payment-plan'>{t('Plan to buy')}</Label>
        <Select
          items={planItems}
          value={plan}
          onValueChange={(value) => setPlan(String(value ?? ''))}
          disabled={plans.length === 0}
        >
          <SelectTrigger id='order-payment-plan' className='w-full font-mono'>
            <SelectValue placeholder={t('Select')} />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {planItems.map((item) => (
                <SelectItem
                  key={item.value}
                  value={item.value}
                  className='font-mono'
                >
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {planHint && (
          <p className='text-muted-foreground text-xs'>{planHint}</p>
        )}
      </div>
    </ConfirmDialog>
  )
}
