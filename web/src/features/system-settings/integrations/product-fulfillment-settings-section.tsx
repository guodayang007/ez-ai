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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Lock } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useForm, type Control } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { PasswordInput } from '@/components/password-input'
import { TagInput } from '@/components/tag-input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
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
  getProductFulfillerHealth,
  getProductFulfillmentConfig,
  updateProductFulfillmentConfig,
} from '@/features/products/api'
import { FulfillerSetupNotice } from '@/features/products/components/fulfiller-setup-notice'
import { PRODUCT_QUERY_KEYS } from '@/features/products/constants'
import { isFulfillerReady } from '@/features/products/lib/fulfillment'
import type {
  ProductFulfillmentConfigUpdate,
  ProductFulfillmentConfigView,
} from '@/features/products/types'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import {
  SettingsForm,
  SettingsFormGrid,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'

const createSchema = (t: (key: string) => string) => {
  const optional = (pattern: RegExp, message: string) =>
    z
      .string()
      .refine((value) => !value.trim() || pattern.test(value.trim()), message)
  const url = optional(
    /^https?:\/\/\S+$/,
    t('Provide a valid URL starting with http:// or https://')
  )
  return z.object({
    url,
    secret: z
      .string()
      .refine(
        (value) => !value.trim() || value.trim().length >= 32,
        t('The shared secret must be at least 32 characters')
      ),
    callback_url: url,
    plans: z.array(z.string()),
    card_number: z
      .string()
      .refine(
        (value) =>
          !value.trim() || /^\d{12,19}$/.test(value.replaceAll(/[\s-]/g, '')),
        t('The card number must be 12-19 digits')
      ),
    card_expiry: optional(
      /^(0[1-9]|1[0-2])\/\d{2}$/,
      t('The card expiry must look like MM/YY')
    ),
    card_cvc: optional(/^\d{3,4}$/, t('The CVC must be 3-4 digits')),
    card_holder: z.string(),
    country: optional(
      /^[A-Za-z]{2}$/,
      t('The country must be a two-letter code such as US')
    ),
    currency: optional(
      /^[A-Za-z]{3}$/,
      t('The currency must be a three-letter code such as USD')
    ),
    line1: z.string(),
    city: z.string(),
    state: z.string(),
    postal_code: z.string(),
    browser_proxy: z.string(),
    clear_browser_proxy: z.boolean(),
  })
}

type FormValues = z.infer<ReturnType<typeof createSchema>>
type TextFieldName = Exclude<keyof FormValues, 'plans' | 'clear_browser_proxy'>

/**
 * The DogPay fulfiller settings used by "Execute payment" on product orders.
 * The server stores them encrypted with CONFIG_ENCRYPTION_KEY; secrets are
 * never sent back, so their fields stay empty and only replace the saved
 * value when filled in.
 */
export function ProductFulfillmentSettingsSection() {
  const { t } = useTranslation()

  const configQuery = useQuery({
    queryKey: PRODUCT_QUERY_KEYS.fulfillerConfig,
    queryFn: async () => {
      const result = await getProductFulfillmentConfig()
      if (!result.success || !result.data) throw createServerError(result)
      return result.data
    },
  })
  const healthQuery = useQuery({
    queryKey: PRODUCT_QUERY_KEYS.fulfillerHealth,
    queryFn: async () => {
      const result = await getProductFulfillerHealth()
      if (!result.success || !result.data) throw createServerError(result)
      return result.data
    },
    staleTime: 0,
  })
  const health = healthQuery.data

  let form: ReactNode
  if (configQuery.isPending) {
    form = <LoadingState />
  } else if (configQuery.isError) {
    form = <ErrorState title={t('Failed to load the fulfillment settings')} />
  } else {
    form = <ProductFulfillmentForm view={configQuery.data} />
  }

  return (
    <SettingsSection title={t('Product Fulfillment')}>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Execute payment on product orders hands the order to the DogPay fulfillment service (services/dogpay-fulfiller), which pays with the card below.'
        )}
      </p>
      <Alert>
        <Lock aria-hidden='true' />
        <AlertTitle>{t('Stored encrypted')}</AlertTitle>
        <AlertDescription>
          {t(
            'These settings are encrypted with CONFIG_ENCRYPTION_KEY before they are written to the database, and sent to the fulfillment service encrypted with the shared secret. Saved secrets are never shown again.'
          )}
        </AlertDescription>
      </Alert>

      {health && isFulfillerReady(health) && (
        <Alert>
          <CheckCircle2 aria-hidden='true' />
          <AlertTitle>{t('The fulfillment service is ready')}</AlertTitle>
          <AlertDescription>
            {t('Connected to {{url}}. Plans offered: {{plans}}', {
              url: health.service_url,
              plans: health.plans.join(', '),
            })}
          </AlertDescription>
        </Alert>
      )}
      {health && (
        <FulfillerSetupNotice
          health={health}
          showSettingsLink={false}
          onRecheck={() => void healthQuery.refetch()}
          isRechecking={healthQuery.isFetching}
        />
      )}

      {form}
    </SettingsSection>
  )
}

