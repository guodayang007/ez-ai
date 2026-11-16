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
import { useMemo, useState } from 'react'
import { type Resolver, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { RadioGroup } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { createProductOrder } from '@/features/products/api'
import { PRODUCT_QUERY_KEYS } from '@/features/products/constants'
import { formatProductPrice } from '@/features/products/lib/format'
import type {
  Product,
  ProductInputField,
  ProductSku,
} from '@/features/products/types'
import { toIntlLocale } from '@/i18n/languages'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import {
  buildOrderInputsSchema,
  getOrderFormDefaults,
  type OrderFormValues,
} from '../lib/order-form'
import { OrderInputControl } from './order-input-control'
import { SkuOptionCard } from './sku-option-card'

const ORDER_FORM_ID = 'product-order-form'

type PurchaseDialogProps = {
  product: Product | null
  onOpenChange: (open: boolean) => void
}

export function PurchaseDialog(props: PurchaseDialogProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [selectedSkuId, setSelectedSkuId] = useState<number | null>(null)
  const product = props.product
  if (!product) return null

  const sku =
    product.skus.find((item) => item.id === selectedSkuId) ?? product.skus[0]

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) setSelectedSkuId(null)
        props.onOpenChange(open)
      }}
      title={product.title}
      contentClassName='sm:max-w-5xl'
      description={product.subtitle || undefined}
      footer={
        <>
          <span className='mr-auto text-lg font-semibold'>
            {formatProductPrice(sku.price_amount, sku.currency, locale)}
          </span>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button type='submit' form={ORDER_FORM_ID}>
            {t('Place order')}
          </Button>
        </>
      }
    >
      <div className='space-y-5'>
        <div className='space-y-2'>
          <p className='text-sm font-medium'>{t('Choose a specification')}</p>
          <RadioGroup
            value={String(sku.id)}
            onValueChange={(value) => setSelectedSkuId(Number(value))}
            className='grid max-h-[50vh] gap-3 overflow-y-auto p-1 sm:grid-cols-2 lg:grid-cols-4'
          >
            {product.skus.map((item) => (
              <SkuOptionCard key={item.id} sku={item} icon={product.icon} />
            ))}
          </RadioGroup>
        </div>
        <OrderForm
          sku={sku}
          fields={product.input_fields ?? []}
          onCreated={() => {
            setSelectedSkuId(null)
            props.onOpenChange(false)
          }}
        />
      </div>
    </Dialog>
  )
}

function OrderForm(props: {
  sku: ProductSku
  fields: ProductInputField[]
  onCreated: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fields = props.fields
  const schema = useMemo(() => buildOrderInputsSchema(fields, t), [fields, t])
  const form = useForm<OrderFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<OrderFormValues>,
    defaultValues: getOrderFormDefaults(fields),
  })

  const mutation = useMutation({
    mutationFn: async (values: OrderFormValues) => {
      const result = await createProductOrder({
        sku_id: props.sku.id,
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
      props.onCreated()
      void navigate({ to: '/store/orders' })
    },
    onError: (error) => handleServerError(error),
  })

  return (
    <Form {...form}>
      <form
        id={ORDER_FORM_ID}
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        className='space-y-4'
      >
        <fieldset disabled={mutation.isPending} className='contents'>
          {fields.map((field) => (
            <FormField
              key={field.key}
              control={form.control}
              name={`inputs.${field.key}`}
              render={({ field: controller }) => (
                <FormItem>
                  <FormLabel>
                    {field.label}
                    {field.required && (
                      <span className='text-destructive' aria-hidden='true'>
                        *
                      </span>
                    )}
                  </FormLabel>
                  <FormControl>
                    <OrderInputControl field={field} controller={controller} />
                  </FormControl>
                  {field.description && (
                    <FormDescription>{field.description}</FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
          <FormField
            control={form.control}
            name='remark'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Remark (optional)')}</FormLabel>
                <FormControl>
                  <Textarea {...field} rows={2} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </fieldset>
      </form>
    </Form>
  )
}
