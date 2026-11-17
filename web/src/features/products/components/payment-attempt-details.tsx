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
import {
  ChevronDown,
  Circle,
  CircleCheck,
  CircleX,
  LoaderCircle,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { formatTimestampToDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  PRODUCT_FULFILLMENT_STEP_STATUSES,
  PRODUCT_FULFILLMENT_STEPS,
} from '../constants'
import { getAttemptProgress } from '../lib/fulfillment'
import type {
  ProductFulfillmentAttempt,
  ProductFulfillmentStepKey,
  ProductFulfillmentStepStatus,
} from '../types'

const STEP_ICONS: Record<
  ProductFulfillmentStepStatus,
  { icon: LucideIcon; className: string }
> = {
  pending: { icon: Circle, className: 'text-muted-foreground' },
  running: { icon: LoaderCircle, className: 'text-chart-1 animate-spin' },
  succeeded: { icon: CircleCheck, className: 'text-success' },
  failed: { icon: CircleX, className: 'text-destructive' },
}

type PaymentAttemptDetailsProps = {
  attempt: ProductFulfillmentAttempt
}

/**
 * One payment attempt: where it stands, each step with its result, and the
 * full log of what the fulfiller reported.
 */
export function PaymentAttemptDetails(props: PaymentAttemptDetailsProps) {
  const { t } = useTranslation()
  const attempt = props.attempt
  const progress = getAttemptProgress(attempt)
  const stepLabel = (key: string) => {
    const config = PRODUCT_FULFILLMENT_STEPS[key as ProductFulfillmentStepKey]
    return config ? t(config.labelKey) : key
  }

  let nextStep = t('None, the payment succeeded')
  if (progress.next) {
    nextStep = stepLabel(progress.next.key)
  } else if (attempt.status === 'running') {
    nextStep = '-'
  } else if (attempt.status === 'failed') {
    nextStep = t('None, the attempt stopped')
  }
  const summary: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: t('Current step'),
      value: progress.current ? (
        <span className='inline-flex flex-wrap items-center gap-2'>
          {stepLabel(progress.current.key)}
          <StatusBadge
            label={t(
              PRODUCT_FULFILLMENT_STEP_STATUSES[progress.current.status]
                .labelKey
            )}
            variant={
              PRODUCT_FULFILLMENT_STEP_STATUSES[progress.current.status].variant
            }
            copyable={false}
          />
        </span>
      ) : (
        '-'
      ),
    },
    { label: t('Next step'), value: nextStep },
    {
      label: t('Plan to buy'),
      value: <span className='font-mono'>{attempt.plan}</span>,
    },
    {
      label: t('Started by'),
      value: attempt.operator_name || `ID ${attempt.operator_id}`,
    },
    { label: t('Started'), value: formatTimestampToDate(attempt.started_at) },
    {
      label: t('Finished'),
      value:
        attempt.finished_at > 0
          ? formatTimestampToDate(attempt.finished_at)
          : t('Still running'),
    },
  ]

  return (
    <div className='space-y-4'>
      <dl className='grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2'>
        {summary.map((row) => (
          <div key={row.label} className='flex min-w-0 gap-2'>
            <dt className='text-muted-foreground shrink-0'>{row.label}</dt>
            <dd className='min-w-0 break-words'>{row.value}</dd>
          </div>
        ))}
      </dl>

      <ol className='space-y-3' aria-label={t('Payment steps')}>
        {attempt.steps.map((step, index) => {
          const statusConfig = PRODUCT_FULFILLMENT_STEP_STATUSES[step.status]
          const icon = STEP_ICONS[step.status] ?? STEP_ICONS.pending
          const Icon = icon.icon
          return (
            <li key={step.key} className='flex gap-3'>
              <Icon
                className={cn('mt-0.5 size-4 shrink-0', icon.className)}
                aria-hidden='true'
              />
              <div className='min-w-0 flex-1 space-y-1'>
                <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
                  <span
                    className={cn(
                      'text-sm font-medium',
                      step.status === 'pending' && 'text-muted-foreground'
                    )}
                  >
                    {index + 1}. {stepLabel(step.key)}
                  </span>
                  <span className='sr-only'>
                    {statusConfig ? t(statusConfig.labelKey) : step.status}
                  </span>
                  {step.started_at > 0 && (
                    <span className='text-muted-foreground font-mono text-xs'>
                      {formatTimestampToDate(step.started_at)}
                      {step.finished_at > 0 &&
                        step.finished_at !== step.started_at &&
                        ` → ${formatTimestampToDate(step.finished_at)}`}
                    </span>
                  )}
                </div>
                {step.message && (
                  <p
                    className={cn(
                      'text-sm break-words',
                      step.status === 'failed'
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                    )}
                  >
                    {t(step.message, step.params)}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      <Collapsible>
        <CollapsibleTrigger className='group text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 text-sm font-medium'>
          <ChevronDown
            className='size-4 transition-transform group-data-[panel-open]:rotate-180'
            aria-hidden='true'
          />
          {t('Detailed log ({{count}})', { count: attempt.events.length })}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className='bg-muted/50 mt-2 max-h-72 space-y-1.5 overflow-y-auto rounded-md p-3 text-xs'>
            {attempt.events.map((event) => (
              <li
                key={`${event.at}|${event.step}|${event.status}|${event.message}|${JSON.stringify(event.params ?? {})}`}
                className='break-words'
              >
                <span className='text-muted-foreground font-mono'>
                  {formatTimestampToDate(event.at)}
                </span>{' '}
                {event.step && (
                  <span className='font-medium'>
                    [{stepLabel(event.step)}]{' '}
                  </span>
                )}
                {t(event.message, event.params)}
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
