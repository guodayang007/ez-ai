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
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { useMediaQuery } from '@/hooks'
import { type NavigateFn, useTableUrlState } from '@/hooks/use-table-url-state'
import { toIntlLocale } from '@/i18n/languages'
import { formatTimestampToDate } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'

import { PRODUCT_ORDER_STATUSES } from '../constants'
import { formatProductPrice } from '../lib/format'
import type {
  ApiResponse,
  PageData,
  ProductOrder,
  ProductOrderListParams,
} from '../types'
import { OrderStatusBadge } from './order-details'

type OrdersTableProps = {
  queryKey: readonly string[]
  fetchOrders: (
    params: ProductOrderListParams
  ) => Promise<ApiResponse<PageData<ProductOrder>>>
  search: Record<string, unknown>
  navigate: NavigateFn
  showUser: boolean
  renderActions: (order: ProductOrder) => React.ReactNode
  emptyDescription: string
}

function useOrderColumns(props: OrdersTableProps): ColumnDef<ProductOrder>[] {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const columns: ColumnDef<ProductOrder>[] = [
    {
      accessorKey: 'trade_no',
      header: t('Order number'),
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <span className='font-mono text-xs'>{row.original.trade_no}</span>
      ),
      size: 200,
    },
    {
      accessorKey: 'product_title',
      header: t('Product'),
      meta: { mobileTitle: true },
      cell: ({ row }) => (
        <div className='min-w-0'>
          <p className='truncate font-medium'>{row.original.product_title}</p>
          <p className='text-muted-foreground truncate text-xs'>
            {row.original.sku_name}
          </p>
        </div>
      ),
      size: 220,
    },
    {
      accessorKey: 'price_amount',
      header: t('Price'),
      cell: ({ row }) =>
        formatProductPrice(
          row.original.price_amount,
          row.original.currency,
          locale
        ),
      size: 110,
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      meta: { mobileBadge: true },
      cell: ({ row }) => <OrderStatusBadge status={row.original.status} />,
      size: 120,
    },
    {
      accessorKey: 'created_at',
      header: t('Created'),
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <span className='font-mono text-sm'>
          {formatTimestampToDate(row.original.created_at)}
        </span>
      ),
      size: 170,
    },
    {
      id: 'actions',
      header: () => t('Actions'),
      meta: { pinned: 'right' as const },
      cell: ({ row }) => props.renderActions(row.original),
    },
  ]
  if (props.showUser) {
    columns.splice(1, 0, {
      accessorKey: 'username',
      header: t('User'),
      cell: ({ row }) => (
        <span className='text-sm'>
          {row.original.username || '-'}{' '}
          <span className='text-muted-foreground'>#{row.original.user_id}</span>
        </span>
      ),
      size: 140,
    })
  }
  return columns
}

export function OrdersTable(props: OrdersTableProps) {
  const { t } = useTranslation()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const columns = useOrderColumns(props)
  const urlState = useTableUrlState({
    search: props.search,
    navigate: props.navigate,
    pagination: { defaultPage: 1, defaultPageSize: isMobile ? 10 : 20 },
    globalFilter: { enabled: true, key: 'filter' },
    columnFilters: [{ columnId: 'status', searchKey: 'status', type: 'array' }],
  })
  const statusFilter =
    (urlState.columnFilters.find((filter) => filter.id === 'status')?.value as
      | string[]
      | undefined) ?? []
  const status = statusFilter[0] ?? ''
  const keyword = urlState.globalFilter?.trim() ?? ''
  const page = urlState.pagination.pageIndex + 1
  const pageSize = urlState.pagination.pageSize

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [...props.queryKey, page, pageSize, status, keyword],
    queryFn: async () => {
      const result = requireServerSuccess(
        await props.fetchOrders({
          p: page,
          page_size: pageSize,
          status,
          keyword,
        })
      )
      return { items: result.data?.items ?? [], total: result.data?.total ?? 0 }
    },
    placeholderData: (previous) => previous,
  })

  const { table } = useDataTable({
    data: data?.items ?? [],
    columns,
    getRowId: (row) => String(row.id),
    columnFilters: urlState.columnFilters,
    globalFilter: urlState.globalFilter,
    pagination: urlState.pagination,
    onPaginationChange: urlState.onPaginationChange,
    onGlobalFilterChange: urlState.onGlobalFilterChange,
    onColumnFiltersChange: urlState.onColumnFiltersChange,
    manualPagination: true,
    manualFiltering: true,
    totalCount: data?.total ?? 0,
    ensurePageInRange: urlState.ensurePageInRange,
  })

  const statusOptions = useMemo(
    () =>
      Object.entries(PRODUCT_ORDER_STATUSES).map(([value, config]) => ({
        value,
        label: t(config.labelKey),
      })),
    [t]
  )

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={isLoading}
      isFetching={isFetching}
      emptyTitle={t('No orders yet')}
      emptyDescription={props.emptyDescription}
      skeletonKeyPrefix='product-orders-skeleton'
      applyHeaderSize
      toolbarProps={{
        searchPlaceholder: t('Search order number or product...'),
        searchDebounceMs: 500,
        filters: [
          {
            columnId: 'status',
            title: t('Status'),
            options: statusOptions,
            singleSelect: true,
          },
        ],
      }}
    />
  )
}
