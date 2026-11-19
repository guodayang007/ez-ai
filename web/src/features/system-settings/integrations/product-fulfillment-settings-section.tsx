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
import { LearnMore } from '@/components/learn-more'
import { LoadingState } from '@/components/loading-state'
import { PasswordInput } from '@/components/password-input'
import { TagInput } from '@/components/tag-input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { FulfillmentCardPool } from '@/features/products/components/fulfillment-card-pool'
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
  })
}

type FormValues = z.infer<ReturnType<typeof createSchema>>
type TextFieldName = Exclude<keyof FormValues, 'plans'>

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
          'Execute payment on product orders hands the order to the DogPay fulfillment service (services/dogpay-fulfiller), which pays with a ready card from the card pool.'
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
              plans: [...health.plans, ...(health.claude_plans ?? [])].join(
                ', '
              ),
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

      {configQuery.data && (
        <fieldset
          disabled={!configQuery.data.encryption_ready}
          className='min-w-0'
        >
          <FulfillmentCardPool />
        </fieldset>
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
      country: view.billing.country,
      currency: view.billing.currency,
      line1: view.billing.line1,
      city: view.billing.city,
      state: view.billing.state,
      postal_code: view.billing.postal_code,
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
              help={[
                t(
                  'What it is: the address of the DogPay fulfillment service. ez-ai calls it when you click Execute payment on an order.'
                ),
                t(
                  'Where to find it: on the machine where you run services/dogpay-fulfiller (node src/server.mjs). By default it listens on http://127.0.0.1:3100; the PORT and HOST values in that service .env file set the address.'
                ),
                t(
                  'Note: must start with http:// or https://. Keep it on a private network, because only ez-ai should reach it.'
                ),
              ]}
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
              help={[
                t(
                  'What it is: the password shared by ez-ai and the fulfillment service. Every request to the service is signed and encrypted with it.'
                ),
                t(
                  'Where to find it: in services/dogpay-fulfiller/.env, under FULFILLER_SECRET. If it is empty, generate one with openssl rand -hex 32, put it in that file, and paste the same value here.'
                ),
                t(
                  'Note: at least 32 characters. After saving it is never shown again; leave the field empty to keep the saved value.'
                ),
              ]}
            />
            <ConfigTextField
              control={control}
              name='callback_url'
              label={t('Callback URL')}
              placeholder={view.default_callback_url}
              description={t(
                'Where the fulfillment service reports results. Leave empty when it runs on the same server as ez-ai'
              )}
              help={[
                t(
                  'What it is: the address the fulfillment service uses to report progress and results back to ez-ai.'
                ),
                t(
                  'Where to find it: leave it empty if the service runs on the same server as ez-ai; the default is the grey placeholder text. Fill it in only when the service runs on another machine.'
                ),
                t(
                  'Note: must start with http:// or https:// and be reachable from the fulfillment service.'
                ),
              ]}
            />
            <FormField
              control={control}
              name='plans'
              render={({ field }) => (
                <FormItem>
                  <div className='flex items-center gap-1.5'>
                    <FormLabel>{t('Plans to buy')}</FormLabel>
                    <FieldHelp
                      label={t('Plans to buy')}
                      paragraphs={[
                        t(
                          'What it is: the ChatGPT plan codes the admin may choose in the Execute payment dialog for ChatGPT orders.'
                        ),
                        t(
                          'Where to find it: type a plan code and press Enter to add it. Add one code per Enter press, for example chatgptplusplan.'
                        ),
                        t(
                          'Note: Claude plans are fixed (claude_pro, claude_max_5x, claude_max_20x) and are not set here. At least one ChatGPT plan is required.'
                        ),
                      ]}
                    />
                  </div>
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

          <h4 className='text-sm font-semibold'>{t('Billing address')}</h4>
          <SettingsFormGrid>
            <ConfigTextField
              control={control}
              name='country'
              label={t('Country code')}
              placeholder='US'
              help={[
                t(
                  'What it is: the two-letter country code of the billing address, for example US.'
                ),
                t(
                  'Where to find it: the country the card is billed to. The fulfiller machine must exit to the internet from this same country, or checkout stops before any payment is made.'
                ),
                t(
                  'Note: use an ISO 3166-1 two-letter code such as US, GB or JP.'
                ),
              ]}
            />
            <ConfigTextField
              control={control}
              name='currency'
              label={t('Currency code')}
              placeholder='USD'
              help={[
                t(
                  'What it is: the three-letter currency code of the billing account, for example USD.'
                ),
                t(
                  'Where to find it: the currency the card is billed in. For a US billing country this is USD.'
                ),
                t('Note: use an ISO 4217 code such as USD, EUR or GBP.'),
              ]}
            />
            <ConfigTextField
              control={control}
              name='line1'
              label={t('Address line')}
              help={[
                t('What it is: the street address of the billing address.'),
                t(
                  'Where to find it: the billing address registered for the cards in the card pool.'
                ),
                t(
                  'Note: enter it exactly as registered, or the card may be declined.'
                ),
              ]}
            />
            <ConfigTextField
              control={control}
              name='city'
              label={t('City')}
              help={[
                t('What it is: the city of the billing address.'),
                t(
                  'Where to find it: the same registered billing address as the address line.'
                ),
              ]}
            />
            <ConfigTextField
              control={control}
              name='state'
              label={t('State / province')}
              help={[
                t('What it is: the state or province of the billing address.'),
                t(
                  'Where to find it: the same registered billing address as the address line.'
                ),
                t(
                  'Note: leave empty if the billing country has no states or provinces.'
                ),
              ]}
            />
            <ConfigTextField
              control={control}
              name='postal_code'
              label={t('Postal code')}
              help={[
                t(
                  'What it is: the postal code of the billing address (ZIP code in the US).'
                ),
                t(
                  'Where to find it: the same registered billing address as the address line.'
                ),
                t(
                  'Note: enter it exactly as registered, for example 78701 in the US.'
                ),
              ]}
            />
          </SettingsFormGrid>
        </fieldset>
      </SettingsForm>
    </Form>
  )
}

/**
 * A "?" button beside a field label. Each paragraph explains one part of the
 * field: what it is, where to find its value, and the format or safety notes.
 */
function FieldHelp(props: { label: string; paragraphs: string[] }) {
  const { t } = useTranslation()
  return (
    <LearnMore
      triggerProps={{
        'aria-label': t('Learn more about {{field}}', {
          field: props.label,
          // An accessible name is plain text, so "/" in a label must not be escaped.
          interpolation: { escapeValue: false },
        }),
      }}
      contentProps={{
        className: 'flex max-w-sm flex-col gap-2 leading-relaxed',
      }}
    >
      {props.paragraphs.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
    </LearnMore>
  )
}

type ConfigTextFieldProps = {
  control: Control<FormValues>
  name: TextFieldName
  label: string
  placeholder?: string
  description?: string
  /** Paragraphs shown in the "?" popover beside the label. */
  help?: string[]
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
          <div className='flex items-center gap-1.5'>
            <FormLabel>{props.label}</FormLabel>
            {props.help && (
              <FieldHelp label={props.label} paragraphs={props.help} />
            )}
          </div>
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
