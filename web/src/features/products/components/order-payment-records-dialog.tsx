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
import { useQuery } from '@tanstack/react-query'
import { History } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { formatTimestampToDate } from '@/lib/format'
import {
  createServerError,
  getServerErrorMessage,
} from '@/lib/server-error-message'

import { getProductOrderFulfillments } from '../api'
import { PRODUCT_FULFILLMENT_POLL_MS, PRODUCT_QUERY_KEYS } from '../constants'
import type { ProductOrder } from '../types'
import { FulfillmentStatusBadge } from './order-details'
import { PaymentAttemptDetails } from './payment-attempt-details'

type OrderPaymentRecordsDialogProps = {
  order: ProductOrder | null
  onOpenChange: (open: boolean) => void
}

/**
 * Every "Execute payment" attempt of an order, newest first and open. It
 * refreshes on its own while an attempt is still running.
 */
export function OrderPaymentRecordsDialog(
  props: OrderPaymentRecordsDialogProps
) {
  const { t } = useTranslation()
  const order = props.order
  const query = useQuery({
    queryKey: [...PRODUCT_QUERY_KEYS.fulfillmentAttempts, order?.id],
    queryFn: async () => {
      if (!order) return []
      const result = await getProductOrderFulfillments(order.id)
      if (!result.success) throw createServerError(result)
      return result.data ?? []
    },
    enabled: order !== null,
    staleTime: 0,
    refetchInterval: (current) =>
      current.state.data?.some((attempt) => attempt.status === 'running')
        ? PRODUCT_FULFILLMENT_POLL_MS
        : false,
    meta: { errorToast: false },
  })

  if (!order) return null

  const attempts = query.data ?? []
  let body: React.ReactNode
  if (query.isPending) {
    body = <LoadingState />
  } else if (query.isError) {
    body = (
      <ErrorState
        description={getServerErrorMessage(
          query.error,
          t('Failed to load payment records')
        )}
        onRetry={() => void query.refetch()}
      />
    )
  } else if (attempts.length === 0) {
    body = (
      <EmptyState
        icon={History}
        title={t('No payment records yet')}
        description={t(
          'Each click on Execute payment is recorded here with every step'
        )}
      />
    )
  } else {
    body = (
      <Accordion defaultValue={[attempts[0].id]}>
        {attempts.map((attempt) => (
          <AccordionItem key={attempt.id} value={attempt.id}>
            <AccordionTrigger className='hover:no-underline'>
              <span className='flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1'>
                <span>{t('Attempt {{seq}}', { seq: attempt.seq })}</span>
                <FulfillmentStatusBadge status={attempt.status} />
                <span className='text-muted-foreground font-mono text-xs font-normal'>
                  {attempt.plan} · {formatTimestampToDate(attempt.started_at)}
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <PaymentAttemptDetails attempt={attempt} />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    )
  }

  return (
    <Dialog
      open
      onOpenChange={props.onOpenChange}
      title={t('Payment records')}
      description={`${order.trade_no} · ${order.product_title} · ${order.sku_name}`}
      contentClassName='sm:max-w-3xl'
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            {t('Refresh')}
          </Button>
          <Button onClick={() => props.onOpenChange(false)}>
            {t('Close')}
          </Button>
        </>
      }
    >
      {body}
    </Dialog>
  )
}
