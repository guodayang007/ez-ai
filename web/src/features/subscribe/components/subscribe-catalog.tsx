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
import { Link } from '@tanstack/react-router'
import {
  BadgeCheck,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { Product } from '@/features/products/types'
import { useAuthStore } from '@/stores/auth-store'

import { ProductShowcaseCard } from './product-showcase-card'

type SubscribeCatalogProps = {
  products: Product[]
  isLoading: boolean
  onSelect: (product: Product) => void
}

// labelKey values are i18n keys.
const HIGHLIGHTS = [
  { icon: BadgeCheck, labelKey: 'Official subscriptions' },
  { icon: ShieldCheck, labelKey: 'Secure session verification' },
  { icon: Zap, labelKey: 'Fast activation after ordering' },
] as const

const HOW_IT_WORKS = [
  {
    titleKey: 'Choose a plan',
    descriptionKey: 'Pick the subscription and duration you need',
  },
  {
    titleKey: 'Verify your account',
    descriptionKey: 'Paste the session copied from the official site',
  },
  {
    titleKey: 'Wait for activation',
    descriptionKey: 'Track progress anytime in My Orders',
  },
] as const

export function SubscribeCatalog(props: SubscribeCatalogProps) {
  const { t } = useTranslation()
  const isAuthed = useAuthStore((state) => Boolean(state.auth.user))

  let content: React.ReactNode
  if (props.isLoading) {
    content = (
      <div className='grid gap-5 sm:grid-cols-2 lg:grid-cols-3'>
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className='h-72 rounded-2xl' />
        ))}
      </div>
    )
  } else if (props.products.length === 0) {
    content = (
      <EmptyState
        icon={Sparkles}
        title={t('No subscriptions available')}
        description={t('Please check back later.')}
      />
    )
  } else {
    content = (
      <div className='grid justify-center gap-5 sm:grid-cols-[repeat(auto-fit,minmax(280px,360px))]'>
        {props.products.map((product) => (
          <ProductShowcaseCard
            key={product.id}
            product={product}
            onSelect={() => props.onSelect(product)}
          />
        ))}
      </div>
    )
  }

  return (
    <div className='space-y-12'>
      <section className='flex flex-col items-center text-center'>
        <span className='inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-400/20 dark:text-emerald-400'>
          <Sparkles className='size-3.5' aria-hidden='true' />
          {t('AI Subscriptions')}
        </span>
        <h1 className='mt-4 text-[clamp(1.875rem,4vw,2.75rem)] leading-tight font-bold tracking-tight'>
          {t('Upgrade your AI account in minutes')}
        </h1>
        <p className='text-muted-foreground mt-3 max-w-xl text-sm leading-relaxed sm:text-base'>
          {t(
            'Pick a plan, verify your account, and we take care of the rest.'
          )}
        </p>
        <ul className='mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm'>
          {HIGHLIGHTS.map((item) => (
            <li
              key={item.labelKey}
              className='text-muted-foreground flex items-center gap-1.5'
            >
              <item.icon
                className='size-4 text-emerald-600 dark:text-emerald-400'
                aria-hidden='true'
              />
              {t(item.labelKey)}
            </li>
          ))}
        </ul>
        {isAuthed && (
          <Button
            variant='outline'
            size='sm'
            className='mt-6 rounded-full'
            render={<Link to='/store/orders' />}
          >
            <ReceiptText />
            {t('My Orders')}
          </Button>
        )}
      </section>

      <section aria-label={t('AI Subscriptions')}>{content}</section>

      <section className='bg-muted/40 rounded-2xl border p-6 sm:p-8'>
        <h2 className='text-center text-lg font-semibold'>
          {t('How it works')}
        </h2>
        <ol className='mt-6 grid gap-6 sm:grid-cols-3'>
          {HOW_IT_WORKS.map((item, index) => (
            <li key={item.titleKey} className='flex gap-3'>
              <span className='bg-background flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold'>
                {index + 1}
              </span>
              <div className='space-y-1'>
                <p className='text-sm font-medium'>{t(item.titleKey)}</p>
                <p className='text-muted-foreground text-xs leading-relaxed'>
                  {t(item.descriptionKey)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
