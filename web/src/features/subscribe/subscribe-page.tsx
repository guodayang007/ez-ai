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
import { useNavigate, useSearch } from '@tanstack/react-router'

import { PublicLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-transition'
import { getProducts } from '@/features/products/api'
import { PRODUCT_QUERY_KEYS } from '@/features/products/constants'
import { requireServerSuccess } from '@/lib/server-error-message'

import { SubscribeCatalog } from './components/subscribe-catalog'
import { SubscribeCheckout } from './components/subscribe-checkout'

/**
 * Public AI subscription storefront. The catalog and the checkout share one
 * screen; the selected product, plan and step live in the URL so the flow
 * survives the sign-in redirect and the browser back button.
 */
export function SubscribePage() {
  const search = useSearch({ from: '/subscribe/' })
  const navigate = useNavigate({ from: '/subscribe/' })
  const { data, isLoading } = useQuery({
    queryKey: PRODUCT_QUERY_KEYS.storeProducts,
    queryFn: async () => requireServerSuccess(await getProducts()).data ?? [],
  })
  const products = data ?? []
  const selected = search.product
    ? products.find((item) => item.id === search.product)
    : undefined

  return (
    <PublicLayout showMainContainer={false}>
      <div className='relative'>
        <div
          aria-hidden
          className='pointer-events-none absolute inset-x-0 top-0 h-[520px] opacity-25 dark:opacity-[0.12]'
          style={{
            background: [
              'radial-gradient(ellipse 55% 50% at 15% 15%, oklch(0.75 0.15 160 / 70%) 0%, transparent 70%)',
              'radial-gradient(ellipse 50% 45% at 85% 10%, oklch(0.72 0.16 250 / 70%) 0%, transparent 70%)',
            ].join(', '),
            maskImage: 'linear-gradient(to bottom, black 40%, transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to bottom, black 40%, transparent 100%)',
          }}
        />
        <PageTransition className='relative mx-auto w-full max-w-6xl px-4 pt-20 pb-16 sm:px-6 sm:pt-24'>
          {selected ? (
            <SubscribeCheckout
              key={selected.id}
              product={selected}
              skuId={search.sku}
              step={search.step ?? 'plan'}
            />
          ) : (
            <SubscribeCatalog
              products={products}
              isLoading={isLoading}
              onSelect={(product) =>
                void navigate({ search: { product: product.id } })
              }
            />
          )}
        </PageTransition>
      </div>
    </PublicLayout>
  )
}
