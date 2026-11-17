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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useMemo, useState } from 'react'
import { type Resolver, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { RadioGroup } from '@/components/ui/radio-group'
import { createProductOrder } from '@/features/products/api'
import { PRODUCT_QUERY_KEYS } from '@/features/products/constants'
import type { Product } from '@/features/products/types'
import { SkuOptionCard } from '@/features/store/components/sku-option-card'
import {
  buildOrderInputsSchema,
  getOrderFormDefaults,
  type OrderFormValues,
} from '@/features/store/lib/order-form'
import { handleServerError } from '@/lib/handle-server-error'
import { getLobeIcon } from '@/lib/lobe-icon'
import { createServerError } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { AccountStep, type VerifiedSession } from './account-step'
import { CheckoutSteps } from './checkout-steps'
import { OrderSummary } from './order-summary'

type SubscribeCheckoutProps = {
  product: Product
  skuId: number | undefined
  step: 'plan' | 'account'
}

/**
 * In-page checkout: choose a plan, verify the account, then create the order.
 * The order can only be placed after the ChatGPT session or Claude cookie
 * passes verification.
 */
export function SubscribeCheckout(props: SubscribeCheckoutProps) {
  const { t } = useTranslation()
  const navigate = useNavigate({ from: '/subscribe/' })
  const queryClient = useQueryClient()
  const isAuthed = useAuthStore((state) => Boolean(state.auth.user))
  const [verified, setVerified] = useState<VerifiedSession | null>(null)

  const product = props.product
  const sku =
    product.skus.find((item) => item.id === props.skuId) ?? product.skus[0]
  const fields = useMemo(() => product.input_fields ?? [], [product])
  // The ChatGPT session or Claude cookie that names the account to upgrade.
  const sessionField = fields.find(
    (field) =>
      field.type === 'chatgpt_session' || field.type === 'claude_cookie'
  )
  const isClaude = sessionField?.type === 'claude_cookie'
  const otherFields = fields.filter((field) => field !== sessionField)

  const schema = useMemo(() => buildOrderInputsSchema(fields, t), [fields, t])
  const form = useForm<OrderFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<OrderFormValues>,
    defaultValues: getOrderFormDefaults(fields),
  })
  const sessionValue = form.watch(
    sessionField ? `inputs.${sessionField.key}` : 'remark'
  )
  const sessionVerified =
    !sessionField || (verified !== null && verified.value === sessionValue)

  const mutation = useMutation({
    mutationFn: async (values: OrderFormValues) => {
      const result = await createProductOrder({
        sku_id: sku.id,
        inputs: values.inputs,
        remark: values.remark.trim(),
      })
      if (!result.success) throw createServerError(result)
      return result.data
    },
    onSuccess: (order) => {
      toast.success(
        t('Order {{tradeNo}} created', { tradeNo: order?.trade_no ?? '' })
      )
      void queryClient.invalidateQueries({
        queryKey: PRODUCT_QUERY_KEYS.selfOrders,
      })
      void navigate({ to: '/store/orders' })
    },
    onError: (error) => handleServerError(error),
  })

  const accountStepLabel = sessionField
    ? t('Verify account')
    : t('Order details')
  const stepIndex = props.step === 'plan' ? 0 : 1

  const goToAccountStep = () => {
    if (!isAuthed) {
      const redirect = `/subscribe?product=${product.id}&sku=${sku.id}&step=account`
      void navigate({ to: '/sign-in', search: { redirect } })
      return
    }
    void navigate({
      search: { product: product.id, sku: sku.id, step: 'account' },
    })
  }

  const verifyHint = isClaude
    ? t('Verify your cookie to place the order')
    : t('Verify your session to place the order')
  let action: {
    label: string
    disabled?: boolean
    hint?: string
    run: () => void
  }
  if (props.step === 'plan') {
    action = {
      label: t('Next: {{step}}', { step: accountStepLabel }),
      run: goToAccountStep,
    }
  } else if (!isAuthed) {
    action = { label: t('Sign in to continue'), run: goToAccountStep }
  } else {
    action = {
      label: t('Create order'),
      disabled: !sessionVerified,
      hint: sessionVerified
        ? t('You can track the order in My Orders')
        : verifyHint,
      run: () => void form.handleSubmit((values) => mutation.mutate(values))(),
    }
  }

  return (
    <div className='space-y-6 pb-24 lg:pb-0'>
      <Button
        variant='ghost'
        size='sm'
        className='-ml-2'
        onClick={() => void navigate({ search: {} })}
      >
        <ArrowLeft />
        {t('All subscriptions')}
      </Button>

      <header className='flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between'>
        <div className='flex items-center gap-4'>
          <span className='bg-card flex size-14 shrink-0 items-center justify-center rounded-2xl border shadow-xs'>
            {getLobeIcon(product.icon, 36)}
          </span>
          <div className='min-w-0'>
            <h1 className='text-2xl font-bold tracking-tight'>
              {product.title}
            </h1>
            {product.subtitle && (
              <p className='text-muted-foreground text-sm'>
                {product.subtitle}
              </p>
            )}
          </div>
        </div>
        <div className='w-full lg:max-w-md'>
          <CheckoutSteps
            labels={[t('Choose a plan'), accountStepLabel]}
            current={stepIndex}
          />
        </div>
      </header>

      <div className='grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]'>
        <div className='min-w-0'>
          {props.step === 'plan' ? (
            <section className='bg-card space-y-5 rounded-2xl border p-5 sm:p-6'>
              <div className='space-y-1'>
                <h2 className='text-lg font-semibold'>{t('Choose a plan')}</h2>
                {product.description && (
                  <p className='text-muted-foreground text-sm leading-relaxed whitespace-pre-wrap'>
                    {product.description}
                  </p>
                )}
              </div>
              <RadioGroup
                aria-label={t('Choose a plan')}
                value={String(sku.id)}
                onValueChange={(value) =>
                  void navigate({
                    search: { product: product.id, sku: Number(value) },
                    replace: true,
                    resetScroll: false,
                  })
                }
                className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'
              >
                {product.skus.map((item) => (
                  <SkuOptionCard key={item.id} sku={item} icon={product.icon} />
                ))}
              </RadioGroup>
            </section>
          ) : (
            <Form {...form}>
              <form
                onSubmit={(event) => event.preventDefault()}
                aria-label={accountStepLabel}
              >
                <fieldset disabled={mutation.isPending} className='contents'>
                  <AccountStep
                    form={form}
                    sessionField={sessionField}
                    otherFields={otherFields}
                    verified={sessionVerified ? verified : null}
                    onVerifiedChange={setVerified}
                  />
                </fieldset>
              </form>
            </Form>
          )}
        </div>

        <OrderSummary
          product={product}
          sku={sku}
          accountEmail={sessionVerified ? verified?.email : undefined}
          actionLabel={action.label}
          actionDisabled={action.disabled}
          actionPending={mutation.isPending}
          hint={action.hint}
          onAction={action.run}
          onChangePlan={
            props.step === 'account'
              ? () =>
                  void navigate({
                    search: { product: product.id, sku: sku.id, step: 'plan' },
                  })
              : undefined
          }
        />
      </div>
    </div>
  )
}
