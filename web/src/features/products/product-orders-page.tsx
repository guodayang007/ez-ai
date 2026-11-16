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
import { getRouteApi } from '@tanstack/react-router'
import { CreditCard, Eye, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'

import { getAdminProductOrders } from './api'
import { OrderManageDialog } from './components/order-manage-dialog'
import { OrderStatusDialog } from './components/order-status-dialog'
import { OrdersTable } from './components/orders-table'
import { PRODUCT_ORDER_TRANSITIONS, PRODUCT_QUERY_KEYS } from './constants'
import type { ProductOrder } from './types'

const route = getRouteApi('/_authenticated/product-orders/')

export function ProductOrdersPage() {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<ProductOrder | null>(null)
  const [statusTarget, setStatusTarget] = useState<ProductOrder | null>(null)

  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>{t('Product Orders')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <OrdersTable
            queryKey={PRODUCT_QUERY_KEYS.adminOrders}
            fetchOrders={getAdminProductOrders}
            search={route.useSearch()}
            navigate={route.useNavigate()}
            showUser
            emptyDescription={t('Orders placed in the store will appear here.')}
            renderActions={(order) => (
              <div className='-ml-1.5 flex items-center gap-1'>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => setSelected(order)}
                >
                  <Eye />
                  {t('Details')}
                </Button>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => setStatusTarget(order)}
                  disabled={
                    PRODUCT_ORDER_TRANSITIONS[order.status].length === 0
                  }
                >
                  <RefreshCw />
                  {t('Change status')}
                </Button>
                {/* Placeholder until the admin payment flow is designed. */}
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() =>
                    toast.info(t('Payment execution is not available yet'))
                  }
                >
                  <CreditCard />
                  {t('Execute payment')}
                </Button>
              </div>
            )}
          />
        </SectionPageLayout.Content>
      </SectionPageLayout>
      <OrderManageDialog
        order={selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
      <OrderStatusDialog
        order={statusTarget}
        onOpenChange={(open) => !open && setStatusTarget(null)}
      />
    </>
  )
}
