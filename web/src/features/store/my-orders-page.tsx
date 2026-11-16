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
import { Link, getRouteApi } from '@tanstack/react-router'
import { Eye, ShoppingBag } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  cancelProductOrder,
  getSelfProductOrders,
} from '@/features/products/api'
import { OrderDetails } from '@/features/products/components/order-details'
import { OrdersTable } from '@/features/products/components/orders-table'
import { PRODUCT_QUERY_KEYS } from '@/features/products/constants'
import type { ProductOrder } from '@/features/products/types'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

const route = getRouteApi('/_authenticated/store/orders/')

export function MyOrdersPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [viewing, setViewing] = useState<ProductOrder | null>(null)
  const [cancelling, setCancelling] = useState<ProductOrder | null>(null)

  const cancelMutation = useMutation({
    mutationFn: async (order: ProductOrder) => {
      const result = await cancelProductOrder(order.id)
      if (!result.success) throw createServerError(result)
    },
    onSuccess: () => {
      toast.success(t('Order cancelled'))
      setCancelling(null)
      void queryClient.invalidateQueries({
        queryKey: PRODUCT_QUERY_KEYS.selfOrders,
      })
    },
    onError: (error) => handleServerError(error),
  })

  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>{t('My Orders')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button variant='outline' render={<Link to='/store' />}>
            <ShoppingBag />
            {t('Shop')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <OrdersTable
            queryKey={PRODUCT_QUERY_KEYS.selfOrders}
            fetchOrders={getSelfProductOrders}
            search={route.useSearch()}
            navigate={route.useNavigate()}
            showUser={false}
            emptyDescription={t('Orders you place in the store appear here.')}
            renderActions={(order) => (
              <div className='-ml-1.5 flex items-center gap-1'>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => setViewing(order)}
                >
                  <Eye />
                  {t('View')}
                </Button>
                {order.status === 'pending' && (
                  <Button
                    variant='ghost'
                    size='sm'
                    className='text-destructive'
                    onClick={() => setCancelling(order)}
                  >
                    {t('Cancel')}
                  </Button>
                )}
              </div>
            )}
          />
        </SectionPageLayout.Content>
      </SectionPageLayout>

      {viewing && (
        <Dialog
          open
          onOpenChange={(open) => !open && setViewing(null)}
          title={t('Order details')}
        >
          <OrderDetails order={viewing} allowCopySecrets={false} />
        </Dialog>
      )}

      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => !open && setCancelling(null)}
        title={t('Cancel order')}
        desc={t('Cancel order {{tradeNo}}?', {
          tradeNo: cancelling?.trade_no ?? '',
        })}
        destructive
        confirmText={t('Cancel order')}
        isLoading={cancelMutation.isPending}
        handleConfirm={() => cancelling && cancelMutation.mutate(cancelling)}
      />
    </>
  )
}
