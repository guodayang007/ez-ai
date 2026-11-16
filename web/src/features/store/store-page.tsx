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
import { Link } from '@tanstack/react-router'
import { ReceiptText, ShoppingBag } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { getProducts } from '@/features/products/api'
import { PRODUCT_QUERY_KEYS } from '@/features/products/constants'
import {
  formatProductPrice,
  getLowestPricedSku,
} from '@/features/products/lib/format'
import type { Product } from '@/features/products/types'
import { toIntlLocale } from '@/i18n/languages'
import { getLobeIcon } from '@/lib/lobe-icon'
import { requireServerSuccess } from '@/lib/server-error-message'

import { PurchaseDialog } from './components/purchase-dialog'

function ProductCard(props: { product: Product; onBuy: () => void }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const lowest = getLowestPricedSku(props.product.skus)

  return (
    <Card className='flex flex-col'>
      <CardHeader className='flex flex-row items-start gap-3'>
        <span className='bg-muted flex size-12 shrink-0 items-center justify-center rounded-lg'>
          {getLobeIcon(props.product.icon, 32)}
        </span>
        <div className='min-w-0 space-y-1'>
          <CardTitle className='truncate'>{props.product.title}</CardTitle>
          {props.product.subtitle && (
            <CardDescription>{props.product.subtitle}</CardDescription>
          )}
        </div>
      </CardHeader>
      <CardContent className='flex-1'>
        {props.product.description && (
          <p className='text-muted-foreground text-sm whitespace-pre-wrap'>
            {props.product.description}
          </p>
        )}
      </CardContent>
      <CardFooter className='flex items-center justify-between gap-2'>
        {lowest && (
          <span className='text-lg font-semibold'>
            {props.product.skus.length > 1
              ? t('From {{price}}', {
                  price: formatProductPrice(
                    lowest.price_amount,
                    lowest.currency,
                    locale
                  ),
                })
              : formatProductPrice(
                  lowest.price_amount,
                  lowest.currency,
                  locale
                )}
          </span>
        )}
        <Button onClick={props.onBuy}>{t('Buy now')}</Button>
      </CardFooter>
    </Card>
  )
}

export function StorePage() {
  const { t } = useTranslation()
  const [buying, setBuying] = useState<Product | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: PRODUCT_QUERY_KEYS.storeProducts,
    queryFn: async () => requireServerSuccess(await getProducts()).data ?? [],
  })
  const products = data ?? []

  let content: React.ReactNode
  if (isLoading) {
    content = <LoadingState />
  } else if (products.length === 0) {
    content = (
      <EmptyState
        icon={ShoppingBag}
        title={t('No products available')}
        description={t('Please check back later.')}
      />
    )
  } else {
    content = (
      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
        {products.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            onBuy={() => setBuying(product)}
          />
        ))}
      </div>
    )
  }

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Shop')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button variant='outline' render={<Link to='/store/orders' />}>
            <ReceiptText />
            {t('My Orders')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>{content}</SectionPageLayout.Content>
      </SectionPageLayout>
      <PurchaseDialog
        product={buying}
        onOpenChange={(open) => !open && setBuying(null)}
      />
    </>
  )
}
