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
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import { updateProductOrder } from '../api'
import { PRODUCT_QUERY_KEYS } from '../constants'
import type { ProductOrder } from '../types'
import { OrderDetails } from './order-details'

type OrderManageDialogProps = {
  order: ProductOrder | null
  onOpenChange: (open: boolean) => void
}

export function OrderManageDialog(props: OrderManageDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [deliveryNote, setDeliveryNote] = useState('')
  const order = props.order

  useEffect(() => {
    setDeliveryNote(order?.delivery_note ?? '')
  }, [order])

  const mutation = useMutation({
    mutationFn: async () => {
      if (!order) return
      const result = await updateProductOrder(order.id, {
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

  return (
    <Dialog
      open
      onOpenChange={props.onOpenChange}
      title={t('Order details')}
      contentClassName='sm:max-w-2xl'
      footer={
        <>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Close')}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? t('Saving...') : t('Save changes')}
          </Button>
        </>
      }
    >
      <div className='space-y-5'>
        <OrderDetails order={order} allowCopySecrets />
        <div className='space-y-2'>
          <Label htmlFor='order-delivery-note'>{t('Delivery note')}</Label>
          <Textarea
            id='order-delivery-note'
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
