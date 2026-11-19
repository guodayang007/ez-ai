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
import { Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  StaticDataTable,
  type StaticDataTableColumn,
  StaticRowActions,
} from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import {
  deleteProductFulfillmentCard,
  getProductFulfillmentCards,
  updateProductFulfillmentCard,
} from '../api'
import {
  PRODUCT_FULFILLMENT_CARD_PROVIDERS,
  PRODUCT_FULFILLMENT_CARD_STATUSES,
  PRODUCT_QUERY_KEYS,
} from '../constants'
import type { ProductFulfillmentCard } from '../types'
import { FulfillmentCardDialog } from './fulfillment-card-dialog'

/**
 * The payment card pool: the cards "Execute payment" may charge. Automatic
 * payments pick one at random. Only the brand and last four digits are ever shown.
 */
export function FulfillmentCardPool() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<ProductFulfillmentCard | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState<ProductFulfillmentCard | null>(null)

  const cardsQuery = useQuery({
    queryKey: PRODUCT_QUERY_KEYS.fulfillmentCards,
    queryFn: async () => {
      const result = await getProductFulfillmentCards()
      if (!result.success || !result.data) throw createServerError(result)
      return result.data
    },
  })

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: PRODUCT_QUERY_KEYS.fulfillmentCards,
    })
    void queryClient.invalidateQueries({
      queryKey: PRODUCT_QUERY_KEYS.fulfillerHealth,
    })
  }

  const toggleMutation = useMutation({
    mutationFn: async (variables: { id: number; enabled: boolean }) => {
      const result = await updateProductFulfillmentCard(variables.id, {
        enabled: variables.enabled,
      })
      if (!result.success) throw createServerError(result)
    },
    onError: (error) => handleServerError(error),
    onSettled: refresh,
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const result = await deleteProductFulfillmentCard(id)
      if (!result.success) throw createServerError(result)
    },
    onSuccess: () => {
      toast.success(t('Card deleted'))
      setDeleting(null)
    },
    onError: (error) => handleServerError(error),
    onSettled: refresh,
  })

  const openAdd = () => {
    setEditing(null)
    setDialogOpen(true)
  }
  const openEdit = (card: ProductFulfillmentCard) => {
    setEditing(card)
    setDialogOpen(true)
  }

  let body: ReactNode
  if (cardsQuery.isPending) {
    body = <LoadingState />
  } else if (cardsQuery.isError) {
    body = <ErrorState title={t('Failed to load the card pool')} />
  } else {
    const cards = cardsQuery.data
    const columns: StaticDataTableColumn<ProductFulfillmentCard>[] = [
      {
        id: 'label',
        header: t('Label'),
        cell: (card) => (
          <div className='space-y-0.5'>
            <div>{card.label}</div>
            <div className='text-muted-foreground text-xs'>
              {providerLabel(card.provider, t)}
            </div>
          </div>
        ),
      },
      {
        id: 'card',
        header: t('Card'),
        cell: (card) => (
          <span className='font-mono'>
            {card.brand || t('Card')} •••• {card.last4}
          </span>
        ),
      },
      {
        id: 'expiry',
        header: t('Expiry (MM/YY)'),
        cell: (card) => (
          <span className='font-mono'>
            {String(card.expiry_month).padStart(2, '0')}/
            {String(card.expiry_year % 100).padStart(2, '0')}
          </span>
        ),
      },
      {
        id: 'status',
        header: t('Status'),
        cell: (card) => (
          <div className='space-y-0.5'>
            <StatusBadge
              label={t(PRODUCT_FULFILLMENT_CARD_STATUSES[card.status].labelKey)}
              variant={PRODUCT_FULFILLMENT_CARD_STATUSES[card.status].variant}
              copyable={false}
            />
            {card.status === 'disabled' && (
              <div className='text-muted-foreground text-xs'>
                {card.disabled_reason === 'declined'
                  ? t('Declined by the bank')
                  : t('Switched off')}
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'enabled',
        header: t('Enabled'),
        cell: (card) => (
          <Switch
            checked={card.enabled}
            aria-label={t('Enable {{label}}', { label: card.label })}
            disabled={toggleMutation.isPending}
            onCheckedChange={(checked) =>
              toggleMutation.mutate({ id: card.id, enabled: checked })
            }
          />
        ),
      },
      {
        id: 'priority',
        header: t('Priority'),
        cell: (card) => <span className='font-mono'>{card.priority}</span>,
      },
      {
        id: 'usage',
        header: t('Payments (succeeded / failed)'),
        cell: (card) => (
          <div className='space-y-0.5'>
            <div className='font-mono'>
              {card.success_count} / {card.fail_count}
            </div>
            <div className='text-muted-foreground text-xs'>
              {card.last_used_at > 0
                ? t('Last used {{time}}', {
                    time: formatTimestampToDate(card.last_used_at),
                  })
                : t('Never used')}
            </div>
          </div>
        ),
      },
      {
        id: 'actions',
        header: <span className='sr-only'>{t('Actions')}</span>,
        className: 'w-20',
        cell: (card) => (
          <StaticRowActions
            editLabel={t('Edit {{label}}', { label: card.label })}
            deleteLabel={t('Delete card')}
            menuLabel={t('More actions for {{label}}', { label: card.label })}
            onEdit={() => openEdit(card)}
            onDelete={() => setDeleting(card)}
          />
        ),
      },
    ]
    body = (
      <StaticDataTable
        columns={columns}
        data={cards}
        getRowKey={(card) => card.id}
        empty={cards.length === 0}
        emptyContent={
          <EmptyState
            title={t('No cards in the pool yet')}
            description={t(
              'Add at least one ready card, or Execute payment cannot run.'
            )}
          />
        }
      />
    )
  }

  return (
    <div className='flex min-w-0 flex-col gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='space-y-1'>
          <h4 className='text-sm font-semibold'>{t('Card pool')}</h4>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Execute payment charges a ready card from this pool. A card that the bank declines is switched off automatically.'
            )}
          </p>
        </div>
        <Button type='button' variant='outline' onClick={openAdd}>
          <Plus aria-hidden='true' />
          {t('Add card')}
        </Button>
      </div>

      {body}

      <FulfillmentCardDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        card={editing}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t('Delete card')}
        desc={
          deleting
            ? t(
                'Delete {{label}} ({{card}})? Past payment records keep their card label, and the card is no longer used for new payments.',
                {
                  label: deleting.label,
                  card: `•••• ${deleting.last4}`,
                }
              )
            : ''
        }
        confirmText={t('Delete')}
        destructive
        isLoading={deleteMutation.isPending}
        handleConfirm={() => {
          if (deleting) deleteMutation.mutate(deleting.id)
        }}
      />
    </div>
  )
}

function providerLabel(
  provider: ProductFulfillmentCard['provider'],
  t: (key: string) => string
): string {
  const item = PRODUCT_FULFILLMENT_CARD_PROVIDERS.find(
    (entry) => entry.value === provider
  )
  return item ? t(item.labelKey) : provider
}
