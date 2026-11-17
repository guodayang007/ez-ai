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
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
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

import { executeProductOrderPayment, getProductFulfillerHealth } from '../api'
import { PRODUCT_QUERY_KEYS } from '../constants'
import { formatProductPrice } from '../lib/format'
import {
  canExecutePayment,
  FULFILLER_SETTINGS_SECTION,
  getDefaultPlan,
  getOrderPlans,
  isFulfillerReady,
} from '../lib/fulfillment'
import type { ProductOrder } from '../types'
import { FulfillerSetupNotice } from './fulfiller-setup-notice'
import { OrderStatusBadge } from './order-details'

type OrderPaymentDialogProps = {
  order: ProductOrder | null
  onOpenChange: (open: boolean) => void
  /** Called with the order once its payment has started, to follow it. */
  onStarted?: (order: ProductOrder) => void
}

/**
 * Confirms "Execute payment" and lets the admin pick the plan to buy. When
 * the fulfiller cannot take the payment yet, it explains what to set up and
 * the main button leads there instead of staying disabled.
 */
export function OrderPaymentDialog(props: OrderPaymentDialogProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const order = props.order
  const payable = order !== null && canExecutePayment(order)
  const [plan, setPlan] = useState('')

  const healthQuery = useQuery({
    queryKey: PRODUCT_QUERY_KEYS.fulfillerHealth,
    queryFn: async () => {
      const result = await getProductFulfillerHealth()
      if (!result.success || !result.data) throw createServerError(result)
      return result.data
    },
    enabled: payable,
    // Re-check on every open: the admin may have just fixed the setup.
    staleTime: 0,
    meta: { errorToast: false },
  })
  const health = healthQuery.data
  const ready = health !== undefined && isFulfillerReady(health)
  // A Claude order is bought with a Claude plan, any other with a ChatGPT one.
  const plans = ready && order ? getOrderPlans(order, health) : []

  useEffect(() => {
    const data = healthQuery.data
    setPlan(
      order && data ? getDefaultPlan(order, getOrderPlans(order, data)) : ''
    )
  }, [order, healthQuery.data])

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
      if (order) props.onStarted?.(order)
    },
    onError: (error) => handleServerError(error),
    // A rejected attempt is also recorded on the order and in its payment
    // records, so refresh either way.
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: PRODUCT_QUERY_KEYS.adminOrders,
      })
      void queryClient.invalidateQueries({
        queryKey: PRODUCT_QUERY_KEYS.fulfillmentAttempts,
      })
    },
  })

  const recheck = () => void healthQuery.refetch()
  const openSettings = () => {
    props.onOpenChange(false)
    void navigate({
      to: '/system-settings/billing/$section',
      params: { section: FULFILLER_SETTINGS_SECTION },
    })
  }

  // The main button always does something useful: pay, open the settings
  // that need fixing, or check the service again after starting it.
  let confirmText = t('Pay with DogPay')
  let handleConfirm = () => mutation.mutate()
  let confirmDisabled = !payable || !plan
  // An encryption key or a stopped service is fixed on the server; the rest
  // is fixed on the settings page.
  const fixedInSettings =
    health?.status === 'not_configured' ||
    health?.status === 'unauthorized' ||
    health?.status === 'config_unreadable'
  if (payable && health && !ready) {
    confirmText = fixedInSettings
      ? t('Open fulfillment settings')
      : t('Check again')
    handleConfirm = fixedInSettings ? openSettings : recheck
    confirmDisabled = healthQuery.isFetching
  } else if (payable && healthQuery.isError) {
    confirmText = t('Check again')
    handleConfirm = recheck
    confirmDisabled = healthQuery.isFetching
  }

  const planItems = plans.map((value) => ({ value, label: value }))

  let body: ReactNode
  if (order && !payable) {
    body = (
      <div className='space-y-2 text-sm'>
        <div className='flex items-center gap-2'>
          <span className='text-muted-foreground'>{t('Current status')}</span>
          <OrderStatusBadge status={order.status} />
        </div>
        <p className='text-destructive'>
          {t('Automatic payment is already running for this order')}
        </p>
      </div>
    )
  } else if (healthQuery.isPending) {
    body = (
      <p className='text-muted-foreground text-sm'>
        {t('Checking the fulfillment service...')}
      </p>
    )
  } else if (healthQuery.isError) {
    body = (
      <p className='text-destructive text-sm'>
        {getServerErrorMessage(
          healthQuery.error,
          t('The fulfillment service is unavailable')
        )}
      </p>
    )
  } else if (!ready) {
    body = (
      // The notice offers whichever of the two actions the main button
      // does not.
      <FulfillerSetupNotice
        health={healthQuery.data}
        showSettingsLink={!fixedInSettings}
        onRecheck={fixedInSettings ? recheck : undefined}
        isRechecking={healthQuery.isFetching}
      />
    )
  } else {
    body = (
      <div className='space-y-2'>
        <Label htmlFor='order-payment-plan'>{t('Plan to buy')}</Label>
        <Select
          items={planItems}
          value={plan}
          onValueChange={(value) => setPlan(String(value ?? ''))}
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
      </div>
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
      confirmText={confirmText}
      disabled={confirmDisabled}
      isLoading={mutation.isPending}
      handleConfirm={handleConfirm}
    >
      {body}
    </ConfirmDialog>
  )
}
