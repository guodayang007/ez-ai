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
import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { PasswordInput } from '@/components/password-input'
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
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import {
  createProductFulfillmentCard,
  updateProductFulfillmentCard,
} from '../api'
import {
  PRODUCT_FULFILLMENT_CARD_PROVIDERS,
  PRODUCT_QUERY_KEYS,
} from '../constants'
import {
  cardFormToInput,
  cardToFormValues,
  createCardFormSchema,
  emptyCardFormValues,
  type CardFormValues,
} from '../lib/fulfillment-card-form'
import type { ProductFulfillmentCard } from '../types'

const FORM_ID = 'fulfillment-card-form'

type FulfillmentCardDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The card being edited; null when adding one. */
  card: ProductFulfillmentCard | null
}

/**
 * Adds a card to the payment pool or edits one. The number and CVC are
 * write-only: an edit leaves them empty to keep the saved values.
 */
export function FulfillmentCardDialog(props: FulfillmentCardDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const editing = props.card !== null

  const defaultValues = useMemo<CardFormValues>(
    () => (props.card ? cardToFormValues(props.card) : emptyCardFormValues()),
    [props.card]
  )
  const form = useForm<CardFormValues>({
    resolver: zodResolver(createCardFormSchema(t, { editing })),
    defaultValues,
  })
  // Each open starts from the card's saved values, with secrets blank.
  useEffect(() => {
    if (props.open) form.reset(defaultValues)
  }, [props.open, defaultValues, form])

  const mutation = useMutation({
    mutationFn: async (values: CardFormValues) => {
      const payload = cardFormToInput(values, { editing })
      const result = props.card
        ? await updateProductFulfillmentCard(props.card.id, payload)
        : await createProductFulfillmentCard(payload)
      if (!result.success) throw createServerError(result)
    },
    onSuccess: () => {
      toast.success(t('Setting updated successfully'))
      props.onOpenChange(false)
    },
    onError: (error) => handleServerError(error),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: PRODUCT_QUERY_KEYS.fulfillmentCards,
      })
      void queryClient.invalidateQueries({
        queryKey: PRODUCT_QUERY_KEYS.fulfillerHealth,
      })
    },
  })

  const providerItems = PRODUCT_FULFILLMENT_CARD_PROVIDERS.map((item) => ({
    value: item.value,
    label: t(item.labelKey),
  }))

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={editing ? t('Edit card') : t('Add card')}
      description={t(
        'Automatic payments pick a random ready card from the pool.'
      )}
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={mutation.isPending}
          >
            {t('Cancel')}
          </Button>
          <Button type='submit' form={FORM_ID} disabled={mutation.isPending}>
            {t('Save Changes')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id={FORM_ID}
          autoComplete='off'
          className='grid gap-4 sm:grid-cols-2'
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <FormField
            control={form.control}
            name='label'
            render={({ field }) => (
              <FormItem className='sm:col-span-2'>
                <FormLabel>{t('Label')}</FormLabel>
                <FormControl>
                  <Input placeholder='DogPay #1' {...field} />
                </FormControl>
                <FormDescription>
                  {t('A name to tell the cards apart in lists and records.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='provider'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Source')}</FormLabel>
                <Select
                  items={providerItems}
                  value={field.value}
                  onValueChange={(value) => field.onChange(String(value ?? ''))}
                >
                  <FormControl>
                    <SelectTrigger className='w-full'>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {providerItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='priority'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Priority')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={0}
                    max={9999}
                    step={1}
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    value={Number.isNaN(field.value) ? '' : field.value}
                    onChange={(event) =>
                      field.onChange(
                        event.target.value === ''
                          ? Number.NaN
                          : Number(event.target.value)
                      )
                    }
                  />
                </FormControl>
                <FormDescription>
                  {t('Lower numbers are used first.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='number'
            render={({ field }) => (
              <FormItem className='sm:col-span-2'>
                <FormLabel>{t('Card number')}</FormLabel>
                <FormControl>
                  <PasswordInput
                    placeholder={
                      editing
                        ? t('Leave empty to keep the saved card number')
                        : '4242 4242 4242 4242'
                    }
                    autoComplete='new-password'
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    '12-19 digits; spaces and dashes are allowed. Stored encrypted; only the last 4 digits are shown afterwards.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='expiry'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Expiry (MM/YY)')}</FormLabel>
                <FormControl>
                  <Input placeholder='MM/YY' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='cvc'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('CVC')}</FormLabel>
                <FormControl>
                  <PasswordInput
                    placeholder={
                      editing ? t('Leave empty to keep the saved CVC') : '123'
                    }
                    autoComplete='new-password'
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='holder'
            render={({ field }) => (
              <FormItem className='sm:col-span-2'>
                <FormLabel>{t('Cardholder name')}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <FormItem className='flex flex-row items-center justify-between gap-2 sm:col-span-2'>
                <div className='space-y-0.5'>
                  <FormLabel>{t('Enabled')}</FormLabel>
                  <FormDescription>
                    {t('A disabled card is never chosen for a payment.')}
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked)}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </form>
      </Form>
    </Dialog>
  )
}
