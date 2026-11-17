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
import { parseChatGPTSession } from '@/features/store/lib/chatgpt-session'
import {
  maskSessionKey,
  parseClaudeCookie,
} from '@/features/store/lib/claude-cookie'
import type { OrderFormValues } from '@/features/store/lib/order-form'
import { toIntlLocale } from '@/i18n/languages'

import { ClaudeCookieGuide } from './claude-cookie-guide'
import { SessionGuide } from './session-guide'

/** The account a ChatGPT session or a Claude cookie belongs to. */
export type VerifiedSession = {
  /** The exact text that passed verification; editing it voids the result. */
  value: string
  email: string
  plan: string
  expiresAt: Date | null
  /** Claude only: the masked session key and the last used organization. */
  sessionKey: string
  organization: string
}

type VerifyResult =
  | { ok: true; verified: VerifiedSession }
  | { ok: false; errorKey: string }

/**
 * Checks the pasted session or cookie of an account field. A Claude cookie
 * is replaced by the normalized form the server stores.
 */
function verifyAccountValue(
  field: ProductInputField,
  value: string
): VerifyResult {
  if (field.type === 'claude_cookie') {
    const cookie = parseClaudeCookie(value)
    if (!cookie.ok) return cookie
    return {
      ok: true,
      verified: {
        value: cookie.cookie,
        email: '',
        plan: '',
        expiresAt: null,
        sessionKey: maskSessionKey(cookie.sessionKey),
        organization: cookie.organization,
      },
    }
  }
  const session = parseChatGPTSession(value)
  if (!session.ok) return session
  return {
    ok: true,
    verified: {
      value,
      email: session.email,
      plan: session.plan,
      expiresAt: session.expiresAt,
      sessionKey: '',
      organization: '',
    },
  }
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
  isClaude: boolean
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
    { label: t('Session key'), value: props.verified.sessionKey },
    { label: t('Organization'), value: props.verified.organization },
  ].filter((row) => row.value !== '')

  return (
    <div
      role='status'
      className='rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4'
    >
      <div className='flex items-start justify-between gap-3'>
        <div className='flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400'>
          <CircleCheck className='size-5' aria-hidden='true' />
          {props.isClaude ? t('Cookie verified') : t('Session verified')}
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

/**
 * Second checkout step: verify the ChatGPT session or Claude cookie and fill
 * other fields.
 */
export function AccountStep(props: AccountStepProps) {
  const { t } = useTranslation()
  const sessionField = props.sessionField
  const sessionName = sessionField
    ? (`inputs.${sessionField.key}` as const)
    : undefined
  const isClaude = sessionField?.type === 'claude_cookie'

  const verify = () => {
    if (!sessionField || !sessionName) return
    const value = props.form.getValues(sessionName).trim()
    const result = verifyAccountValue(sessionField, value)
    if (!result.ok) {
      props.onVerifiedChange(null)
      props.form.setError(sessionName, { message: t(result.errorKey) })
      return
    }
    props.form.clearErrors(sessionName)
    props.form.setValue(sessionName, result.verified.value)
    props.onVerifiedChange(result.verified)
  }

  let placeholder = '{"user":{...},"expires":"...","accessToken":"..."}'
  if (isClaude) placeholder = 'sessionKey=sk-ant-sid01-...'
  if (sessionField?.placeholder) placeholder = sessionField.placeholder

  return (
    <div className='space-y-6'>
      {sessionField && sessionName && (
        <section className='bg-card space-y-6 rounded-2xl border p-5 sm:p-6'>
          <div className='space-y-1'>
            <h2 className='text-lg font-semibold'>
              {isClaude
                ? t('Verify your Claude account')
                : t('Verify your ChatGPT account')}
            </h2>
            <p className='text-muted-foreground text-sm'>
              {isClaude
                ? t(
                    'We use the cookie to identify the account to upgrade. It takes about a minute.'
                  )
                : t(
                    'We use the session to identify the account to upgrade. It takes about a minute.'
                  )}
            </p>
          </div>

          {isClaude ? <ClaudeCookieGuide /> : <SessionGuide />}

          {props.verified ? (
            <VerifiedSessionCard
              verified={props.verified}
              isClaude={isClaude}
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
                      placeholder={placeholder}
                      className='min-h-36 font-mono text-xs'
                    />
                  </FormControl>
                  {sessionField.description && (
                    <FormDescription>
                      {sessionField.description}
                    </FormDescription>
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
            {isClaude
              ? t(
                  'Your cookie is only used to activate this subscription and is hidden after the order is placed. Do not share it with anyone else.'
                )
              : t(
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
