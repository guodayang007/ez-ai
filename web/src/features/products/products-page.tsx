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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTablePage, useDataTable } from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { handleServerError } from '@/lib/handle-server-error'
import {
  createServerError,
  requireServerSuccess,
} from '@/lib/server-error-message'

import { deleteProduct, getAdminProducts, updateProductStatus } from './api'
import { ProductMutateDrawer } from './components/product-mutate-drawer'
import { useProductsColumns } from './components/products-columns'
import { PRODUCT_QUERY_KEYS } from './constants'
import type { Product } from './types'

export function ProductsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [deleting, setDeleting] = useState<Product | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: PRODUCT_QUERY_KEYS.adminProducts,
    queryFn: async () =>
      requireServerSuccess(await getAdminProducts()).data ?? [],
  })

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: PRODUCT_QUERY_KEYS.adminProducts,
    })

  const toggleMutation = useMutation({
    mutationFn: async (product: Product) => {
      const result = await updateProductStatus(product.id, !product.enabled)
      if (!result.success) throw createServerError(result)
      return !product.enabled
    },
    onSuccess: (enabled) => {
      toast.success(
        enabled ? t('Product is on sale') : t('Product taken off sale')
      )
      void invalidate()
    },
    onError: (error) => handleServerError(error),
  })

  const deleteMutation = useMutation({
    mutationFn: async (product: Product) => {
      const result = await deleteProduct(product.id)
      if (!result.success) throw createServerError(result)
    },
    onSuccess: () => {
      toast.success(t('Product deleted'))
      setDeleting(null)
      void invalidate()
    },
    onError: (error) => handleServerError(error),
  })

  const columns = useProductsColumns({
    onEdit: (product) => {
      setEditing(product)
      setDrawerOpen(true)
    },
    onToggle: (product) => toggleMutation.mutate(product),
    onDelete: (product) => setDeleting(product),
  })

  const { table } = useDataTable({
    data: data ?? [],
    columns,
    withFilteredRowModel: false,
    withFacetedRowModel: false,
  })

  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          {t('Product Management')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button
            onClick={() => {
              setEditing(null)
              setDrawerOpen(true)
            }}
          >
            <Plus />
            {t('Create product')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <DataTablePage
            table={table}
            columns={columns}
            isLoading={isLoading}
            emptyTitle={t('No products yet')}
            emptyDescription={t(
              'Create a product such as ChatGPT Plus, Claude Pro or Gemini Advanced to start selling.'
            )}
            skeletonKeyPrefix='products-skeleton'
            applyHeaderSize
          />
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <ProductMutateDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        product={editing}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('Delete product')}
        desc={t(
          'Delete "{{title}}" and all of its specifications? Existing orders are kept.',
          { title: deleting?.title ?? '' }
        )}
        destructive
        confirmText={t('Delete')}
        isLoading={deleteMutation.isPending}
        handleConfirm={() => deleting && deleteMutation.mutate(deleting)}
      />
    </>
  )
}
