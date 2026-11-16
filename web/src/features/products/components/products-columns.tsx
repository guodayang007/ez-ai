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
import type { ColumnDef } from '@tanstack/react-table'
import { Edit, Power, PowerOff, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { DataTableRowActionMenu } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import { Button } from '@/components/ui/button'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu'
import { toIntlLocale } from '@/i18n/languages'
import { formatTimestampToDate } from '@/lib/format'
import { getLobeIcon } from '@/lib/lobe-icon'

import { formatProductPrice, getLowestPricedSku } from '../lib/format'
import type { Product } from '../types'

export type ProductRowActions = {
  onEdit: (product: Product) => void
  onToggle: (product: Product) => void
  onDelete: (product: Product) => void
}

export function useProductsColumns(
  actions: ProductRowActions
): ColumnDef<Product>[] {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  return [
    {
      accessorKey: 'id',
      header: t('ID'),
      meta: { mobileHidden: true },
      cell: ({ row }) => <TableId value={row.original.id} />,
      size: 70,
    },
    {
      accessorKey: 'title',
      header: t('Product'),
      meta: { mobileTitle: true },
      cell: ({ row }) => (
        <div className='flex min-w-0 items-center gap-3'>
          <span className='flex size-8 shrink-0 items-center justify-center'>
            {getLobeIcon(row.original.icon, 24)}
          </span>
          <div className='min-w-0'>
            <p className='truncate font-medium'>{row.original.title}</p>
            {row.original.subtitle && (
              <p className='text-muted-foreground truncate text-xs'>
                {row.original.subtitle}
              </p>
            )}
          </div>
        </div>
      ),
      size: 280,
    },
    {
      id: 'skus',
      header: t('Specifications'),
      cell: ({ row }) => {
        const lowest = getLowestPricedSku(row.original.skus)
        const lowestPrice = lowest
          ? formatProductPrice(lowest.price_amount, lowest.currency, locale)
          : ''
        return (
          <div className='text-sm'>
            <p>
              {t('{{count}} specifications', {
                count: row.original.skus.length,
              })}
            </p>
            {lowest && (
              <p className='text-muted-foreground text-xs'>
                {row.original.skus.length > 1
                  ? t('From {{price}}', { price: lowestPrice })
                  : lowestPrice}
              </p>
            )}
          </div>
        )
      },
      size: 160,
    },
    {
      accessorKey: 'enabled',
      header: t('Status'),
      meta: { mobileBadge: true },
      cell: ({ row }) => (
        <StatusBadge
          label={row.original.enabled ? t('On sale') : t('Off sale')}
          variant={row.original.enabled ? 'success' : 'neutral'}
          copyable={false}
          className='-ml-1.5'
        />
      ),
      size: 110,
    },
    {
      accessorKey: 'sort_order',
      header: t('Sort order'),
      meta: { mobileHidden: true },
      size: 90,
    },
    {
      accessorKey: 'updated_at',
      header: t('Updated'),
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <span className='font-mono text-sm'>
          {formatTimestampToDate(row.original.updated_at)}
        </span>
      ),
      size: 170,
    },
    {
      id: 'actions',
      header: () => t('Actions'),
      meta: { pinned: 'right' as const },
      cell: ({ row }) => (
        <div className='-ml-1.5 flex items-center gap-1'>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={t('Edit')}
            onClick={() => actions.onEdit(row.original)}
          >
            <Edit />
          </Button>
          <DataTableRowActionMenu ariaLabel={t('Open menu')} modal={false}>
            <DropdownMenuItem onClick={() => actions.onToggle(row.original)}>
              {row.original.enabled ? t('Take off sale') : t('Put on sale')}
              <DropdownMenuShortcut>
                {row.original.enabled ? (
                  <PowerOff size={16} />
                ) : (
                  <Power size={16} />
                )}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => actions.onDelete(row.original)}
              className='text-destructive focus:text-destructive'
            >
              {t('Delete')}
              <DropdownMenuShortcut>
                <Trash2 size={16} />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          </DataTableRowActionMenu>
        </div>
      ),
    },
  ]
}
