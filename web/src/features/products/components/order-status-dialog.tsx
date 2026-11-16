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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import { updateProductOrder } from '../api'
import {
  PRODUCT_ORDER_STATUSES,
  PRODUCT_ORDER_TRANSITIONS,
  PRODUCT_QUERY_KEYS,
} from '../constants'
import type { ProductOrder, ProductOrderStatus } from '../types'
import { OrderStatusBadge } from './order-details'

type OrderStatusDialogProps = {
  order: ProductOrder | null
  onOpenChange: (open: boolean) => void
}

export function OrderStatusDialog(props: OrderStatusDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<ProductOrderStatus | ''>('')
  const [deliveryNote, setDeliveryNote] = useState('')
  const order = props.order

  useEffect(() => {
    setStatus('')
    setDeliveryNote(order?.delivery_note ?? '')
  }, [order])

  const mutation = useMutation({
    mutationFn: async () => {
      if (!order || !status) return
      const result = await updateProductOrder(order.id, {
        status,
        delivery_note: deliveryNote,
      })
      if (!result.success) throw createServerError(result)
    },
    onSuccess: () => {
      toast.success(t('Order updated'))
      void queryClient.invalidateQueries({
        queryKey: PRODUCT_QUERY_KEYS.adminOrders,
      })
      props.onOpenChange(false)
    },
    onError: (error) => handleServerError(error),
  })

  if (!order) return null

  const statusItems = PRODUCT_ORDER_TRANSITIONS[order.status].map((value) => ({
    value,
    label: t(PRODUCT_ORDER_STATUSES[value].labelKey),
  }))

  return (
    <Dialog
      open
      onOpenChange={props.onOpenChange}
      title={t('Change status')}
      description={order.trade_no}
      footer={
        <>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!status || mutation.isPending}
          >
            {mutation.isPending ? t('Saving...') : t('Save')}
          </Button>
        </>
      }
    >
      <div className='space-y-5'>
        <div className='flex items-center gap-2 text-sm'>
          <span className='text-muted-foreground'>{t('Current status')}</span>
          <OrderStatusBadge status={order.status} />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='order-status'>{t('New status')}</Label>
          <Select
            items={statusItems}
            value={status}
            onValueChange={(value) => setStatus(value as ProductOrderStatus)}
          >
            <SelectTrigger id='order-status' className='w-full'>
              <SelectValue placeholder={t('Select')} />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {statusItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-2'>
          <Label htmlFor='order-status-delivery-note'>
            {t('Delivery note')}
          </Label>
          <Textarea
            id='order-status-delivery-note'
            rows={3}
            value={deliveryNote}
            onChange={(e) => setDeliveryNote(e.target.value)}
            placeholder={t('Visible to the buyer, e.g. activation result')}
          />
        </div>
      </div>
    </Dialog>
  )
}
