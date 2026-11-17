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

import { CopyButton } from '@/components/copy-button'
import { StatusBadge } from '@/components/status-badge'
import { toIntlLocale } from '@/i18n/languages'
import { formatTimestampToDate } from '@/lib/format'

import {
  PRODUCT_FULFILLMENT_STATUSES,
  PRODUCT_MASKED_INPUT_TYPES,
  PRODUCT_ORDER_STATUSES,
} from '../constants'
import { formatProductPrice } from '../lib/format'
import type { ProductFulfillmentStatus, ProductOrder } from '../types'

type OrderDetailsProps = {
  order: ProductOrder
  /** Buyers see masked secrets, so copying them is pointless. */
  allowCopySecrets: boolean
}

export function OrderStatusBadge(props: { status: ProductOrder['status'] }) {
  const { t } = useTranslation()
  const config = PRODUCT_ORDER_STATUSES[props.status]
  return (
    <StatusBadge
      label={config ? t(config.labelKey) : props.status}
      variant={config?.variant ?? 'neutral'}
      copyable={false}
    />
  )
}

export function FulfillmentStatusBadge(props: {
  status: ProductFulfillmentStatus
}) {
  const { t } = useTranslation()
  const config = PRODUCT_FULFILLMENT_STATUSES[props.status]
  return (
    <StatusBadge
      label={config ? t(config.labelKey) : props.status}
      variant={config?.variant ?? 'neutral'}
      copyable={false}
    />
  )
}

export function OrderDetails(props: OrderDetailsProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const order = props.order
  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: t('Order number'), value: order.trade_no },
    {
      label: t('Product'),
      value: `${order.product_title} · ${order.sku_name}`,
    },
    {
      label: t('Price'),
      value: formatProductPrice(order.price_amount, order.currency, locale),
    },
    { label: t('Status'), value: <OrderStatusBadge status={order.status} /> },
    { label: t('Created'), value: formatTimestampToDate(order.created_at) },
  ]
  if (order.username !== undefined) {
    rows.splice(1, 0, {
      label: t('User'),
      value: `${order.username || '-'} (ID ${order.user_id})`,
    })
  }
  if (order.fulfillment_plan) {
    rows.push({
      label: t('Fulfillment plan'),
      value: <span className='font-mono'>{order.fulfillment_plan}</span>,
    })
  }
  if (order.fulfillment_status) {
    rows.push({
      label: t('Automatic payment'),
      value: <FulfillmentStatusBadge status={order.fulfillment_status} />,
    })
  }
  if (order.completed_at > 0) {
    rows.push({
      label: t('Completed'),
      value: formatTimestampToDate(order.completed_at),
    })
  }

  return (
    <div className='space-y-5'>
      <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm'>
        {rows.map((row) => (
          <div key={row.label} className='contents'>
            <dt className='text-muted-foreground'>{row.label}</dt>
            <dd className='min-w-0 break-all'>{row.value}</dd>
          </div>
        ))}
      </dl>

      <section className='space-y-2'>
        <h4 className='text-sm font-semibold'>{t('Submitted information')}</h4>
        {order.input_fields.length === 0 && (
          <p className='text-muted-foreground text-sm'>
            {t('No information was required for this order')}
          </p>
        )}
        {order.input_fields.map((field) => {
          const value = order.inputs[field.key] ?? ''
          const canCopy =
            value !== '' &&
            (props.allowCopySecrets ||
              !PRODUCT_MASKED_INPUT_TYPES.has(field.type))
          return (
            <div key={field.key} className='rounded-md border p-3'>
              <div className='mb-1 flex items-center justify-between gap-2'>
                <span className='text-sm font-medium'>{field.label}</span>
                {canCopy && (
                  <CopyButton value={value} size='icon' tooltip={t('Copy')} />
                )}
              </div>
              <pre className='bg-muted/40 max-h-48 overflow-auto rounded p-2 font-mono text-xs break-all whitespace-pre-wrap'>
                {value || '-'}
              </pre>
            </div>
          )
        })}
      </section>

      {order.remark && (
        <section className='space-y-1'>
          <h4 className='text-sm font-semibold'>{t('Buyer remark')}</h4>
          <p className='text-sm whitespace-pre-wrap'>{order.remark}</p>
        </section>
      )}
      {order.fulfillment_message && (
        <section className='space-y-1'>
          <h4 className='text-sm font-semibold'>
            {t('Automatic payment result')}
          </h4>
          <p className='text-sm break-all whitespace-pre-wrap'>
            {order.fulfillment_message}
          </p>
        </section>
      )}
      {order.delivery_note && (
        <section className='space-y-1'>
          <h4 className='text-sm font-semibold'>{t('Delivery note')}</h4>
          <p className='text-sm whitespace-pre-wrap'>{order.delivery_note}</p>
        </section>
      )}
    </div>
  )
}