function ProductFulfillmentForm(props: { view: ProductFulfillmentConfigView }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const view = props.view
  const defaultValues = useMemo<FormValues>(
    () => ({
      url: view.url,
      secret: '',
      callback_url: view.callback_url,
      plans: view.plans,
      card_number: '',
      card_expiry: view.card_expiry,
      card_cvc: '',
      card_holder: view.card_holder,
      country: view.billing.country,
      currency: view.billing.currency,
      line1: view.billing.line1,
      city: view.billing.city,
      state: view.billing.state,
      postal_code: view.billing.postal_code,
      browser_proxy: '',
      clear_browser_proxy: false,
    }),
    [view]
  )
  const form = useForm<FormValues>({
    resolver: zodResolver(createSchema(t)),
    defaultValues,
  })
  useResetForm(form, defaultValues)

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload: ProductFulfillmentConfigUpdate = {
        url: values.url.trim(),
        callback_url: values.callback_url.trim(),
        plans: values.plans,
        card_expiry: values.card_expiry.trim(),
        card_holder: values.card_holder.trim(),
        billing: {
          country: values.country.trim(),
          currency: values.currency.trim(),
          line1: values.line1.trim(),
          city: values.city.trim(),
          state: values.state.trim(),
          postal_code: values.postal_code.trim(),
        },
      }
      // Empty secret fields keep what is saved.
      if (values.secret.trim()) payload.secret = values.secret.trim()
      if (values.card_number.trim()) payload.card_number = values.card_number
      if (values.card_cvc.trim()) payload.card_cvc = values.card_cvc.trim()
      if (values.browser_proxy.trim()) {
        payload.browser_proxy = values.browser_proxy.trim()
      } else if (values.clear_browser_proxy) {
        payload.browser_proxy = ''
      }
      const result = await updateProductFulfillmentConfig(payload)
      if (!result.success || !result.data) throw createServerError(result)
      return result.data
    },
    onSuccess: (data) => {
      toast.success(t('Setting updated successfully'))
      queryClient.setQueryData(PRODUCT_QUERY_KEYS.fulfillerConfig, data)
      void queryClient.invalidateQueries({
        queryKey: PRODUCT_QUERY_KEYS.fulfillerHealth,
      })
    },
    onError: (error) => handleServerError(error),
  })

  const onSubmit = form.handleSubmit((values) => mutation.mutate(values))
  const control = form.control
  const savedSecret = t('Saved. Leave empty to keep it')

  return (
    <Form {...form}>
      <SettingsForm onSubmit={onSubmit} autoComplete='off'>
        <SettingsPageFormActions
          onSave={onSubmit}
          isSaving={mutation.isPending}
        />
        <fieldset
          disabled={!view.encryption_ready}
          className='flex min-w-0 flex-col gap-6'
        >
          <h4 className='text-sm font-semibold'>{t('Connection')}</h4>
          <SettingsFormGrid>
            <ConfigTextField
              control={control}
              name='url'
              label={t('Fulfillment service URL')}
              placeholder='http://127.0.0.1:3100'
              description={t('Address of the running fulfillment service')}
            />
            <ConfigTextField
              control={control}
              name='secret'
              secret
              label={t('Shared secret')}
              placeholder={
                view.has_secret ? savedSecret : t('At least 32 characters')
              }
              description={t(
                'Must equal FULFILLER_SECRET in services/dogpay-fulfiller/.env'
              )}
            />
            <ConfigTextField
              control={control}
              name='callback_url'
              label={t('Callback URL')}
              placeholder={view.default_callback_url}
              description={t(
                'Where the fulfillment service reports results. Leave empty when it runs on the same server as ez-ai'
              )}
            />
            <FormField
              control={control}
              name='plans'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Plans to buy')}</FormLabel>
                  <FormControl>
                    <TagInput
                      value={field.value}
                      onChange={field.onChange}
                      placeholder='chatgptplusplan'
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'ChatGPT plan codes the admin may choose on Execute payment. Press Enter after each one'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsFormGrid>

          <h4 className='text-sm font-semibold'>{t('DogPay card')}</h4>
          <SettingsFormGrid>
            <ConfigTextField
              control={control}
              name='card_number'
              secret
              label={t('Card number')}
              placeholder={
                view.card_last4
                  ? t(
                      'Saved card ending in {{last4}}. Leave empty to keep it',
                      {
                        last4: view.card_last4,
                      }
                    )
                  : '4242 4242 4242 4242'
              }
            />
            <ConfigTextField
              control={control}
              name='card_expiry'
              label={t('Expiry (MM/YY)')}
              placeholder='MM/YY'
            />
            <ConfigTextField
              control={control}
              name='card_cvc'
              secret
              label={t('CVC')}
              placeholder={view.has_card_cvc ? savedSecret : '123'}
            />
            <ConfigTextField
              control={control}
              name='card_holder'
              label={t('Cardholder name')}
            />
          </SettingsFormGrid>

          <h4 className='text-sm font-semibold'>{t('Billing address')}</h4>
          <SettingsFormGrid>
            <ConfigTextField
              control={control}
              name='country'
              label={t('Country code')}
              placeholder='US'
            />
            <ConfigTextField
              control={control}
              name='currency'
              label={t('Currency code')}
              placeholder='USD'
            />
            <ConfigTextField
              control={control}
              name='line1'
              label={t('Address line')}
            />
            <ConfigTextField control={control} name='city' label={t('City')} />
            <ConfigTextField
              control={control}
              name='state'
              label={t('State / province')}
            />
            <ConfigTextField
              control={control}
              name='postal_code'
              label={t('Postal code')}
            />
          </SettingsFormGrid>

          <h4 className='text-sm font-semibold'>{t('Browser')}</h4>
          <SettingsFormGrid>
            <ConfigTextField
              control={control}
              name='browser_proxy'
              secret
              label={t('Browser proxy')}
              placeholder={
                view.has_browser_proxy
                  ? savedSecret
                  : 'http://user:pass@host:port'
              }
              description={t(
                'Optional. The checkout browser goes through this proxy'
              )}
            />
            {view.has_browser_proxy && (
              <FormField
                control={control}
                name='clear_browser_proxy'
                render={({ field }) => (
                  <FormItem className='flex flex-row items-center gap-2 self-center'>
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(checked) =>
                          field.onChange(checked === true)
                        }
                      />
                    </FormControl>
                    <FormLabel className='font-normal'>
                      {t('Remove the saved proxy')}
                    </FormLabel>
                  </FormItem>
                )}
              />
            )}
          </SettingsFormGrid>
        </fieldset>
      </SettingsForm>
    </Form>
  )
}

type ConfigTextFieldProps = {
  control: Control<FormValues>
  name: TextFieldName
  label: string
  placeholder?: string
  description?: string
  /** Masked input for values that are never shown again once saved. */
  secret?: boolean
}

function ConfigTextField(props: ConfigTextFieldProps) {
  return (
    <FormField
      control={props.control}
      name={props.name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{props.label}</FormLabel>
          <FormControl>
            {props.secret ? (
              <PasswordInput
                placeholder={props.placeholder}
                autoComplete='new-password'
                {...field}
              />
            ) : (
              <Input
                placeholder={props.placeholder}
                autoComplete='off'
                {...field}
              />
            )}
          </FormControl>
          {props.description && (
            <FormDescription>{props.description}</FormDescription>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
