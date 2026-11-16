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
import { CircleCheck, ShieldCheck } from 'lucide-react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import type { ProductInputField } from '@/features/products/types'
import { OrderInputControl } from '@/features/store/components/order-input-control'
import {
  type ChatGPTSessionResult,
  parseChatGPTSession,
} from '@/features/store/lib/chatgpt-session'
import type { OrderFormValues } from '@/features/store/lib/order-form'
import { toIntlLocale } from '@/i18n/languages'

import { SessionGuide } from './session-guide'

export type VerifiedSession = Extract<ChatGPTSessionResult, { ok: true }> & {
  /** The exact text that passed verification; editing it voids the result. */
  value: string
}

type AccountStepProps = {
  form: UseFormReturn<OrderFormValues>
  sessionField: ProductInputField | undefined
  otherFields: ProductInputField[]
  verified: VerifiedSession | null
  onVerifiedChange: (verified: VerifiedSession | null) => void
}

function VerifiedSessionCard(props: {
  verified: VerifiedSession
  onReset: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const rows = [
    { label: t('Account'), value: props.verified.email },
    { label: t('Current plan'), value: props.verified.plan },
    {
      label: t('Session expires'),
      value: props.verified.expiresAt?.toLocaleString(locale) ?? '',
    },
  ].filter((row) => row.value !== '')

  return (
    <div
      role='status'
      className='rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4'
    >
      <div className='flex items-start justify-between gap-3'>
        <div className='flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400'>
          <CircleCheck className='size-5' aria-hidden='true' />
          {t('Session verified')}
        </div>
        <Button variant='ghost' size='sm' onClick={props.onReset}>
          {t('Change')}
        </Button>
      </div>
      {rows.length > 0 && (
        <dl className='mt-3 grid gap-2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6'>
          {rows.map((row) => (
            <div key={row.label} className='contents'>
              <dt className='text-muted-foreground'>{row.label}</dt>
              <dd className='font-medium break-all'>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

/** Second checkout step: verify the ChatGPT session and fill other fields. */
export function AccountStep(props: AccountStepProps) {
  const { t } = useTranslation()
  const sessionField = props.sessionField
  const sessionName = sessionField
    ? (`inputs.${sessionField.key}` as const)
    : undefined

  const verify = () => {
    if (!sessionName) return
    const value = props.form.getValues(sessionName).trim()
    const result = parseChatGPTSession(value)
    if (!result.ok) {
      props.onVerifiedChange(null)
      props.form.setError(sessionName, { message: t(result.errorKey) })
      return
    }
    props.form.clearErrors(sessionName)
    props.form.setValue(sessionName, value)
    props.onVerifiedChange({ ...result, value })
  }

  return (
    <div className='space-y-6'>
      {sessionField && sessionName && (
        <section className='bg-card space-y-6 rounded-2xl border p-5 sm:p-6'>
          <div className='space-y-1'>
            <h2 className='text-lg font-semibold'>
              {t('Verify your ChatGPT account')}
            </h2>
            <p className='text-muted-foreground text-sm'>
              {t(
                'We use the session to identify the account to upgrade. It takes about a minute.'
              )}
            </p>
          </div>

          <SessionGuide />

          {props.verified ? (
            <VerifiedSessionCard
              verified={props.verified}
              onReset={() => props.onVerifiedChange(null)}
            />
          ) : (
            <FormField
              control={props.form.control}
              name={sessionName}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {sessionField.label}
                    {sessionField.required && (
                      <span className='text-destructive' aria-hidden='true'>
                        *
                      </span>
                    )}
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={6}
                      spellCheck={false}
                      autoComplete='off'
                      placeholder={
                        sessionField.placeholder ||
                        '{"user":{...},"expires":"...","accessToken":"..."}'
                      }
                      className='min-h-36 font-mono text-xs'
                    />
                  </FormControl>
                  {sessionField.description && (
                    <FormDescription>{sessionField.description}</FormDescription>
                  )}
                  <FormMessage />
                  <div className='flex justify-end'>
                    <Button
                      type='button'
                      onClick={verify}
                      disabled={field.value.trim() === ''}
                    >
                      {t('Confirm')}
                    </Button>
                  </div>
                </FormItem>
              )}
            />
          )}

          <p className='text-muted-foreground flex items-start gap-2 text-xs leading-relaxed'>
            <ShieldCheck
              className='mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400'
              aria-hidden='true'
            />
            {t(
              'Your session is only used to activate this subscription and is hidden after the order is placed. Do not share it with anyone else.'
            )}
          </p>
        </section>
      )}

      <section className='bg-card space-y-4 rounded-2xl border p-5 sm:p-6'>
        {props.otherFields.map((field) => (
          <FormField
            key={field.key}
            control={props.form.control}
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
          control={props.form.control}
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
      </section>
    </div>
  )
}
